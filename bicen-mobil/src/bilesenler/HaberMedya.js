/**
 * Biçen'den Haberler · medya (12.10.2026, 1.7)
 * ---------------------------------------------------------------------------
 *  - ZoomluGorsel: iki parmakla büyütme. Akışta Instagram'daki gibi
 *    bırakınca yerine döner; tam ekranda (kalici) büyük kalır, tek parmakla
 *    gezilir, çift dokunuş büyütür/küçültür.
 *  - TamEkranGorseller: siyah zeminde, kaydırmalı, yakınlaştırılabilir.
 *  - HaberVideo: ekrana gelince sessiz oynar, dokununca ses açılır;
 *    tam ekran düğmesi. Oynatıcı expo-video; derlemede yoksa video
 *    tarayıcıda açılır.
 *
 * Ek paket yok: dokunuşlar PanResponder ile. Gesture-handler eklemek yeni
 * yerel modül demekti.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Dimensions,
  StyleSheet,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

let Video = null;
try {
  // eslint-disable-next-line global-require
  Video = require("expo-video");
  if (!Video?.VideoView || !Video?.useVideoPlayer) Video = null;
} catch {
  Video = null;
}

const mesafe = (t) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
const orta = (t) => ({ x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 });
const yay = (v, deger) => Animated.spring(v, { toValue: deger, useNativeDriver: true, friction: 7, tension: 70 });

/* ========================================================================== */
/* Yakınlaştırılabilir görsel                                                 */
/* ========================================================================== */

/**
 * @param kalici   true: bırakınca büyük kalır (tam ekran); false: yerine döner (akış)
 * @param onZoom   (büyütülmüş mü) — kaydırmalı listeyi kilitlemek için
 * @param onDokun  tek dokunuş (çift dokunuş ayrı)
 * @param onCiftDokun çift dokunuş (akışta beğeni); kalici'de büyüt/küçült
 */
export function ZoomluGorsel({ uri, genislik, yukseklik, kalici = false, enCok = 4, onZoom, onDokun, onCiftDokun, arkaPlan = "#f4f5f2" }) {
  const olcek = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;

  const d = useRef({ s: 1, x: 0, y: 0, bas: null, dokunus: 0, zoomda: false, sonDokunus: 0, tekZaman: null }).current;
  const [zoomda, setZoomda] = useState(false);

  const zoomBildir = (z) => {
    if (d.zoomda === z) return;
    d.zoomda = z;
    setZoomda(z);
    onZoom?.(z);
  };

  const uygula = (s, tx, ty) => {
    d.s = s;
    d.x = tx;
    d.y = ty;
    olcek.setValue(s);
    x.setValue(tx);
    y.setValue(ty);
  };

  const sinirla = (s, tx, ty) => {
    const mx = (genislik * (s - 1)) / 2;
    const my = (yukseklik * (s - 1)) / 2;
    return [Math.max(-mx, Math.min(mx, tx)), Math.max(-my, Math.min(my, ty))];
  };

  const sifirla = () => {
    d.s = 1;
    d.x = 0;
    d.y = 0;
    Animated.parallel([yay(olcek, 1), yay(x, 0), yay(y, 0)]).start();
    zoomBildir(false);
  };

  const buyut = (s) => {
    d.s = s;
    d.x = 0;
    d.y = 0;
    Animated.parallel([yay(olcek, s), yay(x, 0), yay(y, 0)]).start();
    zoomBildir(true);
  };

  const baslat = (t) => {
    d.bas =
      t.length >= 2
        ? { m: Math.max(1, mesafe(t)), o: orta(t), s: d.s, x: d.x, y: d.y }
        : { o: { x: t[0].pageX, y: t[0].pageY }, s: d.s, x: d.x, y: d.y };
    d.dokunus = t.length;
  };

  const pr = useMemo(
    () =>
      PanResponder.create({
        /* İki parmak ya da (tam ekranda) büyütülmüşken sürükleme: görsel
           üstlenir. Tek dokunuş ve yatay kaydırma alttaki bileşenlere kalır. */
        onStartShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponderCapture: (e, g) =>
          e.nativeEvent.touches.length >= 2 || (kalici && d.s > 1.01 && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3)),
        onPanResponderGrant: (e) => baslat(e.nativeEvent.touches),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (e) => {
          const t = e.nativeEvent.touches;
          if (!t.length) return;
          if (t.length !== d.dokunus || !d.bas) baslat(t);

          if (t.length >= 2) {
            const s = Math.max(kalici ? 1 : 0.9, Math.min(enCok, (d.bas.s * mesafe(t)) / d.bas.m));
            const o = orta(t);
            let tx = d.bas.x + (o.x - d.bas.o.x);
            let ty = d.bas.y + (o.y - d.bas.o.y);
            if (kalici) [tx, ty] = sinirla(s, tx, ty);
            uygula(s, tx, ty);
            zoomBildir(true);
          } else if (kalici && d.s > 1.01) {
            const [tx, ty] = sinirla(d.s, d.bas.x + (t[0].pageX - d.bas.o.x), d.bas.y + (t[0].pageY - d.bas.o.y));
            uygula(d.s, tx, ty);
          }
        },
        onPanResponderRelease: () => {
          d.dokunus = 0;
          d.bas = null;
          if (!kalici || d.s < 1.05) sifirla();
        },
        onPanResponderTerminate: () => {
          d.dokunus = 0;
          d.bas = null;
          if (!kalici || d.s < 1.05) sifirla();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kalici, genislik, yukseklik, enCok]
  );

  /* Tek / çift dokunuş: çift dokunuşu beklemek için tek dokunuş 260 ms gecikiyor */
  const dokun = () => {
    const simdi = Date.now();
    if (simdi - d.sonDokunus < 280) {
      d.sonDokunus = 0;
      if (d.tekZaman) clearTimeout(d.tekZaman);
      d.tekZaman = null;
      if (kalici) {
        if (d.s > 1.05) sifirla();
        else buyut(2.5);
      } else onCiftDokun?.();
      return;
    }
    d.sonDokunus = simdi;
    if (onDokun) {
      if (d.tekZaman) clearTimeout(d.tekZaman);
      d.tekZaman = setTimeout(() => {
        d.tekZaman = null;
        onDokun();
      }, 280);
    }
  };

  useEffect(() => () => d.tekZaman && clearTimeout(d.tekZaman), [d]);

  return (
    <View
      {...pr.panHandlers}
      style={{ width: genislik, height: yukseklik, backgroundColor: arkaPlan, overflow: kalici ? "hidden" : "visible", zIndex: zoomda ? 20 : 0, elevation: zoomda ? 20 : 0 }}
    >
      <TouchableWithoutFeedback onPress={dokun}>
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={{
            width: genislik,
            height: yukseklik,
            transform: [{ translateX: x }, { translateY: y }, { scale: olcek }],
          }}
        />
      </TouchableWithoutFeedback>
    </View>
  );
}

/* ========================================================================== */
/* Tam ekran görseller                                                        */
/* ========================================================================== */

export function TamEkranGorseller({ gorseller, baslangic = 0, kapat }) {
  const ic = useSafeAreaInsets();
  const { width: W, height: H } = Dimensions.get("window");
  const [sira, setSira] = useState(baslangic);
  const [zoomda, setZoomda] = useState(false);
  const liste = useRef(null);

  useEffect(() => {
    setSira(baslangic);
    setZoomda(false);
    const t = setTimeout(() => liste.current?.scrollTo?.({ x: baslangic * W, animated: false }), 0);
    return () => clearTimeout(t);
  }, [baslangic, gorseller, W]);

  if (!gorseller?.length) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={kapat} statusBarTranslucent transparent={false}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <ScrollView
          ref={liste}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomda}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setSira(Math.round(e.nativeEvent.contentOffset.x / W))}
          contentOffset={{ x: baslangic * W, y: 0 }}
        >
          {gorseller.map((g, i) => (
            <ZoomluGorsel key={`${g}-${i}`} uri={g} genislik={W} yukseklik={H} kalici arkaPlan="#000" onZoom={setZoomda} />
          ))}
        </ScrollView>

        <View style={[t.ust, { top: ic.top + 8 }]} pointerEvents="box-none">
          {gorseller.length > 1 ? (
            <View style={t.sayac}>
              <Text style={t.sayacYazi}>
                {sira + 1}/{gorseller.length}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <TouchableOpacity style={t.kapat} onPress={kapat} hitSlop={12} accessibilityLabel="Kapat">
            <Text style={t.kapatYazi}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={[t.ipucu, { bottom: ic.bottom + 18 }]} pointerEvents="none">
          İki parmakla büyütün · çift dokunun
        </Text>
      </View>
    </Modal>
  );
}

/* ========================================================================== */
/* Video                                                                      */
/* ========================================================================== */

/**
 * @param gorunur  ekranda mı: görünürken sessiz oynar, çıkınca durur
 */
export function HaberVideo({ uri, genislik, gorunur, onCiftDokun }) {
  if (!uri) return null;

  if (!Video)
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => Linking.openURL(uri).catch(() => undefined)}
        style={[t.videoYok, { width: genislik, height: genislik * 0.5625 }]}
      >
        <View style={t.oynatDaire}>
          <Text style={t.oynatYazi}>▶</Text>
        </View>
        <Text style={{ color: "#fff", fontWeight: "700", marginTop: 10 }}>Videoyu aç</Text>
      </TouchableOpacity>
    );

  return <VideoIc uri={uri} genislik={genislik} gorunur={gorunur} onCiftDokun={onCiftDokun} />;
}

function VideoIc({ uri, genislik, gorunur, onCiftDokun }) {
  const oynatici = Video.useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const gorunum = useRef(null);
  const [sessiz, setSessiz] = useState(true);
  const [oran, setOran] = useState(null);
  const [duraklatildi, setDuraklatildi] = useState(false);
  /* Tam ekranda telefonun denetimleri açık: kapalıyken tam ekrandan
     çıkılamıyordu (28.10.2026) */
  const [tamEkran, setTamEkran] = useState(false);
  const son = useRef(0);

  /* Videonun en/boy oranı: ilk görüntü izi gelince */
  useEffect(() => {
    let abonelik = null;
    try {
      abonelik = oynatici.addListener?.("videoTrackChange", (o) => {
        const b = o?.videoTrack?.size;
        if (b?.width > 0 && b?.height > 0) setOran(b.width / b.height);
      });
    } catch {
      abonelik = null;
    }
    return () => abonelik?.remove?.();
  }, [oynatici]);

  useEffect(() => {
    try {
      if (gorunur && !duraklatildi) oynatici.play();
      else oynatici.pause();
    } catch {
      /* oynatıcı kapanmış olabilir */
    }
  }, [gorunur, duraklatildi, oynatici]);

  const dokun = () => {
    const simdi = Date.now();
    if (simdi - son.current < 280) {
      son.current = 0;
      onCiftDokun?.();
      return;
    }
    son.current = simdi;
    /* Tek dokunuş: ses aç/kapat; durdurulmuşsa yeniden başlat */
    if (duraklatildi) {
      setDuraklatildi(false);
      return;
    }
    const yeni = !sessiz;
    setSessiz(yeni);
    try {
      oynatici.muted = yeni;
    } catch {
      /* yok sayılır */
    }
  };

  const yukseklik = genislik / Math.min(1.91, Math.max(0.75, oran ?? 16 / 9));

  return (
    <View style={{ width: genislik, height: yukseklik, backgroundColor: "#000" }}>
      <Video.VideoView
        ref={gorunum}
        player={oynatici}
        style={{ width: genislik, height: yukseklik }}
        contentFit="contain"
        nativeControls={tamEkran}
        allowsFullscreen
        fullscreenOptions={{ enable: true }}
        onFullscreenEnter={() => setTamEkran(true)}
        onFullscreenExit={() => setTamEkran(false)}
        allowsPictureInPicture={false}
      />
      <TouchableWithoutFeedback onPress={dokun} onLongPress={() => setDuraklatildi((x) => !x)}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      </TouchableWithoutFeedback>

      {duraklatildi ? (
        <View style={t.ortaKatman} pointerEvents="none">
          <View style={t.oynatDaire}>
            <Text style={t.oynatYazi}>▶</Text>
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        style={[t.videoDugme, { right: 10 }]}
        onPress={dokun}
        hitSlop={8}
        accessibilityLabel={sessiz ? "Sesi aç" : "Sesi kapat"}
      >
        <Text style={t.videoDugmeYazi}>{sessiz ? "🔇" : "🔊"}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[t.videoDugme, { right: 52 }]}
        onPress={() => {
          try {
            setTamEkran(true);
            gorunum.current?.enterFullscreen?.();
          } catch {
            Linking.openURL(uri).catch(() => undefined);
          }
        }}
        hitSlop={8}
        accessibilityLabel="Tam ekran"
      >
        <Text style={t.videoDugmeYazi}>⤢</Text>
      </TouchableOpacity>
      <View style={t.videoRozet} pointerEvents="none">
        <Text style={{ color: "#fff", fontSize: 9 }}>▶</Text>
        <Text style={t.videoRozetYazi}>Video</Text>
      </View>
    </View>
  );
}

const t = StyleSheet.create({
  ust: { position: "absolute", left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sayac: { backgroundColor: "rgba(255,255,255,.18)", borderRadius: 99, paddingHorizontal: 11, paddingVertical: 4 },
  sayacYazi: { color: "#fff", fontWeight: "700", fontSize: 13 },
  kapat: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  kapatYazi: { color: "#fff", fontSize: 18, fontWeight: "700" },
  ipucu: { position: "absolute", left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,.6)", fontSize: 12.5 },

  videoYok: { backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  ortaKatman: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  oynatDaire: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(0,0,0,.55)", alignItems: "center", justifyContent: "center" },
  oynatYazi: { color: "#fff", fontSize: 26, marginLeft: 4 },
  videoDugme: {
    position: "absolute",
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(20,20,20,.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoDugmeYazi: { color: "#fff", fontSize: 15 },
  videoRozet: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(20,20,20,.6)",
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  videoRozetYazi: { color: "#fff", fontSize: 11.5, fontWeight: "700" },
});

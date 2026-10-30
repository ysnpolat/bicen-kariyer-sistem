/**
 * Çalışan aydınlatma metni (08.10.2026, 1.7)
 * ---------------------------------------------------------------------------
 * Uygulama açılınca sunucuya sorulur; kişinin onayı yoksa metin tam ekran
 * açılır ve kapatılamaz. Metin sonuna kadar kaydırılınca onay kutusu açılır,
 * "Okudum, onaylıyorum" ile kayıt sunucuya (sürüm, metin özeti, cihaz,
 * uygulama sürümü, IP) yazılır. Bir kez onaylayan bir daha görmez; işe yeni
 * giren kişi ilk açılışında görür. İK metni değiştirip "herkes yeniden
 * onaylasın" derse herkes yeni metni bir kez daha görür.
 *
 * Sunucuya ulaşılamazsa sessizce geçilir: denetim uygulamayı ağ hatası
 * yüzünden kilitlememeli; bir sonraki açılışta yeniden sorulur.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import ModalAlani, { modalTamEkran } from "./ModalAlani";

import { aydinlatmaAl, aydinlatmaOnayla } from "../api";
import { renk } from "../tema";
import Simge from "./Simge";

const ARALIK_MS = 30 * 60 * 1000;

/** Satırı madde ya da başlık olarak biçimlendirir */
function Satir({ metin }) {
  const t = metin.trim();
  if (!t) return <View style={{ height: 8 }} />;
  if (t.startsWith("•"))
    return (
      <View style={s.madde}>
        <Text style={s.maddeIsaret}>•</Text>
        <Text style={s.govde}>{t.slice(1).trim()}</Text>
      </View>
    );
  /* "1. İşlenen Kişisel Verileriniz" gibi bölüm başlıkları */
  if (/^\d+\.\s/.test(t) && t.length < 90) return <Text style={s.bolum}>{t}</Text>;
  return <Text style={s.govde}>{t}</Text>;
}

export default function AydinlatmaPenceresi() {
  const [veri, setVeri] = useState(null);
  const [sonuna, setSonuna] = useState(false);
  const [isaret, setIsaret] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const sonSorgu = useRef(0);
  const yukseklik = useRef(0);

  const denetle = useCallback(async (zorla) => {
    if (!zorla && Date.now() - sonSorgu.current < ARALIK_MS) return;
    sonSorgu.current = Date.now();
    try {
      const c = await aydinlatmaAl();
      if (c?.bekliyor && c.metin) {
        setVeri(c);
        setSonuna(false);
        setIsaret(false);
      } else setVeri(null);
    } catch {
      /* ağ hatası: bir sonraki açılışta */
    }
  }, []);

  useEffect(() => {
    denetle(true);
    const dinleyici = AppState.addEventListener?.("change", (d) => d === "active" && denetle(false));
    return () => dinleyici?.remove?.();
  }, [denetle]);

  const onayla = async () => {
    if (!veri || !isaret) return;
    setGonderiliyor(true);
    try {
      await aydinlatmaOnayla(veri.surum, veri.ozet);
      setVeri(null);
    } catch (e) {
      Alert.alert("Kaydedilemedi", e?.message ?? "Bağlantınızı kontrol edip yeniden deneyiniz.");
      /* Metin bu arada güncellendiyse yenisi gelsin */
      denetle(true);
    } finally {
      setGonderiliyor(false);
    }
  };

  if (!veri) return null;

  return (
    /* 09.10.2026: pencere kendi güvenli alanını ölçüyor (ModalAlani); önceki
       SafeAreaView Modal içinde boşluğu 0 alıyor, başlık saatin altına giriyordu */
    <Modal visible animationType="slide" onRequestClose={() => {}} {...modalTamEkran}>
      <ModalAlani style={s.sayfa} edges={["top", "bottom"]}>
        <View style={s.bas}>
          <View style={s.rozet}>
            <Simge ad="kalkan" boyut={20} renkli={renk.yesilKoyu} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.ust}>KİŞİSEL VERİLERİNİZ</Text>
            <Text style={s.baslik}>{veri.baslik}</Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.icerik}
          scrollEventThrottle={64}
          onLayout={(e) => (yukseklik.current = e.nativeEvent.layout.height)}
          onContentSizeChange={(_, h) => {
            /* Metin ekrana sığıyorsa kaydırma beklenmez */
            if (yukseklik.current && h <= yukseklik.current + 20) setSonuna(true);
          }}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 60) setSonuna(true);
          }}
        >
          {veri.metin.split("\n").map((t, i) => (
            <Satir key={i} metin={t} />
          ))}
        </ScrollView>

        <View style={s.alt}>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={!sonuna}
            onPress={() => setIsaret((x) => !x)}
            style={[s.kutuSatir, !sonuna && { opacity: 0.45 }]}
          >
            <View style={[s.kutu, isaret && s.kutuSecili]}>{isaret ? <Simge ad="onay" boyut={14} renkli={renk.beyaz} /> : null}</View>
            <Text style={s.onayMetni}>{veri.onayMetni}</Text>
          </TouchableOpacity>
          {!sonuna ? <Text style={s.ipucu}>Onaylamak için metni sonuna kadar kaydırın.</Text> : null}

          <TouchableOpacity style={[s.dugme, (!isaret || gonderiliyor) && s.dugmePasif]} disabled={!isaret || gonderiliyor} onPress={onayla}>
            {gonderiliyor ? <ActivityIndicator color={renk.beyaz} /> : <Text style={s.dugmeYazi}>{veri.dugme ?? "Okudum, onaylıyorum"}</Text>}
          </TouchableOpacity>
        </View>
      </ModalAlani>
    </Modal>
  );
}

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.beyaz },
  bas: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: renk.cizgi },
  rozet: { width: 40, height: 40, borderRadius: 12, backgroundColor: renk.yesilAcik, alignItems: "center", justifyContent: "center" },
  ust: { fontSize: 11, fontWeight: "800", color: renk.yesilKoyu, letterSpacing: 0.6 },
  baslik: { fontSize: 15.5, fontWeight: "800", color: renk.metin, lineHeight: 20, marginTop: 2 },
  icerik: { paddingHorizontal: 18, paddingVertical: 14, gap: 4 },
  bolum: { fontSize: 15, fontWeight: "800", color: renk.metin, marginTop: 10, marginBottom: 2 },
  govde: { flex: 1, fontSize: 14, lineHeight: 21, color: "#374151" },
  madde: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  maddeIsaret: { fontSize: 14, lineHeight: 21, color: renk.yesilKoyu, fontWeight: "900" },
  alt: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: renk.cizgi, gap: 10, backgroundColor: "#fafbf8" },
  kutuSatir: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  kutu: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: renk.yesil, alignItems: "center", justifyContent: "center", marginTop: 1 },
  kutuSecili: { backgroundColor: renk.yesil },
  onayMetni: { flex: 1, fontSize: 13.5, lineHeight: 19, color: renk.metin, fontWeight: "600" },
  ipucu: { fontSize: 12, color: renk.pasif, marginTop: -4, marginLeft: 32 },
  dugme: { height: 50, borderRadius: 14, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  dugmePasif: { backgroundColor: "#b9c7a6" },
  dugmeYazi: { color: renk.beyaz, fontSize: 16, fontWeight: "800" },
});

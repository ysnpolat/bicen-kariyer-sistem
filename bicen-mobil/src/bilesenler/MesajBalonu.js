/**
 * Mesaj balonu (1.9 · 23.10.2026)
 * ---------------------------------------------------------------------------
 * Uygulama açıkken yeni mesaj geldiğinde ekranın üstünden kayan balon
 * (WhatsApp gibi): gönderen, mesaj, "Yanıtla" ile balonun içinden cevap,
 * "Okundu" ile okundu işareti. Balona dokununca sohbet açılıyor.
 *
 * Kaynak /api/Mesajlasma/Ozet: panelle aynı uç, 6 saniyede bir ve yalnız
 * uygulama ön plandayken. Arka planda anlık bildirim (push) devrede;
 * balon çalışırken ön plandaki mesaj bildirimi sistem şeridi olarak
 * çıkmıyor (bildirim.js mesajBalonu.etkin).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mesajOzet, mesajGonder, mesajOkundu } from "../api";
import { mesajBalonu } from "../bildirim";
import { aktifSohbet } from "../ekranlar/Mesajlar";
import { renk } from "../tema";
import Simge from "./Simge";

export default function MesajBalonu({ etkin, ac, okunmamisDegisti }) {
  const ust = useSafeAreaInsets().top;
  const [mesaj, setMesaj] = useState(null);
  const [yanitAcik, setYanitAcik] = useState(false);
  const [metin, setMetin] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [bilgi, setBilgi] = useState("");
  const kayma = useRef(new Animated.Value(-220)).current;
  const son = useRef(0);
  const gizleZamani = useRef(null);
  const yanitRef = useRef(false);
  yanitRef.current = yanitAcik;

  useEffect(() => {
    mesajBalonu.etkin = !!etkin;
    return () => {
      mesajBalonu.etkin = false;
    };
  }, [etkin]);

  const gizle = useCallback(() => {
    clearTimeout(gizleZamani.current);
    Animated.timing(kayma, { toValue: -220, duration: 220, useNativeDriver: true }).start(() => {
      setMesaj(null);
      setYanitAcik(false);
      setMetin("");
      setBilgi("");
    });
  }, [kayma]);

  const zamanla = useCallback(
    (ms = 6500) => {
      clearTimeout(gizleZamani.current);
      gizleZamani.current = setTimeout(() => {
        if (!yanitRef.current) gizle();
      }, ms);
    },
    [gizle]
  );

  const goster = useCallback(
    (m) => {
      setMesaj(m);
      setYanitAcik(false);
      setMetin("");
      setBilgi("");
      Vibration.vibrate(60);
      Animated.spring(kayma, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      zamanla();
    },
    [kayma, zamanla]
  );

  /* Özet sorgusu */
  useEffect(() => {
    if (!etkin) return undefined;
    let iptal = false;

    const sor = async () => {
      if (AppState.currentState !== "active") return;
      try {
        const d = await mesajOzet(son.current);
        if (iptal) return;
        okunmamisDegisti?.(d?.okunmamis ?? 0);
        const ilk = son.current === 0;
        son.current = Math.max(son.current, d?.sonId ?? 0);
        if (ilk) return;
        const yeniler = (d?.yeniler ?? []).filter((x) => x.sohbetId !== aktifSohbet.id);
        if (yeniler.length && !yanitRef.current) goster({ ...yeniler[yeniler.length - 1], adet: yeniler.length });
      } catch {
        /* sessiz: bir sonraki turda */
      }
    };

    sor();
    const z = setInterval(sor, 6000);
    const a = AppState.addEventListener("change", (d) => d === "active" && sor());
    return () => {
      iptal = true;
      clearInterval(z);
      a.remove();
    };
  }, [etkin, goster, okunmamisDegisti]);

  const gonder = async () => {
    const t = metin.trim();
    if (!t || !mesaj) return;
    setGonderiliyor(true);
    try {
      await mesajGonder(mesaj.sohbetId, t, mesaj.id);
      mesajOkundu(mesaj.sohbetId, mesaj.id).catch(() => undefined);
      Keyboard.dismiss();
      setYanitAcik(false);
      setBilgi("✓ Yanıt gönderildi");
      zamanla(1400);
    } catch (h) {
      setBilgi(h?.message ?? "Gönderilemedi");
    } finally {
      setGonderiliyor(false);
    }
  };

  if (!mesaj) return null;

  return (
    <Animated.View pointerEvents="box-none" style={[s.kap, { top: ust + 6, transform: [{ translateY: kayma }] }]}>
      <View style={s.balon}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={s.ustSatir}
          onPress={() => {
            const m = mesaj;
            gizle();
            ac(m.sohbetId);
          }}
        >
          <View style={s.simge}>
            <Simge ad="mesaj" renkli="#fff" boyut={20} dolgu />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.baslik} numberOfLines={1}>
              {mesaj.baslik}
              {mesaj.adet > 1 ? <Text style={s.adet}>  +{mesaj.adet - 1} yeni</Text> : null}
            </Text>
            <Text style={s.metin} numberOfLines={yanitAcik ? 4 : 2}>
              {mesaj.grup ? `${(mesaj.gonderenAd ?? "").split(" ")[0]}: ` : ""}
              {mesaj.metin}
            </Text>
          </View>
          <TouchableOpacity onPress={gizle} hitSlop={10}>
            <Text style={s.kapat}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        {bilgi ? <Text style={s.bilgi}>{bilgi}</Text> : null}

        {yanitAcik ? (
          <View style={s.yanitSatir}>
            <TextInput
              value={metin}
              onChangeText={setMetin}
              placeholder="Yanıt yazın"
              placeholderTextColor="#9aa093"
              style={s.girdi}
              autoFocus
              multiline
            />
            <TouchableOpacity style={[s.gonder, !metin.trim() && { opacity: 0.45 }]} disabled={!metin.trim() || gonderiliyor} onPress={gonder}>
              {gonderiliyor ? <ActivityIndicator color="#fff" size="small" /> : <Simge ad="gonder" renkli="#fff" boyut={18} />}
            </TouchableOpacity>
          </View>
        ) : !bilgi ? (
          <View style={s.dugmeler}>
            <TouchableOpacity
              style={s.dugme}
              onPress={() => {
                mesajOkundu(mesaj.sohbetId, mesaj.id).catch(() => undefined);
                gizle();
              }}
            >
              <Text style={s.dugmeYazi}>Okundu</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.dugme, s.dugmeAna]}
              onPress={() => {
                clearTimeout(gizleZamani.current);
                setYanitAcik(true);
              }}
            >
              <Text style={[s.dugmeYazi, { color: "#fff" }]}>Yanıtla</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  kap: { position: "absolute", left: 8, right: 8, zIndex: 1000, elevation: 30 },
  balon: {
    backgroundColor: "#1f2a1a",
    borderRadius: 18,
    padding: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  ustSatir: { flexDirection: "row", alignItems: "center", gap: 10 },
  simge: { width: 38, height: 38, borderRadius: 19, backgroundColor: renk.yesil, alignItems: "center", justifyContent: "center" },
  baslik: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  adet: { color: "#b5d98a", fontWeight: "600", fontSize: 12 },
  metin: { color: "#dfe7d8", fontSize: 14, marginTop: 1 },
  kapat: { color: "#9fae95", fontSize: 16, paddingHorizontal: 4 },
  bilgi: { color: "#b5d98a", fontSize: 13, fontWeight: "600", marginLeft: 48 },
  dugmeler: { flexDirection: "row", gap: 8, marginLeft: 48 },
  dugme: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center", backgroundColor: "#ffffff1f" },
  dugmeAna: { backgroundColor: renk.yesilKoyu },
  dugmeYazi: { color: "#e6eedf", fontWeight: "700", fontSize: 13.5 },
  yanitSatir: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  girdi: { flex: 1, backgroundColor: "#fff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15.5, maxHeight: 110, color: renk.metin },
  gonder: { width: 40, height: 40, borderRadius: 20, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
});

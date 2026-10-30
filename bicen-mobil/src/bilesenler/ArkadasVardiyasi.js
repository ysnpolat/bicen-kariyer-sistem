/**
 * Ekip arkadaşının haftalık vardiyası
 * ---------------------------------------------------------------------------
 * Yalnızca gün ve saat. Kimin ne zaman çalıştığını bilmek günlük işin
 * parçası; izin, bakiye ve puantaj ayrıntısı burada gösterilmiyor, onu
 * yalnızca yönetici görüyor.
 */

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from "react-native";

import { vardiyaArkadasAl } from "../api";
import { renk } from "../tema";

const GUNLER = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export default function ArkadasVardiyasi({ sicil, adSoyad, pozisyon, kapat }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    let iptal = false;

    vardiyaArkadasAl(sicil)
      .then((c) => !iptal && setVeri(c))
      .catch((h) => !iptal && setHata(h.message));

    return () => {
      iptal = true;
    };
  }, [sicil]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={kapat}>
      <TouchableOpacity style={s.perde} activeOpacity={1} onPress={kapat}>
        <TouchableOpacity activeOpacity={1} style={s.kart}>
          <Text style={s.ad}>{adSoyad}</Text>
          <Text style={s.poz}>{pozisyon}</Text>

          {!veri && !hata ? (
            <ActivityIndicator color={renk.yesilKoyu} style={{ marginVertical: 24 }} />
          ) : hata ? (
            <Text style={s.hata}>{hata}</Text>
          ) : (
            <>
              <Text style={s.baslik}>BU HAFTANIN VARDİYASI</Text>

              {(veri.gunler ?? []).length === 0 ? (
                <Text style={[s.vardiya, { color: renk.pasif, fontWeight: "600", marginVertical: 12 }]}>
                  Bu haftanın planı henüz gönderilmedi.
                </Text>
              ) : null}

              {veri.gunler.map((g, i) => {
                const t = new Date(String(g.tarih).slice(0, 10) + "T00:00:00");

                return (
                  <View key={i} style={s.satir}>
                    <Text style={s.gun}>
                      {GUNLER[i]} {t.getDate()} {AYLAR[t.getMonth()]}
                    </Text>
                    <Text style={[s.vardiya, g.tur !== "vardiya" && { color: renk.pasif, fontWeight: "600" }]}>
                      {g.tur === "off" ? "—" : g.tur === "izin" ? "Haftalık izin" : g.ad}
                    </Text>
                  </View>
                );
              })}
            </>
          )}

          <TouchableOpacity style={s.kapat} onPress={kapat}>
            <Text style={s.kapatYazi}>Kapat</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: "rgba(20,24,18,0.45)", alignItems: "center", justifyContent: "center", padding: 22 },
  kart: { width: "100%", backgroundColor: renk.beyaz, borderRadius: 20, padding: 18 },
  ad: { fontSize: 17, fontWeight: "800", color: renk.metin },
  poz: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },
  baslik: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.7, marginTop: 16, marginBottom: 6 },
  satir: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: renk.cizgi },
  gun: { flex: 1, fontSize: 13, fontWeight: "700", color: renk.pasif },
  vardiya: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  hata: { color: renk.kirmizi, paddingVertical: 16, textAlign: "center" },
  kapat: { marginTop: 14, alignItems: "center", paddingVertical: 11, backgroundColor: renk.zemin, borderRadius: 12 },
  kapatYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },
});

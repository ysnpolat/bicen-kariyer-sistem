/**
 * Güncelleme denetimi (08.10.2026, 1.7)
 * ---------------------------------------------------------------------------
 * Uygulama açılınca ve öne gelince (en çok altı saatte bir) sunucuya
 * mağazadaki güncel ve en düşük kullanılabilir sürümü sorar. İkisi de İK
 * panelinden (Ayarlar Merkezi › Biçen360) değiştiriliyor.
 *
 *  - En düşük sürümden eskiyse: kapatılamayan pencere, "Uygulamayı
 *    güncelle" mağazayı açar. Eski sürümü kapatmak tek ayar.
 *  - Güncel sürümden eskiyse: "Güncelle / Sonra" penceresi; "Sonra"
 *    denince o gün tekrar sorulmaz.
 *
 * Bağlantı telefona göre Play Store ya da App Store'u açar. Sunucuya
 * ulaşılamazsa sessizce geçilir: denetim uygulamayı hiç engellememeli.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { uygulamaSurumAl } from "../api";
import { renk } from "../tema";

const ERTELE_ANAHTARI = "bicen_guncelleme_ertele";
const ARALIK_MS = 6 * 60 * 60 * 1000;

/** "1.6" / "1.6.2" karşılaştırması: a < b ise negatif */
const karsilastir = (a, b) => {
  const x = String(a ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const y = String(b ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

const bugun = () => new Date().toISOString().slice(0, 10);

export default function GuncellemeDenetimi() {
  const [durum, setDurum] = useState(null); // { zorunlu, guncel, link, baslik, mesaj }
  const sonSorgu = useRef(0);

  const denetle = useCallback(async () => {
    if (Date.now() - sonSorgu.current < ARALIK_MS) return;
    sonSorgu.current = Date.now();

    try {
      const benim = Constants.expoConfig?.version ?? "0";
      const c = await uygulamaSurumAl();
      if (!c?.guncel) return;

      const zorunlu = !!c.enDusuk && karsilastir(benim, c.enDusuk) < 0;
      const eski = karsilastir(benim, c.guncel) < 0;
      if (!zorunlu && !eski) {
        setDurum(null);
        return;
      }

      if (!zorunlu) {
        const ertele = await SecureStore.getItemAsync(ERTELE_ANAHTARI).catch(() => null);
        if (ertele === `${c.guncel}|${bugun()}`) return;
      }

      setDurum({ zorunlu, guncel: c.guncel, link: c.link, baslik: c.baslik, mesaj: c.mesaj, benim });
    } catch {
      /* Sunucuya ulaşılamadı: bir sonraki açılışta yeniden denenir */
      sonSorgu.current = 0;
    }
  }, []);

  useEffect(() => {
    denetle();
    const abone = AppState.addEventListener("change", (s) => {
      if (s === "active") denetle();
    });
    return () => abone.remove();
  }, [denetle]);

  if (!durum) return null;

  const guncelle = () => {
    Linking.openURL(durum.link || "https://kariyer.bicen.com.tr/indir").catch(() => {});
  };

  const sonra = async () => {
    await SecureStore.setItemAsync(ERTELE_ANAHTARI, `${durum.guncel}|${bugun()}`).catch(() => {});
    setDurum(null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={durum.zorunlu ? () => {} : sonra}>
      <View style={s.perde}>
        <View style={s.kart}>
          <Text style={s.baslik}>{durum.zorunlu ? "Güncelleme gerekiyor" : durum.baslik || "Yeni sürüm yayında"}</Text>
          <Text style={s.metin}>
            {durum.zorunlu
              ? "Kullandığınız Biçen360 sürümü artık desteklenmiyor. Devam etmek için uygulamayı güncelleyin."
              : durum.mesaj || "Biçen360'ın yeni sürümü mağazada. Uygulamayı güncelleyin."}
          </Text>
          <Text style={s.surum}>
            Sizdeki sürüm {durum.benim} · güncel sürüm {durum.guncel}
          </Text>

          <TouchableOpacity style={s.ana} activeOpacity={0.85} onPress={guncelle}>
            <Text style={s.anaYazi}>Uygulamayı güncelle</Text>
          </TouchableOpacity>

          {!durum.zorunlu ? (
            <TouchableOpacity style={s.ikincil} onPress={sonra} hitSlop={8}>
              <Text style={s.ikincilYazi}>Sonra</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: "rgba(16,24,16,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  kart: { width: "100%", maxWidth: 380, backgroundColor: renk.beyaz, borderRadius: 18, padding: 22 },
  baslik: { fontSize: 19, fontWeight: "800", color: renk.metin, marginBottom: 8 },
  metin: { fontSize: 14.5, lineHeight: 21, color: renk.metin },
  surum: { fontSize: 12.5, color: renk.pasif, marginTop: 10 },
  ana: { marginTop: 18, backgroundColor: renk.yesilKoyu, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  anaYazi: { color: renk.beyaz, fontSize: 15.5, fontWeight: "800" },
  ikincil: { marginTop: 12, alignItems: "center", paddingVertical: 6 },
  ikincilYazi: { color: renk.pasif, fontSize: 14.5, fontWeight: "700" },
});

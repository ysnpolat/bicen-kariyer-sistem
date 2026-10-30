/**
 * Alt menü
 * ---------------------------------------------------------------------------
 * Yüzen, yuvarlatılmış sekme çubuğu.
 *
 * Varsayılan çubuk ekranın en altına yapışıyor ve iPhone'da ana ekran
 * çizgisiyle çakışıyordu. Bu çubuk kenarlardan boşluk bırakıp yukarı
 * kalkıyor; seçili sekme arkasında yeşil bir kapsül beliriyor.
 */

import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { renk } from "../tema";
import Simge from "./Simge";
import { useKlavye } from "../klavye";

export default function AltMenu({ state, descriptors, navigation, rozetler, gecmistenSec = false }) {
  const kenar = useSafeAreaInsets();

  /* 20.10.2026: klavye açıkken yüzen menü gizlenir; Android'de pencere
     kısalınca menü klavyenin üstüne çıkıp formun düğmesini örtüyordu. */
  const klavye = useKlavye();

  const aktifGizli =
    descriptors[state.routes[state.index].key].options.gizli === true;

  /* Gizli bir ekrandayken yanacak sekme.

     Personel uygulamasında gizli ekranlar Diğer menüsünden açılıyor, o
     yüzden Diğer yanıyor. Patron görünümünde Diğer yok: şube detayı hem
     Özet'ten hem Şubeler'den açılabiliyor ve hangisinden gelindiyse o
     sekme yanmalı. `gecmistenSec` ile gezinme geçmişindeki son görünür
     sekme seçiliyor; verilmezse eski davranış aynen sürüyor. */
  const gizliUst = !aktifGizli
    ? null
    : gecmistenSec
    ? sonGorunenSekme(state, descriptors)
    : "Diger";

  if (klavye.acik) return null;

  return (
    <View
      style={[
        s.kaplama,
        /* Ana ekran çizgisi olan cihazlarda biraz daha yukarı */
        { paddingBottom: Math.max(kenar.bottom, 12) },
      ]}
      pointerEvents="box-none"
    >
      <View style={s.cubuk}>
        {/* Gizli ekranlar (Diğer menüsünden gezilenler) çubuğa basılmaz.
            Sıra korunur: seçili sekme kendi state.index'i ile bulunur. */}
        {state.routes
          .map((rota, i) => ({ rota, i }))
          .filter(({ rota }) => !descriptors[rota.key].options.gizli)
          .map(({ rota, i }) => {
          const secenek = descriptors[rota.key].options;

          /* Gizli bir ekrandayken hiçbir sekme yanmıyordu; o kayıtlara
             Diğer üzerinden gidildiği için Diğer seçili gösterilir. */
          const secili =
            state.index === i || (aktifGizli && rota.name === gizliUst);

          const sayi = Number(rozetler?.[rota.name]) || 0;

          const ad = secenek.title ?? rota.name;
          const simge = secenek.simgeAdi ?? "ev";

          const bas = () => {
            const olay = navigation.emit({
              type: "tabPress",
              target: rota.key,
              canPreventDefault: true,
            });

            /* Diğer menüsünden açılan bir ekrandayken Diğer seçili
               görünüyor ama asıl açık olan o ekran; dokununca menüye
               dönülüyor (önceden hiçbir şey olmuyordu). */
            const gizlidenUst = aktifGizli && rota.name === gizliUst;

            if ((!secili || gizlidenUst) && !olay.defaultPrevented)
              navigation.navigate(rota.name);
          };

          return (
            <TouchableOpacity
              key={rota.key}
              style={s.sekme}
              onPress={bas}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={secili ? { selected: true } : {}}
              accessibilityLabel={ad}
            >
              {/* Seçili sekmenin arkasındaki kapsül */}
              <View style={[s.kapsul, secili && s.kapsulAktif]}>
                {/* Seçili sekme dolgulu çiziliyor: çizgili simgeler
                    birbirine benziyor ve hangi sekmede olunduğu yalnızca
                    renkten anlaşılıyordu. Dolgu, renkten bağımsız olarak
                    da ayırt ediliyor. */}
                <Simge
                  ad={simge}
                  renkli={secili ? renk.yesilKoyu : renk.pasif}
                  boyut={secili ? 22 : 20}
                  dolgu={secili}
                />

                {/* Bekleyen iş sayısı; Diğer sekmesinde gösterilir */}
                {sayi > 0 ? (
                  <View style={s.rozet}>
                    <Text style={s.rozetYazi}>
                      {sayi > 9 ? "9+" : String(sayi)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text
                style={[s.yazi, secili && s.yaziAktif]}
                numberOfLines={1}
              >
                {ad}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Gezinme geçmişindeki son görünür (gizli olmayan) sekmenin adı */
function sonGorunenSekme(state, descriptors) {
  const gecmis = state.history ?? [];

  for (let i = gecmis.length - 1; i >= 0; i--) {
    const rota = state.routes.find((r) => r.key === gecmis[i]?.key);
    if (rota && !descriptors[rota.key]?.options?.gizli) return rota.name;
  }

  return state.routes.find((r) => !descriptors[r.key]?.options?.gizli)?.name ?? null;
}

const s = StyleSheet.create({
  /* Rozet kapsülün sağ üstüne taşar; iki hane sığsın diye en az genişlik. */
  rozet: {
    position: "absolute",
    top: -3,
    right: -7,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },

  rozetYazi: { fontSize: 10, fontWeight: "800", color: "#fff" },

  kaplama: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    backgroundColor: "transparent",
  },

  cubuk: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 26,
    paddingVertical: 8,
    paddingHorizontal: 6,

    /* Gölge: çubuğun içerikten ayrıldığı belli olsun */
    ...Platform.select({
      ios: {
        shadowColor: "#1d2126",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },

  sekme: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },

  kapsul: {
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  kapsulAktif: { backgroundColor: renk.yesilAcik },

  yazi: {
    fontSize: 10,
    color: renk.pasif,
    fontWeight: "500",
  },

  yaziAktif: { color: renk.yesilKoyu, fontWeight: "700" },
});

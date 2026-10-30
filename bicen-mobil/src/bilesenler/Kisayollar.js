/**
 * Ana sayfa kısayolları (1.8)
 * ---------------------------------------------------------------------------
 * Kişinin yetkisi olan modüller 4 sütunlu ızgarada. Bekleyen işi olan
 * modülün üstünde sayı rozeti, yeni modülde "YENİ". En fazla 11 kısayol ve
 * sonda "Tüm modüller" (Diğer). Alt menüdeki sekmeler kısayolda yok.
 *
 * Düzenle: kısayolun "−" işaretiyle çıkarılır, ‹ › ile sırası değişir;
 * yetkili olunan ama kısayolda olmayan modüller altta, "+" ile eklenir.
 * Tercih cihazda saklanır (kisayolTercihi.js).
 */

import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

import { renk } from "../tema";
import Simge from "./Simge";
import SimgeKutu from "./SimgeKutu";

export const EN_FAZLA = 11;

function Kutu({ m, rozet, yeni, duzen, isaret, bas, sola, saga }) {
  return (
    <TouchableOpacity style={s.ks} activeOpacity={0.75} onPress={bas}>
      <View>
        <SimgeKutu kod={m.kod} ad={m.simge} boyut={54} />
        {!duzen && rozet > 0 ? (
          <View style={s.rozet}>
            <Text style={s.rozetYazi}>{rozet > 99 ? "99+" : rozet}</Text>
          </View>
        ) : null}
        {!duzen && !(rozet > 0) && yeni ? (
          <View style={s.yeni}>
            <Text style={s.yeniYazi}>YENİ</Text>
          </View>
        ) : null}
        {isaret ? (
          <View style={[s.isaret, { backgroundColor: isaret === "+" ? renk.yesil : "#6b7280" }]}>
            <Text style={s.isaretYazi}>{isaret === "+" ? "+" : "−"}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.ad} numberOfLines={2}>
        {m.ad}
      </Text>
      {duzen && (sola || saga) ? (
        <View style={s.oklar}>
          <TouchableOpacity hitSlop={6} onPress={sola} disabled={!sola} style={!sola && { opacity: 0.25 }}>
            <Text style={s.ok}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity hitSlop={6} onPress={saga} disabled={!saga} style={!saga && { opacity: 0.25 }}>
            <Text style={s.ok}>›</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/**
 * @param moduller  kişide açık, ekranı olan modüller [{kod, ad, simge}]
 * @param secim     seçili kodlar (sıralı)
 * @param degistir  yeni seçim → kaydet
 * @param rozetler  { kod: sayı }
 * @param yeniler   Set(kod)
 * @param ac        kod → ekranı aç
 * @param tumu      Diğer'i aç
 */
export default function Kisayollar({ moduller, secim, degistir, rozetler = {}, yeniler, ac, tumu, Baslik }) {
  const [duzen, setDuzen] = useState(false);

  const harita = Object.fromEntries(moduller.map((m) => [m.kod, m]));
  const liste = secim.filter((k) => harita[k]).slice(0, EN_FAZLA);
  const eklenebilir = moduller.filter((m) => !liste.includes(m.kod));

  const tasi = (i, y) => {
    const l = [...liste];
    const [x] = l.splice(i, 1);
    l.splice(i + y, 0, x);
    degistir(l);
  };

  return (
    <>
      <Baslik sag={
        <TouchableOpacity hitSlop={8} onPress={() => setDuzen((x) => !x)}>
          <Text style={s.duzenle}>{duzen ? "Bitti" : "Düzenle"}</Text>
        </TouchableOpacity>
      } />

      <View style={s.izgara}>
        {liste.map((k, i) => (
          <Kutu
            key={k}
            m={harita[k]}
            rozet={rozetler[k]}
            yeni={yeniler?.has(k)}
            duzen={duzen}
            isaret={duzen ? "-" : null}
            bas={() => (duzen ? degistir(liste.filter((x) => x !== k)) : ac(k))}
            sola={i > 0 ? () => tasi(i, -1) : null}
            saga={i < liste.length - 1 ? () => tasi(i, 1) : null}
          />
        ))}
        {!duzen ? (
          <TouchableOpacity style={s.ks} activeOpacity={0.75} onPress={tumu}>
            <View style={s.tumuKutu}>
              <Simge ad="izgara" boyut={24} renkli="#4b5563" />
            </View>
            <Text style={s.ad}>Tüm modüller</Text>
          </TouchableOpacity>
        ) : null}
        {liste.length === 0 && duzen ? <Text style={s.bos}>Kısayol yok. Aşağıdan ekleyin.</Text> : null}
      </View>

      {duzen ? (
        <>
          <Text style={s.not}>“−” ile çıkarın, ‹ › ile sırasını değiştirin, aşağıdan “+” ile ekleyin.</Text>
          <View style={s.ekleKutu}>
            <Text style={s.ekleBaslik}>
              Eklenebilir modüller{liste.length >= EN_FAZLA ? ` · en fazla ${EN_FAZLA} kısayol` : " · dokununca eklenir"}
            </Text>
            {eklenebilir.length === 0 ? (
              <Text style={s.bos}>Yetkili olduğunuz bütün modüller kısayollarda.</Text>
            ) : (
              <View style={[s.izgara, s.izgaraSade]}>
                {eklenebilir.map((m) => (
                  <Kutu
                    key={m.kod}
                    m={m}
                    duzen
                    isaret="+"
                    bas={() => liste.length < EN_FAZLA && degistir([...liste, m.kod])}
                  />
                ))}
              </View>
            )}
          </View>
        </>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  duzenle: { fontSize: 12.5, fontWeight: "800", color: renk.yesilKoyu },
  izgara: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: renk.beyaz,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingVertical: 14,
    paddingHorizontal: 4,
    rowGap: 12,
  },
  izgaraSade: { borderWidth: 0, backgroundColor: "transparent", paddingVertical: 4 },
  ks: { width: "25%", alignItems: "center", gap: 6 },
  ad: { fontSize: 11.5, fontWeight: "600", color: "#374151", textAlign: "center", lineHeight: 14, minHeight: 28, paddingHorizontal: 2 },
  tumuKutu: { width: 54, height: 54, borderRadius: 17, backgroundColor: "#f1f3ef", alignItems: "center", justifyContent: "center" },
  rozet: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 21,
    height: 21,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: renk.turuncu,
    borderWidth: 2,
    borderColor: renk.beyaz,
    alignItems: "center",
    justifyContent: "center",
  },
  rozetYazi: { color: renk.beyaz, fontSize: 10.5, fontWeight: "800" },
  yeni: {
    position: "absolute",
    top: -7,
    right: -13,
    backgroundColor: "#c8930a",
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 2,
    borderColor: renk.beyaz,
  },
  yeniYazi: { color: renk.beyaz, fontSize: 8.5, fontWeight: "900" },
  isaret: {
    position: "absolute",
    top: -6,
    left: -6,
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: renk.beyaz,
    alignItems: "center",
    justifyContent: "center",
  },
  isaretYazi: { color: renk.beyaz, fontSize: 14, fontWeight: "900", lineHeight: 16 },
  oklar: { flexDirection: "row", gap: 18, marginTop: -4 },
  ok: { fontSize: 20, fontWeight: "800", color: renk.pasif, lineHeight: 20 },
  not: { fontSize: 12, color: renk.pasif, textAlign: "center", marginTop: 8 },
  ekleKutu: {
    marginTop: 10,
    backgroundColor: renk.beyaz,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#c9d8b4",
    borderRadius: 18,
    paddingTop: 12,
    paddingBottom: 6,
    paddingHorizontal: 6,
  },
  ekleBaslik: { fontSize: 12.5, fontWeight: "700", color: renk.pasif, marginHorizontal: 6, marginBottom: 8 },
  bos: { fontSize: 12.5, color: renk.pasif, textAlign: "center", padding: 8, width: "100%" },
});

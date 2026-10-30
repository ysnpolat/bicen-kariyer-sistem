/**
 * Pencere
 * ---------------------------------------------------------------------------
 * Uygulamanın kendi bildirim penceresi.
 *
 * İşletim sisteminin `Alert.alert` penceresi her yerde aynı gri kutu:
 * başarı ile hata aynı görünüyor, uzun metinler okunmuyor ve markanın
 * hiçbir izi yok. Kayıt açıldığında ya da vardiya okutulduğunda personelin
 * gördüğü tek geri bildirim bu pencere olduğu için sade kalması işin
 * kendisini değersiz gösteriyordu.
 *
 * Dört tür var: basari, hata, uyari, bilgi. Tür yalnızca rengi ve simgeyi
 * değiştiriyor; yapı aynı kalıyor ki personel her seferinde aynı yerde
 * aynı şeyi arasın.
 *
 * KULLANIM
 *   const [pencere, setPencere] = useState(null);
 *
 *   setPencere({
 *     tur: "basari",
 *     baslik: "Kayıt açıldı",
 *     metin: "#124 · Yazarkasa › Fiş yazıcı",
 *     satirlar: ["Departman: Bilgi Teknolojileri", "Öncelik: Yüksek"],
 *     dugmeler: [{ ad: "Tamam", bas: () => setPencere(null) }],
 *   });
 *
 *   <Pencere veri={pencere} kapat={() => setPencere(null)} />
 */

import { View, Text, Modal, StyleSheet, TouchableOpacity } from "react-native";

import Simge from "./Simge";
import { renk } from "../tema";

const TURLER = {
  basari: { renk: "#7cb518", acik: "#f2f9e8", simge: "onay" },
  hata: { renk: "#cf1322", acik: "#fff1f0", simge: "uyari" },
  uyari: { renk: "#e8481c", acik: "#fff2e8", simge: "uyari" },
  bilgi: { renk: "#1a4d80", acik: "#eef4fb", simge: "bilgi" },
};

export default function Pencere({ veri, kapat }) {
  if (!veri) return null;

  const tur = TURLER[veri.tur] ?? TURLER.bilgi;

  /* Düğme verilmezse tek bir "Tamam": her çağrı yerinde aynı düğmeyi
     yeniden tanımlamak gereksiz tekrar çıkarıyordu. */
  const dugmeler = veri.dugmeler?.length
    ? veri.dugmeler
    : [{ ad: "Tamam", bas: kapat }];

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={veri.kapatilamaz ? undefined : kapat}
    >
      <View style={s.perde}>
        <View style={s.kutu}>
          <View style={[s.simgeKutu, { backgroundColor: tur.acik }]}>
            <Simge ad={tur.simge} boyut={30} renkli={tur.renk} />
          </View>

          <Text style={s.baslik}>{veri.baslik}</Text>

          {!!veri.metin && <Text style={s.metin}>{veri.metin}</Text>}

          {/* Ayrıntı satırları: kaydın künyesi tek paragrafa sıkıştırıldığında
              okunmuyordu. Her satır kendi yerinde duruyor. */}
          {veri.satirlar?.length > 0 && (
            <View style={s.satirlar}>
              {veri.satirlar.map((satir, i) => (
                <View key={i} style={s.satir}>
                  <View style={[s.nokta, { backgroundColor: tur.renk }]} />
                  <Text style={s.satirYazi}>{satir}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.dugmeler}>
            {dugmeler.map((d, i) => {
              const ikincil = d.ikincil || (dugmeler.length > 1 && i === 0);

              return (
                <TouchableOpacity
                  key={d.ad}
                  style={[
                    s.dugme,
                    ikincil ? s.ikincil : { backgroundColor: tur.renk },
                    dugmeler.length > 1 && { flex: 1 },
                  ]}
                  activeOpacity={0.8}
                  onPress={d.bas ?? kapat}
                >
                  <Text style={[s.dugmeYazi, ikincil && s.ikincilYazi]}>
                    {d.ad}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: {
    flex: 1,
    backgroundColor: "rgba(20, 24, 20, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 26,
  },

  kutu: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: renk.beyaz,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",

    /* Perdenin üstünde ayrı bir yüzey gibi dursun */
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  simgeKutu: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  baslik: {
    fontSize: 17.5,
    fontWeight: "700",
    color: renk.metin,
    textAlign: "center",
    lineHeight: 24,
  },

  metin: {
    fontSize: 14,
    color: renk.pasif,
    textAlign: "center",
    lineHeight: 21,
    marginTop: 8,
  },

  satirlar: {
    width: "100%",
    backgroundColor: renk.zemin,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    gap: 7,
  },

  satir: { flexDirection: "row", alignItems: "flex-start", gap: 8 },

  nokta: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },

  satirYazi: { flex: 1, fontSize: 13.5, color: renk.metin, lineHeight: 20 },

  dugmeler: { flexDirection: "row", gap: 9, marginTop: 18, width: "100%" },

  dugme: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },

  ikincil: { backgroundColor: renk.zemin, borderWidth: 1, borderColor: renk.cizgi },

  dugmeYazi: { fontSize: 15, fontWeight: "700", color: renk.beyaz },

  ikincilYazi: { color: renk.metin },
});

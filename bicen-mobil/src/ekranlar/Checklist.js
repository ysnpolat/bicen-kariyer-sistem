/**
 * Kontrol Listeleri
 * ---------------------------------------------------------------------------
 * Personelin bugün doldurması gereken listeler. Diğer menüsünden açılır.
 *
 * Saat aralığı tanımlı listeler aralık dışında da görünür ama açılmaz:
 * personel neyi ne zaman yapacağını önceden bilsin diye gizlenmiyor.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { checklistlerimAl } from "../api";
import { renk } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";

const SIKLIK_ADI = {
  gunluk: "Her gün",
  haftalik: "Haftalık",
  tek: "Tek seferlik",
};

export default function Checklist({ navigation }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      setVeri(await checklistlerimAl());
      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Kontrol listeleri alınamadı.");
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  if (yukleniyor) return <Yukleniyor />;

  const listeler = veri?.listeler ?? [];

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
          />
        }
      >
        <View style={s.baslikSatir}>
          <TouchableOpacity
            style={s.geri}
            activeOpacity={0.65}
            onPress={() => navigation.goBack()}
          >
            <Simge ad="ok" renkli={renk.pasif} boyut={18} />
          </TouchableOpacity>

          <Text style={s.baslik}>Kontrol Listeleri</Text>
        </View>

        {hata ? <Hata metin={hata} /> : null}

        {listeler.length === 0 && !hata ? (
          <Bilgi>
            Bugün doldurmanız gereken bir kontrol listesi yok.
          </Bilgi>
        ) : null}

        {listeler.map((c) => {
          const kapali = !c.acikMi && !c.tamamlandi;

          return (
            <TouchableOpacity
              key={c.id}
              style={[s.kart, kapali && s.kartKapali]}
              activeOpacity={kapali ? 1 : 0.75}
              onPress={() =>
                kapali
                  ? undefined
                  : navigation.navigate("ChecklistDoldur", {
                      id: c.id,
                      baslik: c.baslik,
                    })
              }
            >
              <View style={s.kartUst}>
                <View style={s.simgeKutu}>
                  <Simge
                    ad="belge"
                    renkli={c.tamamlandi ? renk.yesilKoyu : renk.pasif}
                    boyut={19}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={s.isBaslik}>{c.baslik}</Text>

                  <Text style={s.altBilgi}>
                    {c.maddeSayisi} madde · {SIKLIK_ADI[c.siklik] ?? c.siklik}
                    {c.saatAraligi ? ` · ${c.saatAraligi}` : ""}
                  </Text>
                </View>

                {c.tamamlandi ? (
                  <Rozet metin="Tamam" tur="yesil" />
                ) : kapali ? (
                  <Rozet metin="Saat dışı" tur="gri" />
                ) : (
                  <Rozet metin="Bekliyor" tur="turuncu" />
                )}
              </View>

              {c.aciklama ? (
                <Text style={s.aciklama} numberOfLines={2}>
                  {c.aciklama}
                </Text>
              ) : null}

              {kapali ? (
                <Text style={s.kapaliNot}>
                  Bu liste yalnızca {c.saatAraligi} arasında doldurulabilir.
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 110 },

  baslikSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },

  geri: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "180deg" }],
  },

  baslik: {
    fontSize: 25,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: -0.5,
  },

  kart: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 15,
    marginBottom: 11,
  },

  kartKapali: { opacity: 0.62 },

  kartUst: { flexDirection: "row", alignItems: "center", gap: 11 },

  simgeKutu: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
  },

  isBaslik: { fontSize: 15.5, fontWeight: "700", color: renk.metin },
  altBilgi: { fontSize: 12, color: renk.pasif, marginTop: 3 },

  aciklama: {
    fontSize: 13,
    color: renk.pasif,
    lineHeight: 19,
    marginTop: 10,
  },

  kapaliNot: {
    fontSize: 12,
    color: renk.turuncu,
    fontWeight: "600",
    marginTop: 8,
  },
});

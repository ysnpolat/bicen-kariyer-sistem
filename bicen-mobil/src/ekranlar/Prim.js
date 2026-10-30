/**
 * Prim Hak Edişi
 * ---------------------------------------------------------------------------
 * Geçmiş ayların primleri. İçinde bulunulan ay GÖRÜNMEZ.
 *
 * Ay kapanmadan hesaplanan bir rakam, mağaza verileri kesinleştiğinde
 * değişiyor ve "primim düştü" tartışması çıkıyor. Bu yüzden yalnızca
 * kesinleşmiş aylar gösterilir; sebebi de ekranda yazar.
 */

import { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { primAl } from "../api";
import { renk, paraYaz, AYLAR } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Kart, Satir, Rozet, Bilgi, Uyari, Yukleniyor, Hata } from "../bilesenler/Ortak";

export default function Prim() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      setVeri(await primAl());
      setHata("");
    } catch (h) {
      setHata(h.message);
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { getir(); }, [getir]));

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <View style={s.bar}>
        <BarBaslik ad="Prim Hak Edişi" />
      </View>

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />
        }
      >
        <Uyari>
          İçinde bulunduğunuz ay görünmez. Prim, ay kapandıktan ve mağaza
          verileri kesinleştikten sonra hesaplanır.
        </Uyari>

        <Kart serit={renk.mor} stil={{ alignItems: "center" }}>
          <Text style={s.kartBaslik}>Bu yıl toplam</Text>
          <Text style={s.buyuk}>{paraYaz(veri?.yillikToplam ?? 0)}</Text>
          <Text style={s.altYazi}>
            {veri?.primliAy ?? 0} ayda
          </Text>
        </Kart>

        <Kart baslik="Aylık döküm">
          {(veri?.aylar ?? []).length === 0 ? (
            <Text style={s.bos}>
              Henüz kesinleşmiş prim kaydınız bulunmuyor.
            </Text>
          ) : (
            veri.aylar.map((a, i, dizi) => (
              <Satir
                key={i}
                ad={`${AYLAR[a.ay - 1]} ${a.yil}`}
                alt={
                  a.tutar > 0
                    ? `Puan ${a.puan} · %${a.oran} dilim`
                    : `Puan ${a.puan} · prim yok`
                }
                sag={
                  a.tutar > 0 ? (
                    <Text style={s.tutar}>{paraYaz(a.tutar)}</Text>
                  ) : (
                    <Rozet metin="—" tur="gri" />
                  )
                }
                sonMu={i === dizi.length - 1}
              />
            ))
          )}
        </Kart>

        <Bilgi>
          Prim oranı puanınıza göre belirlenir: 60-70 arası %3, 70-80 %5,
          80-90 %7, 90 ve üzeri %10.
        </Bilgi>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  bar: { backgroundColor: renk.yesil, paddingHorizontal: 18, paddingVertical: 14 },
  barBaslik: { fontSize: 17, fontWeight: "700", color: "#fff" },
  /* Alt boşluk: yüzen menü içeriğin üstüne binmesin */
  govde: { padding: 14, paddingBottom: 110 },
  kartBaslik: { fontSize: 12, color: renk.pasif, textTransform: "uppercase", letterSpacing: 0.5 },
  buyuk: { fontSize: 32, fontWeight: "800", color: renk.mor, marginTop: 2 },
  altYazi: { fontSize: 12.5, color: renk.pasif },
  tutar: { fontSize: 14, fontWeight: "700", color: renk.mor },
  bos: { fontSize: 13, color: renk.pasif, lineHeight: 20 },
});

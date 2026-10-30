/**
 * Takvim
 * ---------------------------------------------------------------------------
 * Ay görünümünde tarih seçici.
 *
 * Platform takvim bileşeni yerine kendi çizimimiz: iOS ve Android'de
 * görünüm ve davranış farklı oluyor, ayrıca marka renklerine uymuyor.
 * Burada ikisinde de aynı ve panelin diliyle tutarlı.
 */

import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

import { renk, AYLAR } from "../tema";

const GUNLER = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];

/** Ayın kaç gün çektiği */
const ayGunu = (yil, ay) => new Date(yil, ay + 1, 0).getDate();

/**
 * Ayın ilk gününün haftadaki yeri.
 * JavaScript pazarı 0 sayıyor; Türkiye'de hafta pazartesi başlıyor.
 */
const ilkGun = (yil, ay) => {
  const g = new Date(yil, ay, 1).getDay();
  return g === 0 ? 6 : g - 1;
};

const ayniGun = (a, b) =>
  a &&
  b &&
  a.getDate() === b.getDate() &&
  a.getMonth() === b.getMonth() &&
  a.getFullYear() === b.getFullYear();

export default function Takvim({ deger, onSec, enAz, enCok }) {
  const baslangic = deger ?? new Date();

  const [yil, setYil] = useState(baslangic.getFullYear());
  const [ay, setAy] = useState(baslangic.getMonth());

  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);

  const gunSayisi = ayGunu(yil, ay);
  const bosluk = ilkGun(yil, ay);

  /* Izgara: baştaki boşluklar + ayın günleri */
  const hucreler = [
    ...Array(bosluk).fill(null),
    ...Array.from({ length: gunSayisi }, (_v, i) => i + 1),
  ];

  const ayDegistir = (yon) => {
    let yeniAy = ay + yon;
    let yeniYil = yil;

    if (yeniAy < 0) {
      yeniAy = 11;
      yeniYil -= 1;
    } else if (yeniAy > 11) {
      yeniAy = 0;
      yeniYil += 1;
    }

    setAy(yeniAy);
    setYil(yeniYil);
  };

  /** Bu gün seçilebilir mi */
  const secilebilir = (gun) => {
    const t = new Date(yil, ay, gun);
    t.setHours(0, 0, 0, 0);

    if (enAz) {
      const sinir = new Date(enAz);
      sinir.setHours(0, 0, 0, 0);
      if (t < sinir) return false;
    }

    if (enCok) {
      const sinir = new Date(enCok);
      sinir.setHours(0, 0, 0, 0);
      if (t > sinir) return false;
    }

    return true;
  };

  return (
    <View style={s.tam}>
      {/* ------------------------------------------------ ay başlığı */}
      <View style={s.ustSatir}>
        <TouchableOpacity style={s.okDugme} onPress={() => ayDegistir(-1)}>
          <Text style={s.ok}>‹</Text>
        </TouchableOpacity>

        <Text style={s.ayYazi}>
          {AYLAR[ay]} {yil}
        </Text>

        <TouchableOpacity style={s.okDugme} onPress={() => ayDegistir(1)}>
          <Text style={s.ok}>›</Text>
        </TouchableOpacity>
      </View>

      {/* --------------------------------------------- gün başlıkları */}
      <View style={s.satir}>
        {GUNLER.map((g, i) => (
          <View key={g} style={s.hucre}>
            <Text style={[s.gunBaslik, i >= 5 && s.haftaSonu]}>{g}</Text>
          </View>
        ))}
      </View>

      {/* ----------------------------------------------------- günler */}
      <View style={s.izgara}>
        {hucreler.map((gun, i) => {
          if (gun === null)
            return <View key={`b${i}`} style={s.hucre} />;

          const tarih = new Date(yil, ay, gun);
          tarih.setHours(0, 0, 0, 0);

          const secili = ayniGun(tarih, deger);
          const bugunMu = ayniGun(tarih, bugun);
          const acik = secilebilir(gun);
          const haftaSonu = i % 7 >= 5;

          return (
            <TouchableOpacity
              key={gun}
              style={s.hucre}
              disabled={!acik}
              onPress={() => onSec(tarih)}
            >
              <View
                style={[
                  s.gun,
                  secili && s.gunSecili,
                  !secili && bugunMu && s.gunBugun,
                ]}
              >
                <Text
                  style={[
                    s.gunYazi,
                    haftaSonu && s.haftaSonu,
                    !acik && s.gunKapali,
                    secili && s.gunYaziSecili,
                  ]}
                >
                  {gun}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tam: { width: "100%" },

  ustSatir: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  okDugme: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: renk.yesilAcik,
  },

  ok: {
    fontSize: 24,
    lineHeight: 26,
    color: renk.yesilKoyu,
    fontWeight: "700",
  },

  ayYazi: { fontSize: 16.5, fontWeight: "700", color: renk.metin },

  satir: { flexDirection: "row" },

  izgara: { flexDirection: "row", flexWrap: "wrap" },

  hucre: {
    width: "14.28%" /* 100/7 yuvarlanınca bazı Android ekranlarda 7. gün alt satıra düşüyordu */,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  gunBaslik: {
    fontSize: 11.5,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
  },

  gun: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  gunSecili: { backgroundColor: renk.yesil },

  gunBugun: { borderWidth: 1.5, borderColor: renk.yesil },

  gunYazi: { fontSize: 14.5, color: renk.metin },

  gunYaziSecili: { color: "#fff", fontWeight: "700" },

  gunKapali: { color: "#c8ccc4" },

  haftaSonu: { color: renk.turuncu },
});

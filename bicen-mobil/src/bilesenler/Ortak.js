/**
 * Ortak bileşenler
 * ---------------------------------------------------------------------------
 * Önizlemedeki kart, kutu, satır ve rozet desenlerinin karşılığı.
 * Ekranlarda aynı stili tekrar yazmamak için tek yerde toplanır.
 */

import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";

import { renk, olcu, yazi } from "../tema";
import Simge from "./Simge";

/* ========================================================================== */
/* Kart                                                                       */
/* ========================================================================== */

/**
 * Beyaz kart. `serit` verilirse sol kenarı o renkte olur — önizlemedeki
 * renkli şeritli kartların karşılığı.
 */
export function Kart({ baslik, serit, children, stil }) {
  return (
    <View
      style={[
        s.kart,
        serit && { borderLeftWidth: 3, borderLeftColor: serit, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
        stil,
      ]}
    >
      {baslik ? <Text style={s.kartBaslik}>{baslik}</Text> : null}
      {children}
    </View>
  );
}

/* ========================================================================== */
/* Özet kutusu                                                                */
/* ========================================================================== */

/** Dört köşe özet kutusu: başlık, büyük değer, alt açıklama */
export function Kutu({ baslik, deger, ek, renkli, stil, bas }) {
  const icerik = (
    <>
      <Text style={s.kutuBaslik}>{baslik}</Text>
      <Text style={[s.kutuDeger, renkli && { color: renkli }]}>{deger}</Text>
      {ek ? <Text style={s.kutuEk}>{ek}</Text> : null}
    </>
  );

  const bicim = [s.kutu, renkli && { borderLeftColor: renkli }, stil];

  /* Dokunulabilir kutu yalnızca bir işlev verildiğinde: her kutuyu
     dokunulabilir yapmak, hiçbir yere gitmeyen kartlarda da basılıyor
     hissi veriyordu. */
  if (!bas) return <View style={bicim}>{icerik}</View>;

  return (
    <TouchableOpacity style={bicim} activeOpacity={0.7} onPress={bas}>
      {icerik}

      {/* Küçük ok: kartın bir yere götürdüğü belli olsun */}
      <View style={s.kutuOk}>
        <Simge ad="ok" boyut={13} renkli={renk.pasif} />
      </View>
    </TouchableOpacity>
  );
}

/** İki sütunlu kutu ızgarası */
export function Kutular({ children }) {
  return <View style={s.kutular}>{children}</View>;
}

/* ========================================================================== */
/* Liste satırı                                                               */
/* ========================================================================== */

/** Solda ad ve açıklama, sağda değer */
export function Satir({ ad, alt, sag, sagRenk, sonMu }) {
  return (
    <View style={[s.satir, sonMu && { borderBottomWidth: 0 }]}>
      <View style={s.satirAd}>
        <Text style={s.satirBaslik}>{ad}</Text>
        {alt ? <Text style={s.satirAlt}>{alt}</Text> : null}
      </View>

      {typeof sag === "string" ? (
        <Text style={[s.satirSag, sagRenk && { color: sagRenk }]}>{sag}</Text>
      ) : (
        sag
      )}
    </View>
  );
}

/* ========================================================================== */
/* Rozet                                                                      */
/* ========================================================================== */

export function Rozet({ metin, tur = "gri" }) {
  const renkler = {
    yesil: [renk.yesilAcik, renk.yesilKoyu],
    turuncu: [renk.turuncuAcik, renk.turuncuKoyu],
    mavi: [renk.maviAcik, renk.mavi],
    mor: [renk.morAcik, renk.mor],
    gri: ["#f1f2ef", renk.pasif],

    /* Kırmızı eksikti: açık arıza rozeti kırmızı isteyip griye düşüyor
       ve diğer rozetlerden ayrılmıyordu. */
    kirmizi: ["#fdecec", renk.kirmizi],
  };

  const [zemin, yaziRengi] = renkler[tur] ?? renkler.gri;

  return (
    <View style={[s.rozet, { backgroundColor: zemin }]}>
      <Text style={[s.rozetYazi, { color: yaziRengi }]}>{metin}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Bilgi ve uyarı kutuları                                                    */
/* ========================================================================== */

export function Bilgi({ children }) {
  return (
    <View style={s.bilgi}>
      <Text style={s.bilgiYazi}>{children}</Text>
    </View>
  );
}

export function Uyari({ children }) {
  return (
    <View style={s.uyari}>
      <Text style={s.uyariYazi}>{children}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Doluluk çubuğu                                                             */
/* ========================================================================== */

/** parcalar: [{ oran: 0-100, renk }] */
export function Cubuk({ parcalar }) {
  return (
    <View style={s.cubuk}>
      {parcalar.map((p, i) => (
        <View
          key={i}
          style={{
            width: `${Math.max(0, Math.min(100, p.oran))}%`,
            backgroundColor: p.renk,
            height: "100%",
          }}
        />
      ))}
    </View>
  );
}

/* ========================================================================== */
/* Durum ekranları                                                            */
/* ========================================================================== */

export function Yukleniyor() {
  return (
    <View style={s.ortala}>
      <ActivityIndicator color={renk.yesil} size="large" />
    </View>
  );
}

export function Bos({ metin }) {
  return (
    <View style={s.ortala}>
      <Text style={s.bosYazi}>{metin}</Text>
    </View>
  );
}

export function Hata({ metin }) {
  return (
    <View style={s.ortala}>
      <Text style={[s.bosYazi, { color: renk.kirmizi }]}>{metin}</Text>
    </View>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  kart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.kartYuvarlak,
    padding: olcu.bosluk,
    marginBottom: 11,
  },

  kartBaslik: { ...yazi.altBaslik, marginBottom: 7 },

  kutular: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4.5,
    marginBottom: 11,
  },

  kutu: {
    width: "50%",
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderLeftWidth: 3,
    borderLeftColor: renk.yesil,
    borderTopRightRadius: 11,
    borderBottomRightRadius: 11,
    padding: 11,
    marginBottom: 9,
    /* İki sütun arasında boşluk; yüzde genişlikle margin çakışmasın */
    marginHorizontal: 4.5,
    flexBasis: "46%",
    flexGrow: 1,
  },

  kutuBaslik: {
    fontSize: 10.5,
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  kutuDeger: {
    fontSize: 21,
    fontWeight: "800",
    color: renk.metin,
    marginTop: 2,
  },

  kutuOk: { position: "absolute", right: 10, top: 12, opacity: 0.55 },

  kutuEk: { fontSize: 11, color: renk.pasif },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },

  satirAd: { flex: 1, minWidth: 0 },
  satirBaslik: { fontSize: 13.5, fontWeight: "600", color: renk.metin },
  satirAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  satirSag: { fontSize: 13, fontWeight: "700", color: renk.metin },

  rozet: {
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 20,
    alignSelf: "flex-start",
  },

  rozetYazi: { fontSize: 11, fontWeight: "600" },

  bilgi: {
    backgroundColor: renk.yesilAcik,
    borderWidth: 1,
    borderColor: "#d8ecc0",
    borderRadius: 11,
    padding: 12,
    marginBottom: 11,
  },

  bilgiYazi: { fontSize: 12.5, color: "#4d6f1a", lineHeight: 19 },

  uyari: {
    backgroundColor: "#fff7e6",
    borderWidth: 1,
    borderColor: "#ffd591",
    borderRadius: 11,
    padding: 12,
    marginBottom: 11,
  },

  uyariYazi: { fontSize: 12.5, color: renk.turuncuKoyu, lineHeight: 19 },

  cubuk: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#eef0ec",
    overflow: "hidden",
    flexDirection: "row",
  },

  ortala: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },

  bosYazi: { fontSize: 13.5, color: renk.pasif, textAlign: "center" },
});

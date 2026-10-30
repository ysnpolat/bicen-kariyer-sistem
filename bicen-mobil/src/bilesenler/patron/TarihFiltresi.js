/**
 * Patron görünümü · tarih süzgeci (1.6)
 * ---------------------------------------------------------------------------
 * Her patron sayfasının üstündeki çip sırası: Bugün · Dün · Bu hafta ·
 * Bu ay · Geçen ay · Bu yıl · Özel aralık. Seçim bütün sayfalarda ortak
 * (aralik.js'teki depo); bir sayfada "Bu ay" seçilince diğer sekmeler de
 * bu ayı gösteriyor.
 *
 * "Özel aralık" alttan açılan bir takvimle seçiliyor. Takvim düz RN
 * bileşenleriyle çizildi: yerel tarih seçici paketi yeni bir yerel modül
 * demek, o da mağaza güncellemesi gerektirirdi. Başlangıç ve bitiş
 * gününe dokunmak yetiyor; gelecek günler seçilemiyor, en çok bir yıl.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";

import { patronRenk as P } from "../../tema";
import AltSayfa from "../AltSayfa";
import Ikon from "./Ikon";
import { Dugme, Dugmeler, stiller } from "./Parcalar";
import {
  HAZIR_ARALIKLAR,
  AY_UZUN,
  EN_UZUN_GUN,
  araligiSec,
  useTarihAraligi,
  tarihYazisi,
  gunYaz,
  gunOku,
  gunEkle,
  gunSayisi,
} from "./aralik";

const GUN_BASLIK = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/**
 * Çip sırası.
 * @param koyu  Özet'in koyu yeşil başlığında (açık yazı)
 * @param kenar Sayfanın yan boşluğu: çipler kenardan kenara kaysın
 */
export default function TarihFiltresi({ koyu = false, kenar = 14, stil }) {
  const aralik = useTarihAraligi();
  const [acik, setAcik] = useState(false);

  const kaydir = useRef(null);
  const konumlar = useRef({});
  const ilkKaydirma = useRef(false);

  /* Seçili çip görünür olsun: "Bu yıl" ya da "Özel" seçiliyken başka
     sekmeye geçilince çip sağda, ekranın dışında kalıyordu. */
  useEffect(() => {
    const x = konumlar.current[aralik.anahtar];
    if (x !== undefined) kaydir.current?.scrollTo?.({ x: Math.max(0, x - 48), animated: false });
  }, [aralik.anahtar]);

  const ogeler = [
    ...HAZIR_ARALIKLAR,
    {
      anahtar: "ozel",
      /* Özel seçiliyken çipin üstünde tarih yazıyor */
      ad: aralik.anahtar === "ozel" ? tarihYazisi(aralik.bas, aralik.bit, true) : "Özel aralık",
    },
  ];

  const k = koyu ? sk : sa;

  return (
    <>
      <ScrollView
        ref={kaydir}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[{ marginHorizontal: -kenar, flexGrow: 0 }, stil]}
        contentContainerStyle={[s.cipler, { paddingHorizontal: kenar }]}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="tablist"
        accessibilityLabel="Tarih aralığı"
      >
        <View style={[s.simge, k.simge]}>
          <Ikon ad="takvim" boyut={15} renkli={koyu ? "rgba(255,255,255,0.85)" : P.yesilKoyu} />
        </View>

        {ogeler.map((o) => {
          const aktif = o.anahtar === aralik.anahtar;

          return (
            <TouchableOpacity
              key={o.anahtar}
              style={[s.cip, k.cip, aktif && k.cipAktif]}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: aktif }}
              onLayout={(e) => {
                konumlar.current[o.anahtar] = e.nativeEvent.layout.x;

                /* İlk çizimde konum henüz bilinmiyordu: ölçülünce kaydır */
                if (aktif && !ilkKaydirma.current) {
                  ilkKaydirma.current = true;
                  kaydir.current?.scrollTo?.({ x: Math.max(0, e.nativeEvent.layout.x - 48), animated: false });
                }
              }}
              onPress={() => (o.anahtar === "ozel" ? setAcik(true) : araligiSec({ anahtar: o.anahtar }))}
            >
              <Text style={[s.cipYazi, k.cipYazi, aktif && k.cipYaziAktif]}>{o.ad}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <AltSayfa gorunur={acik} kapat={() => setAcik(false)} perdeStil={stiller.perde} sayfaStil={stiller.kagit}>
        <View style={stiller.tutamac} />
        {acik ? <OzelAralik aralik={aralik} kapat={() => setAcik(false)} /> : null}
      </AltSayfa>
    </>
  );
}

/* ========================================================================== */
/* Özel aralık: takvim                                                        */
/* ========================================================================== */

const ayBasi = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

function OzelAralik({ aralik, kapat }) {
  const bugun = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);

  /* Taslak: açıldığında geçerli aralık (Bugün seçiliyse boş) */
  const [taslak, setTaslak] = useState(() =>
    aralik.canli ? { bas: null, bit: null } : { bas: aralik.bas, bit: aralik.bit }
  );

  const [ay, setAy] = useState(() => ayBasi(gunOku(taslak.bit ?? taslak.bas) ?? bugun));

  const gun = taslak.bas && taslak.bit ? gunSayisi(taslak.bas, taslak.bit) : 0;
  const uzun = gun > EN_UZUN_GUN;

  const dokun = (g) => {
    setTaslak((t) => {
      if (!t.bas || t.bit) return { bas: g, bit: null };
      if (g < t.bas) return { bas: g, bit: t.bas };
      return { bas: t.bas, bit: g };
    });
  };

  const hazir = (n) => {
    const bas = gunYaz(gunEkle(bugun, -(n - 1)));
    setTaslak({ bas, bit: gunYaz(bugun) });
    setAy(ayBasi(bugun));
  };

  const uygula = () => {
    araligiSec({ anahtar: "ozel", bas: taslak.bas, bit: taslak.bit });
    kapat();
  };

  const sonrakiYok = ay.getFullYear() === bugun.getFullYear() && ay.getMonth() === bugun.getMonth();

  return (
    <View>
      <Text style={stiller.sayfaBaslik}>Özel aralık</Text>
      <Text style={[stiller.sayfaAlt, { marginBottom: 10 }]}>Başlangıç ve bitiş gününe dokunun</Text>

      <View style={s.ucler}>
        <UcKutu baslik="Başlangıç" deger={taslak.bas} aktif={!taslak.bas || !!taslak.bit} />
        <Ikon ad="ok" boyut={16} renkli={P.soluk} />
        <UcKutu baslik="Bitiş" deger={taslak.bit} aktif={!!taslak.bas && !taslak.bit} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hizlilar}>
        {[
          [7, "Son 7 gün"],
          [30, "Son 30 gün"],
          [90, "Son 90 gün"],
          [365, "Son 1 yıl"],
        ].map(([n, ad]) => (
          <TouchableOpacity key={n} style={s.hizli} onPress={() => hazir(n)} activeOpacity={0.7}>
            <Text style={s.hizliYazi}>{ad}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.ayBas}>
        <TouchableOpacity
          style={s.ayDugme}
          onPress={() => setAy((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
          accessibilityRole="button"
          accessibilityLabel="Önceki ay"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ikon ad="geri" boyut={18} renkli={P.metin} />
        </TouchableOpacity>
        <Text style={s.ayAd}>
          {AY_UZUN[ay.getMonth()]} {ay.getFullYear()}
        </Text>
        <TouchableOpacity
          style={[s.ayDugme, sonrakiYok && { opacity: 0.3 }]}
          disabled={sonrakiYok}
          onPress={() => setAy((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
          accessibilityRole="button"
          accessibilityLabel="Sonraki ay"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ikon ad="ok" boyut={18} renkli={P.metin} />
        </TouchableOpacity>
      </View>

      <Takvim ay={ay} bugun={bugun} bas={taslak.bas} bit={taslak.bit} dokun={dokun} />

      <Text style={[s.ozet, uzun && { color: P.turuncu }]}>
        {uzun
          ? "En çok 1 yıl seçilebilir"
          : gun
          ? `${tarihYazisi(taslak.bas, taslak.bit)} · ${gun} gün`
          : taslak.bas
          ? "Bitiş gününe dokunun (aynı gün için yeniden dokunun)"
          : "Başlangıç gününe dokunun"}
      </Text>

      <Dugmeler>
        <Dugme yazi="Vazgeç" tur="ikincil" bas={kapat} />
        <Dugme yazi="Uygula" ikon="tik" bas={uygula} devreDisi={!taslak.bas || !taslak.bit || uzun} />
      </Dugmeler>
    </View>
  );
}

function UcKutu({ baslik, deger, aktif }) {
  return (
    <View style={[s.ucKutu, aktif && s.ucKutuAktif]}>
      <Text style={s.ucBaslik}>{baslik}</Text>
      <Text style={[s.ucDeger, !deger && { color: P.soluk }]} numberOfLines={1}>
        {deger ? tarihYazisi(deger, deger) : "Seçin"}
      </Text>
    </View>
  );
}

/** Ay ızgarası: pazartesiden başlayan 6 hafta */
function Takvim({ ay, bugun, bas, bit, dokun }) {
  const ilk = gunEkle(ay, -((ay.getDay() + 6) % 7));
  const bugunYazi = gunYaz(bugun);

  const haftalar = Array.from({ length: 6 }, (_, h) => Array.from({ length: 7 }, (_, g) => gunEkle(ilk, h * 7 + g)));

  return (
    <View style={s.takvim}>
      <View style={s.hafta}>
        {GUN_BASLIK.map((g) => (
          <Text key={g} style={s.gunBaslik}>
            {g}
          </Text>
        ))}
      </View>

      {haftalar.map((hafta, i) => (
        <View key={i} style={s.hafta}>
          {hafta.map((d) => {
            const g = gunYaz(d);
            const disarida = d.getMonth() !== ay.getMonth();
            const gelecek = d > bugun;
            const uc = g === bas || g === bit;
            const arada = bas && bit && g > bas && g < bit;
            const bant = bas && bit && bas !== bit && (arada || g === bas || g === bit);

            return (
              <TouchableOpacity
                key={g}
                style={s.gunHucre}
                disabled={gelecek}
                onPress={() => dokun(g)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={tarihYazisi(g, g)}
                accessibilityState={{ selected: !!uc, disabled: gelecek }}
              >
                {bant ? (
                  <View
                    style={[
                      s.bant,
                      g === bas ? { left: "50%" } : null,
                      g === bit ? { right: "50%" } : null,
                    ]}
                  />
                ) : null}
                <View style={[s.gunDaire, uc && s.gunDaireUc, !uc && g === bugunYazi && s.gunDaireBugun]}>
                  <Text
                    style={[
                      s.gunYazi,
                      disarida && { color: "#b9c0b4" },
                      gelecek && { color: "#d3d8cf" },
                      arada && { color: P.yesilYazi, fontWeight: "700" },
                      uc && { color: "#fff", fontWeight: "800" },
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/* ========================================================================== */

/** Tarih aralığı değişip yeni veri beklenirken önceki aralığın içeriği soluk */
export function AralikIcerik({ eski, children }) {
  return <View style={eski ? s.eski : null}>{children}</View>;
}

/* ========================================================================== */

const s = StyleSheet.create({
  cipler: { gap: 6, paddingBottom: 10, alignItems: "center" },
  simge: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cip: { borderWidth: 1, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12 },
  cipYazi: { fontSize: 12.5, fontWeight: "600" },

  ucler: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  ucKutu: { flex: 1, borderWidth: 1.5, borderColor: P.cizgi, borderRadius: 13, paddingVertical: 7, paddingHorizontal: 11 },
  ucKutuAktif: { borderColor: P.yesil, backgroundColor: "#fbfdf7" },
  ucBaslik: { fontSize: 11, color: P.soluk, fontWeight: "600" },
  ucDeger: { fontSize: 14.5, fontWeight: "700", color: P.metin, marginTop: 1 },

  hizlilar: { gap: 6, paddingBottom: 6 },
  hizli: { backgroundColor: P.gri, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 11 },
  hizliYazi: { fontSize: 12, fontWeight: "600", color: P.ikincil },

  ayBas: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, marginBottom: 4 },
  ayDugme: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: P.cizgi,
    alignItems: "center",
    justifyContent: "center",
  },
  ayAd: { fontSize: 15, fontWeight: "700", color: P.metin },

  takvim: { marginBottom: 6 },
  hafta: { flexDirection: "row" },
  gunBaslik: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: P.soluk, paddingVertical: 6 },
  gunHucre: { flex: 1, height: 40, alignItems: "center", justifyContent: "center" },
  bant: { position: "absolute", top: 3, bottom: 3, left: 0, right: 0, backgroundColor: P.yesilAcik },
  gunDaire: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  gunDaireUc: { backgroundColor: P.yesil },
  gunDaireBugun: { borderWidth: 1.5, borderColor: P.yesil },
  gunYazi: { fontSize: 13.5, fontWeight: "600", color: P.metin },

  ozet: { fontSize: 12.5, fontWeight: "600", color: P.ikincil, textAlign: "center", marginVertical: 10 },

  eski: { opacity: 0.45 },
});

/** Açık sayfa çipleri (Parcalar.Cipler ile aynı görünüm) */
const sa = StyleSheet.create({
  simge: { backgroundColor: P.yesilAcik },
  cip: { borderColor: P.cizgi, backgroundColor: "#fff" },
  cipAktif: { backgroundColor: P.metin, borderColor: P.metin },
  cipYazi: { color: P.ikincil },
  cipYaziAktif: { color: "#fff" },
});

/** Özet'in koyu başlığı */
const sk = StyleSheet.create({
  simge: { backgroundColor: "rgba(255,255,255,0.12)" },
  cip: { borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.08)" },
  cipAktif: { backgroundColor: "#fff", borderColor: "#fff" },
  cipYazi: { color: "rgba(255,255,255,0.88)" },
  cipYaziAktif: { color: P.metin },
});

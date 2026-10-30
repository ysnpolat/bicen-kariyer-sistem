/**
 * Grafik bileşenleri (mobil)
 * ---------------------------------------------------------------------------
 * Portaldaki rapor sayfasının çizimleri: halka, çubuk ve oranlı satır.
 * Halka SVG ile, diğer ikisi düz View ile: çubuk ve satır için SVG'ye
 * gerek yok ve View, dokunma ile animasyonda daha rahat.
 *
 * react-native-svg zaten kurulu (karekod üretimi için); yeni bağımlılık
 * eklenmiyor.
 */

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Svg, { Circle, G, Text as SvgText } from "react-native-svg";

import { renk } from "../tema";

/* -------------------------------------------------------------------------- */

/**
 * Halka grafik.
 *
 * Ortada toplam duruyor: dilim yüzdelerine bakan kullanıcı toplamı da
 * merak ediyor ve ayrıca aramak zorunda kalıyordu.
 */
export function Halka({ dilimler, etiket = "kayıt", boyut = 150, bas }) {
  const dolu = (dilimler ?? []).filter((d) => d.deger > 0);
  const toplam = dolu.reduce((t, d) => t + d.deger, 0);

  if (toplam === 0) return <Bos />;

  const R = boyut * 0.38;
  const kalinlik = boyut * 0.13;
  const cevre = 2 * Math.PI * R;
  const merkez = boyut / 2;

  let birikim = 0;

  return (
    <View style={g.halka}>
      <Svg width={boyut} height={boyut}>
        <G rotation="-90" origin={`${merkez}, ${merkez}`}>
          {dolu.map((d) => {
            const uzunluk = (d.deger / toplam) * cevre;

            const yay = (
              <Circle
                key={d.ad}
                cx={merkez}
                cy={merkez}
                r={R}
                fill="none"
                stroke={d.renk}
                strokeWidth={kalinlik}
                strokeDasharray={`${uzunluk} ${cevre - uzunluk}`}
                strokeDashoffset={-birikim}
              />
            );

            birikim += uzunluk;

            return yay;
          })}
        </G>

        <SvgText
          x={merkez}
          y={merkez - 2}
          textAnchor="middle"
          fontSize={boyut * 0.16}
          fontWeight="800"
          fill={renk.metin}
        >
          {toplam}
        </SvgText>

        <SvgText
          x={merkez}
          y={merkez + boyut * 0.11}
          textAnchor="middle"
          fontSize={boyut * 0.07}
          fill={renk.pasif}
        >
          {etiket}
        </SvgText>
      </Svg>

      {/* Dilim listesi dokunulabiliyor: pastanın kendisine dokunmak
          telefonda isabetsiz, yandaki satır daha kolay hedef. */}
      <View style={g.halkaListe}>
        {dolu.map((d) => {
          const icerik = (
            <>
              <View style={[g.nokta, { backgroundColor: d.renk }]} />
              <Text style={g.halkaAd} numberOfLines={1}>
                {d.ad}
              </Text>
              <Text style={g.halkaDeger}>{d.deger}</Text>
              <Text style={g.halkaYuzde}>
                %{Math.round((d.deger / toplam) * 100)}
              </Text>
              {bas ? <Text style={g.halkaOk}>›</Text> : null}
            </>
          );

          if (!bas)
            return (
              <View key={d.ad} style={g.halkaSatir}>
                {icerik}
              </View>
            );

          return (
            <TouchableOpacity
              key={d.ad}
              style={g.halkaSatir}
              activeOpacity={0.6}
              onPress={() => bas(d)}
            >
              {icerik}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Çubuk grafik.
 *
 * Etiketler seyreltiliyor: otuz günün her birini yazmak telefonda
 * okunmaz bir şerit bırakıyor.
 */
export function Cubuk({ kayitlar, renkli = renk.yesil, yukseklik = 120 }) {
  const liste = kayitlar ?? [];

  if (liste.length === 0 || liste.every((k) => !k.deger)) return <Bos />;

  const enYuksek = Math.max(...liste.map((k) => k.deger), 1);
  const atlama = Math.ceil(liste.length / 6);

  return (
    <View>
      <View style={[g.cubukAlan, { height: yukseklik }]}>
        {liste.map((k, i) => (
          <View key={i} style={g.cubukSutun}>
            <View
              style={[
                g.cubukDolu,
                {
                  height: `${Math.max((k.deger / enYuksek) * 100, k.deger > 0 ? 4 : 0)}%`,
                  backgroundColor: renkli,
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={g.cubukEtiketler}>
        {liste.map((k, i) => (
          <Text key={i} style={g.cubukEtiket} numberOfLines={1}>
            {i % atlama === 0 ? k.etiket : ""}
          </Text>
        ))}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Oranlı satır listesi.
 *
 * Satıra dokunulabiliyor: rapordaki sayıyı görmek yetmiyor, o sayının
 * hangi kayıtlardan geldiği soruluyor. `bas` verilmezse satır düz metin
 * olarak kalıyor.
 */
export function Satirlar({ kayitlar, renkli = renk.yesil, biciml, bas }) {
  const liste = kayitlar ?? [];

  if (liste.length === 0) return <Bos />;

  const enYuksek = Math.max(...liste.map((k) => k.deger), 1);

  return (
    <View style={g.oranlar}>
      {liste.map((k) => {
        const icerik = (
          <>
            <View style={g.oranUst}>
              <Text style={g.oranAd} numberOfLines={1}>
                {k.ad}
              </Text>

              <View style={g.oranSag}>
                <Text style={g.oranDeger}>
                  {biciml ? biciml(k.deger) : k.deger}
                </Text>
                {bas ? <Text style={g.oranOk}>›</Text> : null}
              </View>
            </View>

            <View style={g.oranAlt}>
              <View
                style={[
                  g.oranDolu,
                  { width: `${(k.deger / enYuksek) * 100}%`, backgroundColor: renkli },
                ]}
              />
            </View>
          </>
        );

        if (!bas) return <View key={k.ad} style={g.oran}>{icerik}</View>;

        return (
          <TouchableOpacity
            key={k.ad}
            style={g.oran}
            activeOpacity={0.6}
            onPress={() => bas(k)}
          >
            {icerik}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/** Sayı kutusu */
export function SayiKutu({ ad, deger, renkli }) {
  return (
    <View style={g.kutu}>
      <Text style={g.kutuAd}>{ad}</Text>
      <Text style={[g.kutuDeger, renkli && { color: renkli }]}>{deger}</Text>
    </View>
  );
}

function Bos() {
  return (
    <View style={g.bos}>
      <Text style={g.bosYazi}>Bu aralıkta veri yok</Text>
    </View>
  );
}

/* ========================================================================== */

const g = StyleSheet.create({
  halka: { flexDirection: "row", alignItems: "center", gap: 14 },
  halkaListe: { flex: 1, gap: 6 },
  halkaSatir: { flexDirection: "row", alignItems: "center", gap: 7 },
  nokta: { width: 9, height: 9, borderRadius: 3 },
  halkaAd: { flex: 1, fontSize: 12.5, color: renk.metin },
  halkaDeger: { fontSize: 12.5, fontWeight: "700", color: renk.metin },
  halkaYuzde: { fontSize: 11, color: renk.pasif, width: 34, textAlign: "right" },
  halkaOk: { fontSize: 15, color: renk.pasif, marginTop: -2 },

  cubukAlan: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  cubukSutun: { flex: 1, height: "100%", justifyContent: "flex-end" },
  cubukDolu: { width: "100%", borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  cubukEtiketler: { flexDirection: "row", gap: 2, marginTop: 4 },
  cubukEtiket: { flex: 1, fontSize: 9, color: renk.pasif, textAlign: "center" },

  oranlar: { gap: 9 },
  oran: {},
  oranUst: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 3 },
  oranAd: { flex: 1, fontSize: 12.5, color: renk.metin },
  oranDeger: { fontSize: 12.5, fontWeight: "700", color: renk.metin },
  oranSag: { flexDirection: "row", alignItems: "center", gap: 5 },
  oranOk: { fontSize: 16, color: renk.pasif, marginTop: -2 },
  oranAlt: { height: 6, borderRadius: 3, backgroundColor: "#eef0ec", overflow: "hidden" },
  oranDolu: { height: 6, borderRadius: 3 },

  kutu: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 12,
  },
  kutuAd: { fontSize: 11, color: renk.pasif, fontWeight: "600" },
  kutuDeger: { fontSize: 22, fontWeight: "800", color: renk.metin, marginTop: 2 },

  bos: { paddingVertical: 18, alignItems: "center" },
  bosYazi: { fontSize: 12.5, color: renk.pasif },
});

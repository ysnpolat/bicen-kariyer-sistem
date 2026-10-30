/**
 * Patron görünümü grafikleri
 * ---------------------------------------------------------------------------
 * Onaylanan tasarımdaki dört çizim: oran halkası, küçük eğilim çizgisi,
 * değer etiketli çubuk ve çok serili çizgi grafik.
 *
 * Grafik.js'teki Halka ve Cubuk burada yetmiyordu: Halka dilimli bir
 * dağılım çiziyor (tek oran değil) ve yanına kendi listesini koyuyor;
 * Cubuk ise değer etiketi ve "bugün" vurgusu taşımıyor — patron sayıya
 * bakmak için çubuğun üstünü okuyor. Oranlı satır listesi (Satirlar)
 * olduğu gibi kullanılıyor.
 *
 * Çubuk ve çizgi grafikler kapsayıcının genişliğini ölçüp gerçek piksel
 * değerleriyle çiziliyor: viewBox ile ölçeklemek yazıları da büyütüp
 * küçültüyor, dar telefonda etiketler okunmaz oluyordu.
 */

import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { patronRenk as P } from "../../tema";
import { sayi } from "./bicim";

/* -------------------------------------------------------------------------- */

/**
 * Tek oranlı halka; ortasına istenen içerik konur.
 * @param oran 0–1 arası
 */
export function OranHalka({ oran, renkli = P.yesil, boyut = 118, kalinlik = 12, children }) {
  const r = 50;
  const cevre = 2 * Math.PI * r;
  const d = Math.max(0, Math.min(1, Number(oran) || 0));

  return (
    <View style={{ width: boyut, height: boyut }}>
      <Svg width={boyut} height={boyut} viewBox="0 0 120 120">
        {/* Yay saat 12'den başlasın diye çevriliyor */}
        <G transform="rotate(-90 60 60)">
          <Circle cx="60" cy="60" r={r} fill="none" stroke={P.cizgi2} strokeWidth={kalinlik} />
          {d > 0 ? (
            <Circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={renkli}
              strokeWidth={kalinlik}
              strokeLinecap="round"
              strokeDasharray={`${cevre * d} ${cevre}`}
            />
          ) : null}
        </G>
      </Svg>

      <View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, g.ortala]} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/** Küçük eğilim çizgisi (KPI kutusunun sağ üstü) */
export function Spark({ degerler, renkli = P.yesil, gen = 64, yuk = 28 }) {
  const l = (degerler ?? []).map(Number).filter(Number.isFinite);
  if (l.length < 2) return null;

  const mx = Math.max(...l);
  const mn = Math.min(...l);

  const noktalar = l
    .map((v, i) => `${(i / (l.length - 1)) * gen},${yuk - 3 - ((v - mn) / (mx - mn || 1)) * (yuk - 6)}`)
    .join(" ");

  return (
    <Svg width={gen} height={yuk}>
      <Polyline
        points={noktalar}
        fill="none"
        stroke={renkli}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Değer etiketli çubuk grafik.
 *
 * @param veri   [[etiket, değer], …]
 * @param vurgu  Turuncu çizilecek çubuğun sırası (ör. "bugün"); -1 yok
 */
export function CubukGrafik({ veri, yuk = 130, renkli = P.yesil, vurgu = -1, birim = "" }) {
  const [gen, setGen] = useState(0);

  const liste = (veri ?? []).filter(Array.isArray).map(([e, v]) => [String(e ?? ""), Number(v) || 0]);
  const enCok = Math.max(0, ...liste.map((x) => x[1]));

  if (!liste.length || enCok === 0) return <Bos />;

  const alt = 18;
  const ust = 16;
  const mx = enCok * 1.1;
  const sutun = gen / liste.length;
  const cg = Math.min(30, sutun * 0.58);
  const alan = yuk - alt - ust;

  return (
    <View style={{ height: yuk }} onLayout={(e) => setGen(e.nativeEvent.layout.width)}>
      {gen > 0 ? (
        <Svg width={gen} height={yuk}>
          {[0.5, 1].map((k) => (
            <Line key={k} x1="0" x2={gen} y1={ust + alan * (1 - k)} y2={ust + alan * (1 - k)} stroke={P.cizgi2} />
          ))}

          {liste.map(([et, v], i) => {
            const h = (alan * v) / mx;
            const x = i * sutun + (sutun - cg) / 2;
            const y = yuk - alt - h;
            const vurgulu = i === vurgu;

            return (
              <G key={i}>
                <Rect
                  x={x}
                  y={y}
                  width={cg}
                  height={Math.max(h, v > 0 ? 2 : 0)}
                  rx={Math.min(5, cg / 3)}
                  fill={vurgulu ? P.turuncu : renkli}
                  opacity={vurgu < 0 || vurgulu ? 1 : 0.55}
                />
                <SvgText
                  x={x + cg / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight="700"
                  fill={P.ikincil}
                >
                  {`${sayi(v)}${birim}`}
                </SvgText>
                <SvgText x={x + cg / 2} y={yuk - 4} textAnchor="middle" fontSize={10} fill={P.soluk}>
                  {et}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Çok serili çizgi grafik (giriş / çıkış gibi).
 * @param seriler   [{ v: [sayılar], renk }]
 * @param etiketler x ekseni yazıları; kalabalık olmasın diye biri atlanıyor
 */
export function CizgiGrafik({ seriler, etiketler, yuk = 150 }) {
  const [gen, setGen] = useState(0);

  const s = (seriler ?? []).filter((x) => (x?.v?.length ?? 0) > 1);
  const et = etiketler ?? [];
  const enCok = Math.max(0, ...s.flatMap((x) => x.v.map(Number)));

  if (!s.length || enCok === 0) return <Bos />;

  const alt = 18;
  const ust = 10;
  const sol = 6;
  const mx = enCok * 1.12;
  const adet = Math.max(...s.map((x) => x.v.length));

  const x = (i) => sol + (i / (adet - 1)) * (gen - sol * 2);
  const y = (v) => ust + (yuk - alt - ust) * (1 - v / mx);

  return (
    <View style={{ height: yuk }} onLayout={(e) => setGen(e.nativeEvent.layout.width)}>
      {gen > 0 ? (
        <Svg width={gen} height={yuk}>
          {[0.33, 0.66, 1].map((k) => (
            <Line key={k} x1="0" x2={gen} y1={y(mx * k)} y2={y(mx * k)} stroke={P.cizgi2} />
          ))}

          {s.map((seri, si) => (
            <G key={si}>
              <Polyline
                points={seri.v.map((v, i) => `${x(i)},${y(Number(v) || 0)}`).join(" ")}
                fill="none"
                stroke={seri.renk}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Circle
                cx={x(seri.v.length - 1)}
                cy={y(Number(seri.v[seri.v.length - 1]) || 0)}
                r={4}
                fill={seri.renk}
                stroke="#fff"
                strokeWidth={2}
              />
            </G>
          ))}

          {et.map((e, i) =>
            i % 2 === 0 || i === et.length - 1 ? (
              <SvgText key={i} x={x(i)} y={yuk - 4} textAnchor="middle" fontSize={10} fill={P.soluk}>
                {e}
              </SvgText>
            ) : null
          )}
        </Svg>
      ) : null}
    </View>
  );
}

/** Grafik lejantı: [[renk, yazı]] */
export function Lejant({ ogeler }) {
  return (
    <View style={g.lejant}>
      {(ogeler ?? []).map(([r, y]) => (
        <View key={y} style={g.lejantOge}>
          <View style={[g.lejantNokta, { backgroundColor: r }]} />
          <Text style={g.lejantYazi}>{y}</Text>
        </View>
      ))}
    </View>
  );
}

function Bos() {
  return (
    <View style={g.bos}>
      <Text style={g.bosYazi}>Henüz veri yok</Text>
    </View>
  );
}

const g = StyleSheet.create({
  ortala: { alignItems: "center", justifyContent: "center" },
  bos: { paddingVertical: 22, alignItems: "center" },
  bosYazi: { fontSize: 12.5, color: P.soluk },
  lejant: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 6 },
  lejantOge: { flexDirection: "row", alignItems: "center", gap: 5 },
  lejantNokta: { width: 9, height: 9, borderRadius: 3 },
  lejantYazi: { fontSize: 11.5, color: P.ikincil },
});

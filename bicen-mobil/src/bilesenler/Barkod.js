/**
 * Code 128 barkod
 * ---------------------------------------------------------------------------
 * Kart numarası on altı hane; EAN-13 on üç hane alıyor ve numarayı
 * kırpmak kasada okunmayan bir barkod üretirdi. Code 128 değişken
 * uzunlukta çalışıyor ve market kasalarındaki okuyucuların hepsi
 * destekliyor.
 *
 * Dışarıdan kitaplık eklemek yerine çizim burada: tek iş için bir
 * bağımlılık daha almak paket boyutunu büyütüyor.
 */

import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";

/* Code 128 desenleri: her karakter altı genişlik değeri.
   Sıra, kod tablosundaki değer sırasıyla aynı. */
const DESEN = [
  "212222","222122","222221","121223","121322","131222","122213","122312",
  "132212","221213","221312","231212","112232","122132","122231","113222",
  "123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321",
  "232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321",
  "331121","312113","312311","332111","314111","221411","431111","111224",
  "111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112",
  "421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412",
  "211214","211232","233111",
];

const BASLANGIC_C = 105;
const DUR = "2331112";

/**
 * Yalnızca rakamlardan oluşan değer için Code 128-C kodlaması.
 * İki rakam tek karakterde kodlanıyor; bu, barkodu yarı yarıya
 * kısaltıyor ve dar ekranda okunur tutuyor.
 */
function kodla(deger) {
  const rakam = (deger ?? "").replace(/\D/g, "");

  /* Tek haneyse başa sıfır: 128-C çiftler hâlinde çalışıyor. */
  const cift = rakam.length % 2 === 1 ? "0" + rakam : rakam;

  const degerler = [BASLANGIC_C];

  for (let i = 0; i < cift.length; i += 2) {
    degerler.push(parseInt(cift.slice(i, i + 2), 10));
  }

  /* Sağlama: başlangıç değeri artı her karakterin konumla çarpımı. */
  let toplam = BASLANGIC_C;

  for (let i = 1; i < degerler.length; i++) toplam += degerler[i] * i;

  degerler.push(toplam % 103);

  return degerler.map((d) => DESEN[d]).join("") + DUR;
}

/* -------------------------------------------------------------------------- */

export default function Barkod({ deger, genislik = 280, yukseklik = 72, renkli = "#182016" }) {
  const desen = kodla(deger);

  if (!desen) return null;

  /* Toplam birim genişliği: desendeki bütün rakamların toplamı. */
  const birim = desen.split("").reduce((t, x) => t + Number(x), 0);
  const olcek = genislik / birim;

  const cubuklar = [];
  let x = 0;
  let koyu = true;

  for (const hane of desen) {
    const en = Number(hane) * olcek;

    if (koyu) cubuklar.push({ x, en });

    x += en;
    koyu = !koyu;
  }

  return (
    <View>
      <Svg width={genislik} height={yukseklik}>
        {cubuklar.map((c, i) => (
          <Rect
            key={i}
            x={c.x}
            y={0}
            width={c.en}
            height={yukseklik}
            fill={renkli}
          />
        ))}
      </Svg>
    </View>
  );
}

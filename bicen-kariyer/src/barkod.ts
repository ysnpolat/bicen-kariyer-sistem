/**
 * ---------------------------------------------------------------------------
 * Code 128 barkod
 * ---------------------------------------------------------------------------
 * Biçen Kart numarası on altı hane; EAN-13 on üç hane alıyor ve numarayı
 * kırpmak kasada okunmayan bir barkod üretirdi. Code 128 değişken uzunlukta
 * çalışıyor ve market kasalarındaki okuyucuların hepsi destekliyor. Mobil
 * uygulamadaki (bicen-mobil/src/bilesenler/Barkod.js) çizimin aynısı;
 * dışarıdan kitaplık alınmadı.
 *
 * Rakamlar Code 128-C ile ikişer ikişer kodlanıyor (barkod yarı yarıya
 * kısalıyor, dar ekranda okunur kalıyor). Hane sayısı tekse son hane
 * Code B'ye geçilerek yazılıyor; başa sıfır eklemek numarayı değiştirirdi.
 * Rakam dışı karakter varsa tamamı Code B.
 * ---------------------------------------------------------------------------
 */

/* Her karakter altı genişlik değeri; sıra kod tablosundaki değer sırası. */
const DESEN = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232",
];

const BASLA_B = 104;
const BASLA_C = 105;
const CODE_B = 100;
const DUR = "2331112";

/** Kodlanacak değerler: başlangıç, veri ve sağlama (durma hariç). */
const degerler = (metin: string): number[] => {
  const s = (metin ?? "").trim();

  if (s.length === 0) return [];

  const liste: number[] = [];

  if (/^\d+$/.test(s) && s.length >= 2) {
    liste.push(BASLA_C);

    const cift = s.length - (s.length % 2);

    for (let i = 0; i < cift; i += 2) liste.push(parseInt(s.slice(i, i + 2), 10));

    if (s.length % 2 === 1) {
      liste.push(CODE_B);
      liste.push(s.charCodeAt(s.length - 1) - 32);
    }
  } else {
    liste.push(BASLA_B);

    for (const c of s) {
      const k = c.charCodeAt(0);
      liste.push(k >= 32 && k <= 127 ? k - 32 : 0);
    }
  }

  /* Sağlama: başlangıç değeri + her karakterin konumuyla çarpımı, mod 103 */
  let toplam = liste[0];

  for (let i = 1; i < liste.length; i++) toplam += liste[i] * i;

  liste.push(toplam % 103);

  return liste;
};

/**
 * Çubuk/boşluk genişlikleri (modül cinsinden), koyu çubukla başlayarak
 * sırayla. Boş değer için boş dizi.
 */
export const barkodGenislikleri = (metin: string): number[] => {
  const d = degerler(metin);

  if (d.length === 0) return [];

  return (d.map((x) => DESEN[x]).join("") + DUR).split("").map(Number);
};

export interface Cubuk {
  x: number;
  en: number;
}

/**
 * Çizilecek koyu çubuklar. `sessiz` her iki yandaki boş alan (modül);
 * okuyucuların barkodu yakalayabilmesi için en az 10 modül olmalı.
 */
export const barkodCubuklari = (
  metin: string,
  genislik: number,
  sessiz = 10
): Cubuk[] => {
  const g = barkodGenislikleri(metin);

  if (g.length === 0) return [];

  const birim = g.reduce((t, x) => t + x, 0) + sessiz * 2;
  const olcek = genislik / birim;

  const cubuklar: Cubuk[] = [];
  let x = sessiz * olcek;

  g.forEach((en, i) => {
    if (i % 2 === 0) cubuklar.push({ x, en: en * olcek });
    x += en * olcek;
  });

  return cubuklar;
};

/**
 * Tema
 * ---------------------------------------------------------------------------
 * Panelle aynı renkler. Değerler tek yerde tutulur; ekranlarda sabit renk
 * kodu yazmak, marka rengi değiştiğinde her dosyayı gezmek demek olurdu.
 */

export const renk = {
  yesil: "#7cb518",
  yesilKoyu: "#5f8c10",
  yesilAcik: "#f2f9e8",
  turuncu: "#e8481c",
  turuncuAcik: "#fff2e8",
  turuncuKoyu: "#ad4e00",
  mavi: "#1a4d80",
  maviAcik: "#eef4fb",
  mor: "#722ed1",
  morAcik: "#f6efff",
  siyah: "#1d2126",
  metin: "#1f2933",
  pasif: "#6b7280",
  cizgi: "#e6e9e3",
  zemin: "#f4f6f2",
  beyaz: "#ffffff",
  kirmizi: "#cf1322",
};

export const olcu = {
  bosluk: 14,
  kucukBosluk: 9,
  yuvarlak: 13,
  kartYuvarlak: 13,
};

export const yazi = {
  baslik: { fontSize: 18, fontWeight: "700", color: renk.metin },
  altBaslik: {
    fontSize: 12,
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  govde: { fontSize: 14, color: renk.metin, lineHeight: 21 },
  kucuk: { fontSize: 12, color: renk.pasif },
  deger: { fontSize: 21, fontWeight: "800", color: renk.metin },
};

/** Gün sayısını yazar: 2 → "2", 2.5 → "2,5" */
export const gunYaz = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

/** Para: 4550 → "4.550 TL" */
export const paraYaz = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL`;
};

/** Tarih: "2026-08-28" → "28.08.2026" */
export const tarihYaz = (v) => {
  if (!v) return "—";
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "—";

  const iki = (x) => String(x).padStart(2, "0");
  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
};

/** Saat: "2026-08-28T08:03" → "08:03" */
export const saatYaz = (v) => {
  if (!v) return "—";
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "—";

  const iki = (x) => String(x).padStart(2, "0");
  return `${iki(t.getHours())}:${iki(t.getMinutes())}`;
};

export const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/**
 * Patron görünümü renkleri.
 *
 * Onaylanan tasarım, durum renklerini (okutma, izin, rapor, kadro…)
 * birbirinden ayırmak için personel ekranlarından daha geniş ve biraz
 * daha yumuşak bir palet kullanıyor. Ayrı tutuluyor: `renk` içindeki
 * değerleri değiştirmek, personel ekranlarının görünümünü de değiştirirdi.
 */
export const patronRenk = {
  yesil: renk.yesil,
  yesilKoyu: renk.yesilKoyu,
  yesilAcik: "#eef6e1",
  yesilYazi: "#3f6507",
  turuncu: renk.turuncu,
  turuncuAcik: "#fff0ea",
  turuncuYazi: "#a33410",
  sari: "#b77a00",
  sariAcik: "#fff6dc",
  mavi: "#2e6aa8",
  maviAcik: "#e9f0f8",
  mor: "#6d4bc2",
  morAcik: "#f1ecfb",
  erik: "#a0277d",
  erikAcik: "#fbeaf5",
  kirmizi: "#c62828",
  kirmiziAcik: "#fdecec",
  metin: "#1c2419",
  ikincil: "#4b5563",
  soluk: "#7b8577",
  cizgi: "#e4e8df",
  cizgi2: "#eef1ea",
  zemin: renk.zemin,
  gri: "#f1f3ef",
  segment: "#e9ede4",
  koyu1: "#132209",
  koyu2: "#24410f",
};

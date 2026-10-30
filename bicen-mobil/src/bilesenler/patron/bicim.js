/**
 * Patron görünümü biçimleyicileri
 * ---------------------------------------------------------------------------
 * Sayı, oran, ad ve renk tonu yardımcıları. Ekranlar arasında aynı
 * sayının iki farklı biçimde yazılması (941 / 941,0 / 941 kişi)
 * karışıklık yaratıyordu; hepsi buradan geçiyor.
 */

import { patronRenk as P, AYLAR } from "../../tema";

/** 1284 → "1.284"; sayı değilse "—" */
export const sayi = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
};

/** 2.1 → "2,1" (tek ondalık) */
export const ondalik = (v, basamak = 1) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: basamak });
};

/** 53000 → "53.000 ₺" */
export const lira = (v) => (v === null || v === undefined ? "—" : `${sayi(Math.round(Number(v)))} ₺`);

/** 1920000 → "1,92 M"; 53000 → "53 B"; küçükler olduğu gibi */
export const kisa = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${ondalik(n / 1_000_000, 2)} M`;
  if (Math.abs(n) >= 10_000) return `${ondalik(n / 1_000, 0)} B`;
  return sayi(n);
};

/**
 * Türkçe küçük harf: "İNEGÖL" → "inegöl".
 * toLocaleLowerCase("tr") her motorda aynı sonucu vermiyor (I → ı);
 * aramada "inegöl" yazan kişi İNEGÖL'ü bulabilmeli.
 */
export const kucult = (s) =>
  String(s ?? "")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase();

/** "ELİF KAYA" → "EK" */
export const basHarf = (ad) =>
  String(ad ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .replace(/i/g, "İ")
    .toUpperCase();

/** "Ayşe Kaya" → "Ayşe" */
export const ilkAd = (ad) => String(ad ?? "").split(" ").filter(Boolean)[0] ?? "";

/** Okutma / doluluk oranının rengi: %90+ yeşil, %75+ sarı, altı turuncu */
export const oranRenk = (o) => (o >= 90 ? P.yesilKoyu : o >= 75 ? P.sari : P.turuncu);
export const oranDolgu = (o) => (o >= 90 ? P.yesil : o >= 75 ? P.sari : P.turuncu);

/** Ton çiftleri: [zemin, yazı] — tasarımdaki t-yesil, t-mavi… sınıfları */
export const TON = {
  yesil: [P.yesilAcik, P.yesilKoyu],
  turuncu: [P.turuncuAcik, P.turuncu],
  mavi: [P.maviAcik, P.mavi],
  mor: [P.morAcik, P.mor],
  erik: [P.erikAcik, P.erik],
  sari: [P.sariAcik, P.sari],
  gri: [P.gri, P.ikincil],
  kirmizi: [P.kirmiziAcik, P.kirmizi],
};

export const ton = (ad) => TON[ad] ?? TON.gri;

export const oranTon = (o) => (o >= 90 ? "yesil" : o >= 75 ? "sari" : "turuncu");

/**
 * Personel durumu → [etiket, ton].
 * "okuttu" tarih aralığında (1.6): aralıkta kaç gün okuttuğu.
 */
export const durumBilgi = (durum, saat, okutmaGun) =>
  ({
    magaza: [saat ? `Mağazada · ${saat}` : "Mağazada", "yesil"],
    cikti: [saat ? `Çıktı · ${saat}` : "Çıktı", "gri"],
    izin: ["İzinli", "mavi"],
    rapor: ["Raporlu", "erik"],
    yok: ["Okutmadı", "turuncu"],
    okuttu: [okutmaGun ? `${okutmaGun} gün okuttu` : "Okuttu", "yesil"],
  }[durum] ?? ["—", "gri"]);

/** Başvuru durumu → ton */
export const basvuruTon = (durum) => {
  const d = kucult(durum);
  if (d.includes("yeni")) return "mavi";
  if (d.includes("incel")) return "gri";
  if (d.includes("görüş")) return "mor";
  if (d.includes("evrak")) return "sari";
  if (d.includes("onay")) return "turuncu";
  if (d.includes("alındı") || d.includes("işe")) return "yesil";
  if (d.includes("red") || d.includes("olumsuz")) return "kirmizi";
  return "gri";
};

/** Huni sırasındaki renkler (tasarımdaki sıra) */
export const HUNI_RENK = [P.mavi, "#9aa39a", P.mor, P.sari, P.turuncu, P.yesil];

/** 936 gün → "2 yıl 6 ay" */
export const kidemYaz = (gun) => {
  const g = Number(gun);
  if (!Number.isFinite(g) || g < 0) return "—";
  const ay = Math.floor(g / 30.44);
  const yil = Math.floor(ay / 12);
  const kalan = ay % 12;
  if (yil === 0 && kalan === 0) return `${Math.max(1, Math.round(g))} gün`;
  return `${yil ? `${yil} yıl ` : ""}${kalan ? `${kalan} ay` : ""}`.trim();
};

const iki = (x) => String(x).padStart(2, "0");

/** Date → "14:31" */
export const saatDk = (t) => {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return "—";
  return `${iki(d.getHours())}:${iki(d.getMinutes())}`;
};

/** "2026-10-02T10:00:00" → "02.10 10:00" */
export const kisaTarihSaat = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${iki(d.getDate())}.${iki(d.getMonth() + 1)} ${iki(d.getHours())}:${iki(d.getMinutes())}`;
};

const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "Cumartesi, 3 Ekim" */
export const uzunTarih = (t = new Date()) => `${GUNLER[t.getDay()]}, ${t.getDate()} ${AYLAR[t.getMonth()]}`;

export const selamla = (t = new Date()) => {
  const s = t.getHours();
  return s < 12 ? "Günaydın" : s < 18 ? "İyi günler" : "İyi akşamlar";
};

/** Bu ayın adı: "Ekim" */
export const buAy = (t = new Date()) => AYLAR[t.getMonth()];

/**
 * Onay türleri. Sunucu yeni bir tür gönderirse kart yine çizilsin diye
 * bilinmeyen tür gri "Onay" olarak gösteriliyor.
 */
/**
 * Norm doluluğu (%): (norm − eksik) ÷ norm, aşağı yuvarlı tek ondalık.
 * Sunucu "doluluk" gönderiyorsa o; eski sunucuda burada hesaplanıyor.
 * Mevcut ÷ norm kullanılmıyor: bir pozisyondaki fazla, başka pozisyonun
 * eksiğini kapatıyor gibi görünüp eksik varken "%100" yazıyordu.
 */
export const dolulukYuzde = (n) => {
  if (!n) return null;
  if (n.doluluk !== null && n.doluluk !== undefined) return Number(n.doluluk);
  if (!n.norm) return null;
  return Math.floor((Math.max(0, n.norm - (n.eksik || 0)) / n.norm) * 1000) / 10;
};

export const dolulukMetni = (n) => {
  const y = dolulukYuzde(n);
  return y === null ? "—" : `%${String(y).replace(".", ",")}`;
};

export const ONAY_TUR = {
  ise: { ad: "İşe alım", ton: "yesil", ikon: "kisiEkle" },
  rot: { ad: "Rotasyon", ton: "mavi", ikon: "rotasyon" },
  norm: { ad: "Norm kadro", ton: "mor", ikon: "kadro" },
  puan: { ad: "Puan onayı", ton: "erik", ikon: "kart" },
  izin: { ad: "Üst düzey izin", ton: "sari", ikon: "takvim" },
  avans: { ad: "Avans", ton: "turuncu", ikon: "para" },
};

export const onayTur = (tur) => ONAY_TUR[tur] ?? { ad: "Onay", ton: "gri", ikon: "onay" };

/** "3 işe alım · 1 rotasyon" */
export const onayOzeti = (turler) =>
  (turler ?? [])
    .filter((t) => t?.adet > 0)
    .map((t) => `${t.adet} ${kucult(onayTur(t.tur).ad)}`)
    .join(" · ");

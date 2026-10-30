/**
 * Hukuk masası uçları (24.10.2026) — /api/Hukuk (Kariyer API)
 * Dış hukuk danışmanı ve Biçen hukuk ekibi aynı uçları kullanır;
 * sunucu kişinin göreceği dosyaları ve hakkını kendisi belirler.
 */
import { api, cokParcali, jetonOku, oturumluAdres } from "./api";

export const hukukBen = () => api.al("/api/Hukuk/Ben");
export const hukukMasa = () => api.al("/api/Hukuk/Masa");
export const hukukDosyalar = (durum = "acik", q = "", tur = "") =>
  api.al(`/api/Hukuk/Dosyalar?durum=${durum}${q ? `&q=${encodeURIComponent(q)}` : ""}${tur ? `&tur=${encodeURIComponent(tur)}` : ""}`);

/* İcra / maaş haczi (30.10.2026) — /api/Hukuk/Icra; danışmana sunucu kapalı,
   istemci de danışmanda hiç çağırmaz. */
export const icraBen = () => api.al("/api/Hukuk/Icra/Ben");
export const icraOzet = () => api.al("/api/Hukuk/Icra/Ozet");
export const icraDosyalar = (durum = "acik", q = "", tur = "") =>
  api.al(`/api/Hukuk/Icra/Dosyalar?durum=${durum}${q ? `&q=${encodeURIComponent(q)}` : ""}${tur ? `&tur=${tur}` : ""}`);
export const icraDosya = (id) => api.al(`/api/Hukuk/Icra/Dosya/${id}`);
export const icraCevapYazisi = (id) => api.al(`/api/Hukuk/Icra/Dosya/${id}/Cevap`);
export const icraAyrilisYazisi = (id) => api.al(`/api/Hukuk/Icra/Dosya/${id}/AyrilisYazisi`);
export const icraOlayEkle = (id, g) => api.gonder(`/api/Hukuk/Icra/Dosya/${id}/Olay`, g);
export const icraOdendi = (kid, odendi = true) => api.gonder(`/api/Hukuk/Icra/Kesinti/${kid}/Odendi`, { odendi });
export const icraBelgeAdresi = (id) => oturumluAdres(`/api/Hukuk/Icra/Belge/${id}`);
export const icraBelgeYukle = (dosyaId, dosya) => cokParcali(`/api/Hukuk/Icra/Dosya/${dosyaId}/Belge`, {}, dosya);
export const lira = (v) => (v == null ? "—" : `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`);
export const hukukDosya = (id) => api.al(`/api/Hukuk/Dosya/${id}`);
export const hukukAjanda = (gun = 45) => {
  const b = new Date();
  b.setDate(b.getDate() - 1);
  const e = new Date();
  e.setDate(e.getDate() + gun);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return api.al(`/api/Hukuk/Ajanda?bas=${f(b)}&bit=${f(e)}`);
};
export const hukukYazilar = (klasor = "gelen", q = "") =>
  api.al(`/api/Hukuk/Yazilar?klasor=${klasor}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
export const hukukYazi = (id) => api.al(`/api/Hukuk/Yazi/${id}`);
export const hukukKisiler = (dosyaId) => api.al(`/api/Hukuk/Kisiler${dosyaId ? `?dosyaId=${dosyaId}` : ""}`);
export const hukukOlayEkle = (dosyaId, g) => api.gonder(`/api/Hukuk/Dosya/${dosyaId}/Olay`, g);
export const hukukOlayGuncelle = (id, g) => api.gonder(`/api/Hukuk/Olay/${id}`, g);
export const hukukArsiv = (id, geri = false) => api.gonder(`/api/Hukuk/Yazi/${id}/Arsiv${geri ? "?geri=true" : ""}`, {});
export const hukukBelgeAdresi = (id, indir = false) => oturumluAdres(`/api/Hukuk/Belge/${id}${indir ? "?indir=true" : ""}`);
export const hukukBelgeYukle = (dosyaId, dosya) => cokParcali(`/api/Hukuk/Dosya/${dosyaId}/Belge`, {}, dosya);

/** Resmi yazı: ek varsa çok parçalı yükleme yolu, yoksa düz form */
export const hukukYaziGonder = async (alanlar, dosya) => {
  if (dosya) return cokParcali("/api/Hukuk/Yazi", alanlar, dosya);
  const form = new FormData();
  Object.entries(alanlar).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") form.append(k, String(v));
  });
  const jeton = jetonOku();
  const r = await fetch(`${api.adres}/api/Hukuk/Yazi`, {
    method: "POST",
    headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    body: form,
  });
  const metin = await r.text();
  let veri = {};
  try {
    veri = metin ? JSON.parse(metin) : {};
  } catch {
    veri = {};
  }
  if (!r.ok) throw new Error(veri?.hata || `Gönderilemedi (${r.status}).`);
  return veri;
};

/* ------------------------------------------------------------ biçimler */

const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUN = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

export const tarih = (t, saatli = false) => {
  if (!t) return "—";
  const d = new Date(t);
  const s = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  return saatli && (d.getHours() || d.getMinutes()) ? `${s} ${saat(t)}` : s;
};
export const saat = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const gunAy = (t) => {
  const d = new Date(t);
  return { gun: d.getDate(), ay: AY[d.getMonth()], hafta: GUN[d.getDay()] };
};
export const kisaZaman = (t) => {
  const d = new Date(t);
  const b = new Date();
  if (d.toDateString() === b.toDateString()) return saat(t);
  const dun = new Date();
  dun.setDate(dun.getDate() - 1);
  if (d.toDateString() === dun.toDateString()) return "Dün";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
};
/** Kalan gün metni ve vurgu */
export const kalan = (t) => {
  const a = new Date(t);
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  const g = Math.round((a - b) / 86400000);
  if (g < 0) return { metin: `${-g} gün geçti`, acil: true };
  if (g === 0) return { metin: "Bugün", acil: true };
  if (g === 1) return { metin: "Yarın", acil: true };
  return { metin: `${g} gün`, acil: false, yakin: g <= 7 };
};
export const boyut = (b) =>
  !b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
export const basHarf = (a = "") =>
  a.replace(/^(Av\.|Dr\.|Prof\.|Doç\.|Stj\.)\s*/i, "").split(" ").filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toLocaleUpperCase("tr");

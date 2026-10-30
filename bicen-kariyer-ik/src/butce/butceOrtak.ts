/**
 * Personel Bütçesi (30.10.2026) — ortak tipler, API sarmalayıcı ve biçim.
 *
 * Ücret verisi hassastır: hiçbir değer adres satırına, sorgu dizesine ya da
 * localStorage'a yazılmaz; her şey bellekte tutulur ve sunucudan POST/GET
 * gövdesiyle gelir. Süzme ve arama tarayıcıda yapılır.
 */
import { api } from "../api";

/* ------------------------------------------------------------------ tipler */

export interface VergiDilimi { ustSinir: number | null; oran: number }
export interface YanGider { kod: string; ad: string; tutar: number; gunOranli?: boolean; aciklama?: string }
export interface TekSeferlik {
  kod: string; ad: string; ay: number; ayTuru: "bordro" | "odeme"; tutar: number;
  gun?: number | null; gece?: boolean; gunOranli?: boolean; aciklama?: string;
}
export interface GeceRol { ad: string; maas: number; dortKisideVar: boolean }
export interface GeceSube { sube: string; kisi: number; norm: number }

export interface Parametre {
  yil: number;
  asgariUcretBrut: number;
  tavanKatsayisi: number;
  vergiDilimleri: VergiDilimi[];
  sgkIsci: number; issizlikIsci: number; damgaVergisi: number;
  sgkIsveren: number; isverenIndirim: number; issizlikIsveren: number;
  sgdpIsci: number; sgdpIsveren: number;
  asgariIstisna: boolean;
  maliyetKatsayisi: number;
  gtGunluk: number;
  yanGiderler: YanGider[];
  tekSeferlikler: TekSeferlik[];
  geceRoller: GeceRol[];
  geceSaatKatsayisi: number;
  geceSubeler: GeceSube[];
  bordroNetEnAzAsgari: boolean;
  yolSgkOrani: number;
  /** Senaryo türetilirken kişiye özel yan gider tutarlarının artışı */
  kisiKalemArtis: number;
}

export interface Donem {
  id: number; ad: string; yil: number; bazDonemId?: number | null; durum: "taslak" | "onayli" | "arsiv";
  aciklama?: string | null; kaynak?: string | null; olusturan?: string | null; olusturma: string;
  guncelleyen?: string | null; guncelleme?: string | null; kisiSayisi: number;
}

export interface AyOzeti {
  ay: number; etiket: string; brut: number; isverenSgk: number; grFarki: number; yanGider: number; tekSeferlik: number; netBanka: number; toplam: number;
}
export interface GrupOzeti {
  ad: string; kisi: number; fte: number; toplam: number; brut: number; isverenSgk: number; grFarki: number; yanGider: number; tekSeferlik: number;
  ortalamaNet: number; kisiBasiAylik: number;
}
export interface Kalem { kod: string; ad: string; tutar: number }
export interface Ozet {
  kisi: number; fte: number; yillikToplam: number; aylikOrtalama: number; kisiBasiAylik: number;
  yillikBrut: number; yillikIsverenSgk: number; yillikGrFarki: number; yillikYanGider: number; yillikTekSeferlik: number;
  yillikNetBanka: number; yillikGrm: number; netMaliyetCarpani: number; asgariNet: number;
  bordroAylari: AyOzeti[]; odemeAylari: AyOzeti[]; subeler: GrupOzeti[]; meslekler: GrupOzeti[];
  yanGiderDagilimi: Kalem[]; tekSeferlikDagilimi: Kalem[];
}

export interface Kural {
  id?: number; tur: "genel" | "sube" | "meslek" | "subeMeslek" | "kisi"; sube?: string | null; meslek?: string | null; kisiId?: number | null;
  bordroOran: number; grmOran?: number | null; aciklama?: string | null;
}

export interface Kisi {
  id: number; sube?: string | null; bolum?: string | null; sicil?: string | null; ad?: string | null; gun: number; emekli: boolean; meslek?: string | null;
  grmOnceki: number; grm: number; bordroNet: number; yanGiderler?: Record<string, number> | null; bazGrm?: number | null; bazBordroNet?: number | null; elle: boolean; aktif: boolean; notu?: string | null;
  zamOrani?: number | null; yillikToplam: number; yillikIsveren: number; yillikGrFarki: number; yillikYanGider: number; yillikTekSeferlik: number;
  ocakBrut: number; aylikOrtalama: number;
}

export interface AyBordro {
  ay: number; etiket: string; brut: number; sgkIsci: number; issizlikIsci: number; matrah: number; kumulatifMatrah: number; gv: number; dv: number;
  gvIstisna: number; dvIstisna: number; gvSon: number; dvSon: number; net: number; sskIsveren: number; indirim: number; issizlikIsveren: number;
  isverenMaliyeti: number; netBanka: number; grFarki: number; yanGider: number; tekSeferlik: number; toplam: number; tekSeferlikKalemler: Kalem[];
}

export interface KisiDetay { kisi: Kisi; aylar: AyBordro[]; yanGiderler: Kalem[]; tavan: number; asgariNet: number }

export interface DonemYaniti {
  donem: Donem; parametre: Parametre; kurallar: Kural[]; ozet: Ozet; subeler: string[]; meslekler: string[];
  baz?: { donem: Donem; ozet: Ozet } | null;
}

export interface KisiGirdi {
  sube?: string | null; bolum?: string | null; sicil?: string | null; ad?: string | null; gun: number; emekli: boolean; meslek?: string | null;
  grmOnceki: number; grm: number; bordroNet: number; yanGiderler?: Record<string, number> | null; aktif?: boolean; notu?: string | null;
}

export interface SenaryoGirdi {
  bazDonemId: number; ad: string; yil: number; aciklama?: string; parametre: Parametre; kurallar: Kural[]; pasifKisiler: number[];
}

/* --------------------------------------------------------------------- API */

export const butceApi = {
  ben: () => api.al<{ yetkili: boolean; ad?: string; rol?: string; varsayilan?: Parametre }>("/api/Butce/Ben"),
  donemler: () => api.al<{ donemler: Donem[] }>("/api/Butce/Donemler"),
  donem: (id: number) => api.al<DonemYaniti>(`/api/Butce/Donem/${id}`),
  kisiler: (id: number) => api.al<{ kisiler: Kisi[] }>(`/api/Butce/Donem/${id}/Kisiler`),
  kisiDetay: (id: number, kisiId: number) => api.al<KisiDetay>(`/api/Butce/Donem/${id}/Kisi/${kisiId}`),
  donemOlustur: (g: { ad: string; yil: number; aciklama?: string; kaynak?: string; parametre?: Parametre; kisiler?: KisiGirdi[] }) =>
    api.gonder<{ id: number; kisi: number }>("/api/Butce/Donem", g),
  donemGuncelle: (id: number, g: { ad?: string; durum?: string; aciklama?: string }) => api.guncelle<{ tamam: boolean }>(`/api/Butce/Donem/${id}`, g),
  donemSil: (id: number) => api.sil<{ tamam: boolean }>(`/api/Butce/Donem/${id}`),
  kisiEkle: (id: number, g: KisiGirdi) => api.gonder<{ id: number }>(`/api/Butce/Donem/${id}/Kisi`, g),
  kisiGuncelle: (id: number, kisiId: number, g: Partial<KisiGirdi>) => api.guncelle<{ tamam: boolean }>(`/api/Butce/Donem/${id}/Kisi/${kisiId}`, g),
  kisiSil: (id: number, kisiId: number) => api.sil<{ tamam: boolean }>(`/api/Butce/Donem/${id}/Kisi/${kisiId}`),
  kisilerToplu: (id: number, g: { ids: number[]; bordroOran?: number; grmOran?: number; gun?: number; emekli?: boolean; aktif?: boolean; meslek?: string; sube?: string }) =>
    api.gonder<{ adet: number }>(`/api/Butce/Donem/${id}/KisilerToplu`, g),
  parametre: (id: number, p: Parametre) => api.guncelle<{ ozet: Ozet }>(`/api/Butce/Donem/${id}/Parametre`, p),
  kurallar: (id: number, k: Kural[], uygula: boolean) => api.guncelle<{ tamam: boolean; uygulanan: number }>(`/api/Butce/Donem/${id}/Kurallar?uygula=${uygula}`, k),
  kurallariUygula: (id: number) => api.gonder<{ uygulanan: number }>(`/api/Butce/Donem/${id}/KurallariUygula`),
  onizle: (g: SenaryoGirdi) => api.gonder<{ baz: Ozet; yeni: Ozet; asgariNet: number }>("/api/Butce/Onizle", g),
  senaryo: (g: SenaryoGirdi) => api.gonder<{ id: number }>("/api/Butce/Senaryo", g),
  karsilastir: (a: number, b: number) => api.al<{ a: { donem: Donem; ozet: Ozet }; b: { donem: Donem; ozet: Ozet } }>(`/api/Butce/Karsilastir?a=${a}&b=${b}`),
  mikro: (id: number) => api.al<{
    hazir: boolean; hata?: string; mikroAktif?: number; butceAktif?: number; sicilsiz?: number;
    butcedeOlupMikrodaYok?: { id: number; ad: string; sube: string; meslek: string; sicil: string }[];
    mikrodaOlupButcedeYok?: { ad: string; sube: string; pozisyon: string; sicil: string; giris?: string }[];
  }>(`/api/Butce/Donem/${id}/MikroKarsilastir`),
  log: (islem: string, donemId?: number, ayrinti?: string) => api.gonder<{ tamam: boolean }>("/api/Butce/Log", { islem, donemId, ayrinti }).catch(() => null),
  gunluk: () => api.al<{ kayitlar: { id: number; kullanici: string; ad: string; rol: string; islem: string; donemId?: number; donemAd?: string; ayrinti?: string; ip?: string; zaman: string }[] }>("/api/Butce/Gunluk"),
};

/* ------------------------------------------------------------------- biçim */

export const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** ₺ tam sayı */
export const para = (v?: number | null) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : "₺" + Math.round(v).toLocaleString("tr-TR");

/** ₺ iki ondalık (bordro tablosu) */
export const paraKurus = (v?: number | null) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : "₺" + v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kısa: ₺1,2 mn / ₺820 bin */
export const paraKisa = (v?: number | null) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const m = Math.abs(v);
  const isaret = v < 0 ? "−" : "";
  if (m >= 1e9) return `${isaret}₺${(m / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} mr`;
  if (m >= 1e6) return `${isaret}₺${(m / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: m >= 1e8 ? 0 : 1 })} mn`;
  if (m >= 1e3) return `${isaret}₺${(m / 1e3).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} bin`;
  return `${isaret}₺${m.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;
};

export const sayi = (v?: number | null, ondalik = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toLocaleString("tr-TR", { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik });

/** 0.27 → %27 */
export const yuzde = (v?: number | null, ondalik = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `%${(v * 100).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: ondalik })}`;

/** Fark: +%3,2 / −%1,0 */
export const farkYuzde = (yeni: number, baz: number, ondalik = 1) => {
  if (!baz) return "—";
  const f = (yeni - baz) / baz;
  return (f >= 0 ? "+" : "−") + `%${Math.abs(f * 100).toLocaleString("tr-TR", { maximumFractionDigits: ondalik })}`;
};

export const tarihSaat = (v?: string | null) => (v ? new Date(v).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "");

export const DURUM_ADI: Record<string, string> = { taslak: "Taslak", onayli: "Onaylı", arsiv: "Arşiv" };
export const KURAL_TUR_ADI: Record<string, string> = { genel: "Genel", sube: "Şube", meslek: "Meslek", subeMeslek: "Şube + meslek", kisi: "Kişi" };

/** Maliyet bileşenleri — grafikte ve tablolarda aynı sıra ve renk */
export const BILESENLER: { k: "brut" | "isverenSgk" | "grFarki" | "yanGider" | "tekSeferlik"; ad: string; renk: string; aciklama: string }[] = [
  { k: "brut", ad: "Brüt ücret", renk: "#2f6b3a", aciklama: "Bordro brütü (gün oranıyla)" },
  { k: "isverenSgk", ad: "İşveren SGK", renk: "#7fa98a", aciklama: "SSK işveren − 5 puan indirim + işsizlik işveren" },
  { k: "grFarki", ad: "GR farkı", renk: "#c9a227", aciklama: "Gerçek net (GRM) − bankaya yatan bordro neti" },
  { k: "yanGider", ad: "Yan giderler", renk: "#8ea7b8", aciklama: "Yemek, yol, çekler, prim, FM, hediye…" },
  { k: "tekSeferlik", ad: "Tek seferlik", renk: "#d0892f", aciklama: "Resmi tatil çalışması, bayram çeki, kıyafet, gece" },
];

/** Metin arama için küçük harf (Türkçe İ/ı dahil) */
export const kucult = (s?: string | null) => (s ?? "").toLocaleLowerCase("tr-TR");

/**
 * ---------------------------------------------------------------------------
 * Panel görünümü: kenar menünün marka bloğu
 * ---------------------------------------------------------------------------
 * Başlık, alt başlık ve logo rozeti Yönetim → Panel Görünümü'nden
 * ayarlanıyor (sunucuda KRY_AYARLAR / PANEL_GORUNUM).
 *
 * Ayar açılışta bir kez okunuyor (App), kaydedilince ayar ekranı yenisini
 * buraya yazıyor. Son değer tarayıcıda da tutuluyor
 * (bicen_ik_panel_gorunum): sayfa yenilendiğinde menü önce varsayılanı
 * sonra kurumun başlığını göstermesin. Okunamazsa ya da istek hata
 * verirse varsayılanlar geçerli.
 * ---------------------------------------------------------------------------
 */

import { useSyncExternalStore, type CSSProperties } from "react";
import { API_TABAN, LOGO_ADRESI, api } from "./api";

export type LogoTuru = "harf" | "gorsel" | "kurum";
export type GorselZemin = "beyaz" | "seffaf";

export type PanelGorunum = {
  baslik: string;
  altBaslik: string;
  logoTuru: LogoTuru;
  harf: string;
  /** Hazır renk adı ya da "ozel" */
  renk: string;
  renk1?: string | null;
  renk2?: string | null;
  gorselZemin: GorselZemin;
  /** Yüklenen menü logosunun sürümü; 0 = yok */
  logoSurum: number;
};

export const EN_UZUN = 40;

export const VARSAYILAN_GORUNUM: PanelGorunum = {
  baslik: "Biçen İK",
  altBaslik: "İnsan Kaynakları Paneli",
  logoTuru: "harf",
  harf: "b",
  renk: "yesil",
  renk1: null,
  renk2: null,
  gorselZemin: "beyaz",
  logoSurum: 0,
};

/** Hazır rozet renkleri: [açık uç, koyu uç] (135° geçiş) */
export const HAZIR_RENKLER: { ad: string; etiket: string; renk: [string, string] }[] = [
  { ad: "yesil", etiket: "Yeşil", renk: ["#8fd11f", "#4f7a0b"] },
  { ad: "turuncu", etiket: "Turuncu", renk: ["#ff9a3d", "#e8481c"] },
  { ad: "mavi", etiket: "Mavi", renk: ["#4ea8ff", "#1d5fd1"] },
  { ad: "mor", etiket: "Mor", renk: ["#b18cff", "#6d28d9"] },
  { ad: "kirmizi", etiket: "Kırmızı", renk: ["#ff6b6b", "#b91c1c"] },
  { ad: "koyu", etiket: "Koyu", renk: ["#4b5563", "#111827"] },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Rozetin iki rengi; özel renk eksikse yeşil */
export function rozetRenkleri(g: PanelGorunum): [string, string] {
  if (g.renk === "ozel" && HEX.test(g.renk1 ?? "") && HEX.test(g.renk2 ?? ""))
    return [g.renk1!, g.renk2!];

  return (HAZIR_RENKLER.find((r) => r.ad === g.renk) ?? HAZIR_RENKLER[0]).renk;
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Harf rozetinin satır içi stili */
export function rozetStili(g: PanelGorunum): CSSProperties {
  const [a, b] = rozetRenkleri(g);

  return {
    background: `linear-gradient(135deg, ${a}, ${b})`,
    boxShadow: `0 6px 16px ${rgba(a, 0.35)}`,
  };
}

export const menuLogoAdresi = (surum: number) =>
  `${API_TABAN}/api/PanelGorunum/Logo?v=${encodeURIComponent(String(surum))}`;

/** Rozette gösterilecek görselin adresi; harf rozetinde boş */
export function logoAdresi(g: PanelGorunum): string {
  if (g.logoTuru === "kurum") return LOGO_ADRESI;
  if (g.logoTuru === "gorsel" && g.logoSurum > 0) return menuLogoAdresi(g.logoSurum);
  return "";
}

/* ========================================================================== */
/* Denetim                                                                     */
/* ========================================================================== */

const metinMi = (x: unknown): x is string => typeof x === "string";

/** Sunucudan ya da depodan gelen değeri güvenli bir ayara çevirir */
export function gorunumDuzelt(ham: any): PanelGorunum {
  const v = VARSAYILAN_GORUNUM;

  if (!ham || typeof ham !== "object") return v;

  const logoTuru: LogoTuru = ["harf", "gorsel", "kurum"].includes(ham.logoTuru) ? ham.logoTuru : "harf";

  return {
    baslik: metinMi(ham.baslik) && ham.baslik.trim() ? ham.baslik.trim().slice(0, EN_UZUN) : v.baslik,
    altBaslik: metinMi(ham.altBaslik) ? ham.altBaslik.trim().slice(0, EN_UZUN) : v.altBaslik,
    logoTuru,
    harf: metinMi(ham.harf) && ham.harf.trim() ? Array.from(ham.harf.trim()).slice(0, 2).join("") : v.harf,
    renk: metinMi(ham.renk) ? ham.renk : v.renk,
    renk1: metinMi(ham.renk1) ? ham.renk1 : null,
    renk2: metinMi(ham.renk2) ? ham.renk2 : null,
    gorselZemin: ham.gorselZemin === "seffaf" ? "seffaf" : "beyaz",
    logoSurum: Number.isFinite(Number(ham.logoSurum)) ? Number(ham.logoSurum) : 0,
  };
}

/* ========================================================================== */
/* Paylaşılan değer                                                            */
/* ========================================================================== */

const DEPO_ANAHTARI = "bicen_ik_panel_gorunum";

const depodan = (): PanelGorunum => {
  try {
    const ham = window.localStorage.getItem(DEPO_ANAHTARI);
    return ham ? gorunumDuzelt(JSON.parse(ham)) : VARSAYILAN_GORUNUM;
  } catch {
    return VARSAYILAN_GORUNUM;
  }
};

let gecerli: PanelGorunum = depodan();
const dinleyiciler = new Set<() => void>();

/** Yeni ayarı menüye uygular ve tarayıcıya yazar */
export function panelGorunumAyarla(yeni: unknown) {
  gecerli = gorunumDuzelt(yeni);

  try {
    window.localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(gecerli));
  } catch {
    /* Depolama kapalı: bu oturumda yine geçerli */
  }

  dinleyiciler.forEach((f) => f());
}

/** Sunucudan okur; hata olursa son bilinen değer kalır */
export function panelGorunumYenile(): Promise<void> {
  return api
    .al<unknown>("/api/PanelGorunum")
    .then((d) => panelGorunumAyarla(d))
    .catch(() => undefined);
}

const abone = (f: () => void) => {
  dinleyiciler.add(f);
  return () => {
    dinleyiciler.delete(f);
  };
};

export function usePanelGorunum(): PanelGorunum {
  return useSyncExternalStore(abone, () => gecerli, () => gecerli);
}

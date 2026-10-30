/**
 * Yenilik kaydının ortak tipi ve sık kullanılan görünürlük fonksiyonları.
 *
 * Her yenilik `src/yenilikler/` altında kendi dosyasında durur:
 *
 *     2026-10-30-01-kisa-ad.ts
 *     ^^^^^^^^^^ ^^
 *     tarih      o günkü sıra (01, 02…)
 *
 * Numara dosya adından türetilir (YYYYMMDDSS); elle numara verilmez,
 * böylece iki geliştirme aynı numarayı alamaz. Okunmamış = numarası
 * kullanıcının okuduğu son numaradan büyük VE `gorur(oturum)` doğru olan.
 *
 * KURAL: kullanıcının göreceği her değişiklikte bir yenilik dosyası
 * eklenir; `gorur`, değişen ekranı açan yetkiyle aynıdır.
 */
import type { Oturum } from "../api";
import { tamYonetim } from "../api";

export interface Yenilik {
  /** Dosya adından: YYYYMMDDSS */
  no: number;
  /** Dosya adının ilk 10 karakteri */
  tarih: string;
  /** Menüdeki ekran adı (etiket) */
  ekran: string;
  /** "Ekrana git" düğmesinin açacağı sayfa anahtarı (isteğe bağlı) */
  sayfa?: string;
  baslik: string;
  /** Kullanıcı diliyle 1–3 cümle: ne değişti, nerede, nasıl kullanılır */
  metin: string;
  gorur: (oturum: Oturum) => boolean;
}

export type YeniKayit = Omit<Yenilik, "no" | "tarih">;

/** Herkes görür */
export const herkes = (): boolean => true;

/** Yalnızca Yönetici / GMY */
export const yonetici = (o: Oturum): boolean => tamYonetim(o);

/**
 * Sayfa bu kullanıcıya açık mı. Rol ayarı boşsa kısıtlama yok sayılır
 * (koddaki varsayılan menü); doluysa yalnızca işaretlenen sayfalar.
 */
export const sayfa = (anahtar: string) => (o: Oturum): boolean => {
  const izinli = o.yetki?.menuler ?? [];
  if (tamYonetim(o)) return true;
  if (izinli.length === 0) return true;
  return izinli.includes(anahtar);
};

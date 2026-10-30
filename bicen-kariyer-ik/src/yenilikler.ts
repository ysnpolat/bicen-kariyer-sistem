/**
 * Yenilik listesi: `src/yenilikler/2*.ts` dosyaları derlemede toplanır.
 * Numara dosya adından (YYYY-MM-DD-SS → YYYYMMDDSS) türetilir.
 */
import type { Oturum } from "./api";
import type { Yenilik, YeniKayit } from "./yenilikler/ortak";

const dosyalar = import.meta.glob<{ default: YeniKayit }>("./yenilikler/2*.ts", { eager: true });

export const YENILIKLER: Yenilik[] = Object.entries(dosyalar)
  .map(([yol, m]) => {
    const ad = yol.slice(yol.lastIndexOf("/") + 1);
    const tarih = ad.slice(0, 10);
    const sira = Number(ad.slice(11, 13)) || 1;
    const no = Number(tarih.replace(/-/g, "")) * 100 + sira;
    return { ...m.default, no, tarih };
  })
  .sort((a, b) => b.no - a.no);

/** Bu kullanıcının görebileceği yenilikler, en yeni üstte */
export const gorunenYenilikler = (o: Oturum): Yenilik[] => YENILIKLER.filter((y) => y.gorur(o));

/** Okunmamış sayısı */
export const okunmamisSayisi = (o: Oturum, okunan: number | null): number =>
  gorunenYenilikler(o).filter((y) => y.no > (okunan ?? 0)).length;

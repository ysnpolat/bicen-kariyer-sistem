/**
 * Uzman Süzgeci
 * ---------------------------------------------------------------------------
 * Başvurular sayfasının İK uzmanı süzgeci başlık çubuğunda, bölge
 * seçicisinin yanında duruyor. Seçim orada yapılıyor ama listeyi çeken
 * kod sayfanın içinde; ikisini birbirine bağlamak için küçük bir ortak
 * nokta gerekiyor.
 *
 * Süzgeç yalnızca Başvurular sayfası açıkken görünür; sayfa değişince
 * App bileşeni gizler.
 */

let secili: string | undefined;

type Dinleyici = (kod: string | undefined) => void;

const dinleyiciler = new Set<Dinleyici>();

/** Başlık çubuğundaki seçici çağırır */
export const uzmanSec = (kod: string | undefined) => {
  secili = kod;
  dinleyiciler.forEach((f) => f(kod));
};

/** Seçili uzmanın kullanıcı adı */
export const uzmanOku = () => secili;

/** Sayfa değişikliklerinde seçim sıfırlanır */
export const uzmanSifirla = () => uzmanSec(undefined);

/** Başvurular sayfası bu dinleyiciyi kurar */
export const uzmanDinle = (f: Dinleyici) => {
  dinleyiciler.add(f);
  return () => dinleyiciler.delete(f);
};

/* --------------------------------------------------------------------------
   Personel Talepleri (07.10.2026): aynı süzgeç izin, avans, fazla mesai ve
   vardiya düzeltme listelerinde. Bileşen seçimi bu kancayla izler; sunucu
   seçim yoksa da İK uzmanına yalnızca kendi şubelerini döndürür.
   -------------------------------------------------------------------------- */
import { useEffect, useState } from "react";

/** Seçili uzmanlar; değişince yeniden çizer */
export const useUzman = () => {
  const [u, setU] = useState<string | undefined>(secili);
  useEffect(() => {
    const birak = uzmanDinle(setU);
    return () => {
      birak();
    };
  }, []);
  return u;
};

/** Adrese eklenecek sorgu: "?uzman=a,b" ya da "" */
export const uzmanSorgu = (u: string | undefined, ek = "") =>
  u ? `${ek ? "&" : "?"}uzman=${encodeURIComponent(u)}` : "";

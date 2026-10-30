/**
 * Personel Kartı Köprüsü (09.10.2026)
 * ---------------------------------------------------------------------------
 * Panelin her sayfasında personel adına tıklanınca Personeller sayfasındaki
 * personel kartı açılır; sayfadan ayrılmadan, aynı kart. App kartı çizen
 * pencereyi kurar ve rol Personeller sayfasını görüyorsa adlar tıklanabilir
 * olur. Sayfalar adı <PersonelAdi kod="…">Ad Soyad</PersonelAdi> ile yazar.
 */
import type { ReactNode, MouseEvent } from "react";
import "./personelKarti.css";

type Dinleyici = (kod: string) => void;

const dinleyiciler = new Set<Dinleyici>();
let acilabilir = false;

/** App: rol personel kartını görebilir mi */
export const personelKartiYetkisi = (v: boolean) => {
  acilabilir = v;
};

export const personelKartiAcilabilir = () => acilabilir;

/** Kartı aç */
export const personelKartiAc = (kod?: string | null) => {
  const k = (kod ?? "").trim();
  if (!k || !acilabilir) return;
  dinleyiciler.forEach((f) => f(k));
};

/** App'teki pencere dinler */
export const personelKartiDinle = (f: Dinleyici) => {
  dinleyiciler.add(f);
  return () => {
    dinleyiciler.delete(f);
  };
};

/** Tıklanınca personel kartını açan ad */
export function PersonelAdi({
  kod,
  children,
  className,
}: {
  kod?: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!kod || !personelKartiAcilabilir()) return <>{children}</>;

  const ac = (e: MouseEvent) => {
    /* Satırın kendi tıklaması (çekmece açma vb.) çalışmasın */
    e.stopPropagation();
    e.preventDefault();
    personelKartiAc(kod);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      className={`pk-ad${className ? ` ${className}` : ""}`}
      title="Personel kartını aç"
      onClick={ac}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          personelKartiAc(kod);
        }
      }}
    >
      {children}
    </span>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Adres Yönlendirme
 * ---------------------------------------------------------------------------
 * Her sayfanın kendi adresi var: portal.bicen.com.tr/anasayfa,
 * /ariza-kayitlari gibi.
 *
 * Sayfa daha önce bileşen durumunda tutuluyordu; adres hep aynı kalıyor,
 * kullanıcı bir sayfayı yer imine ekleyemiyor, bağlantı paylaşamıyor ve
 * tarayıcının geri tuşu portaldan tamamen çıkarıyordu.
 *
 * Kütüphane yerine tarayıcının kendi geçmiş arayüzü kullanılıyor:
 * ihtiyacımız tek düzeyli bir eşleme ve bunun için bağımlılık eklemek,
 * yayın akışına her seferinde kurulum sokuyordu.
 *
 * Sunucu tarafında bu adreslerin hepsi index.html'e düşmeli. IIS için
 * portalın web.config dosyasında yeniden yazma kuralı bulunuyor.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";

/** Sayfa kodu ile adres parçası eşlemesi */
export const ROTALAR: Record<string, string> = {
  pano: "anasayfa",
  ariza: "ariza-kayitlari",
  envanter: "envanter",
  stok: "stok-yonetimi",
  checklist: "kontrol-listeleri",
  kunye: "kunye-analizi",
  rakipfiyat: "rakip-fiyat",
  fiyatkontrol: "fiyat-kontrol",
  rapor: "raporlar",
  rapormerkezi: "rapor-merkezi",
  skt: "skt-takip",
  yonetim: "yonetim",
};

const KODLAR: Record<string, string> = Object.fromEntries(
  Object.entries(ROTALAR).map(([kod, yol]) => [yol, kod])
);

/** Portal bir alt dizinde sunulabiliyor; taban yol buradan çıkarılıyor */
const taban = (): string => {
  const t = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");

  return t;
};

/** Adresten sayfa kodunu okur; tanınmayan adres ana sayfaya düşer */
export const koduOku = (): string => {
  const yol = window.location.pathname
    .replace(taban(), "")
    .replace(/^\/+|\/+$/g, "");

  return KODLAR[yol] ?? "pano";
};

export const adresi = (kod: string, ek?: Record<string, string>) => {
  const yol = `${taban()}/${ROTALAR[kod] ?? "anasayfa"}`;

  /* Süzgeç ve seçili kayıt adres satırında taşınıyor: anasayfadan
     "geciken kayıtlar" kutusuna basan kullanıcı süzülmüş listeyi
     görmeli ve o adresi paylaşabilmeli. */
  const parcalar = Object.entries(ek ?? {}).filter(([, d]) => d !== "");

  return parcalar.length === 0
    ? yol
    : `${yol}?${parcalar
        .map(([a, d]) => `${encodeURIComponent(a)}=${encodeURIComponent(d)}`)
        .join("&")}`;
};

/** Adres satırındaki sorgu parametreleri */
export const sorguOku = (): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(window.location.search).entries());

/**
 * Geçerli sayfa kodu ve değiştirme işlevi.
 *
 * Geri ve ileri tuşları dinleniyor: adres değiştiğinde sayfanın da
 * değişmesi gerekiyor, yoksa adres bir sayfayı gösterirken ekran
 * başkasını gösteriyordu.
 */
export function rotayiKullan(): [
  string,
  (kod: string, ek?: Record<string, string>) => void
] {
  const [kod, setKod] = useState(koduOku);

  useEffect(() => {
    const dinle = () => setKod(koduOku());

    window.addEventListener("popstate", dinle);

    return () => window.removeEventListener("popstate", dinle);
  }, []);

  const git = (yeni: string, ek?: Record<string, string>) => {
    /* Aynı sayfaya farklı süzgeçle gidilebilir; yalnızca kod eşitliğine
       bakmak, anasayfadan iki ayrı kutuya basmayı işlevsiz bırakıyordu. */
    const hedef = adresi(yeni, ek);

    if (hedef === window.location.pathname + window.location.search) return;

    window.history.pushState({}, "", hedef);
    setKod(yeni);

    /* Sayfa değişince başa dönülüyor: uzun bir listeden başka sayfaya
       geçen kullanıcı ortadan başlıyordu. */
    window.scrollTo(0, 0);
  };

  return [kod, git];
}

/**
 * Adresi sayfayla eşitler.
 *
 * Kullanıcı yetkisi olmayan bir adrese geldiğinde ya da oturum açtıktan
 * sonra kök adreste kaldığında adres yerine oturmalı; yoksa tarayıcıda
 * "/" görünürken ekranda ana sayfa duruyor ve yenilendiğinde başka
 * yere düşüyordu.
 */
export const adresiDuzelt = (kod: string) => {
  const hedef = adresi(kod);

  /* Sorgu parametresi varsa korunuyor: süzgeçli bir adrese gelen
     kullanıcının süzgeci düzeltme sırasında silinmemeli. */
  if (window.location.pathname !== hedef)
    window.history.replaceState({}, "", hedef + window.location.search);
};

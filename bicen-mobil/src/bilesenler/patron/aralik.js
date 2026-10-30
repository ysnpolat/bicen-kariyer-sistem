/**
 * Patron görünümü · tarih aralığı (1.6)
 * ---------------------------------------------------------------------------
 * Bütün patron sayfalarının ortak tarih süzgeci. Seçim modül düzeyinde
 * tutuluyor (küçük bir depo + kanca): sekme değiştirince, detaya girip
 * çıkınca aynı aralık geçerli kalıyor; uygulama yeniden açılınca "Bugün"
 * ile başlıyor.
 *
 * "Bugün" klasik canlı görünüm: uçlara hiç tarih gönderilmiyor, sunucu
 * 1.5'teki yanıtı veriyor (şu an mağazada olanlar, bugünkü başvuru, bu
 * ayın sirkülasyonu…). Diğer seçimlerde `bas` / `bit` (yyyy-MM-dd, iki
 * gün de dahil) gidiyor ve zamana bağlı sayılar o aralık için geliyor.
 *
 * Hazır seçimler (Dün, Bu hafta, Bu ay…) tarih olarak değil anahtar olarak
 * saklanıyor: uygulama gece yarısını geçerek açık kalırsa "Bu ay" yeni
 * günü de kapsasın. Özel aralık tarihleriyle saklanıyor.
 *
 * Bu dosya arayüz bileşeni içermiyor: patronApi.js de kullanıyor, döngüsel
 * içe aktarma olmasın.
 */

import { useEffect, useMemo, useState } from "react";

/** Sunucunun kabul ettiği en uzun aralık (gün); daha uzunu sunucu kırpıyor */
export const EN_UZUN_GUN = 366;

const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export const AY_UZUN = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** Hazır seçimler (çip sırası) */
export const HAZIR_ARALIKLAR = [
  { anahtar: "bugun", ad: "Bugün" },
  { anahtar: "dun", ad: "Dün" },
  { anahtar: "buHafta", ad: "Bu hafta" },
  { anahtar: "buAy", ad: "Bu ay" },
  { anahtar: "gecenAy", ad: "Geçen ay" },
  { anahtar: "buYil", ad: "Bu yıl" },
];

const iki = (x) => String(x).padStart(2, "0");

/** Date → "2026-10-06" (yerel gün) */
export const gunYaz = (d) => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;

/** "2026-10-06" → Date (yerel gece yarısı); bozuksa null */
export const gunOku = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const gunEkle = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** İki gün arası gün sayısı (ikisi dahil) */
export const gunSayisi = (bas, bit) => Math.round((gunOku(bit) - gunOku(bas)) / 86_400_000) + 1;

const bugunDate = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};

/** Haftanın ilk günü: pazartesi */
const haftaBasi = (d) => gunEkle(d, -((d.getDay() + 6) % 7));

/**
 * "6 Eki 2026", "1–6 Eki 2026", "28 Eyl – 6 Eki 2026", "28 Ara 2025 – 6 Oca 2026".
 * Sunucudaki AralikYazisi ile aynı biçim.
 */
export const tarihYazisi = (bas, bit, yilYok = false) => {
  const a = gunOku(bas);
  const b = gunOku(bit ?? bas);
  if (!a || !b) return "";

  const yil = (d) => (yilYok ? "" : ` ${d.getFullYear()}`);
  const ay = (d) => AY_KISA[d.getMonth()];

  if (bas === (bit ?? bas)) return `${a.getDate()} ${ay(a)}${yil(a)}`;
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth())
    return `${a.getDate()}–${b.getDate()} ${ay(b)}${yil(b)}`;
  if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${ay(a)} – ${b.getDate()} ${ay(b)}${yil(b)}`;

  return `${a.getDate()} ${ay(a)} ${a.getFullYear()} – ${b.getDate()} ${ay(b)} ${b.getFullYear()}`;
};

/**
 * Seçimden aralık.
 *
 * @returns {{ anahtar, ad, bas, bit, yazi, gun, canli, bugunDahil }}
 *   canli: "Bugün" — uçlara tarih gönderilmez (klasik görünüm)
 */
export const aralikHesapla = (secim, bugun = bugunDate()) => {
  const anahtar = secim?.anahtar ?? "bugun";
  let bas = bugun;
  let bit = bugun;

  switch (anahtar) {
    case "dun":
      bas = bit = gunEkle(bugun, -1);
      break;
    case "buHafta":
      bas = haftaBasi(bugun);
      break;
    case "buAy":
      bas = new Date(bugun.getFullYear(), bugun.getMonth(), 1);
      break;
    case "gecenAy":
      bas = new Date(bugun.getFullYear(), bugun.getMonth() - 1, 1);
      bit = new Date(bugun.getFullYear(), bugun.getMonth(), 0);
      break;
    case "buYil":
      bas = new Date(bugun.getFullYear(), 0, 1);
      break;
    case "ozel": {
      const a = gunOku(secim?.bas);
      const b = gunOku(secim?.bit);
      if (a && b) {
        bas = a <= b ? a : b;
        bit = a <= b ? b : a;
        if (bit > bugun) bit = bugun;
        if (bas > bit) bas = bit;
      }
      break;
    }
    default:
      break;
  }

  /* Bilinmeyen anahtar "Bugün" sayılıyor */
  const hazir = HAZIR_ARALIKLAR.find((x) => x.anahtar === anahtar);
  const gecerli = hazir || anahtar === "ozel" ? anahtar : "bugun";
  const b1 = gunYaz(bas);
  const b2 = gunYaz(bit);

  return {
    anahtar: gecerli,
    ad: gecerli === "ozel" ? "Özel aralık" : hazir?.ad ?? "Bugün",
    bas: b1,
    bit: b2,
    yazi: tarihYazisi(b1, b2),
    gun: gunSayisi(b1, b2),
    canli: gecerli === "bugun",
    /* Aralık bugünü kapsıyor: veri hâlâ değişiyor, canlı ekran gibi tazelenmeli */
    bugunDahil: b2 === gunYaz(bugun),
  };
};

/** Uçlara giden sorgu alanları: "Bugün"de boş (klasik yanıt) */
export const aralikSorgusu = (a) => (!a || a.canli ? {} : { bas: a.bas, bit: a.bit });

/**
 * Sayfa başlığındaki yazı: "Bugün · canlı", "Bu ay · 1–6 Eki 2026",
 * "Dün · 5 Eki 2026", özel aralıkta yalnızca tarih.
 */
export const aralikMetni = (a) => {
  if (!a || a.canli) return "Bugün · canlı";
  if (a.anahtar === "ozel") return a.yazi;
  return `${a.ad} · ${a.yazi}`;
};

/** Grafik başlığında dilim birimi: "gün gün", "hafta hafta", "ay ay" */
export const seriAdi = (birim) => ({ gün: "gün gün", hafta: "hafta hafta", ay: "ay ay" }[birim] ?? "gün gün");

/* ========================================================================== */
/* Depo                                                                       */
/* ========================================================================== */

let secim = { anahtar: "bugun", bas: null, bit: null };
const dinleyiciler = new Set();

/** Seçimi değiştirir; bütün patron sayfaları yeni aralıkla yeniden istek atar */
export const araligiSec = (yeni) => {
  secim = { anahtar: yeni?.anahtar ?? "bugun", bas: yeni?.bas ?? null, bit: yeni?.bit ?? null };
  dinleyiciler.forEach((f) => {
    try {
      f(secim);
    } catch {
      /* Bir ekranın hatası diğerlerini engellemesin */
    }
  });
};

export const secimAl = () => secim;

/**
 * Geçerli aralık. Sekmeler arasında paylaşılıyor; seçim değişince bütün
 * açık sayfalar yeniden çiziliyor (önbellek anahtarları aralığı
 * içerdiğinden yeni veri isteniyor).
 */
export function useTarihAraligi() {
  const [s, setS] = useState(secim);

  useEffect(() => {
    dinleyiciler.add(setS);
    setS(secim);
    return () => dinleyiciler.delete(setS);
  }, []);

  /* Gün değişince hazır aralıklar yeniden hesaplansın */
  const bugun = gunYaz(bugunDate());

  return useMemo(() => aralikHesapla(s, gunOku(bugun)), [s, bugun]);
}

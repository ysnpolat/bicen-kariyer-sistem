/**
 * Başvuru kayıt ve sorgulama katmanı.
 *
 * AYARLAR.apiAktif = false iken kayıtlar tarayıcının yerel deposunda tutulur;
 * aday kendi cihazından başvurusunu görüntüleyebilir.
 * AYARLAR.apiAktif = true olduğunda kayıt ve sorgulama sunucu üzerinden yapılır,
 * yerel kopya yine de tutulur (çevrimdışı görüntüleme için).
 */

import { AYARLAR } from "./sabitler";
import type { BasvuruDto } from "./tipler";

const DEPO_ANAHTARI = "bicen_basvurular";

/** Telefon / kimlik numaralarını karşılaştırma için sadeleştirir */
export const sadelestir = (deger?: string | null): string =>
  (deger ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** Telefonun son 10 hanesi (0, +90 farklarını yok sayar) */
const telefonAnahtari = (deger?: string | null): string => {
  const rakam = (deger ?? "").replace(/[^0-9]/g, "");
  return rakam.slice(-10);
};

/* -------------------------------------------------------------------------- */
/* Yerel depo                                                                  */
/* -------------------------------------------------------------------------- */

const yereldenOku = (): BasvuruDto[] => {
  try {
    const ham = window.localStorage.getItem(DEPO_ANAHTARI);
    return ham ? (JSON.parse(ham) as BasvuruDto[]) : [];
  } catch {
    return [];
  }
};

/** Sertifika görselleri olmadan kopya (depo dolduğunda kullanılır) */
const gorselsizKopya = (liste: BasvuruDto[]): BasvuruDto[] =>
  liste.map((b) => ({
    ...b,
    sertifikalar: (b.sertifikalar ?? []).map((c) => ({ ...c, gorsel: null })),
  }));

const yereleYaz = (liste: BasvuruDto[]): void => {
  try {
    window.localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(liste));
  } catch {
    /* Depo dolu olabilir: önce eski kayıtları, sonra görselleri düşürerek dene */
    try {
      window.localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(liste.slice(0, 3)));
    } catch {
      try {
        window.localStorage.setItem(
          DEPO_ANAHTARI,
          JSON.stringify(gorselsizKopya(liste.slice(0, 5)))
        );
      } catch {
        /* yine de yazılamıyorsa sessizce geçilir */
      }
    }
  }
};

/* -------------------------------------------------------------------------- */
/* Kayıt                                                                       */
/* -------------------------------------------------------------------------- */

export const basvuruKaydet = async (veri: BasvuruDto): Promise<BasvuruDto> => {
  let sonuc = veri;

  if (AYARLAR.apiAktif) {
    const cevap = await fetch(`${AYARLAR.apiTaban}${AYARLAR.apiKaydetUc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(veri),
    });
    if (!cevap.ok) {
      /* Sunucunun döndürdüğü açıklama varsa kullanıcıya o gösterilir;
         hız sınırı gibi durumlarda anlamlı bir mesaj geliyor. */
      const hata = await cevap.json().catch(() => null);

      if (hata?.hata) throw new Error(hata.hata);

      throw new Error(`Başvuru iletilemedi. Sunucu kodu: ${cevap.status}`);
    }
    const donen = await cevap.json().catch(() => null);
    if (donen?.basvuruNo) sonuc = { ...veri, basvuruNo: donen.basvuruNo };
  } else {
    console.log("İş başvurusu (API pasif):", veri);
    await new Promise((r) => setTimeout(r, 600));
  }

  const liste = yereldenOku();
  liste.unshift(sonuc);
  yereleYaz(liste.slice(0, 10));

  return sonuc;
};

/* -------------------------------------------------------------------------- */
/* Sorgulama                                                                   */
/* -------------------------------------------------------------------------- */

export const basvuruSorgula = async (
  kimlikNo: string,
  telefon: string
): Promise<BasvuruDto[]> => {
  if (AYARLAR.apiAktif) {
    const cevap = await fetch(`${AYARLAR.apiTaban}${AYARLAR.apiSorgulaUc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kimlikNo: sadelestir(kimlikNo), telefon: telefonAnahtari(telefon) }),
    });
    if (!cevap.ok) {
      throw new Error(`Sorgulama yapılamadı. Sunucu kodu: ${cevap.status}`);
    }
    const donen = await cevap.json().catch(() => null);
    if (Array.isArray(donen)) return donen as BasvuruDto[];
    if (Array.isArray(donen?.basvurular)) return donen.basvurular as BasvuruDto[];
    return [];
  }

  await new Promise((r) => setTimeout(r, 400));

  const arananKimlik = sadelestir(kimlikNo);
  const arananTelefon = telefonAnahtari(telefon);

  return yereldenOku().filter(
    (b) =>
      sadelestir(b.tcKimlikNo) === arananKimlik &&
      (telefonAnahtari(b.cepTel1) === arananTelefon ||
        telefonAnahtari(b.cepTel2) === arananTelefon)
  );
};

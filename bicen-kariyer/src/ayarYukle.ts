/**
 * ---------------------------------------------------------------------------
 * Form Ayarlarını Yükleme
 * ---------------------------------------------------------------------------
 * Admin panelinden yapılan düzenlemeler (şubeler, bölümler, eğitim seviyeleri,
 * açık/kapalı bölümler, duyuru) açılışta API'den çekilir ve sabit listelerin
 * üzerine yazılır. API'ye ulaşılamazsa varsayılan listeler kullanılır.
 * ---------------------------------------------------------------------------
 */

import {
  ASKERLIK_DURUMLARI,
  AYARLAR,
  ENGEL_TURLERI,
  ILLER,
  BILGISAYAR_PROGRAMLARI,
  BOLUMLER,
  EGITIM_SEVIYELERI,
  EHLIYET_SINIFLARI,
  KAN_GRUPLARI,
  MEDENI_DURUMLAR,
  SERTIFIKA_AYARLARI,
  SRC_BELGELERI,
  SUBELER,
  UYRUKLAR,
  BIRIM_TURLERI,
  type BirimTuru,
  type Sube,
} from "./sabitler";
import {
  ACIK_RIZA_METNI,
  AYDINLATMA_METNI,
} from "./kvkkMetinleri";

export interface ReferansKurali {
  acik: boolean;
  varsayilanAdet: number;
  ustAdet: number;
  muafBirimTurleri: string[];
  muafPozisyonlar: string[];
  ustPozisyonlar: string[];
  ustAnahtarKelimeler: string[];
}

const kucuk = (s?: string | null) => (s ?? "").trim().toLocaleLowerCase("tr");

/** Sunucudaki ReferansKurali.Gereken ile aynı kural */
export const gerekenReferans = (
  k: ReferansKurali | null,
  birimTuru: string | undefined,
  pozisyonlar: string[] | undefined
): number => {
  if (!k || !k.acik) return 0;
  const tur = kucuk(birimTuru || "Şube");
  return Math.max(
    0,
    ...(pozisyonlar ?? []).filter(Boolean).map((poz) => {
      const p = kucuk(poz);
      if (
        (k.ustPozisyonlar ?? []).some((x) => kucuk(x) === p) ||
        (k.ustAnahtarKelimeler ?? []).some((a) => kucuk(a) && p.includes(kucuk(a)))
      )
        return k.ustAdet ?? 2;
      if (
        (k.muafBirimTurleri ?? []).some((x) => kucuk(x) === tur) &&
        (k.muafPozisyonlar ?? []).some((x) => kucuk(x) === p)
      )
        return 0;
      return k.varsayilanAdet ?? 1;
    })
  );
};

/** Ad soyad ve en az 10 haneli telefon */
export const referansGecerli = (r: any): boolean =>
  !!r && (r.adSoyad ?? "").trim().length >= 3 && ((r.telefon ?? "").match(/\d/g) ?? []).length >= 10;

/** Formun görünürlük ayarları; bileşenler bu nesneyi okur. */
export const FORM_DURUMU = {
  yuklendi: false,
  apiUlasildi: false,
  duyuru: "",
  /** Admin panelinden düzenlenebilir; boş bırakılırsa varsayılan metin kullanılır */
  aydinlatmaMetni: AYDINLATMA_METNI,
  acikRizaMetni: ACIK_RIZA_METNI,
  sertifikaBolumuAcik: true,
  referansBolumuAcik: true,
  /** Pozisyona göre zorunlu referans sayısı; sunucudan gelir */
  referansKurali: null as ReferansKurali | null,
  isTecrubesiBolumuAcik: true,
  epostaZorunlu: false,


  /** SMS doğrulama zorunlu mu; sunucu ayarından gelir */
  telefonDogrulama: false,

  /** "Bizi nereden duydunuz" seçenekleri; boşsa alan formda görünmez */
  basvuruKaynaklari: [] as string[],
};

/** Dizinin içeriğini yerinde değiştirir (referans korunur). */
const yenile = <T,>(hedef: T[], kaynak?: T[] | null): void => {
  if (Array.isArray(kaynak) && kaynak.length > 0) {
    hedef.splice(0, hedef.length, ...kaynak);
  }
};

export const ayarlariYukle = async (): Promise<void> => {
  try {
    /* Önbellek kapalı: ayar değiştiğinde (ör. SMS doğrulaması kapatıldığında)
       tarayıcının eski yanıtı göstermesi, değişikliğin uygulanmadığı
       izlenimi veriyordu. */
    const cevap = await fetch(`${AYARLAR.apiTaban}/api/Ayar/FormGenel`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!cevap.ok) throw new Error(String(cevap.status));

    const a = await cevap.json();

    yenile<Sube>(SUBELER, a.subeler);
    yenile<BirimTuru>(BIRIM_TURLERI, a.birimTurleri);
    yenile<string>(BOLUMLER, a.bolumler);
    yenile<string>(EGITIM_SEVIYELERI, a.egitimSeviyeleri);
    yenile<string>(KAN_GRUPLARI, a.kanGruplari);
    yenile<string>(ASKERLIK_DURUMLARI, a.askerlikDurumlari);
    yenile<string>(EHLIYET_SINIFLARI, a.ehliyetSiniflari);
    yenile<string>(SRC_BELGELERI, a.srcBelgeleri);
    yenile<string>(BILGISAYAR_PROGRAMLARI, a.bilgisayarProgramlari);
    yenile<string>(MEDENI_DURUMLAR, a.medeniDurumlar);
    yenile<string>(UYRUKLAR, a.uyruklar);

    if (typeof a.enFazlaSertifika === "number" && a.enFazlaSertifika > 0) {
      SERTIFIKA_AYARLARI.enFazlaAdet = a.enFazlaSertifika;
    }

    FORM_DURUMU.duyuru = a.duyuru ?? "";
    if (a.aydinlatmaMetni?.trim()) FORM_DURUMU.aydinlatmaMetni = a.aydinlatmaMetni;
    if (a.acikRizaMetni?.trim()) FORM_DURUMU.acikRizaMetni = a.acikRizaMetni;
    if (Array.isArray(a.engelTurleri) && a.engelTurleri.length > 0) {
      yenile<string>(ENGEL_TURLERI, a.engelTurleri);
    }
    if (Array.isArray(a.iller) && a.iller.length > 0) {
      yenile<string>(ILLER, a.iller);
    }

    /* Sunucuda SMS doğrulaması açıksa form o adımı gösterir */
    FORM_DURUMU.telefonDogrulama = a.telefonDogrulama === true;

    /* Kaynak listesi panelden yönetiliyor; gelmezse alan gizli kalır */
    FORM_DURUMU.basvuruKaynaklari = Array.isArray(a.basvuruKaynaklari)
      ? a.basvuruKaynaklari.filter((x: unknown) => typeof x === "string" && x.trim())
      : [];
    FORM_DURUMU.sertifikaBolumuAcik = a.sertifikaBolumuAcik !== false;
    FORM_DURUMU.referansBolumuAcik = a.referansBolumuAcik !== false;
    FORM_DURUMU.referansKurali = a.referansKurali ?? null;
    FORM_DURUMU.isTecrubesiBolumuAcik = a.isTecrubesiBolumuAcik !== false;
    FORM_DURUMU.epostaZorunlu = a.epostaZorunlu === true;
    FORM_DURUMU.apiUlasildi = true;
  } catch {
    // Sunucuya ulaşılamadı: varsayılan listelerle devam edilir.
    FORM_DURUMU.apiUlasildi = false;
  } finally {
    FORM_DURUMU.yuklendi = true;
  }
};

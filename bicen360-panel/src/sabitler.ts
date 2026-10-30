/** Panelde kullanılan sabitler */

export const RENK = {
  yesil: "#7CB518",
  yesilKoyu: "#5F8C10",
  yesilAcik: "#F2F9E8",
  turuncu: "#E8481C",
  siyah: "#1D2126",
  metin: "#1F2933",
  metinPasif: "#6B7280",
  cizgi: "#E3E6E1",
};

/**
 * Menüde sayfaların görünme sırası.
 *
 * Sunucudan gelen liste yetkiyi söyler, sırayı söylemez. Sıra burada
 * duruyor ki yetki değiştiğinde menü yeniden dizilmesin.
 */
export const SAYFA_SIRASI = [
  /* Pano başta: panele giren önce genel duruma bakıyor */
  "pano",
  "kunye",
  "rakipfiyat",
  "fiyatkontrol",
  "rapormerkezi",
  "skt",
  "rapor",
  "ariza",
  "envanter",
  "stok",
  "checklist",
  "yonetim",
];

/** Sunucudaki katalogla aynı kodlar; başlık ve açıklama panel tarafında. */
export const SAYFA_ADLARI: Record<string, string> = {
  pano: "Anasayfa",
  kunye: "Künye Analizi",
  rakipfiyat: "Rakip Fiyat",
  fiyatkontrol: "Fiyat Kontrol",

  /* raporgenel burada yok: o bir sayfa değil, raporlarda bütün
     departmanları görme yetkisi. Menüde çıkmaması için adı tanımlı
     değil; yetki ekranı kataloğu sunucudan aldığı için orada görünüyor. */
  rapormerkezi: "Rapor Merkezi",
  skt: "SKT Takip",
  rapor: "Raporlar",
  ariza: "Arıza Kayıtları",
  envanter: "Envanter",
  stok: "Stok Yönetimi",
  checklist: "Kontrol Listeleri",
  yonetim: "Yönetim",
};

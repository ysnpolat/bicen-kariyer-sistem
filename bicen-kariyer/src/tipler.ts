/**
 * Başvuru veri modeli.
 * Backend tarafında (mail gönderimi / kayıt) birebir bu yapı beklenecektir.
 */

export interface IsTecrubesi {
  isyeriAdi: string;
  gorev: string;
  netUcret: string;
  iseGirisTarihi: string;
  istenCikisTarihi: string;
  ayrilmaSebebi: string;
}

export interface SertifikaGorseli {
  ad: string;
  tur: string;
  /** Saf base64 içerik (data URL öneki olmadan) */
  base64: string;
}

export interface Sertifika {
  ad: string;
  kurum: string;
  tarih: string;
  link: string;
  gorsel?: SertifikaGorseli | null;
}

export interface Referans {
  adSoyad: string;
  calistigiYer: string;
  gorev: string;
  telefon: string;
}

export interface BasvuruDto {

  /** E-posta doğrulama jetonu; kod doğrulandığında alınır */
  dogrulamaJetonu?: string | null;

  /* --- KİŞİSEL BİLGİLER --- */
  fotograf?: SertifikaGorseli | null;
  ad: string;
  soyad: string;
  medeniDurum: string;
  cocukSayisi: number;
  dogumTarihi: string;
  dogumYeri: string;
  uyruk: string;
  uyrukUlke: string;
  tcKimlikNo: string;
  kanGrubu: string;
  cepTel1: string;
  cepTel2: string;
  /* Adres */
  il: string;
  ilce: string;
  mahalle: string;
  caddeSokak: string;
  binaNo: string;
  daireNo: string;
  evAdresi: string;
  email: string;

  /* Engel durumu */
  engelDurumuVarMi: string;
  engelTurleri: string[];
  engelOrani: number | null;
  engelRaporuVarMi: string;
  engelAciklama: string;
  askerlikDurumu: string;
  ehliyetVarMi: string;
  ehliyetSinifi: string;
  ticariTasitBelgesiVarMi: string;
  srcBelgeleri: string[];
  egitimSeviyesi: string;
  mezunOkul: string;
  bilgisayarBilgisi: string[];
  bilgisayarDiger: string;

  /* --- İŞ TECRÜBENİZ --- */
  isTecrubesi: IsTecrubesi[];

  /* --- SERTİFİKA VE BELGELER --- */
  sertifikalar: Sertifika[];

  /* --- FİRMA BAŞVURU İÇERİĞİ --- */
  oncedenBasvurduMu: string;
  oncekiBasvuruAciklama: string;
  oncedenCalistiMi: string;
  oncekiCalismaAciklama: string;
  halenCalisiyorMu: string;
  halenCalistigiYer: string;
  talepEdilenNetUcret: string;
  iseBaslamaTarihi: string;

  /* --- ÇALIŞMAK İSTEDİĞİNİZ BÖLÜMLER --- */
  bolumler: string[];
  subeKodu: string;
  subeAdi: string;
  birimTuru: string;
  /** Başvuru anında gösterilen pozisyon listesi */
  bolumSecenekleri?: string[];

  /* --- REFERANSLARINIZ --- */
  referanslar: Referans[];

  /* --- TAAHHÜT VE ONAY --- */
  taahhutOnay: boolean;
  kvkkOnay: boolean;
  aydinlatmaOnay: boolean;
  rizaIsleme: string;
  rizaReferans: string;
  rizaYetkiliMerci: string;
  rizaBeyanPaylasim: string;
  adayAdSoyad: string;
  beyanTarihi: string;

  /* --- SİSTEM --- */
  basvuruNo: string;
  gonderimZamani: string;
  qrSubeKodu: string;
}

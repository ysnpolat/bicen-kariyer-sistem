/**
 * Panel sayfalarının yetki kataloğu (21.10.2026).
 *
 * Rol Yetkileri ekranı ve App.tsx'teki menü süzgeci bu listeyi okur. Önce
 * iki ayrı liste vardı ve birbirini tutmuyordu: Biçen Kart, Ücret
 * Pusulaları, Eğitim, Etik Hat gibi sayfalar yetki ekranında hiç yoktu;
 * Personel Performansı'nın alt sayfaları ayrı verilemiyordu.
 *
 * YENİ SAYFA EKLERKEN: buraya ve App.tsx'teki katalog listesine yazın.
 */

export interface SayfaTanimi {
  key: string;
  ad: string;
  aciklama?: string;
  /** Alt sayfalar: grup başlığı işaretliyse hepsi, değilse yalnız işaretlenenler */
  alt?: { key: string; ad: string }[];
  /** Ayarla verilemez, yalnızca Yönetici */
  yalnizYonetici?: boolean;
}

export interface SayfaGrubu {
  ad: string;
  aciklama: string;
  sayfalar: SayfaTanimi[];
}

export const SAYFA_GRUPLARI: SayfaGrubu[] = [
  {
    ad: "İşe alım",
    aciklama: "Başvurudan işe alıma kadar olan süreç",
    sayfalar: [
      { key: "ozet", ad: "Özet", aciklama: "Giriş sayfası; her rolde açık" },
      { key: "basvurular", ad: "Başvurular" },
      { key: "havuz", ad: "Aday Havuzu" },
      { key: "takvim", ad: "Görüşme Takvimi" },
      { key: "kadro", ad: "Norm Kadro" },
      { key: "yonetimraporu", ad: "Yönetim Raporu" },
    ],
  },
  {
    ad: "Personel",
    aciklama: "Çalışan personel ve günlük İK işleri",
    sayfalar: [
      { key: "personeller", ad: "Personeller" },
      { key: "izintalep", ad: "Personel Talepleri" },
      { key: "cikismulakat", ad: "Çıkış Mülakatı" },
      { key: "sirkulasyon", ad: "Sirkülasyon" },
      /* Personel bütçesi (30.10.2026): ücret verisi; yalnız Admin, GMY ve İK
         yöneticisi, Rol Yetkileri'nden başka role açılamaz */
      { key: "butce", ad: "Personel Bütçesi", yalnizYonetici: true, aciklama: "Yıllık personel maliyeti ve zam senaryoları; yalnız Yönetici, GMY ve İK Yöneticisi" },
      { key: "egitim", ad: "Eğitim Dokümanları" },
      { key: "pusula", ad: "Ücret Pusulaları" },
      /* İcra / maaş haczi (30.10.2026): Hukuk masası › İcra sekmesi. Hukuk
         ekibi ve yöneticiler her zaman görür; İK uzmanı rolüne buradan
         AÇIKÇA verilmedikçe göremez (boş liste = hepsi kuralı geçmez). */
      { key: "icra", ad: "İcra / maaş haczi takibi", aciklama: "Hukuk masası › İcra sekmesi; personelin borç ve maaş bilgisini içerir, yalnız gerekli İK uzmanına açın" },
    ],
  },
  {
    ad: "İzin ve vardiya",
    aciklama: "İzin, vardiya ve karekod",
    sayfalar: [
      { key: "yillikizin", ad: "İzin Yönetimi" },
      { key: "izinduzeni", ad: "İzin Düzeni" },
      { key: "vardiyakarekod", ad: "Vardiya Karekodları" },
      { key: "qr", ad: "QR Kodlar" },
    ],
  },
  {
    ad: "Operasyon",
    aciklama: "Mağaza operasyonu ve iletişim",
    sayfalar: [
      { key: "isemri", ad: "İş Emirleri" },
      { key: "checklist", ad: "Kontrol Listeleri" },
      { key: "kunye", ad: "Künye Analizi" },
      { key: "kazankazan", ad: "Kazan-Kazan (yeni ürün, mağaza havuzu)" },
      { key: "mobilduyuru", ad: "Duyurular" },
      { key: "haberler", ad: "Biçen'den Haberler" },
      { key: "etik", ad: "Etik Hat" },
    ],
  },
  {
    ad: "Performans",
    aciklama: "İK ve personel performansı",
    sayfalar: [
      { key: "performans", ad: "İK Performans" },
      {
        key: "personelperformansGrup",
        ad: "Personel Performansı",
        aciklama: "Başlık işaretliyse üç alt sayfa da açılır",
        alt: [
          { key: "personelperformans", ad: "Değerlendirme" },
          { key: "performansbuyume", ad: "Büyüme Oranları" },
          { key: "primhakedis", ad: "Prim Hak Edişi" },
        ],
      },
    ],
  },
  {
    ad: "Kart ve raporlar",
    aciklama: "Biçen Kart, raporlar, ücret raporu",
    sayfalar: [
      { key: "bicenkart", ad: "Biçen Kart" },
      { key: "rapor", ad: "Raporlar" },
      { key: "izinucreti", ad: "Yıllık İzin Ücretleri", yalnizYonetici: true },
    ],
  },
  {
    ad: "Sistem",
    aciklama: "Ayarlar ve yalnızca yöneticiye açık araçlar",
    sayfalar: [
      { key: "yonetim", ad: "Yönetim" },
      { key: "talepler", ad: "Talep ve Öneriler", aciklama: "Kullanıcıların sorun bildirimi ve önerilerini görür, cevaplar" },
      { key: "zeka", ad: "İnceleme", yalnizYonetici: true },
      { key: "erisim", ad: "Erişim Denetimi", yalnizYonetici: true },
    ],
  },
];

/** Tüm işaretlenebilir anahtarlar (alt sayfalar dahil), sırayla */
export const TUM_SAYFA_ANAHTARLARI: string[] = SAYFA_GRUPLARI.flatMap((g) =>
  g.sayfalar.flatMap((s) => [s.key, ...(s.alt ?? []).map((a) => a.key)])
);

export const sayfaAdi = (key: string): string => {
  for (const g of SAYFA_GRUPLARI)
    for (const s of g.sayfalar) {
      if (s.key === key) return s.ad;
      const a = s.alt?.find((x) => x.key === key);
      if (a) return `${s.ad} › ${a.ad}`;
    }
  return key;
};

/** Grup altındaki sayfa bu izin listesinde açık mı */
export const altSayfaAcik = (izinli: string[], grupKey: string, altKey: string): boolean =>
  izinli.includes(altKey) ||
  /* Başlık işaretli ama hiçbir alt sayfa ayrıca seçilmemişse: hepsi açık (eski ayarlar) */
  (izinli.includes(grupKey) &&
    !(SAYFA_GRUPLARI.flatMap((g) => g.sayfalar).find((s) => s.key === grupKey)?.alt ?? []).some((a) =>
      izinli.includes(a.key)
    ));

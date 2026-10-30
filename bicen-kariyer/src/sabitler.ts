/**
 * Biçen Market - İş Başvuru Formu
 * Tüm düzenlenebilir sabitler bu dosyadadır.
 * Form içeriği BİK-001 numaralı basılı formun (Rev. 4) birebir karşılığıdır.
 */

/* -------------------------------------------------------------------------- */
/* AYARLAR                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ---------------------------------------------------------------------------
 * API adresinin belirlenmesi
 * ---------------------------------------------------------------------------
 * Sıra ile şu kurallar uygulanır:
 *
 *  1. index.html içindeki <meta name="api-taban" content="..."> etiketi.
 *     Yayınlama betiği bu değeri kendisi yazar. Sunucuda yol değişirse
 *     yeniden derlemeye gerek kalmadan index.html düzenlenebilir.
 *  2. Derleme sırasında tanımlı VITE_API_TABAN değeri (.env.production).
 *  3. Aşağıdaki SABIT_API_ADRESI sabiti.
 *  4. Sayfa geliştirme sunucusunda açıldıysa aynı makinenin 5177 portu.
 *  5. Hiçbiri yoksa aynı alan adına göreli istek: /api/...
 * ---------------------------------------------------------------------------
 */
const SABIT_API_ADRESI = "";
const API_PORT = 5177;
const GELISTIRME_PORTLARI = ["5173", "5174", "5178", "5179"];

const temizle = (deger?: string | null): string =>
  (deger ?? "").trim().replace(/\/+$/, "");

const apiAdresiBelirle = (): string => {
  // 1. index.html içindeki meta etiketi (çalışma zamanı)
  const etiket = document.querySelector<HTMLMetaElement>('meta[name="api-taban"]');
  const metaDeger = temizle(etiket?.content);
  if (metaDeger) return metaDeger;

  // 2. Derleme değişkeni. Vite bu ifadeyi metin olarak yerine koyduğu için
  //    kalıbın aynen "import.meta.env.VITE_API_TABAN" olması zorunludur.
  const cevre = temizle(import.meta.env.VITE_API_TABAN);
  if (cevre) return cevre;

  // 3. Elle tanımlanmış sabit
  if (SABIT_API_ADRESI) return temizle(SABIT_API_ADRESI);

  // 4. Geliştirme sunucusu
  const { protocol, hostname, port } = window.location;
  if (GELISTIRME_PORTLARI.includes(port)) {
    return `${protocol}//${hostname}:${API_PORT}`;
  }

  // 5. Aynı alan adı
  return "";
};

export const AYARLAR = {
  /** Form içeriği açılışta API'den çekilir; başarısız olursa aşağıdaki
   *  varsayılan listeler kullanılır. */
  /**
   * Backend hazır olduğunda true yapınız.
   * false iken: form verisi konsola yazılır, kayıtlar tarayıcının yerel
   * deposunda tutulur ve aday kendi cihazından başvurusunu sorgulayabilir.
   */
  apiAktif: true,
  apiTaban: apiAdresiBelirle(),
  apiKaydetUc: "/api/Basvuru/Kaydet",
  apiSorgulaUc: "/api/Basvuru/Sorgula",

  /**
   * Logo adresi. Kurum logosu API üzerinden tek bir yerden yayınlanır:
   * BicenKariyer.API/wwwroot/logo.png
   * Böylece logoyu değiştirmek için tek dosyayı değiştirmek yeterlidir.
   */
  logoYolu: `${apiAdresiBelirle()}/api/Logo`,

  /** Basılı form künyesi */
  dokumanNo: "BİK-001",
  dokKodu: "DST.F.PM.004",
  revNo: "4",
  revTarih: "29.5.2017",

  /** Sayfa alt bilgisinde görünen iletişim */
  ikIletisim: "insankaynaklari@bicen.com.tr",
};

/* -------------------------------------------------------------------------- */
/* MARKA RENKLERİ                                                              */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* ŞUBELER                                                                     */
/* -------------------------------------------------------------------------- */

export interface Sube {
  kod: string;
  ad: string;
  /** Birim türü: "Şube", "Genel Müdürlük", "Lojistik Depo" ... */
  tur: string;
}

/** Birim türü ve o türde başvurulabilecek pozisyonlar */
export interface BirimTuru {
  ad: string;
  /** Karşılama ekranındaki kartta görünen kısa açıklama */
  aciklama?: string;
  /** Kartta görünen küçük rozet (örn. "34 şube") */
  rozet?: string;
  bolumler: string[];
}

/**
 * TODO: 34 şubenin kod ve adlarını buraya giriniz.
 * "kod" değeri QR adresindeki ?sube= parametresi ile birebir aynı olmalıdır.
 * Örnek QR adresi: https://kariyer.bicen.com.tr/?sube=SEFAKOY
 */
export const SUBELER: Sube[] = [
  { kod: "MERKEZ", ad: "Genel Müdürlük", tur: "Genel Müdürlük" },
  { kod: "DEPO", ad: "Lojistik Depo", tur: "Lojistik Depo" },
  { kod: "SEFAKOY", ad: "Sefaköy Şubesi", tur: "Şube" },
  { kod: "SUBE03", ad: "3 No.lu Şube", tur: "Şube" },
  { kod: "SUBE04", ad: "4 No.lu Şube", tur: "Şube" },
  { kod: "SUBE05", ad: "5 No.lu Şube", tur: "Şube" },
];

/**
 * Birim türleri ve pozisyonları.
 * Aday önce birimi seçer, ardından yalnızca o birime ait pozisyonlar listelenir.
 * Sunucudan gelen ayarlarla değiştirilir.
 */
export const BIRIM_TURLERI: BirimTuru[] = [
  {
    ad: "Şube",
    aciklama:
      "Mağazalarımızda satış, kasa, reyon ve gıda bölümlerinde görev alın. " +
      "Size en yakın şubeyi seçerek başvurun.",
    rozet: "Tüm şubelerimiz",
    bolumler: [
      "Aşçı", "Kasap Şefi", "Kasap", "Kasa Şefi", "Kasiyer",
      "Mağaza Müdürü", "Mağaza Şefi", "Manav Şefi", "Manav",
      "Müdür Yardımcısı", "Pastane - Tandolya Fırın",
      "Reyon Şefi", "Reyoner", "Şarküteri Şefi", "Şarküteri", "Temizlik",
    ],
  },
  {
    ad: "Lojistik Depo",
    aciklama: "Depo, sevkiyat ve dağıtım operasyonlarımızın bir parçası olun.",
    rozet: "Vardiyalı çalışma",
    bolumler: [
      "Mal Kabul", "Depo Görevlisi", "Depo Sorumlusu",
      "Forklift Operatörü", "Sevkiyat Görevlisi", "Şoför / Dağıtım",
      "Sayım Görevlisi", "Temizlik",
    ],
  },
  {
    ad: "Genel Müdürlük",
    aciklama:
      "Ofis ve destek birimlerimizde uzmanlık alanınıza uygun pozisyonlarda çalışın.",
    rozet: "Küçükçekmece",
    bolumler: [
      "Bilgi İşlem", "Muhasebe", "Ön Muhasebe", "İnsan Kaynakları",
      "Satın Alma", "Pazarlama", "İdari İşler", "Kalite Kontrol",
      "Sekreter", "Temizlik",
    ],
  },
];

/**
 * Karşılama ekranındaki kart sırası.
 * Buradaki adlar bu sırayla en başta gösterilir; listede olmayan birim
 * türleri sonrasında, ayarlardaki sırayla dizilir.
 *
 * Sırayı değiştirmek için yalnızca bu diziyi düzenlemeniz yeterlidir.
 */
export const KART_SIRASI = ["Şube", "Lojistik Depo", "Genel Müdürlük"];

/** Birim türlerini kart sırasına göre dizer */
export const turleriSirala = <T extends { ad: string }>(liste: T[]): T[] => {
  const oncelik = (ad: string) => {
    const yer = KART_SIRASI.findIndex(
      (x) => x.toLocaleLowerCase("tr") === (ad || "").toLocaleLowerCase("tr")
    );
    return yer === -1 ? KART_SIRASI.length : yer;
  };

  return [...liste].sort((a, b) => oncelik(a.ad) - oncelik(b.ad));
};

/** Seçilen birimin pozisyonlarını verir */
export const birimBolumleri = (subeKodu?: string): string[] => {
  const sube = SUBELER.find((x) => x.kod === subeKodu);
  if (!sube) return [];

  const tur = BIRIM_TURLERI.find((x) => x.ad === sube.tur);
  return tur?.bolumler ?? [];
};

/* -------------------------------------------------------------------------- */
/* FORM SEÇENEKLERİ (basılı form ile birebir)                                  */
/* -------------------------------------------------------------------------- */

/** ÇALIŞMAK İSTEDİĞİNİZ BÖLÜMLER */
export const BOLUMLER = [
  "Aşçı",
  "Mal Kabul",
  "Kasap Şefi",
  "Kasap",
  "Kasa Şefi",
  "Kasiyer",
  "Mağaza Müdürü",
  "Mağaza Şefi",
  "Manav Şefi",
  "Manav",
  "Müdür Yardımcısı",
  "Pastane - Tandolya Fırın",
  "Reyon Şefi",
  "Reyoner",
  "Şarküteri Şefi",
  "Şarküteri",
  "Temizlik",
];

export const MEDENI_DURUMLAR = ["Evli", "Bekar"];

export const UYRUKLAR = ["T.C.", "Yabancı Uyruklu"];

/** Adres seçiminde kullanılacak iller (adresVerisi.ts ile uyumlu olmalıdır) */
export const ILLER = ["İstanbul"];

/** Engellilik türleri */
export const ENGEL_TURLERI = [
  "Bedensel (Ortopedik)",
  "Görme",
  "İşitme",
  "Dil ve Konuşma",
  "Zihinsel",
  "Ruhsal ve Duygusal",
  "Süreğen (Kronik) Hastalık",
  "Diğer",
];

export const ASKERLIK_DURUMLARI = [
  "Yapıldı",
  "Yapılmadı",
  "Tecilli",
  "Muaf / İlgili değil",
];

export const EGITIM_SEVIYELERI = [
  "İlkokul",
  "Ortaokul",
  "Lise",
  "Ön Lisans",
  "Lisans (Üniversite)",
  "Yüksek Lisans",
  "Doktora",
];

/** Aday fotoğrafı ayarları */
export const FOTOGRAF_AYARLARI = {
  /** Fotoğrafın küçültüleceği en büyük kenar (piksel) */
  enBuyukKenar: 800,
  /** JPEG sıkıştırma kalitesi (0-1) */
  kalite: 0.82,
};

/** Sertifika / belge yükleme sınırları */
export const SERTIFIKA_AYARLARI = {
  /** Bir adayın ekleyebileceği en fazla sertifika sayısı */
  enFazlaAdet: 6,
  /** Yüklenen görselin küçültüleceği en büyük kenar (piksel) */
  enBuyukKenar: 1400,
  /** JPEG sıkıştırma kalitesi (0-1) */
  kalite: 0.75,
  /** Seçilebilecek en büyük ham dosya boyutu (MB) */
  enFazlaMB: 10,
};

export const BILGISAYAR_PROGRAMLARI = ["Excel", "Word", "PowerPoint", "Diğer"];

export const EHLIYET_SINIFLARI = [
  "A", "A1", "A2", "B", "B1", "BE", "C", "C1", "CE",
  "D", "D1", "DE", "F", "G", "M",
];

export const SRC_BELGELERI = ["SRC1", "SRC2", "SRC3", "SRC4"];

/** Formda yer almayan, tarafınızca istenen ek alan */
export const KAN_GRUPLARI = [
  "A Rh+", "A Rh-",
  "B Rh+", "B Rh-",
  "AB Rh+", "AB Rh-",
  "0 Rh+", "0 Rh-",
];

/* -------------------------------------------------------------------------- */
/* TAAHHÜT METNİ (basılı formdan aynen alınmıştır)                             */
/* -------------------------------------------------------------------------- */

export const TAAHHUT_METNI =
  "İş başvuru formunda yazmış olduğum bilgilerin gerçeğe aykırı olması halinde " +
  "4857 sayılı iş yasasının 25/II-a maddesi uyarınca firmanız ile aramdaki iş " +
  "akdinin ihbarsız ve tazminatsız feshini kabul ediyorum. İşverenin göstereceği " +
  "işyerinde ve zaman dilimi içerisinde çalışmayı, işyerinde yapılacak fazla " +
  "mesailere katılmayı, işyeri düzenine ve işveren tarafından düzenlenecek diğer " +
  "yönetmeliklere uymayı şimdiden kabul ve taahhüt ediyorum.";

export const KVKK_METNI =
  "Formda paylaştığım kişisel verilerin, 6698 sayılı Kişisel Verilerin Korunması " +
  "Kanunu kapsamında işe alım süreçlerinde kullanılmak ve saklanmak üzere Biçen " +
  "Market tarafından işlenmesine açık rıza veriyorum.";

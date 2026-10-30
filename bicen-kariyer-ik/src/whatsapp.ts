/**
 * ---------------------------------------------------------------------------
 * WhatsApp Gönderimi
 * ---------------------------------------------------------------------------
 * Görüşme davetini WhatsApp üzerinden göndermek için hazır mesaj oluşturur ve
 * kullanıcının kendi WhatsApp hesabında açar.
 *
 * Mesaj, personelin kendi numarasından gider; sistem yalnızca metni hazırlar.
 * Bu yüzden ek bir kurulum, onay süreci veya ücret gerekmez.
 * ---------------------------------------------------------------------------
 */

import dayjs from "dayjs";

/** Varsayılan mesaj metni (Form Ayarları'ndan değiştirilebilir) */
export const VARSAYILAN_WHATSAPP_SABLONU =
  "Sayın {ad}, Biçen Market'e yaptığınız başvuru için sizi görüşmeye davet " +
  "ediyoruz.\n\n" +
  "Tarih: {tarih} {saat}\n" +
  "Yer: {yer}\n" +
  "Adres: {adres}\n" +
  "Konum: {konum}\n\n" +
  "{not}\n\n" +
  "Yanınızda kimlik belgenizi getirmeniz yeterlidir. İyi günler dileriz.\n\n" +
  "{uzman}\n{unvan}\n{telefon}";

/**
 * Telefon numarasını WhatsApp'ın beklediği uluslararası biçime çevirir.
 * 0532 000 00 00 → 905320000000
 */
export const whatsappNumarasi = (telefon?: string | null): string => {
  const rakamlar = (telefon ?? "").replace(/\D/g, "");
  if (rakamlar.length === 0) return "";

  if (rakamlar.startsWith("90") && rakamlar.length === 12) return rakamlar;
  if (rakamlar.startsWith("0") && rakamlar.length === 11) return `90${rakamlar.slice(1)}`;
  if (rakamlar.startsWith("5") && rakamlar.length === 10) return `90${rakamlar}`;

  // Tanınmayan biçimlerde olduğu gibi bırakılır
  return rakamlar;
};

const GUNLER = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
];

const AYLAR = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

export interface MesajBilgisi {
  adSoyad: string;
  basvuruNo?: string;
  gorusmeTarihi?: string | null;
  gorusmeYeri?: string | null;
  aciklama?: string | null;
  /** Görüşmeyi oluşturan personel */
  uzmanAdSoyad?: string;
  uzmanUnvan?: string;
  uzmanTelefon?: string;

  /** Genel Müdürlük adresi ve konum bağlantısı */
  adres?: string;
  konum?: string;
}

/** Şablondaki alanları doldurur */
export const whatsappMetni = (sablon: string, bilgi: MesajBilgisi): string => {
  const t = bilgi.gorusmeTarihi ? dayjs(bilgi.gorusmeTarihi) : null;

  const tarih = t
    ? `${t.date()} ${AYLAR[t.month()]} ${t.year()} ${GUNLER[t.day()]}`
    : "";

  const degerler: Record<string, string> = {
    ad: bilgi.adSoyad ?? "",
    tarih,
    saat: t ? `saat ${t.format("HH:mm")}` : "",
    yer: bilgi.gorusmeYeri ?? "",
    not: bilgi.aciklama ?? "",
    uzman: bilgi.uzmanAdSoyad ?? "",
    unvan: bilgi.uzmanUnvan ?? "",
    telefon: bilgi.uzmanTelefon ?? "",
    basvuruNo: bilgi.basvuruNo ?? "",

    /* Görüşmeler Genel Müdürlük'te yapılıyor; adres ve konum bağlantısı
       Yönetim → Form Ayarları'ndan gelir. */
    adres: bilgi.adres ?? "",
    konum: bilgi.konum ?? "",
  };

  let metin = (sablon || VARSAYILAN_WHATSAPP_SABLONU).replace(
    /\{(\w+)\}/g,
    (tam, alan: string) => degerler[alan] ?? tam
  );

  // Boş alanlardan kalan fazla satır boşlukları toplanır
  metin = metin.replace(/\n{3,}/g, "\n\n").trim();

  return metin;
};

/** Hazır mesajla WhatsApp'ı açar */
export const whatsappAc = (telefon: string, metin: string): boolean => {
  const numara = whatsappNumarasi(telefon);
  if (!numara) return false;

  const adres = `https://wa.me/${numara}?text=${encodeURIComponent(metin)}`;
  window.open(adres, "_blank", "noopener");

  return true;
};

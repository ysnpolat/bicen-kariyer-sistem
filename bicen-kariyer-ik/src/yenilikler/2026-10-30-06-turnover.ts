import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "Sirkülasyon",
  sayfa: "sirkulasyon",
  gorur: sayfa("sirkulasyon"),
  baslik: "Turnover raporu panelde",
  metin:
    "Sirkülasyon sayfasına Turnover sekmesi eklendi: Excel'deki gibi iki yılın aylık tabloları (şube sayısı, " +
    "dönem başı / sonu çalışan, giriş, çıkış, ortalama, oran), yıl karşılaştırması ve aylık giriş-çıkış tablosu. " +
    "Altında oran ve giriş-çıkış grafikleri ile çıkış sebebi, birim ve çalışma süresi pasta grafikleri var; Excel olarak indirilebilir.",
} satisfies YeniKayit;

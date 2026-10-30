import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "Sirkülasyon",
  sayfa: "sirkulasyon",
  gorur: sayfa("sirkulasyon"),
  baslik: "Turnover: elle düzeltme ve tıklanabilir sayılar",
  metin:
    "Turnover tablolarındaki değerler \"Düzenle\" ile elle girilebiliyor; elle girilen hücre mavi köşeyle görünür, " +
    "boşaltılırsa otomatiğe döner. 2025 için rapordaki değerleri tek tıkla doldurabilirsiniz. Tablodaki sayılara, " +
    "grafik noktalarına, çubuklara ve pasta dilimlerine tıklayınca o sayının arkasındaki personel listesi açılır.",
} satisfies YeniKayit;

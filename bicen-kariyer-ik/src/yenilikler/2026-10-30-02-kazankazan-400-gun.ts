import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "Kazan-Kazan",
  sayfa: "kazankazan",
  gorur: sayfa("kazankazan"),
  baslik: "400 gündür satılmayan ürün yeniden önerilebilir",
  metin:
    "Yeni Ürün Önerisi'nde barkodu sistemde kayıtlı olan bir ürün, son 400 gündür hiç " +
    "satış görmemişse artık önerilebiliyor. Personel Biçen360'ta barkodu okuttuğunda " +
    "\"… tarihinden beri satılmıyor, önerebilirsiniz\" uyarısını görür; stok kodu öneriye " +
    "baştan işlenir, 4. ay ölçümü aynı şekilde yapılır.",
} satisfies YeniKayit;

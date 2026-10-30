import { herkes } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "Panel",
  gorur: herkes,
  baslik: "Yenilikler penceresi ve Talep / Öneri",
  metin:
    "Her güncellemede değişenler bu pencerede listelenir; yalnızca yetkiniz olan " +
    "ekranlardaki yenilikleri görürsünüz. Menünün altındaki \"Talep / Öneri\" " +
    "düğmesiyle bulunduğunuz ekrandan sorun bildirebilir ya da öneri yazabilirsiniz; " +
    "ekran görüntüsü ekleyebilir, cevabı Taleplerim listesinden ve zilden takip edebilirsiniz.",
} satisfies YeniKayit;

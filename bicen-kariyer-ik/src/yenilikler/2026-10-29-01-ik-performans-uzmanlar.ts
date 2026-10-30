import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "İK Performans",
  sayfa: "performans",
  gorur: sayfa("performans"),
  baslik: "Uzman kartlarında yalnızca aktif İK uzmanları",
  metin:
    "Uzmanlar listesinde artık yalnızca aktif İK Uzmanı ve İK Yöneticisi rolündeki " +
    "kullanıcılar yer alıyor; yönetici hesapları ve işten ayrılanlar çıkarıldı. " +
    "Üstteki özet sayıları ve genel tepki süresi de aynı kişilerden hesaplanıyor.",
} satisfies YeniKayit;

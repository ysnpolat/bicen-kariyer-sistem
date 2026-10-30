import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "Kazan-Kazan",
  sayfa: "kazankazan",
  gorur: sayfa("kazankazan"),
  baslik: "Personel adına yeni ürün önerisi",
  metin:
    "Kazan-Kazan sayfasındaki \"Personel adına öneri\" düğmesiyle, Biçen360'tan gönderemeyen " +
    "personelin önerisini onun adına girebilirsiniz. Barkod, son 1 ay ve 400 gün kuralları aynen " +
    "uygulanır; görsel isteğe bağlıdır, ödül öneren personele yazılır.",
} satisfies YeniKayit;

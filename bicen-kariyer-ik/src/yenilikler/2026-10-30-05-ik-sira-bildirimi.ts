import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "Personel Talepleri",
  sayfa: "izintalep",
  gorur: sayfa("izintalep"),
  baslik: "Sıra size geldiğinde ekranda bildirim",
  metin:
    "İzin, avans, fazla mesai, rotasyon ya da vardiya düzeltme talebi onayda İK'ya geldiğinde " +
    "ekranın sağ altında sesli bir kart açılır: kim, hangi şube, ne talebi. Karttan doğrudan ilgili " +
    "sekmeye geçebilirsiniz. Yalnızca kendi şubelerinizin talepleri için gelir.",
} satisfies YeniKayit;

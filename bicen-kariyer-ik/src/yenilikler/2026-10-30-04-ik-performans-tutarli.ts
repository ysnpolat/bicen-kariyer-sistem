import { sayfa } from "./ortak";
import type { YeniKayit } from "./ortak";

export default {
  ekran: "İK Performans",
  sayfa: "performans",
  gorur: sayfa("performans"),
  baslik: "İşe alımlar artık işe alan uzmana sayılıyor",
  metin:
    "Uzman kartlarındaki işe alım sayısı, \"İşe Al\" diyen uzmana yazılıyor (önceden onaylayan " +
    "yöneticiye yazılıyordu). Ücret pazarlığı, doldurma süresi, eski çalışan, bölge ve özet sayılar " +
    "da aynı işe alımlardan hesaplanıyor; bir sayıya tıklayınca açılan liste o sayıyla birebir aynı. " +
    "Bölge seçimi sayfadaki bütün sayılara uygulanıyor.",
} satisfies YeniKayit;

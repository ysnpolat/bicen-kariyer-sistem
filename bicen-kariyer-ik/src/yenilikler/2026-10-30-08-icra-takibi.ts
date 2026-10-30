import { yonetici } from "./ortak";
import type { Oturum } from "../api";
import type { YeniKayit } from "./ortak";

/* Hukuk masası sicille / ekip rolüyle açılır, rol menüsünde yok; yenilik
   Yönetici, GMY, İK yöneticisi ve İK uzmanına gösterilir (hukuk ekibi bu
   rollerden seçiliyor). */
const hukukGorur = (o: Oturum): boolean => yonetici(o) || ["IK", "IKYoneticisi"].includes(o?.rol ?? "");

export default {
  ekran: "Hukuk masası",
  sayfa: "hukuk",
  gorur: hukukGorur,
  baslik: "İcra / maaş haczi takibi",
  metin:
    "Hukuk masasına \"İcra / haciz\" sekmesi geldi. Personele gelen haciz ihbarnameleri ve nafaka dosyaları tebliğ sırasına göre " +
    "1, 2, 3… sıralanır; her ay nafakanın tamamı + net maaşın ¼'ü (oran Yönetim › Süreler ve sınırlar'dan) sıradaki dosyaya kesilir, " +
    "net maaş bordrodan okunur, gerekirse elle düzeltilir. Aylık kesinti listesi Excel'e alınır; ödeme ve dekont dosyaya işlenir. " +
    "Tebligat cevap süresi (7 gün) için hazır cevap yazısı ve bildirim, işten ayrılan personel için hazır ayrılış yazısı var. " +
    "Personel kendi icrasını Biçen360 › İcralarım'da görür (uygulama güncellemesi gerekir).",
} satisfies YeniKayit;

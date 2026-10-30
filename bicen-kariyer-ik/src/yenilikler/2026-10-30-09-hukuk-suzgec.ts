import { yonetici } from "./ortak";
import type { Oturum } from "../api";
import type { YeniKayit } from "./ortak";

const hukukGorur = (o: Oturum): boolean => yonetici(o) || ["IK", "IKYoneticisi"].includes(o?.rol ?? "");

export default {
  ekran: "Hukuk masası",
  sayfa: "hukuk",
  gorur: hukukGorur,
  baslik: "Hukuk masası: daha güçlü süzgeçler ve dosya hareketleri",
  metin:
    "Dosyalar sayfasında avukat / vekil, şube, risk ve dava tarihi aralığına göre süzme eklendi. Dosya özetinde süreç kayıtları, " +
    "yazılar ve belgeler tek bir \"Son hareketler\" çizelgesinde görünür. Masa panosuna icra özeti ve cevap bekleyen tebligatlar eklendi. " +
    "Biçen360 hukuk bölümü de aynı yönde tazelendi.",
} satisfies YeniKayit;

import type { Oturum } from "../api";
import type { YeniKayit } from "./ortak";

/* Personel bütçesi ücret verisi taşır: yalnız Admin, GMY ve İK yöneticisi
   görür; yenilik de yalnız onlara gösterilir (menü kapısıyla aynı kural). */
const butceGorur = (o: Oturum): boolean => ["Admin", "GenelMudurYardimcisi", "IKYoneticisi"].includes(o?.rol ?? "");

export default {
  ekran: "Personel Bütçesi",
  sayfa: "butce",
  gorur: butceGorur,
  baslik: "Personel Bütçesi: yıllık maliyet ve zam senaryoları",
  metin:
    "Personel › Personel Bütçesi ekranı geldi; İK'nın B_T_E Excel'inin yerini alır. Excel'den içe aktarın: kişiler, oranlar, yan giderler ve " +
    "tek seferlik kalemler okunur; her kişi için 12 aylık bordro (netten brüte, kümülatif vergi, asgari ücret istisnası, SGK tavanı, emekli SGDP) " +
    "ve toplam işveren maliyeti hesaplanır. \"Yeni senaryo\" sihirbazıyla 2027 için genel / şube / meslek / kişi bazlı zam oranı, asgari ücret ve " +
    "vergi dilimleri girilip sonuç canlı görülür; senaryolar yan yana karşılaştırılır, şube ve kişi ayrıntısına inilir, Excel'e alınır. " +
    "Yalnız Yönetici, GMY ve İK Yöneticisi görür; her bakış ve dışa aktarma günlüğe yazılır.",
} satisfies YeniKayit;

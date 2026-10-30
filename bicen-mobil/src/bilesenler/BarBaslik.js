/**
 * Başlık çubuğu yazısı ve geri oku
 * ---------------------------------------------------------------------------
 * Diğer menüsünden açılan ekranlarda geri dönüş yolu yoktu: personel ya
 * alt menüden başka bir sekmeye geçiyor ya da uygulamanın donanım geri
 * tuşuna basıp ana sayfaya düşüyordu.
 *
 * Ok yalnızca alt menüde kendi sekmesi olmayan ekranlarda çıkıyor. Kendi
 * sekmesi olan bir ekranda geri oku, personelin zaten bulunduğu yerden
 * çıkmasını öneren anlamsız bir düğme oluyordu.
 *
 * Geri dönüş `goBack` ile: alt menü gezinme geçmişini tutuyor (App.js
 * içindeki `backBehavior="history"`), dolayısıyla ekran nereden açıldıysa
 * oraya dönülüyor. Geçmiş yoksa Diğer ekranına düşülüyor — bildirimle
 * doğrudan açılan ekranda geçmiş boş olabiliyor.
 */

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";

import Simge from "./Simge";
import YardimDugmesi from "./YardimDugmesi";
import { renk } from "../tema";
import { sekmeleriKullan } from "../sekmeler";

/**
 * @param ad     Başlık yazısı
 * @param acik   Açık zeminde kullanılıyor (koyu yazı). Varsayılan yeşil çubuk.
 * @param kendi  Kendi satırını da çizsin (çubuğu olmayan ekranlar için)
 * @param yardim Yardım videosunun kodu. Verilmezse ekranın rota adı
 *               (Izin, Performans…); false ise yardım düğmesi yok.
 *               Videosu olmayan sayfada düğme zaten görünmüyor.
 */
export default function BarBaslik({ ad, acik = false, kendi = false, geri: ozelGeri, yardim }) {
  const navigation = useNavigation();
  const rota = useRoute();
  const sekmeler = sekmeleriKullan();

  /* Ekran içi geri: ekranın kendi alt görünümü varsa (puantajda mağaza
     listesinden mağazaya inmek gibi) ok önce oraya dönüyor. */
  const gizliEkran = !!ozelGeri || !sekmeler.includes(rota.name);

  const yardimKodu = yardim === false ? null : yardim ?? rota.name;

  const geri = () => {
    if (ozelGeri) return ozelGeri();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("AnaSayfa");
  };

  const icerik = (
    <View style={s.satir}>
      {gizliEkran && (
        <TouchableOpacity
          onPress={geri}
          style={s.ok}
          /* Simge küçük; dokunma alanı çevresine genişletiliyor */
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Simge ad="ok" boyut={18} renkli={acik ? renk.metin : "#fff"} />
        </TouchableOpacity>
      )}

      <Text style={[s.baslik, acik && s.baslikAcik, kendi && { flex: 1 }]} numberOfLines={1}>
        {ad}
      </Text>

      {/* Yardım çiçeği: kendi çubuğunda sağ köşede, başka bir çubuğun
          içindeyse başlığın hemen yanında */}
      {yardimKodu ? <YardimDugmesi kod={yardimKodu} ad={ad} /> : null}
    </View>
  );

  return kendi ? <View style={s.kendiCubuk}>{icerik}</View> : icerik;
}

const s = StyleSheet.create({
  satir: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },

  /* Simge sağa bakıyor; geri için çevriliyor */
  ok: { transform: [{ rotate: "180deg" }] },

  baslik: { fontSize: 17, fontWeight: "700", color: "#fff", flexShrink: 1 },
  baslikAcik: { color: renk.metin },

  kendiCubuk: {
    backgroundColor: renk.beyaz,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
});

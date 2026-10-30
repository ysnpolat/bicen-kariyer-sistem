/**
 * Hata Kalkanı
 * ---------------------------------------------------------------------------
 * Uygulamanın kökünde beklenmedik bir hata olduğunda beyaz ekran yerine ne
 * olduğunu gösterir.
 *
 * Yayınlanmış derlemede bir bileşen çizim sırasında hata verdiğinde React
 * bütün ağacı söküyor ve geriye boş bir ekran kalıyor: kullanıcı da biz de
 * sebebi göremiyoruz. Burada hata metni ekranda duruyor ve paylaşılabiliyor,
 * böylece sorunu bir kez görmek yetiyor.
 *
 * Kalkan çözüm değil, teşhis aracı: hatayı yutup uygulamayı çalışır
 * göstermiyor, yalnızca görünür kılıyor.
 */

import { Component } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Share } from "react-native";

export default class HataKalkani extends Component {
  constructor(props) {
    super(props);

    this.state = { hata: null, yigin: null, gecildi: false };
  }

  static getDerivedStateFromError(hata) {
    return { hata };
  }

  componentDidCatch(hata, bilgi) {
    /* Yığın ayrı tutuluyor: hangi bileşende koptuğunu asıl bu söylüyor */
    this.setState({ yigin: bilgi?.componentStack ?? "" });
  }

  render() {
    const { hata, yigin } = this.state;

    /* Açılışta yakalanan hata çizim sırasında oluşmadığı için sınır onu
       göremiyor; dışarıdan veriliyor ve aynı ekranda gösteriliyor. */
    const disHata = this.props.baslangicHatasi;

    if (!hata && (!disHata || this.state.gecildi)) return this.props.children;

    if (!hata && disHata)
      return (
        <View style={s.sayfa}>
          <Text style={s.baslik}>Açılışta bir sorun oluştu</Text>

          <Text style={s.alt}>
            Uygulama açıldı ancak aşağıdaki hata kaydedildi. Sorun sürerse
            bu metni bilgi işleme iletiniz.
          </Text>

          <ScrollView style={s.kutu}>
            <Text style={s.hataYazi} selectable>
              {String(disHata)}
            </Text>
          </ScrollView>

          <TouchableOpacity
            style={s.dugme}
            activeOpacity={0.85}
            onPress={() => this.setState({ gecildi: true })}
          >
            <Text style={s.dugmeYazi}>Uygulamaya devam et</Text>
          </TouchableOpacity>
        </View>
      );

    const metin = `${hata?.message ?? hata}\n\n${yigin ?? ""}`.trim();

    return (
      <View style={s.sayfa}>
        <Text style={s.baslik}>Uygulama açılamadı</Text>

        <Text style={s.alt}>
          Beklenmedik bir hata oluştu. Aşağıdaki metni bilgi işleme
          iletirseniz sorunu hızlıca gideririz.
        </Text>

        <ScrollView style={s.kutu}>
          <Text style={s.hataYazi} selectable>
            {metin}
          </Text>
        </ScrollView>

        <TouchableOpacity
          style={s.dugme}
          activeOpacity={0.85}
          onPress={() => Share.share({ message: metin })}
        >
          <Text style={s.dugmeYazi}>Hata metnini paylaş</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  sayfa: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: 80,
    paddingHorizontal: 22,
    paddingBottom: 34,
  },
  baslik: { fontSize: 20, fontWeight: "800", color: "#1f2933" },
  alt: { fontSize: 13.5, color: "#6b7280", marginTop: 8, lineHeight: 20 },

  kutu: {
    flex: 1,
    marginTop: 16,
    backgroundColor: "#f7f7f5",
    borderRadius: 12,
    padding: 12,
  },
  hataYazi: { fontSize: 11.5, color: "#cf1322", lineHeight: 17 },

  dugme: {
    marginTop: 16,
    backgroundColor: "#7cb518",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  dugmeYazi: { fontSize: 15, fontWeight: "700", color: "#fff" },
});

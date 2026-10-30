/**
 * Açılış Katmanı
 * ---------------------------------------------------------------------------
 * Uygulamanın kendisini gecikmeli yükler ve yüklenirken çıkan hatayı
 * ekranda gösterir.
 *
 * Neden gerekli: JavaScript'te `import` deyimleri dosyanın en başına
 * taşınıyor. Bir modül yüklenirken hata verirse bu, herhangi bir React
 * bileşeni çizilmeden önce oluyor — hata sınırı devreye girmiyor,
 * zamanlayıcılar çalışmıyor, açılış perdesi kalkmıyor. Ekranda hiçbir şey
 * görünmüyor ve uygulama donmuş gibi kalıyor.
 *
 * Burada asıl uygulama `require` ile, çizim başladıktan sonra yükleniyor.
 * Böylece hata çıksa bile ekranda bir şey var ve hatanın metni okunabilir.
 *
 * Bu katman kalıcıdır: teşhis aracı değil, açılışı korumanın tek yolu.
 */

import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Share,
} from "react-native";

/* Ölümcül JavaScript hatalarını uygulamayı kapatmadan yakalar.

   Yayınlanmış derlemede yakalanmayan bir hata React Native tarafından
   ölümcül sayılıyor ve uygulama kapatılıyor: çökme kaydında
   RCTExceptionsManager.reportFatal olarak görünüyor. Kullanıcı yalnızca
   kapanan bir uygulama görüyor, sebep hiçbir yerde yazmıyor.

   Buradaki işleyici varsayılan olanı çağırmıyor; böylece uygulama
   kapanmıyor ve hata ekranda okunabiliyor. Eşzamansız hatalar (söz
   reddi, zamanlayıcı içi hata) try/catch ile yakalanamadığı için tek
   yol bu. */
const dinleyiciler = [];

if (typeof ErrorUtils !== "undefined" && ErrorUtils?.setGlobalHandler) {
  ErrorUtils.setGlobalHandler((hata, olumcul) => {
    const metin = `${olumcul ? "[ölümcül] " : ""}${hata?.message ?? hata}\n\n${
      hata?.stack ?? ""
    }`;

    dinleyiciler.forEach((f) => {
      try {
        f(metin);
      } catch {
        /* Gösterim başarısızsa yapacak bir şey yok */
      }
    });

    console.error("Yakalanmayan hata:", metin);
  });
}

export default function Basla() {
  /* Bileşen bir nesnenin içinde tutuluyor.

     Doğrudan durumda tutulduğunda React, setState'e verilen işlevi
     "önceki durumdan yenisini üreten işlev" sanıyor ve bileşeni çağırıyor;
     bileşen de kancalarıyla birlikte yanlış yerde çalışıp çöküyordu. */
  const [kap, setKap] = useState(null);

  const Uygulama = kap?.bilesen ?? null;
  const [hata, setHata] = useState(null);

  /* Uygulama yüklendikten sonra çıkan ölümcül hatalar da bu ekranda
     gösteriliyor: çöken bir uygulamada sebep hiçbir yerde görünmüyordu. */
  useEffect(() => {
    const bildir = (metin) => setHata((o) => o ?? new Error(metin));

    dinleyiciler.push(bildir);

    return () => {
      const yer = dinleyiciler.indexOf(bildir);

      if (yer >= 0) dinleyiciler.splice(yer, 1);
    };
  }, []);

  useEffect(() => {
    /* Bir sonraki kareye bırakılıyor: bu bileşenin ilk çizimi tamamlansın
       ki açılış perdesi kalksın ve yükleme sırasında ekran boş kalmasın. */
    const zamanlayici = setTimeout(() => {
      try {
        const modul = require("./App");

        /* Metro kimi durumlarda modül nesnesi yerine doğrudan dışa
           aktarılanı veriyor; ikisi de karşılanıyor. Hiçbiri işlev
           değilse hata olarak gösteriliyor — boş ekran vermektense
           sebebini yazmak. */
        const bilesen =
          typeof modul === "function"
            ? modul
            : typeof modul?.default === "function"
            ? modul.default
            : null;

        if (!bilesen)
          throw new Error(
            "App bileşeni yüklenemedi. Dönen değer: " +
              (modul === undefined ? "undefined" : typeof modul)
          );

        setKap({ bilesen });
      } catch (e) {
        setHata(e);
      }
    }, 0);

    return () => clearTimeout(zamanlayici);
  }, []);

  /* Hata varsa uygulama yüklenmiş olsa bile hata ekranı öne alınıyor:
     çökmüş bir uygulamanın yarım çizilmiş ekranını göstermek, sorunu
     gizlemekten başka işe yaramıyor. */
  if (Uygulama && !hata) return <Uygulama />;

  if (hata) {
    const metin = `${hata?.message ?? hata}\n\n${hata?.stack ?? ""}`.trim();

    return (
      <View style={s.sayfa}>
        <Text style={s.baslik}>Uygulama başlatılamadı</Text>

        <Text style={s.alt}>
          Aşağıdaki hata nedeniyle uygulama açılamadı. Bu metni bilgi
          işleme iletirseniz sorun giderilir.
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

  return (
    <View style={s.yukleniyor}>
      <ActivityIndicator size="large" color="#7cb518" />
    </View>
  );
}

const s = StyleSheet.create({
  yukleniyor: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },

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

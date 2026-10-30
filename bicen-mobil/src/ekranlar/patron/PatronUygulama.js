/**
 * Patron görünümü — kök
 * ---------------------------------------------------------------------------
 * Patron olarak tanımlanan kişinin yönetim ekranı: Özet · Şubeler ·
 * Onaylar · İK · Biçen Kart sekmeleri ve bunlardan açılan detaylar.
 *
 * Personel uygulamasından tamamen ayrı bir gezgin: patron yetkisi
 * olmayan kişi bu dosyaya hiç girmiyor, personel ekranlarının davranışı
 * değişmiyor. Patron istediğinde menüden personel görünümüne geçebiliyor
 * (vardiya, izin, kendi bordrosu…); seçim cihazda hatırlanıyor.
 *
 * Alt sayfalar (personel kartı, aday kartı, onay gerekçesi, menü) ve
 * tost burada bir kez kuruluyor; ekranlar bağlamdan çağırıyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Alert } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import * as DurumCubugu from "expo-status-bar";

import AltMenu from "../../bilesenler/AltMenu";
import AltSayfa from "../../bilesenler/AltSayfa";
import { PatronBaglami } from "../../bilesenler/patron/Baglam";
import { stiller } from "../../bilesenler/patron/Parcalar";
import { Tost, PersonelSayfasi, AdaySayfasi, KararSayfasi, MenuSayfasi } from "../../bilesenler/patron/Sayfalar";
import { usePatron } from "../../patronApi";
import { useOnbellek } from "../../onbellek";
import { modullerimAl, oturumKapat } from "../../api";
import { gorunumYaz, patronYetkisiYaz } from "../../gorunum";
import { bildirimHazirla, bildirimDinle } from "../../bildirim";
import { patronRenk as P } from "../../tema";

import Ozet from "./Ozet";
import Subeler from "./Subeler";
import SubeDetay from "./SubeDetay";
import Onaylar from "./Onaylar";
import Basvurular from "./Basvurular";
import Norm from "./Norm";
import Gecis from "./Gecis";
import Ik from "./Ik";
import IkDetay from "./IkDetay";
import Kart from "./Kart";
import Ara from "./Ara";
import WebSayfa from "./WebSayfa";
import AydinlatmaPenceresi from "../../bilesenler/AydinlatmaPenceresi";

const Sekme = createBottomTabNavigator();

/** Modüllerim yanıtı: kişi adı ve patron bayrağı. Menü ve Özet de okuyor. */
export const MODUL_ANAHTARI = "patron/Modullerim";

export default function PatronUygulama({ navigation }) {
  const [tost, setTost] = useState(null);
  const [sayfa, setSayfa] = useState(null);

  /* Kapanırken içerik bir anda boşalmasın: pencere aşağı kayarken son
     içerik görünmeye devam ediyor. */
  const sonSayfa = useRef(null);
  if (sayfa) sonSayfa.current = sayfa;
  const gosterilen = sayfa ?? sonSayfa.current;

  const tostGoster = useCallback(
    (metin, tur = "tamam") => setTost((t) => ({ metin, tur, n: (t?.n ?? 0) + 1 })),
    []
  );

  const sayfaKapat = useCallback(() => setSayfa(null), []);

  /* Kişi bilgisi ve yetki. Uzun tazelik süresi: her sekme geçişinde
     sorulacak bir şey değil. */
  const modul = useOnbellek(MODUL_ANAHTARI, modullerimAl, { tazeSure: 5 * 60_000 });

  /* Yetki panelden kaldırıldıysa personel uygulamasına dönülüyor. Bir
     sonraki açılış da personel ekranıyla başlasın diye bayrak yazılıyor. */
  useEffect(() => {
    const p = modul.veri?.patron;
    if (p === undefined || p === null) return;

    patronYetkisiYaz(p);

    if (p === false) {
      gorunumYaz(null);
      navigation.reset({ index: 0, routes: [{ name: "Uygulama" }] });
    }
  }, [modul.veri, navigation]);

  /* Rozet: onay listesi açıldıysa onun sayısı (kararlar hemen düşsün),
     açılmadıysa özetteki toplam. İkisi de yalnızca dinleniyor. */
  const onaylar = usePatron("Onaylar", { pasif: true });
  const ozet = usePatron("Ozet", { pasif: true });

  const bekleyen = Array.isArray(onaylar.veri?.onaylar)
    ? onaylar.veri.onaylar.length
    : ozet.veri?.onay?.toplam ?? 0;

  /* Bildirim jetonu patron görünümünde de kaydediliyor: patron yalnızca
     bu görünümü kullanıyorsa bildirim hiç gelmiyordu. Bildirime dokununca
     yönetim bildirimleri (patron-onaylar, patron-sube:GEMLİK,
     patron-sayfa:duyuru…) burada, diğerleri personel uygulamasında
     açılıyor (duyuru, iş emri…). */
  useEffect(() => {
    try {
      bildirimHazirla();
    } catch {
      /* Bildirim kurulamazsa ekran etkilenmez */
    }

    const dinleyici = bildirimDinle((hedef) =>
      navigation.navigate(hedef.kok, { screen: hedef.ekran, params: hedef.params })
    );

    return () => dinleyici?.remove?.();
  }, [navigation]);

  /* Personel ekranları açık durum çubuğu bekliyor (yeşil başlık);
     patron görünümünden çıkınca geri alınıyor. Özet kendi koyu
     başlığı için açık, diğer patron ekranları koyu yazı kullanıyor. */
  useEffect(() => () => DurumCubugu.setStatusBarStyle?.("light"), []);

  const personeleGec = useCallback(() => {
    setSayfa(null);
    gorunumYaz("personel");
    navigation.reset({ index: 0, routes: [{ name: "Uygulama" }] });
  }, [navigation]);

  const cikisSor = useCallback(() => {
    setSayfa(null);

    Alert.alert("Çıkış yapılsın mı?", "Yeniden giriş için kimlik numaranız ve SMS doğrulaması gerekecek.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çıkış yap",
        style: "destructive",
        onPress: async () => {
          await oturumKapat();
          navigation.reset({ index: 0, routes: [{ name: "Giris" }] });
        },
      },
    ]);
  }, [navigation]);

  const baglam = useMemo(
    () => ({
      tost: tostGoster,
      sayfaKapat,
      personelAc: (kod) => kod && setSayfa({ tur: "personel", kod }),
      adayAc: (id, ek) => setSayfa({ tur: "aday", id, ...(ek ?? {}) }),
      kararAc: (onay, sonuc, gonder) => setSayfa({ tur: "karar", onay, sonuc, gonder }),
      menuAc: () => setSayfa({ tur: "menu" }),
      personeleGec,
    }),
    [tostGoster, sayfaKapat, personeleGec]
  );

  const kisi = modul.veri?.kisi;

  return (
    <PatronBaglami.Provider value={baglam}>
      <View style={{ flex: 1, backgroundColor: P.zemin }}>
        {/* KVKK aydınlatma metni: patron da bir çalışan (1.7) */}
        <AydinlatmaPenceresi />
        <Sekme.Navigator
          tabBar={(p) => <AltMenu {...p} rozetler={{ Onaylar: bekleyen }} gecmistenSec />}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: P.zemin } }}
          /* Geri tuşu geldiği yere dönsün: şube detayından geri basınca
             ilk sekmeye değil, açıldığı listeye. */
          backBehavior="history"
        >
          <Sekme.Screen name="Ozet" component={Ozet} options={{ title: "Özet", simgeAdi: "ev" }} />
          <Sekme.Screen name="Subeler" component={Subeler} options={{ title: "Şubeler", simgeAdi: "magaza" }} />
          <Sekme.Screen name="Onaylar" component={Onaylar} options={{ title: "Onaylar", simgeAdi: "kalkan" }} />
          <Sekme.Screen name="Ik" component={Ik} options={{ title: "İK", simgeAdi: "ekip" }} />
          <Sekme.Screen name="Kart" component={Kart} options={{ title: "Biçen Kart", simgeAdi: "kart" }} />

          {/* Sekme çubuğunda görünmeyen detaylar */}
          <Sekme.Screen name="SubeDetay" component={SubeDetay} options={{ title: "Şube", gizli: true }} />
          <Sekme.Screen name="Basvurular" component={Basvurular} options={{ title: "Başvurular", gizli: true }} />
          <Sekme.Screen name="Norm" component={Norm} options={{ title: "Norm kadro", gizli: true }} />
          <Sekme.Screen name="Gecis" component={Gecis} options={{ title: "Geçiş & okutma", gizli: true }} />
          <Sekme.Screen name="IkDetay" component={IkDetay} options={{ title: "İK", gizli: true }} />
          <Sekme.Screen name="Ara" component={Ara} options={{ title: "Ara", gizli: true }} />

          {/* Sunucu tanımlı sayfalar (çıkış mülakatı, duyuru, bildirim ayarları…) */}
          <Sekme.Screen name="WebSayfa" component={WebSayfa} options={{ title: "Sayfa", gizli: true }} />
        </Sekme.Navigator>

        <AltSayfa gorunur={!!sayfa} kapat={sayfaKapat} perdeStil={stiller.perde} sayfaStil={stiller.kagit}>
          <View style={stiller.tutamac} />

          {gosterilen?.tur === "personel" ? (
            <PersonelSayfasi kod={gosterilen.kod} tost={tostGoster} />
          ) : gosterilen?.tur === "aday" ? (
            <AdaySayfasi id={gosterilen.id} onay={gosterilen.onay} karar={gosterilen.karar} tost={tostGoster} />
          ) : gosterilen?.tur === "karar" ? (
            <KararSayfasi
              key={`${gosterilen.onay?.id}-${gosterilen.sonuc}`}
              onay={gosterilen.onay}
              sonuc={gosterilen.sonuc}
              gonder={gosterilen.gonder}
              kapat={sayfaKapat}
            />
          ) : gosterilen?.tur === "menu" ? (
            <MenuSayfasi
              kisi={kisi}
              ben={ozet.veri?.ben}
              personeleGec={personeleGec}
              ara={() => {
                setSayfa(null);
                navigation.navigate("Patron", { screen: "Ara" });
              }}
              cikis={cikisSor}
            />
          ) : null}
        </AltSayfa>

        <Tost tost={tost} />
      </View>
    </PatronBaglami.Provider>
  );
}

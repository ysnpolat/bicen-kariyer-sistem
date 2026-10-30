/**
 * Biçen360 — uygulama kökü
 * ---------------------------------------------------------------------------
 * Oturum durumuna göre giriş akışı ya da sekmeli uygulama gösterilir.
 *
 * Açılışta saklanan jeton okunur; varsa doğrudan ana sayfaya girilir.
 * Personelin her açılışta SMS beklemesi kullanımı zorlaştırırdı.
 */

import { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { jetonYukle, modullerimAl, islerimAl, yoneticiBekleyenSayisi, onayRozeti, cihazKimligiTasi } from "./src/api";
import { gorunumOku, hukukMu, patronlaAcilsinMi, patronYetkisiYaz } from "./src/gorunum";
import { bildirimHazirla, bildirimDinle } from "./src/bildirim";
import { renk } from "./src/tema";

/* Açılış ekranı elle yönetiliyor.

   Otomatik gizlemede, açılış akışı bir yerde takılırsa görsel ekranda
   kalıyor ve kullanıcı uygulamanın donduğunu sanıyor. Burada perde
   bilinçli olarak tutuluyor ve ilk çizimden sonra her koşulda
   kaldırılıyor — hata çıksa bile. */
let PerdeYoneticisi = null;

try {
  PerdeYoneticisi = require("expo-splash-screen");
} catch {
  PerdeYoneticisi = null;
}

/* preventAutoHideAsync bilinçli olarak çağrılmıyor.

   Perdeyi elde tutup sonra gizlemek, gizleme çağrısının bir sebeple
   çalışmadığı durumda perdeyi kalıcı hâle getiriyor — otomatik gizlemeden
   daha kırılgan. Otomatik gizleme açık bırakılıyor, aşağıdaki çağrılar
   yalnızca hızlandırmak için. */

/* Yakalanmayan JavaScript hatalarını görünür kılar.

   React'in hata sınırı yalnızca çizim sırasındaki hataları yakalıyor;
   açılışta bir söz reddedildiğinde ya da modül yüklenirken hata
   çıktığında ekran sessizce boş kalıyordu. */
const acilisHatalari = [];

if (typeof ErrorUtils !== "undefined" && ErrorUtils?.setGlobalHandler) {
  const oncekiIsleyici = ErrorUtils.getGlobalHandler?.();

  ErrorUtils.setGlobalHandler((hata, olumcul) => {
    acilisHatalari.push(`${olumcul ? "[ÖLÜMCÜL] " : ""}${hata?.message ?? hata}`);
    oncekiIsleyici?.(hata, olumcul);
  });
}

import Giris from "./src/ekranlar/Giris";
import Kod from "./src/ekranlar/Kod";
import AnaSayfa from "./src/ekranlar/AnaSayfa";
import Vardiya from "./src/ekranlar/Vardiya";
import Izin from "./src/ekranlar/Izin";
import Performans from "./src/ekranlar/Performans";
import Prim from "./src/ekranlar/Prim";
import Duyurular from "./src/ekranlar/Duyurular";
import Haberler from "./src/ekranlar/Haberler";
import Diger from "./src/ekranlar/Diger";
import Bilgilerim from "./src/ekranlar/Bilgilerim";
import BilgiModul from "./src/ekranlar/BilgiModul";
import EtikHat from "./src/ekranlar/EtikHat";
import KazanKazan from "./src/ekranlar/KazanKazan";
import EkipDegerlendirme from "./src/ekranlar/EkipDegerlendirme";
import HataKalkani from "./src/bilesenler/HataKalkani";
import GiftKart from "./src/ekranlar/GiftKart";
import IzinOnay from "./src/ekranlar/IzinOnay";
import Puantaj from "./src/ekranlar/Puantaj";
import VardiyaPlani from "./src/ekranlar/VardiyaPlani";
import Ekibim from "./src/ekranlar/Ekibim";
import Isler from "./src/ekranlar/Isler";
import Checklist from "./src/ekranlar/Checklist";
import Kunye from "./src/ekranlar/Kunye";
import Ariza from "./src/ekranlar/Ariza";
import RakipFiyat from "./src/ekranlar/RakipFiyat";
import FiyatKontrol from "./src/ekranlar/FiyatKontrol";
import Avanslarim from "./src/ekranlar/Avanslarim";
import Icralarim from "./src/ekranlar/Icralarim";
import Envanter from "./src/ekranlar/Envanter";
import Raporlar from "./src/ekranlar/Raporlar";
import ChecklistDoldur from "./src/ekranlar/ChecklistDoldur";
import IsEmriPencere from "./src/bilesenler/IsEmriPencere";
import GuncellemeDenetimi from "./src/bilesenler/GuncellemeDenetimi";
import AydinlatmaPenceresi from "./src/bilesenler/AydinlatmaPenceresi";
import AltMenu from "./src/bilesenler/AltMenu";
import { SekmeBaglami } from "./src/sekmeler";
import PatronUygulama from "./src/ekranlar/patron/PatronUygulama";
import HukukUygulama from "./src/ekranlar/hukuk/HukukUygulama";
import Mesajlar from "./src/ekranlar/Mesajlar";
import Devamsizlik from "./src/ekranlar/Devamsizlik";
import DevamsizlikTutanak from "./src/ekranlar/DevamsizlikTutanak";
import Denklestirme, { DenklestirmeOnay } from "./src/ekranlar/Denklestirme";
import Gorevlendirme from "./src/ekranlar/Gorevlendirme";
import Skt from "./src/ekranlar/Skt";
import MesajBalonu from "./src/bilesenler/MesajBalonu";

const Yigin = createNativeStackNavigator();
const Sekmeler = createBottomTabNavigator();

/* ========================================================================== */
/* Sekmeli uygulama                                                           */
/* ========================================================================== */

function Uygulama({ navigation }) {
  const [altMenu, setAltMenu] = useState(["vardiya", "duyuru", "performans"]);

  /* Yönetici İşlemleri (1.7): modül açıksa onay bekleyen sayısı alt
     menüde rozet (sekmedeyse kendi simgesinde, değilse Diğer'de) */
  const [yoneticiVar, setYoneticiVar] = useState(false);
  const [onaySayisi, setOnaySayisi] = useState(0);

  /* 1.9: Diğer sekmesi kalktı; yerine Mesajlar (modül açıksa). Bilgilerim
     ana sayfada isme/fotoğrafa dokunarak, modüller kısayollardan. */
  const [mesajVar, setMesajVar] = useState(false);
  const [mesajOkunmamis, setMesajOkunmamis] = useState(0);

  /* Bildirim izni ve jeton kaydı. Oturum açıldıktan sonra yapılır:
     jeton sunucuya kimlikle birlikte gidiyor. */
  useEffect(() => {
    /* Bildirim kurulumu uygulamanın açılmasını engellememeli: izin
       reddedilmiş ya da servis erişilemez olduğunda burada çıkan hata
       bütün ekranı düşürüyordu. */
    try {
      bildirimHazirla();
    } catch (hata) {
      console.warn("Bildirim hazırlanamadı:", hata?.message);
    }

    /* İç içe gezgin: ekranlar sekme gezgininin içinde, buradaki
       navigation ise yığın gezgininin. Doğrudan ada gitmek "böyle bir
       ekran yok" hatası veriyordu; hedef, kapsayan ekranla birlikte
       veriliyor. */
    const dinleyici = bildirimDinle((hedef) =>
      /* Yönetim bildirimleri (patron-onaylar, patron-sube:…) personel
         görünümündeyken de yönetim ekranında açılıyor: kok "Patron". */
      navigation.navigate(hedef.kok, { screen: hedef.ekran, params: hedef.params })
    );

    return () => dinleyici?.remove();
  }, [navigation]);

  /* Alt menü panelden ayarlanıyor: hangi modüllerin sekme olacağı
     kuruma göre değişiyor. Alınamazsa varsayılan kullanılır. */
  useEffect(() => {
    modullerimAl()
      .then(async (d) => {
        if (d?.altMenu?.length) setAltMenu(d.altMenu);
        setYoneticiVar((d?.moduller ?? []).some((m) => m?.kod === "izinonay"));
        setMesajVar((d?.moduller ?? []).some((m) => m?.kod === "mesajlar"));

        /* Patron görünümü (1.5). Yetki cihazda saklanıyor; bir sonraki
           açılış doğrudan doğru ekranla başlıyor. Yetkisi olan kişi
           personel görünümünü kendisi seçmediyse (ilk açılış, ya da yeni
           tanımlandı) yönetim ekranına geçiliyor. Yetkisi olmayan kişi
           için hiçbir şey değişmiyor. */
        if (typeof d?.patron !== "boolean") return;

        await patronYetkisiYaz(d.patron);

        /* Patron ekranından bildirimle açıldıysa (yığında Patron var)
           geri dönülmüyor: kişi bildirimin götürdüğü ekranı görmeli. */
        const yigindaPatron = navigation
          .getState?.()
          ?.routes?.some((r) => r.name === "Patron");

        if (d.patron && !yigindaPatron && patronlaAcilsinMi(await gorunumOku()))
          navigation.reset({ index: 0, routes: [{ name: "Patron" }] });
      })
      .catch(() => undefined);
  }, [navigation]);

  /* Bekleyen iş emirleri: alt menüdeki rozet ve açılış penceresi için.
     Ekranlar kendi verisini çekiyor; burada yalnızca sayı tutuluyor. */
  const [isler, setIsler] = useState({ acikSayi: 0, yeniler: [] });
  const [pencereAcik, setPencereAcik] = useState(false);

  const isleriTazele = useCallback(async () => {
    try {
      const d = await islerimAl();

      setIsler({
        acikSayi: d?.acikSayi ?? 0,
        yeniler: d?.yeniler ?? [],
      });

      /* Açılır pencere yalnızca hiç görülmemiş emirler için ve oturumda
         bir kez: her tazelemede tekrar açılması rahatsız edici olurdu. */
      if ((d?.yeniler?.length ?? 0) > 0) setPencereAcik(true);
    } catch {
      /* Sayı alınamazsa rozet gösterilmez; uygulama etkilenmez. */
    }
  }, []);

  useEffect(() => {
    isleriTazele();

    const zaman = setInterval(isleriTazele, 120_000);
    return () => clearInterval(zaman);
  }, [isleriTazele]);

  useEffect(() => {
    if (!yoneticiVar) {
      setOnaySayisi(0);
      return undefined;
    }

    const tazele = () =>
      yoneticiBekleyenSayisi()
        .then((d) => setOnaySayisi(d?.toplam ?? 0))
        .catch(() => undefined);

    tazele();
    onayRozeti.tazele = tazele;
    const zaman = setInterval(tazele, 120_000);
    return () => {
      clearInterval(zaman);
      onayRozeti.tazele = null;
    };
  }, [yoneticiVar]);

  const TANIM = {
    vardiya: { rota: "Vardiya", ekran: Vardiya, ad: "Vardiya", simge: "kare" },
    izin: { rota: "Izin", ekran: Izin, ad: "İzin", simge: "takvim" },
    performans: { rota: "Performans", ekran: Performans, ad: "Performans", simge: "grafik" },
    prim: { rota: "Prim", ekran: Prim, ad: "Prim", simge: "para" },
    duyuru: { rota: "Duyurular", ekran: Duyurular, ad: "Duyuru", simge: "zil" },
    /* Biçen'den Haberler (08.10.2026, 1.7): şirket içi sosyal akış */
    haberler: { rota: "Haberler", ekran: Haberler, ad: "Haberler", simge: "kalp" },
    isemri: { rota: "Isler", ekran: Isler, ad: "İşlerim", simge: "liste" },
    checklist: { rota: "Checklist", ekran: Checklist, ad: "Kontrol Listeleri", simge: "belge" },
    kunye: { rota: "Kunye", ekran: Kunye, ad: "Künye Analizi", simge: "kare" },
    ariza: { rota: "Ariza", ekran: Ariza, ad: "Arıza Kayıt", simge: "uyari" },
    rakipfiyat: { rota: "RakipFiyat", ekran: RakipFiyat, ad: "Rakip Fiyat", simge: "kare" },
    envanter: {
      rota: "Envanter",
      ekran: Envanter,
      ad: "Envanter",
      simge: "kutu",
    },
    rapor: {
      rota: "Raporlar",
      ekran: Raporlar,
      ad: "Raporlar",
      simge: "grafik",
    },
    fiyatkontrol: {
      rota: "FiyatKontrol",
      ekran: FiyatKontrol,
      ad: "Fiyat Kontrol",
      simge: "para",
    },

    /* Haftalık izin onayı: yalnızca onay yetkisi olanlarda görünüyor.
       Sunucu bu kodu modül listesine yetkiye göre koyuyor. */
    puantaj: { rota: "Puantaj", ekran: Puantaj, ad: "Puantaj", simge: "takvim" },
    vardiyaplani: { rota: "VardiyaPlani", ekran: VardiyaPlani, ad: "Vardiya Planı", simge: "takvim" },
    ekibim: { rota: "Ekibim", ekran: Ekibim, ad: "Ekibim", simge: "kisi" },
    avans: { rota: "Avans", ekran: Avanslarim, ad: "Avanslarım", simge: "para" },
    /* İcralarım (1.11): sunucu yalnız icra dosyası olana ya da portaldan açılana gönderir */
    icralarim: { rota: "Icralarim", ekran: Icralarim, ad: "İcralarım", simge: "belge" },
    /* SKT Kontrol (1.9): Biçen360 modülü, portaldan açılıyor */
    skt: { rota: "Skt", ekran: Skt, ad: "SKT Kontrol", simge: "takvim" },

    /* Yönetici İşlemleri (1.7; eski adı İzin Onayları): kod ve rota aynı */
    izinonay: {
      rota: "IzinOnay",
      ekran: IzinOnay,
      /* Sekme etiketi kısa: "Yönetici İşlemleri" alt menüye sığmıyor */
      ad: "Yönetici",
      simge: "canta",
    },
  };

  /* Alt menüde sekme olacaklar (Mesajlar ayrıca, en sonda) */
  const sekmeler = altMenu.filter((kod) => TANIM[kod]).slice(0, mesajVar ? 3 : 4);

  /* Kalanlar da kaydedilir ama çubukta görünmez: Diğer menüsünden
     gezilebilmeleri için rotanın var olması gerekiyor. */
  const gizliler = Object.keys(TANIM).filter((kod) => !sekmeler.includes(kod));

  /* Başlık çubuğundaki geri oku yalnızca çubukta yeri olmayan ekranlarda
     çıksın diye: görünen rotalar ekranlara bağlamla veriliyor. */
  const gorunenRotalar = [
    "AnaSayfa",
    ...(mesajVar ? ["Mesajlar"] : []),
    ...sekmeler.map((kod) => TANIM[kod].rota),
  ];

  /* Diğer sekmesi yok: iş ve onay sayısı ana sayfa simgesinde */
  const anaRozet = isler.acikSayi + (sekmeler.includes("izinonay") ? 0 : onaySayisi);

  return (
    <>
    {/* KVKK aydınlatma metni: onayı yoksa tam ekran (1.7) */}
    <AydinlatmaPenceresi />
    {/* Açılışta görülmemiş iş varsa; kapanırken Diğer sekmesine uçar */}
    <IsEmriPencere
      acik={pencereAcik}
      isler={isler.yeniler}
      onKapat={() => setPencereAcik(false)}
      onAc={() => {
        setPencereAcik(false);
        navigation.navigate("Isler");
      }}
    />

    <SekmeBaglami.Provider value={gorunenRotalar}>
    <Sekmeler.Navigator
      tabBar={(p) => (
        <AltMenu
          {...p}
          gecmistenSec
          rozetler={{
            AnaSayfa: anaRozet,
            IzinOnay: sekmeler.includes("izinonay") ? onaySayisi : 0,
            Mesajlar: mesajOkunmamis,
          }}
        />
      )}
      screenOptions={{ headerShown: false }}
      /* Geri tuşu gezinme geçmişini izlesin: varsayılan davranış hangi
         ekranda olursanız olun ilk sekmeye (Ana Sayfa) atıyordu. Diğer
         menüsünden açılan bir ekrandan geri dönmek, açıldığı yere
         dönmek demek. */
      backBehavior="history"
    >
      <Sekmeler.Screen
        name="AnaSayfa"
        component={AnaSayfa}
        options={{ title: "Ana Sayfa", simgeAdi: "ev" }}
      />

      {sekmeler.map((kod) => (
        <Sekmeler.Screen
          key={kod}
          name={TANIM[kod].rota}
          component={TANIM[kod].ekran}
          options={{ title: TANIM[kod].ad, simgeAdi: TANIM[kod].simge }}
        />
      ))}

      {/* 1.9: Diğer sekmesinin yerinde Mesajlar. Modül kapalıysa da rota
          kayıtlı (gizli): bildirimden gelinirse ekran bulunabilsin. */}
      <Sekmeler.Screen
        name="Mesajlar"
        component={Mesajlar}
        options={{ title: "Mesajlar", simgeAdi: "mesaj", gizli: !mesajVar }}
      />

      {/* Eski Diğer menüsü: sekmede değil, "Tüm modüller" ve Bilgilerim'den */}
      <Sekmeler.Screen
        name="Diger"
        component={Diger}
        options={{ title: "Tüm modüller", simgeAdi: "diger", gizli: true }}
      />

      {/* Devamsızlık girişi (1.9): Yönetici İşlemleri ve bildirimden */}
      <Sekmeler.Screen
        name="Devamsizlik"
        component={Devamsizlik}
        options={{ title: "Devamsızlık", simgeAdi: "uyari", gizli: true }}
      />

      {/* Devamsızlık tutanağı (26.10.2026): şahit onayı ve imzalı tutanak yükleme; ana sayfa kartı ve bildirimden */}
      <Sekmeler.Screen
        name="DevamsizlikTutanak"
        component={DevamsizlikTutanak}
        options={{ title: "Tutanak", simgeAdi: "belge", gizli: true }}
      />

      {/* Denkleştirme (23.10.2026): İzin Yönetimi'nden; onay listesi Yönetici İşlemleri'nden */}
      <Sekmeler.Screen
        name="Denklestirme"
        component={Denklestirme}
        options={{ title: "Denkleştirme", simgeAdi: "saat", gizli: true }}
      />
      {/* Görevlendirme (26.10.2026): İzin Yönetimi'nden */}
      <Sekmeler.Screen
        name="Gorevlendirme"
        component={Gorevlendirme}
        options={{ title: "Görevlendirme", simgeAdi: "canta", gizli: true }}
      />
      <Sekmeler.Screen
        name="DenklestirmeOnay"
        component={DenklestirmeOnay}
        options={{ title: "Denkleştirme onayı", simgeAdi: "saat", gizli: true }}
      />

      {/* Menüde görünmeyen ama gezinilebilen ekranlar */}
      {/* Modül değil: kontrol listesi kartından açılır */}
      <Sekmeler.Screen
        name="ChecklistDoldur"
        component={ChecklistDoldur}
        options={{ title: "Kontrol Listesi", simgeAdi: "belge", gizli: true }}
      />

      {/* Modül değil: Diğer ekranındaki künye kartından açılır */}
      {/* Bilgilerim'in alt modülleri tek ekranda; hangisinin açılacağını
          rota parametresi söylüyor. Her modül için ayrı rota tanımlamak,
          modül eklendikçe App.js'i şişiriyordu. */}
      <Sekmeler.Screen
        name="BilgiModul"
        component={BilgiModul}
        options={{ title: "Bilgilerim", simgeAdi: "kisi", gizli: true }}
      />

      {/* Etik hat Diğer menüsünden açılıyor; sekme çubuğunda yeri yok */}
      <Sekmeler.Screen
        name="EtikHat"
        component={EtikHat}
        options={{ title: "Etik Hat", simgeAdi: "uyari", gizli: true }}
      />

      {/* Kazan-Kazan (1.8): Diğer menüsünden açılıyor */}
      <Sekmeler.Screen
        name="KazanKazan"
        component={KazanKazan}
        options={{ title: "Kazan-Kazan", simgeAdi: "kupa", gizli: true }}
      />

      {/* Dönemsel ekip değerlendirmesi (1.8): Diğer menüsü ve ana sayfa kartı */}
      <Sekmeler.Screen
        name="EkipDegerlendirme"
        component={EkipDegerlendirme}
        options={{ title: "Ekip değerlendirmesi", simgeAdi: "ekip", gizli: true }}
      />

      <Sekmeler.Screen
        name="Bilgilerim"
        component={Bilgilerim}
        options={{ title: "Bilgilerim", simgeAdi: "kisi", gizli: true }}
      />

      {/* Gift kart ana sayfadan açılıyor, modül listesinde değil:
          kasada sırada beklerken tek dokunuşla ulaşılmalı. */}
      <Yigin.Screen
        name="GiftKart"
        component={GiftKart}
        options={{ title: "Biçen Kartım", simgeAdi: "para", gizli: true }}
      />

      {gizliler.map((kod) => (
        <Sekmeler.Screen
          key={kod}
          name={TANIM[kod].rota}
          component={TANIM[kod].ekran}
          options={{
            title: TANIM[kod].ad,
            simgeAdi: TANIM[kod].simge,
            gizli: true,
          }}
        />
      ))}
    </Sekmeler.Navigator>
    </SekmeBaglami.Provider>

    {/* Yeni mesajda üstten kayan balon (yanıtlanabilir) */}
    <MesajBalonu
      etkin={mesajVar}
      okunmamisDegisti={setMesajOkunmamis}
      ac={(sohbetId) => navigation.navigate("Uygulama", { screen: "Mesajlar", params: { sohbetId, t: Date.now() } })}
    />
    </>
  );
}

/* ========================================================================== */

export default function App() {
  const [hazir, setHazir] = useState(false);
  const [oturumVar, setOturumVar] = useState(false);

  /* Patron yetkisi saklıysa ve personel görünümü seçilmemişse yönetim
     ekranıyla açılır. Saklı değilse (ilk açılış) personel ekranı açılır;
     sunucu patron derse oradan geçilir (Uygulama içinde). */
  const [patronla, setPatronla] = useState(false);

  const [acilisHatasi, setAcilisHatasi] = useState("");
  const [hukukla, setHukukla] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const jeton = await jetonYukle();

        if (jeton) setPatronla(patronlaAcilsinMi(await gorunumOku()));

        /* Dış hukuk danışmanı yalnız hukuk masasıyla açılır (24.10.2026) */
        if (jeton) setHukukla(await hukukMu());

        setOturumVar(!!jeton);

        /* Cihaz kaydı kalıcı kimliğe taşınır (26.10.2026): 1.9'dan
           güncellenen telefonda eski rastgele kimlik duruyorsa sunucuya
           kalıcı kimlik bildirilir. Açılışı bekletmez; olmazsa (sunucu
           eski, ağ yok) bir sonraki açılışta yeniden denenir. */
        if (jeton) cihazKimligiTasi().catch(() => {});
      } catch (e) {
        /* Jeton okunamazsa giriş ekranından devam edilir; açılışın burada
           takılması, uygulamanın hiç açılmaması demekti. */
        setAcilisHatasi(e?.message ?? "Oturum bilgisi okunamadı.");
      } finally {
        setHazir(true);
      }
    })();
  }, []);

  /* Perde ilk çizimden sonra kaldırılıyor. finally değil useEffect içinde:
     ekranda gerçekten bir şey çizildiğinden emin olunmalı. */
  useEffect(() => {
    if (!hazir) return;

    const zamanlayici = setTimeout(() => {
      PerdeYoneticisi?.hideAsync?.().catch(() => {});
    }, 120);

    return () => clearTimeout(zamanlayici);
  }, [hazir]);

  /* Açılış üç saniyeden uzun sürerse perde yine kalkıyor: takılan bir
     istek yüzünden görselin ekranda kalması, donmuş izlenimi veriyordu. */
  useEffect(() => {
    const emniyet = setTimeout(() => {
      PerdeYoneticisi?.hideAsync?.().catch(() => {});
      setHazir(true);
    }, 3000);

    return () => clearTimeout(emniyet);
  }, []);

  if (!hazir)
    return (
      <View style={s.acilis}>
        <ActivityIndicator color={renk.yesil} size="large" />
      </View>
    );

  return (
    /* Kalkan en dışta: bir ekran çizim sırasında hata verdiğinde React
       bütün ağacı söküyor ve geriye beyaz ekran kalıyor. Hata metnini
       görmek, sorunu bulmanın tek yolu. */
    <HataKalkani baslangicHatasi={acilisHatasi || acilisHatalari[0]}>
      <SafeAreaProvider>
        <StatusBar style="light" />

        <NavigationContainer>
          <Yigin.Navigator
            screenOptions={{ headerShown: false }}
            initialRouteName={oturumVar ? (hukukla ? "Hukuk" : patronla ? "Patron" : "Uygulama") : "Giris"}
          >
            <Yigin.Screen name="Giris" component={Giris} />
            <Yigin.Screen name="Kod" component={Kod} />
            <Yigin.Screen name="Uygulama" component={Uygulama} />

            {/* Patron görünümü: yalnızca yetkisi olanlar buraya geçiyor */}
            <Yigin.Screen name="Patron" component={PatronUygulama} options={{ animation: "fade" }} />

            {/* Hukuk masası: dış danışman ve Biçen hukuk ekibi */}
            <Yigin.Screen name="Hukuk" component={HukukUygulama} options={{ animation: "fade" }} />
          </Yigin.Navigator>
        </NavigationContainer>

        {/* Mağazada yeni sürüm varsa güncelleme penceresi (1.7) */}
        <GuncellemeDenetimi />
      </SafeAreaProvider>
    </HataKalkani>
  );
}

const s = StyleSheet.create({
  acilis: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: renk.beyaz,
  },
});

/**
 * Ana Sayfa
 * ---------------------------------------------------------------------------
 * Personelin günlük olarak bakacağı özet: vardiya durumu, son duyuru,
 * izin ve prim özeti, son geçiş hareketleri.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import Simge from "../bilesenler/Simge";
import YardimDugmesi from "../bilesenler/YardimDugmesi";
import SimgeKutu from "../bilesenler/SimgeKutu";
import KartZemin, { TURUNCU, YESIL } from "../bilesenler/KartZemin";

import { api, ozetAl, dogumGunuAl, modullerimAl, duyuruAl, duyuruGorselAdresi, yoneticiBekleyenSayisi } from "../api";
import { api360, moduller360Al } from "../api360";
import { oku as onbellekOku, tazele as onbellekTazele } from "../onbellek";
import { renk, gunYaz, paraYaz, saatYaz, tarihYaz, AYLAR } from "../tema";
import { Kart, Kutu, Kutular, Satir, Yukleniyor, Hata } from "../bilesenler/Ortak";
import DogumGunu from "../bilesenler/DogumGunu";
import { gorevBekleyenlerAl, tutanakBekleyenlerAl } from "../api";
import { RotasyonDetay, ROTASYON_DURUM } from "../bilesenler/Rotasyon";
import { EvrakPenceresi as MazeretBelgePenceresi, OryantasyonFormu, EkipGorevleri, kalanYaz } from "../bilesenler/Gorevler";
import EksikPenceresi, { eksikAlt } from "../bilesenler/TalepEksik";
import Kisayollar, { EN_FAZLA } from "../bilesenler/Kisayollar";
import { EKRANLAR } from "./Diger";
import { kisayolOku, kisayolYaz } from "../kisayolTercihi";

/* Kısayollarda olmayanlar: alt menüdeki sekmeler */
const KISAYOL_DISI = new Set(["vardiya", "duyuru", "performans"]);

/* Varsayılan sıra (kişi düzenleyene kadar): yönetici işleri önce */
const KISAYOL_SIRASI = [
  "izinonay", "ekipdegerlendirme", "ekibim", "puantaj", "vardiyaplani", "isemri", "checklist", "ariza",
  "izin", "avans", "icralarim", "kazankazan", "fiyatkontrol", "rakipfiyat", "envanter", "kunye", "haberler", "prim",
  "rapor", "etik",
];

/* "YENİ" rozeti */
const YENI_MODULLER = new Set(["kazankazan", "ekipdegerlendirme", "icralarim"]);

/** Kutlamanın aynı gün tekrar çıkmaması için; uygulama kapanınca sıfırlanır. */
let kutlamaGunu = null;

/** Saate göre selamlama */
function selamla() {
  const s = new Date().getHours();

  if (s < 6) return "İyi geceler";
  if (s < 12) return "Günaydın";
  if (s < 18) return "İyi günler";

  return "İyi akşamlar";
}

/**
 * Bölüm başlığı.
 *
 * Sağa uzanan ince çizgi bölümleri birbirinden ayırıyor; art arda gelen
 * kart yığınında nerede bir bölümün bittiği belli olmuyordu.
 */
function Bolum({ ad, say, sag }) {
  return (
    <View style={s.bolum}>
      <Text style={s.bolumAd}>{ad.toLocaleUpperCase("tr")}</Text>

      {say ? (
        <View style={s.bolumSay}>
          <Text style={s.bolumSayYazi}>{say}</Text>
        </View>
      ) : null}

      <View style={s.bolumCizgi} />

      {sag ?? null}
    </View>
  );
}

const DURUM_ADLARI = {
  acik: "Açık",
  yeni: "Yeni",
  atandi: "Atandı",
  islemde: "İşlemde",
  beklemede: "Beklemede",
  cozuldu: "Çözüldü",
  kapandi: "Kapandı",
  iptal: "İptal",
};

const durumRengi = (d) =>
  d === "cozuldu" || d === "kapandi"
    ? { backgroundColor: "#eef4e6" }
    : d === "beklemede"
    ? { backgroundColor: "#fff7e6" }
    : { backgroundColor: "#fff1f0" };

export default function AnaSayfa({ navigation, route }) {
  /* Hukuk masası (24.10.2026): Biçen hukuk ekibindeki personele giriş kartı */
  const [hukukYetkili, setHukukYetkili] = useState(false);
  useEffect(() => {
    api.al("/api/Hukuk/Ben").then((b) => setHukukYetkili(!!b?.yetkili && !b?.danisman)).catch(() => setHukukYetkili(false));
  }, []);

  /* Doğum günü kutlaması. Ana sayfa uygulamanın ilk açılan ekranı olduğu
     için buradan soruluyor; ayrı bir açılış ekranı kurmak gereksiz. */
  const [kutlama, setKutlama] = useState(null);

  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  /* Açılışta son özet dosyadan: gösterge yerine hemen ana sayfa (1.9) */
  useEffect(() => {
    onbellekOku("mobil-ozet")
      .then((k) => {
        if (k?.veri) {
          setVeri((v) => v ?? k.veri);
          setYukleniyor(false);
        }
      })
      .catch(() => undefined);
  }, []);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [fotoHatasi, setFotoHatasi] = useState(false);

  /* Portal tarafı: hangi modüllere yetki var ve son arıza kaydı.

     Ayrı tutuluyor ve alınamazsa sessizce boş kalıyor: portal servisi
     ulaşılmaz olduğunda İK özeti yine gösterilmeli. Ana sayfanın
     tamamını tek servise bağlamak, biri düştüğünde diğerini de
     görünmez yapıyordu. */
  const [portal, setPortal] = useState({
    moduller: [],
    sonAriza: null,
    acikAriza: 0,

    /* Ana sayfa kartları portaldan: Biçen Kartım şeridi, Bu Ay Mesai ve
       Son Prim kutuları şimdilik kapalı, ileride sırayla açılacak. Portal
       okunamazsa kapalı kalıyorlar. */
    kartlar: { bicenkart: false, mesai: false, prim: false },
  });

  /* Vardiya girişi hatırlatması.

     Uygulama açıldığında giriş yapılmamışsa ekran hafifçe kararıp karekod
     öne çıkıyor. Kapatıldığında hiçbir yere yönlendirmiyor: personel ana
     sayfada kalıyor ve hazır olduğunda kendisi okutuyor. Zorlayıcı bir
     yönlendirme, elinde iş varken uygulamayı kullanılamaz yapıyordu.

     Oturum başına bir kez: her ekran dönüşünde tekrar çıkması rahatsız
     edici olurdu. */
  const [hatirlatmaAcik, setHatirlatmaAcik] = useState(false);

  /* Gift kart bakiyesi ayrı çekiliyor: yazarkasa veritabanı başka bir
     sunucuda ve yavaş yanıt verebiliyor. Özetle birlikte istenseydi
     bütün ana sayfa onu bekliyordu. */
  const [gift, setGift] = useState(null);

  const hatirlatildiRef = useRef(false);

  /* Mazeret belgesi ve oryantasyon: kendi bekleyenleri ve (yöneticiyse)
     ekibinkiler. Ayrı istek: alınamazsa ana sayfa yine açılıyor. */
  const [gorev, setGorev] = useState(null);
  const [belgeTalep, setBelgeTalep] = useState(null);
  /* Rotasyon talebi (1.6): personel yalnızca görür */
  const [rotasyon, setRotasyon] = useState(null);
  const [anketAcik, setAnketAcik] = useState(false);
  const [ekipGorev, setEkipGorev] = useState(null);
  /* İK'nın bildirdiği talep eksiği (07.10.2026) */
  const [eksikKart, setEksikKart] = useState(null);

  const gorevGetir = useCallback(() => {
    gorevBekleyenlerAl()
      .then(setGorev)
      .catch(() => {});
  }, []);

  /* Devamsızlık tutanağı (26.10.2026): girenin yüklemesi beklenen imzalı
     tutanaklar ve kişinin şahitlik onayı bekleyen tutanaklar. Ayrı istek,
     odağa dönüşte tazelenir; alınamazsa kart çıkmaz. */
  const [tutanak, setTutanak] = useState(null);
  useFocusEffect(
    useCallback(() => {
      tutanakBekleyenlerAl()
        .then(setTutanak)
        .catch(() => {});
    }, [])
  );

  /* Eksik bildirimine dokunuldu: bekleyenler tazelenip açık eksik açılıyor */
  const eksikIstek = route?.params?.eksik;

  useEffect(() => {
    if (!eksikIstek) return;

    gorevBekleyenlerAl()
      .then((g) => {
        setGorev(g);
        const liste = g?.eksikler ?? [];
        const e = liste.find((x) => x?.kayit?.durum === "acik") ?? liste[0];
        if (e) setEksikKart(e);
      })
      .catch(() => {});
  }, [eksikIstek]);

  /* Yönetici İşlemleri kısayolu (1.7): modülü açık olan yöneticide,
     onay bekleyen sayısı rozetle. Yönetici talebin geldiğini bildirimi
     kaçırsa da ana sayfadan görüyor. */
  const [yonetici, setYonetici] = useState(null);
  const yoneticiZamani = useRef(0);

  /* Ekrana dönülünce (onay verip gelince) sayı hemen tazelensin */
  useFocusEffect(
    useCallback(() => {
      yoneticiZamani.current = 0;
    }, [])
  );

  /* Son duyuru: ana sayfanın üstünde tek kart. Duyurular sekmesine
     girmeyen personel önemli bir duyuruyu hiç görmüyordu. */
  const [sonDuyuru, setSonDuyuru] = useState(null);

  /* Kısayol tercihi (1.8): null = hiç düzenlenmedi, varsayılan sıra */
  const [kisayolSecim, setKisayolSecim] = useState(null);

  /* Vardiya karekodunun nefes alması.

     Daha önce bir ölçek animasyonu konup kaldırılmıştı: genişlik ve
     yükseklik canlandırılınca döngü JS iş parçacığında çalışıyor ve ekran
     tepkisizleşiyordu. transform.scale yerel sürücüyle çiziliyor, döngü
     JS'e hiç uğramıyor.

     Ekran odaktan çıkınca durduruluyor: arka planda dönen bir döngü
     bataryayı boşuna harcıyor. */
  const nefes = useRef(new Animated.Value(0)).current;

  /* Çan sallanması: okunmamış duyuru varken 3 saniyede bir kısa sallantı */
  const zilSalla = useRef(new Animated.Value(0)).current;
  const okunmamis = (veri?.okunmamisDuyuru ?? 0) > 0;
  useEffect(() => {
    if (!okunmamis) {
      zilSalla.setValue(0);
      return undefined;
    }
    const adim = (d) => Animated.timing(zilSalla, { toValue: d, duration: 90, useNativeDriver: true });
    const dongu = Animated.loop(
      Animated.sequence([adim(1), adim(-1), adim(0.7), adim(-0.7), adim(0.3), adim(0), Animated.delay(2600)])
    );
    dongu.start();
    return () => dongu.stop();
  }, [okunmamis, zilSalla]);

  useFocusEffect(
    useCallback(() => {
      const dongu = Animated.loop(
        Animated.sequence([
          Animated.timing(nefes, {
            toValue: 1,
            duration: 1100,
            useNativeDriver: true,
          }),
          Animated.timing(nefes, {
            toValue: 0,
            duration: 1100,
            useNativeDriver: true,
          }),
        ])
      );

      dongu.start();

      return () => {
        dongu.stop();
        nefes.setValue(0);
      };
    }, [nefes])
  );

  const portalGetir = useCallback(async () => {
    try {
      /* İki servisin modülleri birleştiriliyor.

         Ana sayfa eskiden yalnızca portal modüllerini okuyordu: özet
         kutuları ve bekleyenler listesi yetkiden bağımsız çiziliyordu.
         Performans yetkisi alınan personel modül listesinde göremiyor
         ama ana sayfadaki kutudan ekrana girebiliyordu. */
      const [b360, ik] = await Promise.all([
        moduller360Al(),
        modullerimAl().catch(() => ({ moduller: [] })),
      ]);

      const nesneler = [];
      for (const m of [...(ik?.moduller ?? []), ...(b360?.moduller ?? [])]) {
        if (m?.kod && !nesneler.some((x) => x.kod === m.kod)) nesneler.push(m);
      }
      const moduller = nesneler.map((x) => x.kod);

      let sonAriza = null;

      let acikAriza = 0;

      if (moduller.includes("ariza")) {
        const c = await api360.al("/api/Ariza/Kayitlarim?kapsam=benim");
        const liste = Array.isArray(c) ? c : c?.kayitlar ?? [];

        sonAriza = liste[0] ?? null;

        /* Açık arıza sayısı bekleyenler listesinde gösteriliyor. */
        acikAriza = liste.filter(
          (x) => x.durum !== "cozuldu" && x.durum !== "kapandi" && x.durum !== "iptal"
        ).length;
      }

      const kartlar = {
        bicenkart: !!b360?.anaSayfaKartlari?.bicenkart,
        mesai: !!b360?.anaSayfaKartlari?.mesai,
        prim: !!b360?.anaSayfaKartlari?.prim,
      };

      kartlarRef.current = kartlar;
      setPortal({ moduller, nesneler, sonAriza, acikAriza, kartlar });

      /* Sayı en çok dakikada bir: ana sayfa 30 saniyede bir tazeleniyor ve
         onay listesi sunucuda organizasyon şemasıyla hesaplanıyor */
      if (moduller.includes("izinonay")) {
        if (Date.now() - yoneticiZamani.current > 60000) {
          yoneticiZamani.current = Date.now();
          yoneticiBekleyenSayisi()
            .then(setYonetici)
            .catch(() => setYonetici((o) => o ?? { toplam: 0 }));
        }
      } else setYonetici(null);

      /* Kart şeridi açıksa bakiye ancak şimdi çekiliyor: kapalıyken
         yavaş yazarkasa sunucusuna hiç gidilmiyor. */
      if (kartlar.bicenkart) giftGetir();
    } catch {
      kartlarRef.current = { bicenkart: false, mesai: false, prim: false };
      setPortal({ moduller: [], sonAriza: null, acikAriza: 0, kartlar: { bicenkart: false, mesai: false, prim: false } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sicilim = veri?.kisi?.personelKodu;
  useEffect(() => {
    if (sicilim) kisayolOku(sicilim).then(setKisayolSecim);
  }, [sicilim]);

  /* Portaldan gelen kart ayarının son hâli; gift isteği bunu okuyor */
  const kartlarRef = useRef({ bicenkart: false, mesai: false, prim: false });

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      /* 1.9: özet önbellekte de tutuluyor; uygulama açılışında son
         görüntü dosyadan hemen çiziliyor, taze veri arkadan geliyor. */
      const ozet = await onbellekTazele("mobil-ozet", ozetAl);

      setVeri(ozet);
      setHata("");

      if (!hatirlatildiRef.current && !ozet?.vardiya?.girisSaati && !ozet?.vardiya?.izinli) {
        hatirlatildiRef.current = true;
        setHatirlatmaAcik(true);
      }

      /* Portal özeti ana isteği bekletmiyor */
      portalGetir();
      gorevGetir();

      /* Son duyuru da ana isteği bekletmiyor; gelmezse kart çıkmıyor */
      duyuruAl()
        .then((d) => setSonDuyuru((d?.kayitlar ?? []).find((x) => !x.kisisel) ?? null))
        .catch(() => setSonDuyuru(null));
    } catch (h) {
      setHata(h.message);

      /* Oturum düşmüşse giriş ekranına dönülür. Başka bir cihazdan
         giriş yapıldığında ya da İK eşleştirmeyi kaldırdığında olur. */
      /* Büyük/küçük harf gözetilmez: "oturumunuz kapatıldı" (çıkış
         tarihi gelen personel) da giriş ekranına döndürür (26.10.2026) */
      if (/oturum/i.test(h.message) || /yeniden giriş/i.test(h.message)) {
        navigation.getParent()?.reset({
          index: 0,
          routes: [{ name: "Giris" }],
        });
      }
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, [navigation]);


  /* Sekmeye her dönüşte tazelenir: vardiya durumu anlık olmalı */
  /* Gift kart: kart yoksa ya da servise ulaşılamıyorsa şerit hiç
     görünmüyor, hata gösterilmiyor. */
  const [giftHatasi, setGiftHatasi] = useState("");


  const giftGetir = useCallback(async () => {
    /* Şerit portaldan kapalıysa bakiye hiç istenmiyor */
    if (!kartlarRef.current.bicenkart) {
      setGift(null);
      setGiftHatasi("");
      return;
    }

    try {
      const c = await api.al("/api/Mobil/GiftKart");

      setGift(c?.kartVar ? c : null);

      /* Kart bulunamadıysa sebep yazılıyor: şerit sessizce kaybolunca
         özellik hiç gelmemiş gibi görünüyordu. */
      setGiftHatasi(c?.kartVar ? "" : c?.bilgi ?? "");
    } catch (e) {
      setGift(null);
      setGiftHatasi(e?.message ?? "Kart bilgisi alınamadı.");
    }
  }, []);

  /* Alt menüde ana sayfadayken sekmeye tekrar basmak sayfayı tazeler.

     Gezinme açık olan ekrana yeniden gitmiyor, bu yüzden odak etkisi
     çalışmıyordu: kullanıcı "ana sayfaya bastım, bir şey olmadı" diyordu.
     Basış olayı seçili sekmede de yayımlanıyor, onu dinliyoruz. */
  useEffect(
    () =>
      navigation.addListener("tabPress", () => {
        if (navigation.isFocused()) {
          getir(true);
          giftGetir();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation]
  );

  useFocusEffect(
    useCallback(() => {
      getir();
      giftGetir();

      /* Kutlama günde bir kez: uygulamayı gün içinde her açışta pencere
         çıkması kutlamayı rahatsız ediciye çeviriyordu. */
      const bugun = new Date().toDateString();

      if (kutlamaGunu !== bugun) {
        dogumGunuAl()
          .then((c) => {
            if (c?.kutlama) {
              kutlamaGunu = bugun;
              setKutlama(c);
            }
          })
          /* Kutlama alınamazsa sessizce geçiliyor; ana sayfanın açılışını
             bir süse bağlamanın anlamı yok. */
          .catch(() => {});
      }

      /* Ana sayfa açıkken tazelenir: vardiya durumu ve duyuru anlık
         olmalı. Bildirim gelmese de kullanıcı güncel veriyi görür. */
      const zamanlayici = setInterval(() => getir(), 30000);

      /* Uygulama arka plandan dönünce hemen tazelenir: telefonu cebinden
         çıkaran kullanıcı eski veriyi görmemeli. */
      const dinleyici = AppState.addEventListener("change", (durum) => {
        if (durum === "active") getir();
      });

      return () => {
        clearInterval(zamanlayici);
        dinleyici.remove();
      };
    }, [getir])
  );

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  const k = veri?.kisi ?? {};
  const v = veri?.vardiya ?? {};

  /* Bekleyen işler tek listede toplanıyor: her biri sayı, kısa açıklama
     ve gidilecek ekranla. Sayısı sıfır olan girmiyor. */
  /* Kişide açık modüller: iki servisin listesi birleştirilmiş hâli.
     Liste hiç okunamadıysa kısıtlama uygulanmıyor — ağ hatası yüzünden
     ana sayfanın boşalması, yanlış bilgi göstermekten daha kötü. */
  const acik = (kod) =>
    portal.moduller.length === 0 || portal.moduller.includes(kod);

  const ozetKutulari = [
    acik("izin") && (
      <Kutu
        key="izin"
        baslik="Kalan İzin"
        deger={gunYaz(veri?.izin?.kalan ?? 0)}
        ek="gün"
        renkli={renk.yesilKoyu}
        bas={() => navigation.navigate("Izin")}
      />
    ),

    /* Son Prim kutusu da portaldaki "Ana sayfa kartları" anahtarına
       bağlı; kapalıyken prim modülü açık olsa bile ana sayfada yok. */
    portal.kartlar?.prim && acik("prim") && (
      <Kutu
        key="prim"
        baslik="Son Prim"
        deger={
          veri?.prim?.sonTutar
            ? paraYaz(veri.prim.sonTutar).replace(" TL", "")
            : "—"
        }
        ek={veri?.prim?.sonAy ? `TL · ${AYLAR[veri.prim.sonAy - 1]}` : "prim yok"}
        renkli={renk.mor}
        bas={() => navigation.navigate("Prim")}
      />
    ),

    acik("performans") && (
      <Kutu
        key="performans"
        baslik="Performans"
        deger={veri?.performans?.puan ?? "—"}
        ek={veri?.performans?.sira ? `/ 100 · #${veri.performans.sira}` : "/ 100"}
        renkli={renk.mavi}
        bas={() => navigation.navigate("Performans")}
      />
    ),

    /* Mesai kutusu ayrı yetkiye bağlı: vardiya modülü açıkken bile
       portaldan gizlenebiliyor. Portaldaki "Ana sayfa kartları" anahtarı
       kapalıysa hiç çizilmiyor. */
    portal.kartlar?.mesai && acik("vardiya") && acik("mesaiozet") && (
      <Kutu
        key="vardiya"
        baslik="Bu Ay Mesai"
        deger={veri?.vardiya?.aylikSaat ?? "—"}
        ek="saat"
        renkli={renk.turuncu}
        bas={() => navigation.navigate("Vardiya")}
      />
    ),
  ].filter(Boolean);

  /* Mazeret belgesi ve oryantasyon kartları listenin başında: süreleri var */
  const gecikenBelge = (gorev?.ekipBelge ?? []).filter((x) => x.gecikti);

  const gorevKartlari = [
    /* İK eksik bildirimi en başta: personelin yapması gereken bir iş var */
    ...(gorev?.eksikler ?? []).map((e) => {
      const k = e.kayit ?? {};
      const tamamlandi = k.durum === "tamamlandi";

      return {
        anahtar: `eksik-${k.id}`,
        kod: "mazeret",
        /* 2.0 (26.10.2026): eksiği yönetici bildirdiyse kart onun adıyla */
        ad: tamamlandi
          ? k.yonetici
            ? `${k.turAdi} eksiği · yöneticinize bildirildi`
            : `${k.turAdi} eksiği · İK kontrol ediyor`
          : `${k.yonetici ? k.bildiren ?? "Yöneticiniz" : "İK"}: ${k.baslik}`,
        alt: eksikAlt(k),
        simge: tamamlandi ? "onay" : "uyari",
        renk: tamamlandi ? renk.yesil : renk.turuncu,
        acil: !tamamlandi,
        bas: () => setEksikKart(e),
      };
    }),

    ...(gorev?.belgeler ?? []).map((b) =>
      b.tamam
        ? {
            anahtar: `belge-${b.id}`,
            kod: "mazeret",
            ad: "Evrakın aslını İK'ya gönderin",
            alt: `${b.tur} · evrak yüklendi, aslını teslim edin`,
            simge: "belge",
            renk: renk.yesil,
            bas: () => setBelgeTalep(b),
          }
        : b.formBekleniyor
        ? {
            /* Şube personeli: imzalı form yüklenene kadar kart sürekli
               görünür; yönetici form gelmeden onaylayamaz (07.10.2026) */
            anahtar: `belge-${b.id}`,
            kod: "mazeret",
            ad: "İmzalı izin formunu yükleyin",
            alt: `${b.altTur ? `${b.tur} · ${b.altTur}` : b.tur} · yöneticiniz form yüklenmeden onaylayamaz`,
            simge: "belge",
            renk: renk.turuncu,
            acil: true,
            bas: () => setBelgeTalep(b),
          }
        : {
            anahtar: `belge-${b.id}`,
            kod: "mazeret",
            ad: b.belgeGerekli ? "İzin evrakınızı ve belgenizi yükleyin" : "İzin evrakınızı yükleyin",
            alt: b.gecikti ? `${b.tur} · süre doldu, hemen yükleyin` : `${b.tur} · ${kalanYaz(b.kalanSaat)}`,
            simge: "belge",
            renk: renk.turuncu,
            acil: b.gecikti || b.kalanSaat < 24,
            bas: () => setBelgeTalep(b),
          }
    ),

    /* Devamsızlık tutanağı (26.10.2026) */
    ...(tutanak?.sahitlik ?? []).map((t) => ({
      anahtar: `tutanak-sahit-${t.id}`,
      kod: "devamsizlik",
      ad: "Şahitlik onayı bekleyen tutanak",
      alt: `${t.adSoyad} · ${t.tarihler} · ${t.girenAd} sizi şahit seçti`,
      simge: "belge",
      renk: renk.turuncu,
      acil: true,
      bas: () => navigation.navigate("DevamsizlikTutanak", { id: t.id, t: Date.now() }),
    })),

    ...(tutanak?.yuklenecek ?? []).map((t) => ({
      anahtar: `tutanak-belge-${t.id}`,
      kod: "devamsizlik",
      ad: "İmzalı devamsızlık tutanağını yükleyin",
      alt: `${t.adSoyad} · ${t.tarihler} · yazdırıp şahitlerle imzalayın`,
      simge: "belge",
      renk: renk.turuncu,
      bas: () => navigation.navigate("DevamsizlikTutanak", { id: t.id, t: Date.now() }),
    })),

    ...(gorev?.rotasyonlar ?? []).map((r) => ({
      anahtar: `rotasyon-${r.id}`,
      kod: "rotasyon",
      ad: r.durum === "onaylandi" ? "Şube değişikliğiniz onaylandı" : "Sizin için rotasyon talebi açıldı",
      alt: `${r.sube} → ${r.onaylananSube ?? (r.hedefler ?? []).map((h) => h.ad).join(", ")} · ${(ROTASYON_DURUM[r.durum] ?? {}).ad ?? r.durumAdi}`,
      simge: "kisi",
      renk: r.durum === "onaylandi" ? renk.yesil : r.durum === "reddedildi" ? renk.pasif : renk.mavi,
      bas: () => setRotasyon(r),
    })),

    gorev?.oryantasyon && {
      anahtar: "oryantasyon",
      kod: "oryantasyon",
      ad: gorev.oryantasyon.test ? "Oryantasyon anketiniz hazır (test)" : "Oryantasyon anketiniz hazır",
      alt: `${gorev.oryantasyon.asamaAdi} · ${kalanYaz(gorev.oryantasyon.kalanSaat)}`,
      simge: "onay",
      renk: renk.yesil,
      acil: gorev.oryantasyon.kalanSaat < 24,
      bas: () => setAnketAcik(true),
    },

    gecikenBelge.length > 0 && {
      anahtar: "ekip-belge",
      kod: "mazeret",
      ad: "Evrak yüklemesi beklenen personel mevcut",
      alt: gecikenBelge.map((x) => x.adSoyad).slice(0, 2).join(", ") + (gecikenBelge.length > 2 ? "…" : ""),
      sayi: gecikenBelge.length,
      simge: "uyari",
      renk: renk.turuncu,
      acil: true,
      bas: () => setEkipGorev("belge"),
    },

    /* Dönemsel ekip değerlendirmesi (1.8): oryantasyondan ayrı kart */
    (gorev?.ekipDegerlendirme?.bekleyen ?? 0) > 0 && {
      anahtar: "ekip-degerlendirme",
      kod: "ekipdegerlendirme",
      ad: "Ekibini değerlendir",
      alt: `${gorev.ekipDegerlendirme.donemAdi} · ${gorev.ekipDegerlendirme.bekleyen}/${gorev.ekipDegerlendirme.toplam} kişi bekliyor · son gün ${tarihYaz(gorev.ekipDegerlendirme.bitis)}`,
      sayi: gorev.ekipDegerlendirme.bekleyen,
      simge: "ekip",
      renk: renk.yesil,
      acil: gorev.ekipDegerlendirme.kalanGun <= 2,
      bas: () => navigation.navigate("EkipDegerlendirme"),
    },

    (gorev?.ekipOryantasyon ?? []).length > 0 && {
      anahtar: "ekip-oryantasyon",
      kod: "oryantasyon",
      ad: "Oryantasyon doldurulması bekleniyor",
      alt: `Ekibinizden ${gorev.ekipOryantasyon.length} kişi · değerlendirmeniz bekleniyor`,
      sayi: gorev.ekipOryantasyon.length,
      simge: "kisi",
      renk: renk.yesil,
      acil: gorev.ekipOryantasyon.some((x) => x.kalanSaat < 24),
      bas: () => setEkipGorev("oryantasyon"),
    },
  ].filter(Boolean);

  const bekleyenler = [
    ...gorevKartlari,

    portal.acikAriza > 0 && {
      kod: "ariza",
      ad: "Açık arıza kaydınız",
      alt: "Çözüm bekliyor",
      sayi: portal.acikAriza,
      ekran: "Ariza",
      simge: "uyari",
      renk: renk.turuncu,
      zemin: "#fdece7",
      acil: true,
    },

    acik("isemri") && (veri?.isEmri?.acik ?? 0) > 0 && {
      kod: "isemri",
      ad: "Tamamlanmamış iş emri",
      alt: veri.isEmri.gecikenVar ? "Süresi geçmiş iş var" : "Size atandı",
      sayi: veri.isEmri.acik,
      ekran: "Isler",
      simge: "liste",
      renk: renk.mavi,
      zemin: "#e8f0f8",
      acil: !!veri.isEmri.gecikenVar,
    },

    acik("checklist") && (veri?.checklist?.bekleyen ?? 0) > 0 && {
      kod: "checklist",
      ad: "Bugünkü kontrol listesi",
      alt: "Doldurulmayı bekliyor",
      sayi: veri.checklist.bekleyen,
      ekran: "Checklist",
      simge: "onay",
      renk: renk.yesil,
      zemin: renk.yesilAcik,
    },
  ].filter(Boolean);

  /* Kısayollar (1.8): kişide açık, ekranı olan modüller */
  const kisayolModulleri = (portal.nesneler ?? [])
    .filter((m) => !KISAYOL_DISI.has(m.kod) && (EKRANLAR[m.kod] || m.kod === "bilgilerim"))
    .map((m) => ({ kod: m.kod, ad: m.ad, simge: m.simge }));
  const varsayilanKisayol = [
    ...KISAYOL_SIRASI.filter((k) => kisayolModulleri.some((m) => m.kod === k)),
    ...kisayolModulleri.map((m) => m.kod).filter((k) => !KISAYOL_SIRASI.includes(k)),
  ].slice(0, EN_FAZLA);
  const kisayolRozet = {
    izinonay: yonetici?.toplam ?? 0,
    isemri: veri?.isEmri?.acik ?? 0,
    checklist: veri?.checklist?.bekleyen ?? 0,
    ariza: portal.acikAriza ?? 0,
    ekipdegerlendirme: gorev?.ekipDegerlendirme?.bekleyen ?? 0,
  };
  const kisayolAc = (kod) =>
    kod === "bilgilerim" ? navigation.navigate("Bilgilerim") : navigation.navigate(EKRANLAR[kod]);

  const d = veri?.sonDuyuru;

  const basHarfler = `${k.adSoyad ?? ""}`
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
          />
        }
      >
        {/* Yeşil tepe.

            Vardiya kartı bunun üzerine taşıyor: katmanlama ekrana derinlik
            veriyor ve en sık yapılan iş (okutma) en görünür yerde duruyor. */}
        <KartZemin renkler={YESIL} yuvarlak={0} stil={s.tepe}>

          <View style={s.tepeSatir}>
            {/* 1.9: isme ya da fotoğrafa dokununca Bilgilerim (Diğer sekmesi kalktı) */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => navigation.navigate("Bilgilerim")}
              style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 10 }}
            >
            <View style={[s.foto, s.fotoYok]}>
              <Text style={s.basHarf}>{basHarfler}</Text>

              {k.personelKodu && !fotoHatasi ? (
                <Image
                  source={{ uri: api.resimAdresi() }}
                  style={s.fotoUst}
                  onError={() => setFotoHatasi(true)}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.selam} numberOfLines={1}>
                {selamla()}, {(k.adSoyad ?? "").split(" ")[0]}
              </Text>
              <Text style={s.tepeAlt} numberOfLines={1}>
                {k.gorev ?? "—"} · {k.subeAdi ?? "—"} ›
              </Text>
            </View>
            </TouchableOpacity>

            {/* Yardım çiçeği: ana sayfanın nasıl kullanıldığı. Kutusu
                düğmenin içinde; video yoksa boş kutu kalmıyor. */}
            <YardimDugmesi kod="AnaSayfa" ad="Ana sayfa" boyut={22} kutu />

            <TouchableOpacity
              style={[s.zil, (veri?.okunmamisDuyuru ?? 0) > 0 && s.zilYeni]}
              onPress={() => navigation.navigate("Duyurular")}
              activeOpacity={0.7}
            >
              {/* Okunmamış duyuru varsa çan sarı ve sallanıyor (1.8) */}
              <Animated.View
                style={
                  (veri?.okunmamisDuyuru ?? 0) > 0
                    ? {
                        transform: [
                          {
                            rotate: zilSalla.interpolate({
                              inputRange: [-1, 0, 1],
                              outputRange: ["-16deg", "0deg", "16deg"],
                            }),
                          },
                        ],
                      }
                    : null
                }
              >
                <Simge ad="zil" boyut={17} renkli={(veri?.okunmamisDuyuru ?? 0) > 0 ? "#5c4300" : renk.beyaz} />
              </Animated.View>

              {/* Okunmamış duyuru sayısı sunucudan geliyor. Önce
                  okunmayan bir alandan okunuyordu ve rozet hiç
                  çıkmıyordu. Dokuz üstü "9+": iki haneli sayı rozeti
                  simgenin üstüne taşırıyor. */}
              {(veri?.okunmamisDuyuru ?? 0) > 0 ? (
                <View style={s.zilRozet}>
                  <Text style={s.zilRozetYazi}>
                    {veri.okunmamisDuyuru > 9 ? "9+" : veri.okunmamisDuyuru}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>

          {/* Vardiya: yalnızca karekod, yeşil alanın ortasında.

              Yanındaki durum metni şeridi genişletip karekodu kenara
              itiyordu; aynı bilgi Vardiya ekranında zaten duruyor. */}
          {/* Vardiya karekodu da yetkiye bağlı: modülü kapalı olan
              personelin ekranın tepesinden giriş yapabilmesi yanlıştı. */}
          {/* Giriş / çıkış (1.8): bugünkü okutma saatleri ve QR okut.
              Giriş yoksa düğme nefes alıyor; vardiya modülü kapalıysa şerit yok. */}
          {acik("vardiya") ? (
            <View style={s.gc}>
              <View style={s.gcSaat}>
                <Text style={s.gcEtiket}>Giriş</Text>
                <Text style={[s.gcDeger, !v.girisSaati && s.gcBos]}>
                  {v.izinli && !v.icerideMi ? "İzinli" : v.girisSaati ? saatYaz(v.girisSaati) : "--:--"}
                </Text>
              </View>
              <View style={[s.gcSaat, s.gcSaatIki]}>
                <Text style={s.gcEtiket}>Çıkış</Text>
                <Text style={[s.gcDeger, !v.cikisSaati && s.gcBos]}>{v.cikisSaati ? saatYaz(v.cikisSaati) : "--:--"}</Text>
              </View>
              <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate("Vardiya")}>
                {!v.girisSaati && !v.izinli ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      s.gcHale,
                      {
                        opacity: nefes.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                        transform: [{ scale: nefes.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
                      },
                    ]}
                  />
                ) : null}
                <View style={s.gcQr}>
                  <Simge ad="kare" boyut={19} renkli={renk.yesilKoyu} />
                  <Text style={s.gcQrYazi}>QR okut</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : null}
        </KartZemin>

        <View style={s.govde}>

          {/* Gift kart.

              Vardiyanın hemen altında ve tam genişlikte: ödeme kasada,
              sırada beklerken yapılıyor ve orada her dokunuş uzun
              sürüyor. Bakiyeyi görmek ikincil, hızlı ödeme birincil. */}
          {portal.kartlar?.bicenkart && !gift && giftHatasi ? (
            <>
              <Bolum ad="Biçen Kartım" />

              <View style={s.giftNot}>
                <Text style={s.giftNotYazi}>{giftHatasi}</Text>
              </View>
            </>
          ) : null}

          {portal.kartlar?.bicenkart && gift ? (
            <>
              <Bolum ad="Biçen Kartım" />

              <TouchableOpacity
                activeOpacity={0.88}
                onPress={() => navigation.navigate("GiftKart")}
              >
                {/* Kart yüzüyle aynı desen ve renk: şerit, kartın ana
                    sayfadaki küçük hâli gibi okunsun. */}
                <KartZemin renkler={TURUNCU} yuvarlak={20} stil={s.gift}>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.giftEtiket}>KULLANILABİLİR BAKİYE</Text>

                  <Text style={s.giftBakiye}>
                    {gift.bakiyeOkunabildi
                      ? `${(gift.bakiye ?? 0).toLocaleString("tr-TR", {
                          minimumFractionDigits: 2,
                        })} ₺`
                      : "—"}
                  </Text>
                </View>

                <View style={s.giftOde}>
                  <Simge ad="kare" boyut={17} renkli={renk.beyaz} dolgu />
                  <Text style={s.giftOdeYazi}>Öde</Text>
                </View>
                </KartZemin>
              </TouchableOpacity>
            </>
          ) : null}

          {/* Sizi bekleyenler.

              Personel hangi işinin beklediğini görmek için modülleri tek
              tek açmak zorunda kalıyordu. Bekleyen iş yoksa bölüm hiç
              çıkmıyor: boş bir liste göstermek yer kaplıyor. */}
          {bekleyenler.length > 0 ? (
            <>
              <Bolum ad="Sizi bekleyenler" say={bekleyenler.length} />

              <View style={{ gap: 9 }}>
                {bekleyenler.map((b) => (
                  <TouchableOpacity
                    key={b.anahtar ?? b.ad}
                    style={[s.bek, b.kod === "mazeret" && b.acil && s.bekAcil]}
                    activeOpacity={0.8}
                    onPress={() => (b.bas ? b.bas() : navigation.navigate(b.ekran))}
                  >
                    <SimgeKutu kod={b.kod} ad={b.simge} boyut={42} />

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.bekAd}>{b.ad}</Text>
                      <Text style={[s.bekAlt, b.acil && { color: renk.turuncu }]}>
                        {b.alt}
                      </Text>
                    </View>

                    {b.sayi != null ? (
                      <View style={[s.bekRozet, { backgroundColor: b.renk }]}>
                        <Text style={s.bekRozetYazi}>{b.sayi}</Text>
                      </View>
                    ) : null}

                    <Simge ad="ok" boyut={15} renkli="#c8cfc4" />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}

          {hukukYetkili ? (
            <TouchableOpacity activeOpacity={0.88} onPress={() => navigation.navigate("Hukuk")} style={s.hukukKart}>
              <View style={s.hukukIkon}><Text style={{ color: "#e6c88f", fontSize: 18, fontWeight: "700" }}>§</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Hukuk masası</Text>
                <Text style={{ color: "#c4cbdb", fontSize: 12 }}>Dosyalar, duruşmalar ve resmi yazışma</Text>
              </View>
              <Simge ad="ok" boyut={15} renkli="#c4cbdb" />
            </TouchableOpacity>
          ) : null}

          {/* Kısayollar (1.8): yetkili modüller, rozetler, düzenle */}
          {kisayolModulleri.length > 0 ? (
            <Kisayollar
              moduller={kisayolModulleri}
              secim={kisayolSecim ?? varsayilanKisayol}
              degistir={(l) => {
                setKisayolSecim(l);
                kisayolYaz(sicilim, l);
              }}
              rozetler={kisayolRozet}
              yeniler={YENI_MODULLER}
              ac={kisayolAc}
              tumu={() => navigation.navigate("Diger")}
              Baslik={({ sag }) => <Bolum ad="Kısayollar" sag={sag} />}
            />
          ) : null}

          {/* Son duyuru: kapak görseli, başlık, tarih. Dokununca
              Duyurular ekranı açılıyor. */}
          {sonDuyuru && acik("duyuru") ? (
            <>
              <Bolum ad="Son duyuru" />

              <TouchableOpacity
                style={s.duyuruKart}
                activeOpacity={0.88}
                onPress={() => navigation.navigate("Duyurular")}
              >
                {sonDuyuru.gorselVar === 1 ? (
                  <Image
                    source={{ uri: duyuruGorselAdresi(sonDuyuru.id) }}
                    style={s.duyuruGorsel}
                    resizeMode="cover"
                  />
                ) : null}

                <View style={s.duyuruGovde}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {!sonDuyuru.okundu ? <View style={s.duyuruYeni} /> : null}
                    <Text style={s.duyuruBaslik} numberOfLines={2}>
                      {sonDuyuru.baslik}
                    </Text>
                  </View>
                  <Text style={s.duyuruMetin} numberOfLines={2}>
                    {sonDuyuru.metin}
                  </Text>
                  <Text style={s.duyuruAlt}>
                    {sonDuyuru.gecenGun === 0 ? "bugün" : sonDuyuru.gecenGun === 1 ? "dün" : `${sonDuyuru.gecenGun} gün önce`}
                    {"  ·  Tüm duyurular ›"}
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          ) : null}

          {/* Özet kutuları modül yetkisine bağlı.

              Kutular eskiden koşulsuz çiziliyordu: performans yetkisi
              alınan personel modül listesinde göremiyor ama buradaki
              kutuya dokunup ekrana girebiliyordu. Yetkisi olmayan modülün
              sayısını göstermek de sızıntı — puanı görmemesi gereken kişi
              kutuda okuyordu. */}
          {ozetKutulari.length > 0 ? (
            <>
              <Bolum ad="Özet" />

              <Kutular>{ozetKutulari}</Kutular>
            </>
          ) : null}

        </View>
      </ScrollView>

      <DogumGunu veri={kutlama} kapat={() => setKutlama(null)} />

      {belgeTalep ? (
        <MazeretBelgePenceresi
          talep={belgeTalep}
          turler={gorev?.belgeTurleri}
          kapat={() => setBelgeTalep(null)}
          tamam={() => {
            setBelgeTalep(null);
            gorevGetir();
          }}
        />
      ) : null}

      {rotasyon ? <RotasyonDetay talep={rotasyon} kapat={() => setRotasyon(null)} /> : null}

      {eksikKart ? (
        <EksikPenceresi
          kart={eksikKart}
          kapat={() => setEksikKart(null)}
          evrakAc={(b) => {
            setEksikKart(null);
            setBelgeTalep(b);
          }}
          tamam={() => {
            setEksikKart(null);
            gorevGetir();
          }}
        />
      ) : null}

      {anketAcik && gorev?.oryantasyon ? (
        <OryantasyonFormu
          mod="calisan"
          kod={gorev.oryantasyon.kod}
          asama={gorev.oryantasyon.asama}
          adSoyad={k.adSoyad}
          kapat={() => setAnketAcik(false)}
          tamam={() => {
            setAnketAcik(false);
            gorevGetir();
          }}
        />
      ) : null}

      {ekipGorev ? (
        <EkipGorevleri mod={ekipGorev} veri={gorev} kapat={() => setEkipGorev(null)} yenile={gorevGetir} />
      ) : null}
      {/* Vardiya hatırlatması: ekran hafifçe kararıyor, karekod öne
          çıkıyor. Kapatınca ana sayfada kalıyor, yönlendirme yok. */}
      <Modal visible={hatirlatmaAcik && acik("vardiya")} transparent animationType="fade">
        <View style={s.karartma}>
          <View style={s.hatirlatmaKutu}>
            <TouchableOpacity
              style={s.hatirlatmaQr}
              activeOpacity={0.85}
              onPress={() => {
                setHatirlatmaAcik(false);
                navigation.navigate("Vardiya");
              }}
            >
              <Simge ad="kare" boyut={54} renkli={renk.beyaz} />
            </TouchableOpacity>

            <Text style={s.hatirlatmaBaslik}>Vardiya girişiniz yapılmadı</Text>

            <Text style={s.hatirlatmaYazi}>
              Karekoda dokunarak mağazadaki kodu okutabilir, girişinizi
              hemen yapabilirsiniz.
            </Text>

            <TouchableOpacity
              style={s.hatirlatmaTamam}
              onPress={() => setHatirlatmaAcik(false)}
            >
              <Text style={s.hatirlatmaTamamYazi}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hukukKart: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#14213d", borderRadius: 16, padding: 14, marginTop: 4 },
  hukukIkon: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#ffffff14", alignItems: "center", justifyContent: "center" },
  /* ------------------------------------------------------------ tepe */
  tepe: {
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
  },
  tepeSatir: { flexDirection: "row", alignItems: "center", gap: 10 },
  selam: { fontSize: 17, fontWeight: "800", color: renk.beyaz, letterSpacing: -0.3 },
  tepeAlt: { fontSize: 11.5, color: "rgba(255,255,255,.8)", marginTop: 2 },

  zil: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  zilYeni: {
    backgroundColor: "#ffd43b",
    shadowColor: "#ffd43b",
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  zilRozet: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: renk.turuncu,
    borderWidth: 2,
    borderColor: renk.yesilKoyu,
    alignItems: "center",
    justifyContent: "center",
  },
  zilRozetYazi: { fontSize: 9.5, fontWeight: "800", color: renk.beyaz },

  /* ------------------------------------------------- vardiya düğmesi */
  vDugme: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: renk.turuncu,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 12,
  },
  vDugmeAcik: { backgroundColor: "rgba(255,255,255,.2)" },
  vDugmeYazi: { fontSize: 12, fontWeight: "800", color: renk.beyaz },

  duyuruKart: {
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: renk.cizgi,
    overflow: "hidden",
  },
  duyuruGorsel: { width: "100%", height: 140, backgroundColor: renk.zemin },
  duyuruGovde: { padding: 13 },
  duyuruYeni: { width: 8, height: 8, borderRadius: 4, backgroundColor: renk.turuncu },
  duyuruBaslik: { flex: 1, fontSize: 15, fontWeight: "800", color: renk.metin },
  duyuruMetin: { fontSize: 12.5, color: renk.pasif, marginTop: 4, lineHeight: 18 },
  duyuruAlt: { fontSize: 11.5, color: renk.yesilKoyu, fontWeight: "700", marginTop: 8 },

  vSerit: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },

  /* Nefesin halkası: düğmenin arkasında büyüyüp sönen turuncu daire.
     Konumu mutlak, yerleşimi etkilemiyor — akışta yer kaplasaydı her
     karede şerit yeniden ölçülürdü. */
  vHale: {
    position: "absolute",
    width: 74,
    height: 62,
    borderRadius: 20,
    backgroundColor: renk.turuncu,
  },
  vDugmeAcik: { backgroundColor: "rgba(255,255,255,.24)" },
  vDugmeYazi: { fontSize: 11.5, fontWeight: "800", color: renk.beyaz },

  /* ------------------------------------------- giriş / çıkış şeridi */
  gc: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.28)",
    borderRadius: 18,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
    gap: 10,
  },
  gcSaat: { flex: 1 },
  gcSaatIki: { borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,.3)", paddingLeft: 14 },
  gcEtiket: { fontSize: 11.5, color: "rgba(255,255,255,.85)" },
  gcDeger: { fontSize: 21, fontWeight: "800", color: renk.beyaz, letterSpacing: -0.2, fontVariant: ["tabular-nums"] },
  gcBos: { opacity: 0.55 },
  gcQr: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  gcQrYazi: { fontSize: 14, fontWeight: "800", color: renk.yesilKoyu },
  gcHale: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, backgroundColor: renk.beyaz },

  /* ------------------------------------------------------ bölüm başlığı */
  bolum: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 10 },
  bolumAd: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.8 },
  bolumSay: {
    backgroundColor: renk.cizgi,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 8,
  },
  bolumSayYazi: { fontSize: 9.5, fontWeight: "700", color: "#6f776d" },
  bolumCizgi: { flex: 1, height: 1, backgroundColor: renk.cizgi },

  /* --------------------------------------------------------- gift kart */
  gift: {
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    paddingVertical: 15,
    paddingHorizontal: 18,
    shadowColor: "#8f2d08",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  giftEtiket: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,.8)",
    letterSpacing: 0.5,
  },
  giftBakiye: {
    fontSize: 26,
    fontWeight: "800",
    color: renk.beyaz,
    letterSpacing: -0.8,
    marginTop: 3,
  },
  giftOde: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,

    /* Şerit artık turuncu: düğme de turuncu kalsaydı zeminde
       kaybolurdu. */
    backgroundColor: "rgba(0,0,0,.22)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  giftOdeYazi: { fontSize: 13, fontWeight: "800", color: renk.beyaz },
  giftNot: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 13,
  },
  giftNotYazi: { fontSize: 12, color: renk.pasif, lineHeight: 17 },

  /* ------------------------------------------------------- bekleyenler */
  bek: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 16,
    padding: 13,
  },
  bekAcil: { borderColor: "#f3b9a5", backgroundColor: "#fffaf7" },
  yonAcil: { borderColor: "#b7c7e0", backgroundColor: "#f7faff" },
  yonRozet: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: renk.turuncu,
    borderWidth: 2,
    borderColor: renk.beyaz,
    alignItems: "center",
    justifyContent: "center",
  },
  yonRozetYazi: { fontSize: 10.5, fontWeight: "800", color: renk.beyaz },
  bekIkon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  bekAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  bekAlt: { fontSize: 11, color: renk.pasif, marginTop: 2 },
  bekRozet: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  bekRozetYazi: { fontSize: 12, fontWeight: "800", color: renk.beyaz },

  /* --------------------------------------------------------- kısayollar */
  kisaSerit: { flexDirection: "row", gap: 9 },
  kisa: {
    flex: 1,
    gap: 8,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 17,
    paddingVertical: 13,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  kisaKutu: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  kisaAd: { fontSize: 10, fontWeight: "700", color: "#4a534a" },


  /* Karekod düğmesi: kartın içine sığacak ama küçük kalmayacak boyutta.
     Marka turuncusu, çevresindeki yeşil zeminde en çok ayrılan renk. */
  karartma: {
    flex: 1,
    backgroundColor: "rgba(20,24,18,.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  hatirlatmaKutu: {
    backgroundColor: renk.beyaz,
    borderRadius: 22,
    padding: 26,
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  hatirlatmaQr: {
    width: 116,
    height: 116,
    borderRadius: 26,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  hatirlatmaBaslik: {
    fontSize: 17,
    fontWeight: "800",
    color: renk.metin,
    textAlign: "center",
  },
  hatirlatmaYazi: {
    fontSize: 13.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 19,
  },
  hatirlatmaTamam: {
    marginTop: 20,
    paddingVertical: 11,
    paddingHorizontal: 40,
    borderRadius: 12,
    backgroundColor: renk.zemin,
  },
  hatirlatmaTamamYazi: { fontSize: 14.5, fontWeight: "700", color: renk.metin },

  qrDugme: {
    backgroundColor: renk.turuncu,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minWidth: 76,
  },
  qrYazi: { fontSize: 12.5, fontWeight: "800", color: renk.beyaz },

  arizaSatir: { flexDirection: "row", alignItems: "center", gap: 10 },
  arizaBaslik: { fontSize: 14, fontWeight: "600", color: renk.metin },
  arizaAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },
  durumRozet: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  durumYazi: { fontSize: 11.5, fontWeight: "700", color: renk.metin },

  raporKisayol: {
    backgroundColor: renk.yesilKoyu,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  raporKisayolYazi: { fontSize: 15, fontWeight: "800", color: renk.beyaz },
  raporKisayolAlt: { fontSize: 12.5, color: "rgba(255,255,255,.8)", marginTop: 2 },

  tam: { flex: 1, backgroundColor: renk.zemin },

  bar: {
    backgroundColor: renk.yesil,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
  },

  profil: { flexDirection: "row", alignItems: "center", gap: 13 },

  foto: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,.5)",
    backgroundColor: "rgba(255,255,255,.22)",
  },

  fotoYok: { alignItems: "center", justifyContent: "center", overflow: "hidden" },

  fotoUst: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 32,
  },

  basHarf: { fontSize: 21, fontWeight: "800", color: "#fff" },

  ad: { fontSize: 18, fontWeight: "700", color: "#fff" },

  altBilgi: { fontSize: 12.5, color: "rgba(255,255,255,.86)", marginTop: 1 },

  cikisDugme: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.55)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },

  cikisYazi: { color: "#fff", fontSize: 12.5, fontWeight: "600" },

  /* Alt boşluk: yüzen menü içeriğin üstüne binmesin */
  govde: { padding: 14, paddingBottom: 110 },

  kartBaslik: {
    fontSize: 12,
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  vardiyaSatir: { flexDirection: "row", alignItems: "center", gap: 12 },

  vardiyaDurum: {
    fontSize: 16,
    fontWeight: "700",
    color: renk.metin,
    marginTop: 3,
  },

  vardiyaAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },

  vardiyaDugme: {
    backgroundColor: renk.siyah,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },

  vardiyaDugmeYazi: { color: "#fff", fontSize: 13.5, fontWeight: "700" },

  duyuruBaslik: {
    fontSize: 14.5,
    fontWeight: "700",
    color: renk.metin,
    marginTop: 2,
  },

  duyuruMetin: {
    fontSize: 13,
    color: renk.pasif,
    lineHeight: 20,
    marginTop: 5,
  },

  bos: { fontSize: 13, color: renk.pasif },
});

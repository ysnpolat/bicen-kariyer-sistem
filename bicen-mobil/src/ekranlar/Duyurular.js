/**
 * Duyurular
 * ---------------------------------------------------------------------------
 * Panelden gönderilen duyurular ve kişiye özel bilgilendirmeler.
 *
 * <p>
 * Her duyuru bir kart: üstte kapak görseli, altında tek satır başlık, tam
 * tarih ve "Detayı gör". Okunmuş kartlar gri zeminli ve sağ altta çift tik
 * taşıyor; okunmamışlar beyaz ve öne çıkıyor. Eski düzende metin kartın
 * içinde dört satır olarak duruyordu ve liste uzadıkça duyurular birbirine
 * karışıyordu — görsel ve başlık, duyuruyu tanımanın en hızlı yolu.
 * </p>
 *
 * <p>
 * Görseli olmayan duyurularda marka renginde bir yer tutucu çiziliyor:
 * kartların bir kısmı görselli bir kısmı düz olunca liste düzensiz
 * görünüyordu.
 * </p>
 *
 * <p>
 * Kişisel bildirim (izin onayı gibi) ile genel duyuru ayrı işaretleniyor.
 * Karıştırılırsa kişisel bilgi genel duyuru sanılıp gözden kaçıyor.
 * </p>
 */

import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Image,
  Linking,
  TextInput,
  Share,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran, useModalBosluk } from "../bilesenler/ModalAlani";
import { useFocusEffect } from "@react-navigation/native";

import Svg, { Circle, Path } from "react-native-svg";

import { api, duyuruAl, duyuruGorselAdresi, logoAdresi } from "../api";
import KART_LOGO from "../../assets/kart-logo.png";
import { renk } from "../tema";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import YardimDugmesi from "../bilesenler/YardimDugmesi";

/* Dosya sistemi: SDK 54 sonrası eski API "legacy" altında (api.js ile aynı) */
let FileSystem;
try {
  FileSystem = require("expo-file-system/legacy");
} catch {
  FileSystem = require("expo-file-system");
}

/* -------------------------------------------------------------------------- */

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const GUNLER = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/**
 * "22 Haziran 2026/Pzt  18:39"
 *
 * Tarih yoksa (eski sunucu) göreli yazıya düşülüyor.
 */
const tarihYaz = (d) => {
  if (d?.olusturma) {
    const t = new Date(d.olusturma);

    if (!Number.isNaN(t.getTime())) {
      const iki = (x) => String(x).padStart(2, "0");

      return `${t.getDate()} ${AYLAR[t.getMonth()]} ${t.getFullYear()}/${
        GUNLER[t.getDay()]
      }  ${iki(t.getHours())}:${iki(t.getMinutes())}`;
    }
  }

  const g = d?.gecenGun ?? 0;

  return g === 0 ? "bugün" : g === 1 ? "dün" : `${g} gün önce`;
};

/* ------------------------------------------------------------ simgeler */

function AraSimge({ renkli = renk.metin, boyut = 26 }) {
  return (
    <Svg width={boyut} height={boyut} viewBox="0 0 24 24">
      <Circle cx="10.5" cy="10.5" r="6.5" stroke={renkli} strokeWidth="1.9" fill="none" />
      <Path d="M15.5 15.5 L20.5 20.5" stroke={renkli} strokeWidth="1.9" strokeLinecap="round" />
    </Svg>
  );
}

/** Okundu işareti: çift tik. */
function CiftTik({ renkli = renk.yesilKoyu, boyut = 26 }) {
  return (
    <Svg width={boyut} height={boyut * 0.72} viewBox="0 0 28 20">
      <Path
        d="M1.5 10.5 L7 16 L18 4"
        stroke={renkli}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M10 14 L12 16 L26.5 1.5"
        stroke={renkli}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function OkSimge({ renkli = renk.metin }) {
  return (
    <Svg width={20} height={14} viewBox="0 0 20 14">
      <Path
        d="M1 7 H18 M12 1 L18 7 L12 13"
        stroke={renkli}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/* --------------------------------------------------------------- video */

/**
 * Duyuru videosu (13.10.2026, uygulama 1.7).
 *
 * <p>
 * İK panelinden yüklenen video duyurunun "Bağlantı" alanına izleme sayfası
 * olarak yazılıyor (/api/DuyuruVideo/Izle/{anahtar}). 1.6 bu bağlantıyı
 * tarayıcıda açıyor; 1.7 aynı anahtarla dosyayı alıp videoyu görselin
 * yerinde, uygulamanın içinde oynatıyor. Sunucuda değişiklik gerekmiyor.
 * </p>
 */
const VIDEO_DESENI = /\/api\/DuyuruVideo\/Izle\/([0-9a-f]{32})/i;
const duyuruVideo = (d) => {
  const m = String(d?.baglanti ?? "").match(VIDEO_DESENI);
  return m ? `${api.adres}/api/DuyuruVideo/Dosya/${m[1].toLowerCase()}` : null;
};

/* Oynatıcı: expo-video; derlemede yoksa video tarayıcıda açılır */
let ExpoVideo = null;
try {
  // eslint-disable-next-line global-require
  ExpoVideo = require("expo-video");
  if (!ExpoVideo?.VideoView || !ExpoVideo?.useVideoPlayer) ExpoVideo = null;
} catch {
  ExpoVideo = null;
}

/**
 * Duyuru videosu (28.10.2026, 1.10).
 *
 * <p>
 * Kart görsel gibi görünür: videonun ilk karesi (ya da duyurunun görseli)
 * ve ortada oynat düğmesi. Dokununca aynı yerde, sesli oynar; telefonun
 * kendi denetimleri açılır (durdur, sar, tam ekran). Tam ekrandan geri
 * tuşu ya da kapat düğmesiyle çıkılır. Eski oynatıcıda denetimler kapalı
 * olduğu için tam ekrandan çıkılamıyordu.
 * </p>
 */
function DuyuruVideoKutusu({ d, durdur }) {
  const [basladi, setBasladi] = useState(false);
  const uri = duyuruVideo(d);

  if (!ExpoVideo) {
    return (
      <TouchableOpacity activeOpacity={0.88} onPress={() => Linking.openURL(uri).catch(() => undefined)}>
        <VideoKapak d={d} />
      </TouchableOpacity>
    );
  }

  return <VideoOynatici d={d} uri={uri} basladi={basladi} setBasladi={setBasladi} durdur={durdur} />;
}

function VideoKapak({ d, yukleniyor }) {
  const gorselVar = d.gorselVar === 1;
  return (
    <View style={[s.kapak, { aspectRatio: 16 / 9, overflow: "hidden", backgroundColor: "#10241a" }]}>
      {gorselVar ? (
        <Image source={{ uri: duyuruGorselAdresi(d.id) }} style={s.kapakGorsel} resizeMode="cover" />
      ) : null}
      <View style={s.videoOrta} pointerEvents="none">
        <View style={s.videoDaire}>
          {yukleniyor ? <ActivityIndicator color="#fff" /> : <Text style={s.videoOk}>▶</Text>}
        </View>
      </View>
    </View>
  );
}

function VideoOynatici({ d, uri, basladi, setBasladi, durdur }) {
  const oynatici = ExpoVideo.useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
  });
  const [hazir, setHazir] = useState(false);
  const [oran, setOran] = useState(16 / 9);

  useEffect(() => {
    const abonelikler = [];
    try {
      abonelikler.push(
        oynatici.addListener?.("statusChange", (o) => {
          if (o?.status === "readyToPlay") setHazir(true);
        })
      );
      abonelikler.push(
        oynatici.addListener?.("videoTrackChange", (o) => {
          const b = o?.videoTrack?.size;
          if (b?.width > 0 && b?.height > 0) setOran(Math.min(1.91, Math.max(0.56, b.width / b.height)));
        })
      );
    } catch {
      /* eski sürüm: olaylar yok */
    }
    return () => abonelikler.forEach((a) => a?.remove?.());
  }, [oynatici]);

  /* Ayrıntı penceresi açılınca listedeki video durur */
  useEffect(() => {
    if (durdur && basladi) {
      try {
        oynatici.pause();
      } catch {
        /* yok sayılır */
      }
    }
  }, [durdur, basladi, oynatici]);

  const oynat = () => {
    setBasladi(true);
    try {
      oynatici.muted = false;
      oynatici.play();
    } catch {
      Linking.openURL(uri).catch(() => undefined);
    }
  };

  return (
    <View style={[s.kapak, { aspectRatio: basladi ? oran : 16 / 9, overflow: "hidden", backgroundColor: "#000" }]}>
      <ExpoVideo.VideoView
        player={oynatici}
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
        nativeControls={basladi}
        allowsFullscreen
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
      />
      {!basladi ? (
        <TouchableOpacity activeOpacity={0.9} onPress={oynat} style={StyleSheet.absoluteFill}>
          {d.gorselVar === 1 ? (
            <VideoKapak d={d} yukleniyor={false} />
          ) : (
            <View style={s.videoOrta} pointerEvents="none">
              <View style={s.videoDaire}>
                <Text style={s.videoOk}>▶</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>
      ) : !hazir ? (
        <View style={s.videoOrta} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- kapak */

/**
 * Kapak görseli ya da logo.
 *
 * <p>
 * Görsel varsa kendi en-boy oranıyla gösteriliyor: sabit yükseklikte
 * "cover" ile afişlerin kenarları kesiliyor, yazılı görseller okunmuyordu.
 * Oran okunamazsa 16:9. Çok uzun ya da çok geniş görsellerde oran
 * sınırlanıyor ki kart ekranı kaplamasın; o zaman yalnızca kenarlar
 * kırpılıyor. Görsel kapak kutusunu hiçbir durumda taşırmıyor.
 * </p>
 *
 * <p>
 * Görsel yoksa ya da yüklenemezse kurumsal logo, açık zeminde ortalı.
 * Eskiden "biçen" yazısı düz metin olarak yazılıyor ve yanında bir zil
 * simgesi duruyordu. Logo sunucudan geliyor; ağ yoksa uygulamadaki logo
 * marka yeşiline boyanıyor.
 * </p>
 */
function Kapak({ d, yukseklik = 200, ac }) {
  const [bozuk, setBozuk] = useState(false);
  const [oran, setOran] = useState(null);
  const [logoBozuk, setLogoBozuk] = useState(false);

  const gorselVar = d.gorselVar === 1 && !bozuk;
  const uri = duyuruGorselAdresi(d.id);

  useEffect(() => {
    if (d.gorselVar !== 1) return;

    let iptal = false;

    Image.getSize(
      uri,
      (en, boy) => !iptal && boy > 0 && setOran(en / boy),
      () => !iptal && setOran(null)
    );

    return () => {
      iptal = true;
    };
  }, [uri, d.gorselVar]);

  if (gorselVar) {
    /* Liste kartında 0,8 (dikey afiş) ile 2,4 (geniş bant) arası;
       ayrıntıda dikey görsel biraz daha uzun olabiliyor. */
    const enAz = yukseklik > 200 ? 0.66 : 0.8;
    const r = oran ? Math.min(Math.max(oran, enAz), 2.4) : 16 / 9;

    const gorsel = (
      <View style={[s.kapak, { aspectRatio: r, overflow: "hidden" }]}>
        <Image
          source={{ uri }}
          style={s.kapakGorsel}
          resizeMode="cover"
          onError={() => setBozuk(true)}
        />
      </View>
    );

    /* Dokununca tam ekran: yakınlaştırma ve indirme */
    return ac ? (
      <TouchableOpacity activeOpacity={0.9} onPress={() => ac(uri, d)}>
        {gorsel}
      </TouchableOpacity>
    ) : (
      gorsel
    );
  }

  const kisisel = !!d.kisisel;

  return (
    <View
      style={[
        s.kapak,
        s.yerTutucu,
        { height: Math.round(yukseklik * 0.8) },
        kisisel && { backgroundColor: "#eef3f9" },
      ]}
    >
      {logoBozuk ? (
        <Image
          source={KART_LOGO}
          style={s.logo}
          resizeMode="contain"
          tintColor={kisisel ? renk.mavi : renk.yesilKoyu}
        />
      ) : (
        <Image
          source={{ uri: logoAdresi() }}
          style={s.logo}
          resizeMode="contain"
          onError={() => setLogoBozuk(true)}
        />
      )}
    </View>
  );
}

/* --------------------------------------------------------- görüntüleyici */

/**
 * Tam ekran görsel: yakınlaştırılabilir, indirilebilir.
 *
 * İndirme uygulamanın içindeki paketlerle: görsel önbelleğe iniyor, iPhone'da
 * paylaşım menüsü açılıyor ("Görüntüyü Kaydet" orada). Android'in paylaşım
 * menüsü dosya kabul etmediği için görsel tarayıcıda açılıyor; oradan
 * indiriliyor. Doğrudan galeriye kaydetmek yeni bir mağaza sürümü
 * (expo-media-library) gerektiriyor.
 */
/**
 * Gösterici üst şeridi (✕ ve İndir). Boşluk pencerenin kendisinden
 * ölçülüyor: uygulama kökündeki ölçüm bazı Android telefonlarda 0
 * geliyor, düğmeler durum çubuğunun altında kalıyordu.
 */
function GostericiUst({ children }) {
  const b = useModalBosluk();

  return (
    <View style={[s.gostericiUst, { paddingTop: 8 + b.top, paddingLeft: 16 + b.left, paddingRight: 16 + b.right }]}>
      {children}
    </View>
  );
}

function GorselGosterici({ uri, baslik, kapat }) {
  const [indiriliyor, setIndiriliyor] = useState(false);
  const { width, height } = Dimensions.get("window");

  const indir = async () => {
    if (Platform.OS !== "ios") {
      Linking.openURL(uri);
      return;
    }

    setIndiriliyor(true);

    try {
      const ad = `duyuru-${Date.now()}.jpg`;
      const hedef = `${FileSystem.cacheDirectory}${ad}`;
      const sonuc = await FileSystem.downloadAsync(uri, hedef);

      await Share.share({ url: sonuc.uri, title: baslik ?? "Duyuru görseli" });
    } catch (h) {
      Alert.alert("İndirilemedi", h?.message ?? "Görsel indirilemedi.");
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={kapat} {...modalTamEkran}>
      <SafeAreaProvider>
      <View style={s.gosterici}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ width, height, alignItems: "center", justifyContent: "center" }}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image source={{ uri }} style={{ width, height: height * 0.8 }} resizeMode="contain" />
        </ScrollView>

        <GostericiUst>
          <TouchableOpacity style={s.gostericiDugme} onPress={kapat} hitSlop={10}>
            <Text style={s.gostericiYazi}>✕</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.gostericiDugme, s.gostericiIndir]} onPress={indir} disabled={indiriliyor}>
            {indiriliyor ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.gostericiIndirYazi}>İndir</Text>
            )}
          </TouchableOpacity>
        </GostericiUst>
      </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/* ========================================================================== */

export default function Duyurular() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [acik, setAcik] = useState(null);
  const [gosterilen, setGosterilen] = useState(null);

  const [araAcik, setAraAcik] = useState(false);
  const [ara, setAra] = useState("");

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      setVeri(await duyuruAl());
      setHata("");
    } catch (h) {
      setHata(h.message);
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();

      /* Sekme açıkken düzenli tazelenir. Anlık bildirim yalnızca
         derlenmiş uygulamada çalışıyor; uygulama açıkken yeni duyuruyu
         görmek için yenilemeye zorlamak iyi bir deneyim değil. */
      const zamanlayici = setInterval(() => getir(), 30000);

      return () => clearInterval(zamanlayici);
    }, [getir])
  );

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  const q = ara.trim().toLocaleLowerCase("tr");

  const liste = (veri?.kayitlar ?? []).filter(
    (d) =>
      !q ||
      `${d.baslik ?? ""} ${d.metin ?? ""}`.toLocaleLowerCase("tr").includes(q)
  );

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      {/* ------------------------------------------------------ başlık */}
      <View style={s.bar}>
        {/* Sol köşe boştu: yardım çiçeği burada, arama düğmesiyle dengeli */}
        <View style={[s.barYan, { alignItems: "flex-start", justifyContent: "center" }]}>
          <YardimDugmesi kod="Duyurular" ad="Duyurular" />
        </View>

        {araAcik ? (
          <TextInput
            style={s.araGirdi}
            value={ara}
            onChangeText={setAra}
            placeholder="Duyurularda ara"
            placeholderTextColor="#a3a9a0"
            autoFocus
            returnKeyType="search"
          />
        ) : (
          <Text style={s.barBaslik}>Duyurular</Text>
        )}

        <TouchableOpacity
          style={s.barYan}
          hitSlop={12}
          onPress={() => {
            /* Kapatınca arama da temizleniyor: kapalı aramanın listeyi
               süzmeye devam etmesi duyuruların kaybolduğu izlenimi
               veriyordu. */
            if (araAcik) setAra("");
            setAraAcik(!araAcik);
          }}
        >
          {araAcik ? (
            <Text style={s.araKapat}>Vazgeç</Text>
          ) : (
            <AraSimge />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.govde}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
          />
        }
      >
        {liste.length === 0 ? (
          <View style={s.bos}>
            <Simge ad="zil" boyut={40} renkli="#c8cec4" />
            <Text style={s.bosYazi}>
              {q ? "Aramanıza uyan duyuru yok." : "Henüz duyuru bulunmuyor."}
            </Text>
          </View>
        ) : (
          liste.map((d) => {
            const okundu = !!d.okundu;

            return (
              <TouchableOpacity
                key={d.id}
                activeOpacity={0.88}
                onPress={() => setAcik(d)}
                style={[s.kart, okundu && s.kartOkundu]}
              >
                {duyuruVideo(d) ? (
                  <DuyuruVideoKutusu d={d} durdur={!!acik} />
                ) : (
                  <Kapak d={d} ac={(u, x) => setGosterilen({ uri: u, baslik: x.baslik })} />
                )}

                {/* Kişisel ve önemli işaretleri başlığın üstünde küçük
                    etiket: kapak görselinin üstüne binerse görsel
                    okunmuyordu. */}
                {(d.kisisel || d.onemli) && (
                  <View style={s.etiketler}>
                    {d.kisisel ? (
                      <View style={[s.etiket, { backgroundColor: "#e8eff7" }]}>
                        <Text style={[s.etiketYazi, { color: renk.mavi }]}>
                          KİŞİSEL
                        </Text>
                      </View>
                    ) : null}

                    {d.onemli ? (
                      <View style={[s.etiket, { backgroundColor: renk.turuncuAcik }]}>
                        <Text style={[s.etiketYazi, { color: renk.turuncu }]}>
                          ÖNEMLİ
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}

                <Text style={s.baslik} numberOfLines={1}>
                  {d.baslik}
                </Text>

                <Text style={s.tarih}>
                  {tarihYaz(d)}
                  {d.yazanAd ? `  ·  ${d.yazanAd}` : ""}
                </Text>

                <View style={s.altSatir}>
                  <View style={s.detay}>
                    <Text style={s.detayYazi}>Detayı gör</Text>
                    <OkSimge />
                  </View>

                  {/* Çift tik: daha önce görülmüş duyuru. Okunmamış
                      kartta işaret yok, beyaz zemin zaten öne
                      çıkarıyor. */}
                  {okundu ? <CiftTik /> : null}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* -------------------------------------------------- duyuru detayı */}
      <Modal
        {...modalTamEkran}
        visible={!!acik}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAcik(null)}
      >
        <ModalAlani style={[s.tam, { backgroundColor: renk.beyaz }]} edges={["top"]}>
          <View style={s.bar}>
            <View style={s.barYan} />

            <Text style={s.barBaslik}>Duyuru</Text>

            <TouchableOpacity
              style={s.barYan}
              hitSlop={12}
              onPress={() => setAcik(null)}
            >
              <Text style={s.araKapat}>Kapat</Text>
            </TouchableOpacity>
          </View>

          {acik && (
            <ScrollView contentContainerStyle={s.detayGovde}>
              {duyuruVideo(acik) ? (
                <View style={s.videoAlan}>
                  <DuyuruVideoKutusu d={acik} />
                </View>
              ) : null}

              {/* Video varken görsel yalnızca ayrıca eklendiyse, videonun altında */}
              {!duyuruVideo(acik) || acik.gorselVar === 1 ? (
                <Kapak
                  d={acik}
                  yukseklik={230}
                  ac={(u, x) => setGosterilen({ uri: u, baslik: x.baslik })}
                />
              ) : null}

              <View style={s.etiketler}>
                <View
                  style={[
                    s.etiket,
                    {
                      backgroundColor: acik.kisisel ? "#e8eff7" : renk.yesilAcik,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.etiketYazi,
                      { color: acik.kisisel ? renk.mavi : renk.yesilKoyu },
                    ]}
                  >
                    {acik.kisisel ? "KİŞİSEL" : "DUYURU"}
                  </Text>
                </View>

                {acik.onemli ? (
                  <View style={[s.etiket, { backgroundColor: renk.turuncuAcik }]}>
                    <Text style={[s.etiketYazi, { color: renk.turuncu }]}>ÖNEMLİ</Text>
                  </View>
                ) : null}
              </View>

              <Text style={s.detayBaslik}>{acik.baslik}</Text>

              <Text style={s.tarih}>{tarihYaz(acik)}</Text>

              <View style={s.cizgi} />

              <Text style={s.detayMetin}>{acik.metin}</Text>

              {/* İmza: duyuruyu yapanın kendi metni ya da adı ve ünvanı.
                  Kullanıcı adı tek başına personele bir şey söylemiyordu. */}
              {(acik.imza || acik.yazanAd) && (
                <View style={s.imza}>
                  {acik.imza ? (
                    <Text style={s.imzaMetin}>{acik.imza}</Text>
                  ) : (
                    <>
                      <Text style={s.imzaAd}>{acik.yazanAd}</Text>
                      {acik.yazanUnvan ? <Text style={s.imzaUnvan}>{acik.yazanUnvan}</Text> : null}
                    </>
                  )}
                </View>
              )}

              {acik.baglanti && !duyuruVideo(acik) ? (
                <TouchableOpacity
                  style={s.baglantiDugme}
                  activeOpacity={0.85}
                  onPress={() => Linking.openURL(acik.baglanti)}
                >
                  <Text style={s.baglantiYazi}>
                    {acik.baglantiYazi || "Bağlantıyı aç"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          )}
        </ModalAlani>

        {/* Ayrıntı penceresi açıkken görüntüleyici onun içinde: iOS bir
            pencere açıkken ikinci pencereyi ancak onun içinden gösteriyor */}
        {acik && gosterilen && (
          <GorselGosterici {...gosterilen} kapat={() => setGosterilen(null)} />
        )}
      </Modal>

      {!acik && gosterilen && (
        <GorselGosterici {...gosterilen} kapat={() => setGosterilen(null)} />
      )}
    </SafeAreaView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.beyaz },

  /* ------------------------------------------------------------- başlık */
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: "#e4e6e2",
    backgroundColor: renk.beyaz,
  },
  barYan: { width: 60, alignItems: "flex-end", justifyContent: "center" },
  barBaslik: {
    fontSize: 21,
    fontWeight: "600",
    color: renk.metin,
    letterSpacing: -0.2,
  },
  araGirdi: {
    flex: 1,
    backgroundColor: "#f2f3f0",
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 9,
    fontSize: 15,
    color: renk.metin,
  },
  araKapat: { fontSize: 14, fontWeight: "700", color: renk.yesilKoyu },

  /* Alt boşluk: yüzen menü içeriğin üstüne binmesin */
  govde: { padding: 16, paddingBottom: 120, gap: 18 },

  /* -------------------------------------------------------------- kart */
  kart: {
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e3e5e1",
    padding: 11,
    paddingBottom: 14,
  },
  kartOkundu: { backgroundColor: "#f1f2f0" },

  kapak: {
    width: "100%",
    borderRadius: 13,
    backgroundColor: "#eef0ec",
  },
  kapakGorsel: { width: "100%", height: "100%" },

  imza: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },
  imzaMetin: { fontSize: 13.5, color: renk.metin, lineHeight: 20 },
  imzaAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  imzaUnvan: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },

  gosterici: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)" },
  gostericiUst: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  gostericiDugme: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  gostericiYazi: { color: "#fff", fontSize: 18, fontWeight: "700" },
  gostericiIndir: { paddingHorizontal: 18, backgroundColor: renk.yesilKoyu },
  gostericiIndirYazi: { color: "#fff", fontSize: 14, fontWeight: "800" },
  yerTutucu: {
    backgroundColor: "#f1f5ec",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: "52%", height: "46%" },

  etiketler: { flexDirection: "row", gap: 6, marginTop: 12 },
  etiket: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  etiketYazi: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },

  baslik: {
    fontSize: 19,
    fontWeight: "600",
    color: renk.metin,
    marginTop: 12,
    letterSpacing: -0.2,
  },
  tarih: { fontSize: 14, color: "#a0a59d", marginTop: 5 },

  altSatir: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  detay: { flexDirection: "row", alignItems: "center", gap: 10 },
  detayYazi: { fontSize: 15, color: renk.metin, fontWeight: "500" },

  bos: { alignItems: "center", paddingVertical: 60, gap: 12 },
  bosYazi: { fontSize: 14, color: renk.pasif },

  /* ------------------------------------------------------------- detay */
  detayGovde: { padding: 16, paddingBottom: 60 },

  /* ------------------------------------------------------------- video */
  videoOrta: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 8 },
  videoDaire: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
  },
  videoOk: { color: "#fff", fontSize: 24, marginLeft: 4 },
  videoYazi: { color: "#fff", fontWeight: "800", fontSize: 14, letterSpacing: 0.3 },
  videoAlan: { marginBottom: 14, borderRadius: 13, overflow: "hidden" },
  videoIpucu: { color: "#8a9187", fontSize: 12, marginTop: 6, textAlign: "center" },
  detayBaslik: {
    fontSize: 22,
    fontWeight: "800",
    color: renk.metin,
    marginTop: 10,
    lineHeight: 29,
    letterSpacing: -0.3,
  },
  cizgi: { height: 1, backgroundColor: "#e8eae6", marginVertical: 16 },
  detayMetin: { fontSize: 15.5, color: renk.metin, lineHeight: 25 },

  baglantiDugme: {
    backgroundColor: renk.yesilKoyu,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 22,
  },
  baglantiYazi: { color: renk.beyaz, fontSize: 15, fontWeight: "800" },
});

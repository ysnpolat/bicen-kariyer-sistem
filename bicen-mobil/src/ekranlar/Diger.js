/**
 * Diğer
 * ---------------------------------------------------------------------------
 * Alt menüye sığmayan modüller ve hesap işlemleri.
 *
 * Hangi modüllerin görüneceğini pozisyon belirler: panelden her modül
 * için hangi görevlerin göreceği ayarlanır. Kişi bazlı yetki, personel
 * değiştikçe bakımı imkânsız hâle geliyor.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { api, modullerimAl, ozetAl, islerimAl, oturumKapat, yoneticiBekleyenSayisi } from "../api";
import { gorunumYaz } from "../gorunum";
import { moduller360Al } from "../api360";
import { renk } from "../tema";
import { Yukleniyor } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import SimgeKutu from "../bilesenler/SimgeKutu";
import { bildirimDurumu } from "../bildirim";
import Constants from "expo-constants";

/** Modül kodu → uygulama içindeki ekran adı */
export const EKRANLAR = {
  vardiya: "Vardiya",
  izin: "Izin",
  performans: "Performans",
  prim: "Prim",
  duyuru: "Duyurular",
  isemri: "Isler",
  checklist: "Checklist",
  kunye: "Kunye",
  ariza: "Ariza",
  rakipfiyat: "RakipFiyat",
  etik: "EtikHat",
  fiyatkontrol: "FiyatKontrol",
  envanter: "Envanter",
  rapor: "Raporlar",
  izinonay: "IzinOnay",
  puantaj: "Puantaj",
  vardiyaplani: "VardiyaPlani",
  ekibim: "Ekibim",
  avans: "Avans",
  /* 1.7: alt menüde değilse Diğer'den açılsın */
  haberler: "Haberler",
  /* 1.8: Kazan-Kazan (yeni ürün önerisi) */
  kazankazan: "KazanKazan",
  ekipdegerlendirme: "EkipDegerlendirme",
  /* 1.9 */
  mesajlar: "Mesajlar",
  devamsizlik: "Devamsizlik",
  skt: "Skt",
};

export default function Diger({ navigation }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [fotoHatasi, setFotoHatasi] = useState(false);
  const [hata, setHata] = useState("");

  /* İşlerim satırındaki rozet için bekleyen iş sayısı */
  const [isSayisi, setIsSayisi] = useState(0);

  /* Yönetici İşlemleri satırındaki rozet: onay bekleyen talep sayısı */
  const [onaySayisi, setOnaySayisi] = useState(0);

  /* Portal sunucusuna ulaşılamadığında gösterilecek not. Ekranda
     "Biçen360" denmiyor: uygulamanın adı da bu ve kullanıcıya uygulamanın
     kendisi açılmamış gibi geliyor. */
  const [b360Hatasi, setB360Hatasi] = useState("");

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      /* Modüller iki sunucudan geliyor: İK tarafı Kariyer API'den,
         Biçen360 modülleri yeni panelden. Biçen360'a ulaşılamazsa
         uygulama açılmaya devam etmeli — yalnızca o modüller görünmez.
         Hata gibi göstermek, çalışan İK modüllerini de kullanılamaz
         hâle getirirdi. */
      const [ik, b360] = await Promise.all([
        modullerimAl(),
        moduller360Al().catch((e) => ({ moduller: [], hata: e?.message })),
      ]);

      /* Iki katalogda ayni kod bulunabiliyor: kunye ve checklist su an
         hem Kariyer hem Bicen360 tarafinda tanimli. Tekrarlar ayiklanmazsa
         menude ayni modul iki kez cikiyor ve React "ayni anahtar" uyarisi
         veriyor. Kariyer tarafindaki kayit korunuyor; o modullerin ekrani
         hala oradan besleniyor. */
      const birlesik = [];
      const gorulen = new Set();

      for (const m of [...(ik?.moduller ?? []), ...(b360?.moduller ?? [])]) {
        if (!m?.kod || gorulen.has(m.kod)) continue;

        gorulen.add(m.kod);
        birlesik.push(m);
      }

      setVeri({ ...ik, moduller: birlesik });

      /* Biçen360'a ulaşılamazsa uygulama açılmaya devam eder ama modüller
         sessizce kaybolmamalı: menüde olmayan bir şeyin neden olmadığını
         anlamak, hiçbir şey yazmayan bir ekranda imkânsızdı. */
      setB360Hatasi(b360?.hata ?? "");

      setHata("");

      islerimAl()
        .then((d) => setIsSayisi(d?.acikSayi ?? 0))
        .catch(() => undefined);

      if (birlesik.some((m) => m.kod === "izinonay"))
        yoneticiBekleyenSayisi()
          .then((d) => setOnaySayisi(d?.toplam ?? 0))
          .catch(() => undefined);
    } catch (e) {
      /* Modül listesi alınamadı. Sebebi ekranda yazılır: sessizce boş
         kalan ekran, sorunun sunucuda mı ağda mı olduğunu gizliyordu. */
      setHata(e?.message ?? "Modül listesi alınamadı.");

      /* Künye ayrı bir uçtan doldurulur; ad ve görev, modüller
         gelmese de doğru görünsün. */
      try {
        const ozet = await ozetAl();

        setVeri((onceki) =>
          onceki ?? {
            moduller: [],
            altMenu: [],
            kisi: ozet?.kisi ?? {},
            gorev: ozet?.kisi?.gorev ?? null,
          }
        );
      } catch {
        /* Bu da alınamazsa künye boş kalır; hata şeridi zaten görünür. */
      }
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const cikisSor = () => {
    Alert.alert(
      "Çıkış yapılsın mı?",
      "Yeniden giriş için kimlik numaranız ve SMS doğrulaması gerekecek.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Çıkış yap",
          style: "destructive",
          onPress: async () => {
            await oturumKapat();

            navigation.getParent()?.reset({
              index: 0,
              routes: [{ name: "Giris" }],
            });
          },
        },
      ]
    );
  };

  if (yukleniyor) return <Yukleniyor />;

  /* Alt menüde olmayan modüller burada listelenir: aynı şeyi iki yerde
     göstermek gereksiz yer kaplıyor. */
  const altMenu = veri?.altMenu ?? [];

  /* Sunucudan gelmeyen ama uygulamada bulunan modüller.

     Etik hat her personelde görünüyor: bildirimin önündeki en büyük engel
     nereye başvurulacağının bilinmemesi. Kaydı yalnızca yetkili roller ve
     bildiren görüyor. */
  /* Etik hat artık sunucudan, yetkiye bağlı geliyor: portaldan
     gizlenebilsin diye. Varsayılan olarak herkese açık. */
  const yerelModuller = [];

  const sunucudan = (veri?.moduller ?? []).filter(
    (m) => !altMenu.includes(m.kod)
  );

  /* Sunucudan gelen modüller önce; yerel liste yalnızca sunucuda olmayan
     kodları ekliyor. Aynı modül iki kez eklenince React yinelenen anahtar
     uyarısı veriyor ve satırlardan biri çizilmiyordu. */
  /* Son bir ayıklama: kaynaklar ne olursa olsun aynı kod iki kez
     listelenmemeli. Birleştirmede zaten ayıklanıyor ama liste iki ayrı
     sunucudan ve bir de yerel tanımdan geldiği için tek noktada garanti
     altına alınıyor — yinelenen anahtar uyarısı satırlardan birini
     görünmez yapıyordu. */
  /* Modüller gruplara ayrılıyor.

     Düz bir liste uzayınca aranan modül kayboluyordu; başlıklar
     personelin zaten bildiği ayrımı kullanıyor: günlük iş, mağaza,
     özlük, yönetim.

     Gruba girmeyen modül "Diğer" başlığı altında toplanıyor, böylece
     yeni bir modül eklendiğinde listeden düşmüyor. */
  const GRUPLAR = [
    { ad: "Günlük işler", kodlar: ["vardiya", "checklist", "isemri"] },
    { ad: "Ödüller", kodlar: ["kazankazan"] },
    /* İzin onayı mağaza başlığında: mağaza yöneticisinin işi ve
       personelin kendi izin ekranıyla karışmaması gerekiyor. */
    /* Yönetici İşlemleri (1.7) ekibin işleriyle bir arada */
    { ad: "Ekip ve onaylar", kodlar: ["izinonay", "ekibim", "ekipdegerlendirme", "devamsizlik", "puantaj", "vardiyaplani"] },
    { ad: "Mağaza", kodlar: ["skt", "ariza", "envanter", "fiyatkontrol", "rakipfiyat", "kunye"] },
    { ad: "Özlük", kodlar: ["izin", "avans", "prim", "performans", "bilgilerim", "bilgi"] },
    { ad: "İletişim ve raporlar", kodlar: ["mesajlar", "duyuru", "haberler", "rapor", "etik"] },
  ];

  const kalanlar = [];
  const eklenen = new Set();

  for (const m of [
    ...sunucudan,
    ...yerelModuller.filter((y) => !altMenu.includes(y.kod)),
  ]) {
    if (!m?.kod || eklenen.has(m.kod)) continue;

    /* Ekranı olmayan modüller menüde çıkmıyor: bunlar yalnızca bir
       alanın görünürlüğünü açıp kapatmak için (ana sayfadaki mesai
       özeti gibi) ve dokunulacak bir ekranları yok. */
    if (!EKRANLAR[m.kod]) continue;

    eklenen.add(m.kod);
    kalanlar.push(m);
  }

  const kisi = veri?.kisi ?? {};

  const b360Notu = b360Hatasi ? (
    <View style={s.b360Not}>
      <Text style={s.b360NotYazi}>
        Bazı modüller yüklenemedi: {b360Hatasi}
      </Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
          />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TouchableOpacity onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("AnaSayfa"))} hitSlop={12}>
            <Text style={{ fontSize: 28, color: renk.metin, marginTop: -4 }}>‹</Text>
          </TouchableOpacity>
          <Text style={s.baslik}>Tüm modüller</Text>
        </View>

        {/* ---------------------------------------------- hata şeridi */}
        {hata ? (
          <View style={s.hataKutu}>
            <View style={{ flex: 1 }}>
              <Text style={s.hataBaslik}>Modül listesi alınamadı</Text>
              <Text style={s.hataMetin}>{hata}</Text>
            </View>

            <TouchableOpacity
              style={s.hataDugme}
              activeOpacity={0.7}
              onPress={() => getir(true)}
            >
              <Text style={s.hataDugmeYazi}>Tekrar dene</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* -------------------------------------------------- künye */}
        <TouchableOpacity
          style={s.kunye}
          activeOpacity={0.7}
          onPress={() => navigation.navigate("Bilgilerim")}
        >
          <View style={s.avatar}>
            <Text style={s.basHarf}>
              {`${kisi.adSoyad ?? ""}`
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((x) => x[0])
                .join("")}
            </Text>

            {!fotoHatasi && (
              <Image
                source={{ uri: api.resimAdresi() }}
                style={s.foto}
                onError={() => setFotoHatasi(true)}
              />
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.ad}>{kisi.adSoyad ?? "—"}</Text>
            <Text style={s.altBilgi}>
              {veri?.gorev ?? "—"}
              {kisi.subeAdi ? ` · ${kisi.subeAdi}` : ""}
            </Text>
            <Text style={s.kunyeIpucu}>Bilgilerim</Text>
          </View>

          <Simge ad="ok" renkli="#c8ccc4" boyut={17} />
        </TouchableOpacity>

        {b360Notu}

        {/* Bildirim teşhisi.

            Bildirim gelmediğinde sebebi cihazda kalıyor ve sunucu
            günlüğünde iz bırakmıyordu; durum burada görünüyor ki
            "izin yok" ile "jeton üretilemedi" ayırt edilebilsin. */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            Alert.alert(
              "Bildirim durumu",
              `Aşama: ${bildirimDurumu.asama}\n\n` +
                `Jeton: ${bildirimDurumu.jeton ?? "yok"}\n\n` +
                `Hata: ${bildirimDurumu.hata ?? "yok"}`
            )
          }
        >
          <Text style={s.bildirimNotu}>
            Bildirim: {bildirimDurumu.asama}
            {bildirimDurumu.hata ? " · hata var" : ""}
          </Text>
        </TouchableOpacity>

        {/* ------------------------------------------------ modüller */}
        {GRUPLAR.map((grup) => {
          /* Grubun kendi modülleri; katalogdaki sıra değil grup sırası
             geçerli, böylece başlık altındaki dizilim öngörülebilir. */
          const uyanlar = grup.kodlar
            .map((kod) => kalanlar.find((m) => m.kod === kod))
            .filter(Boolean);

          if (uyanlar.length === 0) return null;

          return (
            <View key={grup.ad}>
              <Text style={s.bolumBaslik}>{grup.ad}</Text>
              <View style={s.kart}>
                {uyanlar.map((m, i) => (
                  <ModulSatiri
                    key={m.kod}
                    m={m}
                    son={i === uyanlar.length - 1}
                    isSayisi={isSayisi}
                    onaySayisi={onaySayisi}
                    navigation={navigation}
                  />
                ))}
              </View>
            </View>
          );
        })}

        {/* Gruba girmeyenler: yeni bir modül eklendiğinde listeden
            düşmesin diye. */}
        {(() => {
          const gruplu = new Set(GRUPLAR.flatMap((g) => g.kodlar));
          const digerleri = kalanlar.filter((m) => !gruplu.has(m.kod));

          if (digerleri.length === 0) return null;

          return (
            <View>
              <Text style={s.bolumBaslik}>Diğer</Text>
              <View style={s.kart}>
                {digerleri.map((m, i) => (
                  <ModulSatiri
                    key={m.kod}
                    m={m}
                    son={i === digerleri.length - 1}
                    isSayisi={isSayisi}
                    onaySayisi={onaySayisi}
                    navigation={navigation}
                  />
                ))}
              </View>
            </View>
          );
        })()}

        {/* -------------------------------------------------- hesap */}
        <Text style={s.bolumBaslik}>Hesap</Text>

        <View style={s.kart}>
          {/* Patron görünümüne dönüş. Yalnızca patron olarak tanımlanan
              kişide (sunucu bayrağı) çıkıyor; diğer personel için menü
              aynen eskisi gibi. */}
          {veri?.patron === true ? (
            <TouchableOpacity
              style={s.satir}
              activeOpacity={0.65}
              onPress={async () => {
                await gorunumYaz("patron");
                navigation.getParent()?.reset({ index: 0, routes: [{ name: "Patron" }] });
              }}
            >
              <View style={[s.simgeKutu, { backgroundColor: renk.yesilAcik }]}>
                <Simge ad="kalkan" renkli={renk.yesilKoyu} boyut={19} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.satirAd}>Patron görünümü</Text>
                <Text style={s.satirAlt}>
                  Şubeler, onaylar, İK ve Biçen Kart özeti
                </Text>
              </View>

              <Simge ad="ok" renkli="#c8ccc4" boyut={17} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[s.satir, s.sonSatir]}
            activeOpacity={0.65}
            onPress={cikisSor}
          >
            <View style={[s.simgeKutu, { backgroundColor: "#fff2e8" }]}>
              <Simge ad="cikis" renkli={renk.turuncu} boyut={19} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={s.satirAd}>Çıkış yap</Text>
              <Text style={s.satirAlt}>
                Yeniden giriş için SMS doğrulaması gerekir
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={s.dipnot}>Biçen360 · sürüm {Constants.expoConfig?.version ?? "—"}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Modül satırı.
 *
 * Grup listelerinin hepsinde aynı satır kullanılıyor; her grupta ayrı
 * yazmak, bir değişikliği dört yerde tekrarlamak olurdu.
 */
function ModulSatiri({ m, son, isSayisi, onaySayisi = 0, navigation }) {
  const ekran = EKRANLAR[m.kod];

  return (
    <TouchableOpacity
      style={[s.satir, son && s.sonSatir]}
      activeOpacity={0.65}
      onPress={() =>
        ekran && !m.yakinda
          ? navigation.navigate(ekran)
          : Alert.alert(m.ad, "Bu modül yakında kullanıma açılacak.")
      }
    >
      {/* Renk eşlemesi SimgeKutu içinde tek yerde: üç ekranda ayrı
          tanımlamak, bir rengi değiştirirken birini unutmaya açıktı. */}
      <SimgeKutu kod={m.kod} ad={m.simge} boyut={38} />

      <View style={{ flex: 1 }}>
        <Text style={s.satirAd}>{m.ad}</Text>
        {m.aciklama ? <Text style={s.satirAlt}>{m.aciklama}</Text> : null}
      </View>

      {m.kod === "isemri" && isSayisi > 0 ? (
        <View style={s.satirRozet}>
          <Text style={s.satirRozetYazi}>{isSayisi}</Text>
        </View>
      ) : null}

      {m.kod === "izinonay" && onaySayisi > 0 ? (
        <View style={s.satirRozet}>
          <Text style={s.satirRozetYazi}>{onaySayisi > 99 ? "99+" : onaySayisi}</Text>
        </View>
      ) : null}

      {m.yakinda ? (
        <View style={s.yakindaRozet}>
          <Text style={s.yakindaYazi}>YAKINDA</Text>
        </View>
      ) : null}

      <Simge ad="ok" renkli="#c8ccc4" boyut={17} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  bildirimNotu: {
    fontSize: 11,
    color: "#a3a9b0",
    textAlign: "center",
    marginBottom: 10,
  },

  /* Portal sunucusuna ulaşılamadığında modüllerin neden eksik olduğunu
     söyleyen not. Hata gibi kırmızı değil: uygulamanın geri kalanı
     çalışıyor, bu bir uyarı. */
  b360Not: {
    backgroundColor: "#fff7e6",
    borderRadius: 10,
    padding: 11,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#ffd591",
  },
  b360NotYazi: { fontSize: 12.5, color: "#ad4e00", lineHeight: 18 },

  tam: { flex: 1, backgroundColor: renk.zemin },

  /* Alt boşluk: yüzen menü içeriğin üstüne binmesin */
  govde: { padding: 16, paddingBottom: 110 },

  baslik: {
    fontSize: 30,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: -0.6,
    marginBottom: 16,
  },

  hataKutu: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff2e8",
    borderRadius: 13,
    borderLeftWidth: 3,
    borderLeftColor: renk.turuncu,
    padding: 12,
    marginBottom: 12,
  },

  hataBaslik: { fontSize: 13, fontWeight: "700", color: renk.metin },
  hataMetin: { fontSize: 11.5, color: renk.pasif, marginTop: 2 },

  hataDugme: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: "#fff",
  },

  hataDugmeYazi: { fontSize: 12, fontWeight: "700", color: renk.turuncu },

  kunye: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 14,
    marginBottom: 20,
  },

  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  basHarf: { fontSize: 17, fontWeight: "800", color: renk.yesilKoyu },

  foto: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  ad: { fontSize: 16.5, fontWeight: "700", color: renk.metin },
  altBilgi: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },

  /* "Yakında" rozeti: satır soluk değil, rozet belirgin. Soluk satır
     dokunulamaz izlenimi veriyor ve modülün varlığı gözden kaçıyordu. */
  yakindaRozet: {
    backgroundColor: renk.turuncuAcik,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginRight: 6,
  },
  yakindaYazi: {
    fontSize: 9.5,
    fontWeight: "800",
    color: renk.turuncuKoyu,
    letterSpacing: 0.4,
  },

  satirRozet: {
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  satirRozetYazi: { fontSize: 11.5, fontWeight: "800", color: "#fff" },

  kunyeIpucu: {
    fontSize: 11.5,
    fontWeight: "600",
    color: renk.yesilKoyu,
    marginTop: 5,
  },

  bolumBaslik: {
    fontSize: 12,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },

  kart: {
    backgroundColor: "#fff",
    borderRadius: 15,
    paddingHorizontal: 14,
    marginBottom: 20,
  },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },

  sonSatir: { borderBottomWidth: 0 },

  simgeKutu: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
  },

  satirAd: { fontSize: 14.5, fontWeight: "600", color: renk.metin },
  satirAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },

  dipnot: {
    fontSize: 11.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 6,
  },
});

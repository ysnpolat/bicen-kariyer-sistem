/**
 * Kontrol Listesi Doldurma
 * ---------------------------------------------------------------------------
 * Maddeler tek tek cevaplanır: Evet / Hayır / Uygun değil. İstenirse yorum
 * yazılır ve birden çok fotoğraf çekilir.
 *
 * Cevaplar madde bazında anında kaydedilir; sonda tek bir "gönder" düğmesi
 * yok. Mağazada ağ kopabiliyor, personel yarısını doldurup çıkabiliyor —
 * her maddenin kendi başına kaydedilmesi yapılan işi korur.
 *
 * Fotoğraf çekme ayrı bir ekrana gitmez, aynı ekranda kaplama olarak açılır:
 * personel elinde ürünle dururken sayfa değiştirmek zorunda kalmasın.
 */

import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { checklistAl, checklistCevapla, checklistGorselYukle } from "../api";
import { renk } from "../tema";
import { Yukleniyor, Hata, Bilgi } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";

const CEVAPLAR = [
  { kod: "evet", ad: "Evet" },
  { kod: "hayir", ad: "Hayır" },
  { kod: "uygundegil", ad: "Uygun değil" },
];

export default function ChecklistDoldur({ route, navigation }) {
  const { id, baslik } = route.params ?? {};

  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  /* Yorum kutuları: madde kimliği → metin. Her tuşta sunucuya gitmemek
     için yerelde tutulur, kutudan çıkınca kaydedilir. */
  const [yorumlar, setYorumlar] = useState({});
  const [kaydedilen, setKaydedilen] = useState(null);

  /* Fotoğraf kaplaması hangi madde için açık */
  const [fotoMadde, setFotoMadde] = useState(null);
  const [yukleniyorFoto, setYukleniyorFoto] = useState(false);

  /* Çekim sonrası kısa onay: personel fotoğrafın gidip gitmediğini
     anlamıyordu, ekranda hiçbir şey değişmiyordu. */
  const [cekildi, setCekildi] = useState(false);
  const [izin, izinIste] = useCameraPermissions();
  const kameraRef = useRef(null);

  const getir = useCallback(
    async (yenile = false) => {
      if (yenile) setYenileniyor(true);

      try {
        const d = await checklistAl(id);

        setVeri(d);
        setHata("");

        /* Sunucudaki yorumlar kutulara yazılır; personel kaldığı yerden
           devam edebilsin. */
        const mevcut = {};

        (d?.maddeler ?? []).forEach((m) => {
          if (m.yorum) mevcut[m.id] = m.yorum;
        });

        setYorumlar((o) => ({ ...mevcut, ...o }));
      } catch (e) {
        setHata(e?.message ?? "Liste alınamadı.");
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [id]
  );

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  /** Bir maddeyi cevaplar ve listeyi tazeler */
  const cevapla = async (madde, cevap) => {
    setKaydedilen(madde.id);

    try {
      await checklistCevapla(id, madde.id, cevap, yorumlar[madde.id] ?? null);
      await getir();
    } catch (e) {
      Alert.alert("Kaydedilemedi", e?.message ?? "İşlem tamamlanamadı.");
    } finally {
      setKaydedilen(null);
    }
  };

  /** Yorum kutusundan çıkılınca kaydeder */
  const yorumKaydet = async (madde) => {
    const metin = (yorumlar[madde.id] ?? "").trim();

    if (metin === (madde.yorum ?? "").trim()) return;

    try {
      await checklistCevapla(id, madde.id, madde.cevap ?? null, metin);
    } catch {
      /* Yorum kaydedilemezse cevap yine durur; sessiz geçilir. */
    }
  };

  /** Fotoğraf kaplamasını açar, gerekiyorsa izin ister */
  const fotoAc = async (maddeId) => {
    if (!izin?.granted) {
      const sonuc = await izinIste();

      if (!sonuc.granted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Fotoğraf eklemek için kamera iznine ihtiyaç var. Ayarlardan verebilirsiniz."
        );
        return;
      }
    }

    setFotoMadde(maddeId);
  };

  /** Çeker ve yükler; kaplama açık kalır, arka arkaya çekilebilsin */
  const cek = async () => {
    if (!kameraRef.current || yukleniyorFoto) return;

    setYukleniyorFoto(true);

    try {
      /* skipProcessing kaldırıldı: Android'de ham sensör görüntüsü
         dönüyor, quality yok sayılıyor ve dosya sunucunun 12 MB sınırını
         aşıyordu. Hata "sunucuya bağlanılamadı" diye görünüyordu çünkü
         istek tamamlanamadan düşüyor.

         İşleme birkaç yüz milisaniye ekliyor ama dosyayı onda bire
         indiriyor. */
      const foto = await kameraRef.current.takePictureAsync({
        quality: 0.5,
      });

      await checklistGorselYukle(id, fotoMadde, foto.uri);
      await getir();

      setCekildi(true);
      setTimeout(() => setCekildi(false), 1400);
    } catch (e) {
      Alert.alert("Yüklenemedi", e?.message ?? "Fotoğraf gönderilemedi.");
    } finally {
      setYukleniyorFoto(false);
    }
  };

  /* ---------------------------------------------------- fotoğraf kaplaması */
  const fotoMaddesi = (veri?.maddeler ?? []).find((m) => m.id === fotoMadde);

  /* Kamera ekranın kendisi olarak değil pencere olarak açılır: alt sekme
     çubuğu ekranın üstünde duruyor ve deklanşörü örtüyordu. */
  const kameraPenceresi = (
    <Modal
      visible={fotoMadde !== null}
      animationType="slide"
      onRequestClose={() => setFotoMadde(null)}
    >
      <View style={s.kameraTam}>
        <CameraView ref={kameraRef} style={s.kamera} facing="back" active />

        <View style={s.kameraUst}>
          <Text style={s.kameraSoru} numberOfLines={3}>
            {fotoMaddesi?.soru}
          </Text>

          <Text style={s.kameraSayi}>
            {fotoMaddesi?.gorselSayisi ?? 0} fotoğraf eklendi
          </Text>
        </View>

        {cekildi ? (
          <View style={s.cekildiSerit}>
            <Text style={s.cekildiYazi}>Fotoğraf eklendi</Text>
          </View>
        ) : null}

        <View style={s.kameraAlt}>
          <TouchableOpacity
            style={s.kapatDugme}
            activeOpacity={0.7}
            onPress={() => setFotoMadde(null)}
          >
            <Text style={s.kapatYazi}>Bitir</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.deklansor, yukleniyorFoto && s.soluk]}
            activeOpacity={0.8}
            disabled={yukleniyorFoto}
            onPress={cek}
          >
            {yukleniyorFoto ? (
              <ActivityIndicator color={renk.metin} />
            ) : (
              <View style={s.deklansorIc} />
            )}
          </TouchableOpacity>

          {/* Sağ tarafta denge için boşluk */}
          <View style={s.kapatDugme} />
        </View>
      </View>
    </Modal>
  );

  if (yukleniyor) return <Yukleniyor />;

  const maddeler = veri?.maddeler ?? [];
  const kapali = veri?.acikMi === false;

  /* Eksik kalan zorunlu alanlar; kaydet düğmesi bunları söyler.

     Numara listedeki gerçek sıradan geliyor: süzmeden sonra yeniden
     numaralandırmak, personele "3. madde eksik" deyip ekranda birinci
     maddeyi aratıyordu. */
  const eksikMi = (m) =>
    !m.cevap ||
    m.iade ||
    (m.gorselZorunlu && (m.gorselSayisi ?? 0) === 0) ||
    (m.yorumZorunlu && !(yorumlar[m.id] ?? "").trim());

  const eksikler = maddeler
    .map((m, i) => ({ m, sira: i + 1 }))
    .filter((x) => eksikMi(x.m))
    .map((x) => `${x.sira}. ${x.m.soru}`);

  /* Tamamlanma oranı: uzun listelerde personel nerede olduğunu
     göremiyordu. */
  const tamam = maddeler.length - eksikler.length;

  const oran =
    maddeler.length === 0 ? 0 : Math.round((tamam / maddeler.length) * 100);

  const bitir = () => {
    if (eksikler.length > 0) {
      Alert.alert(
        `${eksikler.length} madde eksik`,
        eksikler.slice(0, 6).join("\n") +
          (eksikler.length > 6 ? `\n… ve ${eksikler.length - 6} madde daha` : "")
      );
      return;
    }

    Alert.alert(
      "Kaydedildi",
      "Kontrol listeniz panele iletildi. Teşekkürler.",
      [{ text: "Tamam", onPress: () => navigation.goBack() }]
    );
  };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      {kameraPenceresi}

      {maddeler.length > 0 && !kapali ? (
        <View style={s.ilerleme}>
          <View style={s.cubuk}>
            <View style={[s.cubukDolu, { width: `${oran}%` }]} />
          </View>

          <Text style={s.ilerlemeYazi}>
            {tamam}/{maddeler.length} madde tamam
          </Text>
        </View>
      ) : null}

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
        <View style={s.baslikSatir}>
          <TouchableOpacity
            style={s.geri}
            activeOpacity={0.65}
            onPress={() => navigation.goBack()}
          >
            <Simge ad="ok" renkli={renk.pasif} boyut={18} />
          </TouchableOpacity>

          <Text style={s.baslik} numberOfLines={2}>
            {veri?.liste?.baslik ?? baslik ?? "Kontrol Listesi"}
          </Text>
        </View>

        {hata ? <Hata metin={hata} /> : null}

        {veri?.liste?.aciklama ? (
          <Bilgi>{veri.liste.aciklama}</Bilgi>
        ) : null}

        {kapali ? (
          <Bilgi>
            Bu liste şu anda doldurma saati dışında. Verdiğiniz cevaplar
            görüntülenebilir ama değiştirilemez.
          </Bilgi>
        ) : null}

        {maddeler.map((m, i) => (
          <View key={m.id} style={s.kart}>
            <Text style={s.sira}>Madde {i + 1}</Text>
            <Text style={s.soru}>{m.soru}</Text>

            {/* Panelden iade edildiyse ne isteniyor, üstte yazar */}
            {m.iade ? (
              <View style={s.iadeKutu}>
                <Text style={s.iadeBaslik}>Tekrar yapılması isteniyor</Text>
                <Text style={s.iadeMetin}>{m.iadeNotu}</Text>
              </View>
            ) : null}

            {/* ------------------------------------------ cevap düğmeleri */}
            <View style={s.cevapSatir}>
              {CEVAPLAR.map((c) => {
                const secili = m.cevap === c.kod;

                return (
                  <TouchableOpacity
                    key={c.kod}
                    style={[
                      s.cevapDugme,
                      secili && s.cevapSecili,
                      kapali && s.soluk,
                    ]}
                    activeOpacity={0.75}
                    disabled={kapali || kaydedilen === m.id}
                    onPress={() => cevapla(m, c.kod)}
                  >
                    <Text style={[s.cevapYazi, secili && s.cevapYaziSecili]}>
                      {c.ad}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ------------------------------------------------- yorum */}
            <Text style={s.etiket}>
              Yorum{m.yorumZorunlu ? " (zorunlu)" : ""}
            </Text>

            <TextInput
              style={s.giris}
              value={yorumlar[m.id] ?? ""}
              onChangeText={(t) =>
                setYorumlar((o) => ({ ...o, [m.id]: t }))
              }
              onBlur={() => yorumKaydet(m)}
              editable={!kapali}
              multiline
              placeholder="Varsa açıklamanız: sevkiyat gelmedi, ürünler çürük geldi…"
              placeholderTextColor="#c8ccc4"
            />

            {/* ---------------------------------------------- fotoğraf */}
            <View style={s.fotoSatir}>
              <TouchableOpacity
                style={[s.fotoDugme, kapali && s.soluk]}
                activeOpacity={0.75}
                disabled={kapali}
                onPress={() => fotoAc(m.id)}
              >
                <Text style={s.fotoYazi}>Fotoğraf ekle</Text>
              </TouchableOpacity>

              <Text
                style={[
                  s.fotoSayi,
                  m.gorselZorunlu && (m.gorselSayisi ?? 0) === 0 && s.eksik,
                ]}
              >
                {(m.gorselSayisi ?? 0) === 0
                  ? m.gorselZorunlu
                    ? "Fotoğraf zorunlu"
                    : "Fotoğraf yok"
                  : `${m.gorselSayisi} fotoğraf`}
              </Text>
            </View>
          </View>
        ))}

        {/* Cevaplar zaten anında kaydediliyor; bu düğme eksik madde
            kalmadığını doğrular ve personele işin bittiğini söyler. */}
        {!kapali ? (
          <TouchableOpacity
            style={[s.bitirDugme, eksikler.length > 0 && s.bitirEksik]}
            activeOpacity={0.85}
            onPress={bitir}
          >
            <Text style={s.bitirYazi}>
              {eksikler.length > 0
                ? `${eksikler.length} madde eksik`
                : "Kaydet ve bitir"}
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text style={s.dipnot}>
          Cevaplarınız anında kaydedilir. Fotoğraflar yedi gün saklanır.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 110 },

  baslikSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },

  geri: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "180deg" }],
  },

  baslik: {
    flex: 1,
    fontSize: 22,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: -0.4,
  },

  kart: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 15,
    marginBottom: 12,
  },

  sira: {
    fontSize: 11,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  soru: {
    fontSize: 15,
    fontWeight: "600",
    color: renk.metin,
    lineHeight: 21,
    marginTop: 5,
  },

  cevapSatir: { flexDirection: "row", gap: 7, marginTop: 12 },

  cevapDugme: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#f2f4f0",
    alignItems: "center",
  },

  cevapSecili: { backgroundColor: renk.yesil },

  cevapYazi: { fontSize: 13, fontWeight: "700", color: renk.pasif },
  cevapYaziSecili: { color: "#fff" },

  etiket: {
    fontSize: 11.5,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 6,
  },

  giris: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 13.5,
    minHeight: 64,
    textAlignVertical: "top",
    color: renk.metin,
    backgroundColor: "#fbfcfa",
  },

  fotoSatir: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },

  fotoDugme: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: renk.yesilAcik,
  },

  fotoYazi: { fontSize: 13, fontWeight: "700", color: renk.yesilKoyu },

  fotoSayi: { fontSize: 12.5, color: renk.pasif },
  eksik: { color: renk.turuncu, fontWeight: "700" },

  ilerleme: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  cubuk: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "#eef0ec",
    overflow: "hidden",
  },
  cubukDolu: { height: 7, backgroundColor: renk.yesil },
  ilerlemeYazi: { fontSize: 11.5, color: renk.pasif, marginTop: 5 },

  soluk: { opacity: 0.5 },

  bitirDugme: {
    marginTop: 4,
    marginBottom: 14,
    paddingVertical: 14,
    borderRadius: 13,
    backgroundColor: renk.yesil,
    alignItems: "center",
  },

  bitirEksik: { backgroundColor: renk.turuncu },

  bitirYazi: { fontSize: 15, fontWeight: "700", color: "#fff" },

  dipnot: {
    fontSize: 11.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 17,
  },

  iadeKutu: {
    backgroundColor: "#fff2e8",
    borderLeftWidth: 3,
    borderLeftColor: renk.turuncu,
    borderRadius: 10,
    padding: 11,
    marginTop: 10,
  },

  iadeBaslik: { fontSize: 12.5, fontWeight: "800", color: renk.turuncu },
  iadeMetin: { fontSize: 13, color: renk.metin, marginTop: 4, lineHeight: 19 },

  cekildiSerit: {
    position: "absolute",
    bottom: 140,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(106,168,45,0.94)",
  },

  cekildiYazi: { fontSize: 14, fontWeight: "700", color: "#fff" },

  /* ------------------------------------------------------------- kamera */
  kameraTam: { flex: 1, backgroundColor: "#000" },
  kamera: { flex: 1 },

  kameraUst: {
    position: "absolute",
    top: 54,
    left: 20,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 14,
    padding: 13,
  },

  kameraSoru: { fontSize: 14.5, fontWeight: "700", color: "#fff", lineHeight: 20 },
  kameraSayi: { fontSize: 12, color: "#d9ddd4", marginTop: 5 },

  kameraAlt: {
    position: "absolute",
    bottom: 44,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  kapatDugme: {
    width: 86,
    paddingVertical: 11,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
  },

  kapatYazi: { fontSize: 14, fontWeight: "700", color: "#fff" },

  deklansor: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.65)",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },

  deklansorIc: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fff",
  },
});

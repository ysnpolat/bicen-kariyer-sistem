/**
 * Görevler: mazeret belgesi ve oryantasyon
 * ---------------------------------------------------------------------------
 * Ana sayfadaki "Sizi bekleyenler" kartlarından ve Ekibim'den açılan
 * pencereler:
 *
 *  - EvrakPenceresi        : personel, izin talebinin evrakını yükler:
 *                            imzalı form, belge istenen türlerde
 *                            destekleyici belge (fotoğraf, galeri, PDF) ve
 *                            aslını İK'ya gönderdiğini işaretler.
 *  - OryantasyonFormu      : personelin kendi anketi ya da yöneticinin ekip
 *                            üyesi için değerlendirmesi (aynı soru seti web
 *                            ile ortak: ../oryantasyonSorulari.js).
 *  - EkipGorevleri         : yönetici için liste — belgesi beklenenler ya da
 *                            oryantasyonu bekleyenler; hatırlatma ve
 *                            değerlendirme buradan.
 *
 * Kamera ve dosya seçici koşullu yükleniyor: paket kurulu olmayan eski bir
 * derlemede ekran açılışta çökmesin, düğmeye basınca "güncelleyin" desin.
 */

import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";

import { renk } from "../tema";
import ModalAlani, { modalTamEkran } from "./ModalAlani";
import { dosyaSec, galeridenSec, kameradanCek } from "../dosyaSecici";
import {
  mazeretBelgeYukle,
  mazeretBelgeHatirlat,
  asilGonderildi,
  izinFormuAdresi,
  uyumAc,
  uyumCevapla,
  oryantasyonDegerlendir,
  oryantasyonHatirlat,
} from "../api";
import { ASAMA_ADI, CALISAN, YONETICI, aciklamaGerek, cevapGovdesi } from "../oryantasyonSorulari";

/* Modül nesnesi kimi paketleyicide doğrudan, kiminde default altında */
const modulAl = (m, islev) => (m?.[islev] ? m : m?.default?.[islev] ? m.default : null);

let ImagePicker = null;
let DocumentPicker = null;

try {
  ImagePicker = modulAl(require("expo-image-picker"), "launchCameraAsync");
} catch {
  ImagePicker = null;
}

try {
  DocumentPicker = modulAl(require("expo-document-picker"), "getDocumentAsync");
} catch {
  DocumentPicker = null;
}

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const gunAy = (t) => {
  const d = new Date(t);
  return `${d.getDate()} ${AYLAR[d.getMonth()]}`;
};

/** "2 gün kaldı", "5 saat kaldı", "süre doldu" */
export const kalanYaz = (saat) => {
  const s = Number(saat ?? 0);
  if (s <= 0) return "süre doldu";
  if (s < 24) return `${Math.max(1, Math.floor(s))} saat kaldı`;
  return `${Math.max(1, Math.round(s / 24))} gün kaldı`;
};

const guncelleyin = () =>
  Alert.alert(
    "Uygulamayı güncelleyin",
    "Belge yükleme bu sürümde yok. Biçen360'ı mağazadan güncelledikten sonra yükleyebilirsiniz."
  );

/* ========================================================================== */
/* İzin evrakı                                                                */
/* ========================================================================== */

/**
 * Taleplerim'deki evrak özetini ana sayfa kartının biçimine çevirir; talep
 * detayından da aynı pencere açılsın diye.
 */
export const evrakTalebi = (t) =>
  t?.evrak
    ? {
        id: t.id,
        tur: t.tur,
        cikis: t.cikisTarihi,
        donus: t.donusTarihi,
        son: t.evrak.son,
        kalanSaat: t.evrak.kalanSaat,
        gecikti: t.evrak.gecikti,
        tamam: t.evrak.personelTamam,
        belgeGerekli: (t.evrak.gerekenler ?? []).length > 1,
        asilGonderildi: !!t.evrak.asilGonderim,
        gerekenler: (t.evrak.gerekenler ?? []).map((g) => ({ ...g, dosyalar: [] })),
      }
    : null;

/** Dosya seçimi: kamera, galeri ya da PDF / dosya. Seçilen dosya ya da null. */
export async function dosyaAl(kaynak) {
  if (kaynak === "dosya") {
    if (!DocumentPicker) return guncelleyin();

    const sonuc = await dosyaSec({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (sonuc?.canceled) return null;

    const a = sonuc?.assets?.[0];

    return a?.uri
      ? { uri: a.uri, ad: a.name ?? `evrak_${Date.now()}.pdf`, tip: a.mimeType ?? "application/pdf" }
      : null;
  }

  if (!ImagePicker) return guncelleyin();

  const kamera = kaynak === "kamera";

  const izin = kamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!izin?.granted) {
    Alert.alert("İzin gerekli", kamera ? "Kamera izni verilmedi." : "Galeri izni verilmedi.");
    return null;
  }

  /* Android'de seçici açılamazsa yeniden denenir, galeri için sistem dosya
     seçicisine geçilir (dosyaSecici.js, 09.10.2026) */
  const sonuc = kamera
    ? await kameradanCek({ quality: 0.6 })
    : await galeridenSec({ quality: 0.6, mediaTypes: ["images"] }, { pdfDahil: true });

  if (sonuc?.canceled) return null;

  const a = sonuc?.assets?.[0];
  const pdf = /pdf/i.test(a?.mimeType ?? "") || /\.pdf$/i.test(a?.fileName ?? "");

  return a?.uri
    ? {
        uri: a.uri,
        ad: a.fileName ?? `evrak_${Date.now()}.${pdf ? "pdf" : "jpg"}`,
        tip: a.mimeType ?? (pdf ? "application/pdf" : "image/jpeg"),
      }
    : null;
}

/**
 * İzin evrakı: formu açıp yazdırma, imzalı formu ve (mazeret, rapor gibi
 * türlerde) destekleyici belgeyi yükleme, aslını İK'ya gönderdiğini
 * işaretleme. Her adım ayrı satır; yüklenen hemen işaretlenir.
 */
export function EvrakPenceresi({ talep, turler, kapat, tamam }) {
  const [kalemler, setKalemler] = useState(talep.gerekenler ?? [{ kalem: "form", ad: "İmzalı izin formu", yuklendi: false }]);
  const [asil, setAsil] = useState(!!talep.asilGonderildi);
  /* Raporlu mazerette belge türü baştan "Sağlık raporu" (07.10.2026) */
  const raporlu = (talep.gerekenler ?? []).some((k) => k.kalem === "destek" && /rapor/i.test(k.ad ?? ""));
  const [destekTur, setDestekTur] = useState(raporlu ? "Sağlık raporu" : null);
  const [yukleniyor, setYukleniyor] = useState(null);
  const [secim, setSecim] = useState(null);
  const [degisti, setDegisti] = useState(false);

  const destekTurleri = (turler?.length ? turler : ["Sağlık raporu", "Doğum belgesi", "Evlilik cüzdanı / belgesi", "Ölüm belgesi", "Diğer"]);

  const hepsiYuklendi = kalemler.every((k) => k.yuklendi);

  const kapatYenile = () => (degisti ? tamam?.() : kapat());

  const yukle = async (kalem, kaynak) => {
    setSecim(null);

    if (kalem === "destek" && !destekTur) {
      Alert.alert("Belge türü", "Önce belgenin türünü seçin.");
      return;
    }

    try {
      const dosya = await dosyaAl(kaynak);
      if (!dosya) return;

      setYukleniyor(kalem);

      await mazeretBelgeYukle(talep.id, kalem === "form" ? "İmzalı izin formu" : destekTur, dosya, kalem);

      setKalemler((o) => o.map((k) => (k.kalem === kalem ? { ...k, yuklendi: true, dosyalar: [...(k.dosyalar ?? []), dosya.ad] } : k)));
      setDegisti(true);
    } catch (h) {
      Alert.alert("Yüklenemedi", h?.message ?? "Dosya yüklenemedi.");
    } finally {
      setYukleniyor(null);
    }
  };

  const asilGonder = async () => {
    try {
      await asilGonderildi(talep.id);
      setAsil(true);
      setDegisti(true);
    } catch (h) {
      Alert.alert("Kaydedilemedi", h?.message ?? "İşlem yapılamadı.");
    }
  };

  const formuAc = () => {
    const adres = izinFormuAdresi(talep.id);
    Linking.openURL(adres).catch(() => Alert.alert("Açılamadı", "Form açılamadı. Şubenizden ya da İK'dan çıktısını isteyebilirsiniz."));
  };

  const Adim = ({ no, bitti, baslik, alt, children, son }) => (
    <View style={s.adim}>
      <View style={s.adimSol}>
        <View style={[s.adimNo, bitti && s.adimNoBitti]}>
          <Text style={[s.adimNoYazi, bitti && { color: renk.beyaz }]}>{bitti ? "✓" : no}</Text>
        </View>
        {!son ? <View style={[s.adimCizgi, bitti && { backgroundColor: renk.yesil }]} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: son ? 0 : 18 }}>
        <Text style={s.adimBaslik}>{baslik}</Text>
        {alt ? <Text style={s.adimAlt}>{alt}</Text> : null}
        {children}
      </View>
    </View>
  );

  const KaynakSecimi = ({ kalem }) =>
    secim === kalem ? (
      <View style={s.kaynaklar}>
        {[
          ["kamera", "Fotoğraf çek"],
          ["galeri", "Galeriden seç"],
          ["dosya", "PDF / dosya"],
        ].map(([k, ad]) => (
          <TouchableOpacity key={k} style={s.kaynak} onPress={() => yukle(kalem, k)} activeOpacity={0.8}>
            <Text style={s.kaynakYazi}>{ad}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ) : null;

  const YukleDugmesi = ({ k }) =>
    yukleniyor === k.kalem ? (
      <ActivityIndicator color={renk.yesilKoyu} style={{ alignSelf: "flex-start", marginTop: 10 }} />
    ) : (
      <TouchableOpacity
        style={[s.ikincilDar, k.yuklendi && { borderColor: "#d5dbcf" }]}
        onPress={() => setSecim(secim === k.kalem ? null : k.kalem)}
        activeOpacity={0.8}
      >
        <Text style={s.ikincilYazi}>{k.yuklendi ? "Bir dosya daha ekle" : "Yükle"}</Text>
      </TouchableOpacity>
    );

  let no = 1;
  const form = kalemler.find((k) => k.kalem === "form");
  const destek = kalemler.find((k) => k.kalem === "destek");

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapatYenile}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.beyaz }]} edges={["top", "bottom"]}>
        <View style={s.ust}>
          <Text style={[s.ustBaslik, { flex: 1 }]}>İzin evrakı</Text>
          <TouchableOpacity onPress={kapatYenile} hitSlop={12}>
            <Text style={s.ustKapat}>Kapat</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.govde}>
          <View style={[s.bilgi, hepsiYuklendi && { backgroundColor: renk.yesilAcik }, !hepsiYuklendi && talep.gecikti && s.bilgiGecikti]}>
            <Text style={s.bilgiBaslik}>{talep.altTur ? `${talep.tur} · ${talep.altTur}` : talep.tur}</Text>
            <Text style={s.bilgiAlt}>
              {gunAy(talep.cikis)}
              {gunAy(talep.donus) !== gunAy(talep.cikis) ? ` – ${gunAy(talep.donus)}` : ""}
            </Text>
            <Text style={[s.bilgiSure, hepsiYuklendi && { color: renk.yesilKoyu }, !hepsiYuklendi && talep.gecikti && { color: renk.turuncu }]}>
              {hepsiYuklendi
                ? asil
                  ? "Evrakınız tamam · İK aslını teslim alınca onaylar"
                  : "Yüklendi · aslını İK'ya gönderin"
                : talep.formBekleniyor && !form?.yuklendi
                ? "Yöneticiniz imzalı form yüklenmeden onaylayamaz"
                : talep.gecikti
                ? "Süre doldu · yöneticinize bildirildi"
                : `Son gün ${gunAy(talep.son)} · ${kalanYaz(talep.kalanSaat)}`}
            </Text>
          </View>

          <View style={{ marginTop: 18 }}>
            <Adim
              no={no++}
              bitti={!!form?.yuklendi}
              baslik="Formu yazdırıp imzalatın"
              alt="Formunuz otomatik dolduruldu ve şubenize ya da İnsan Kaynakları'na gönderildi. Siz, yerinize bakacak kişi ve yöneticiniz imzalayın."
            >
              <TouchableOpacity style={s.baglanti} onPress={formuAc} hitSlop={8}>
                <Text style={s.baglantiYazi}>Formu aç (PDF)</Text>
              </TouchableOpacity>
            </Adim>

            {form ? (
              <Adim no={no++} bitti={form.yuklendi} baslik="İmzalı formu yükleyin" alt="Formun tamamı okunur görünsün; düz bir zeminde çekin.">
                {(form.dosyalar ?? []).length ? <Text style={s.dosyaAdi}>✓ {form.dosyalar.join(", ")}</Text> : null}
                <YukleDugmesi k={form} />
                <KaynakSecimi kalem="form" />
              </Adim>
            ) : null}

            {destek ? (
              <Adim
                no={no++}
                bitti={destek.yuklendi}
                baslik={raporlu ? "Rapor belgesini yükleyin" : "Destekleyici belgeyi yükleyin"}
                alt={
                  raporlu
                    ? "Doktorun verdiği rapor; tarihleri ve kaşesi okunur görünsün."
                    : "Sağlık raporu, doğum, evlilik ya da ölüm belgesi gibi izninizin dayanağı olan belge."
                }
              >
                {!destek.yuklendi ? (
                  <View style={[s.cipler, { marginTop: 10 }]}>
                    {destekTurleri.map((x) => (
                      <TouchableOpacity key={x} style={[s.cip, destekTur === x && s.cipSecili]} onPress={() => setDestekTur(x)}>
                        <Text style={[s.cipYazi, destekTur === x && { color: renk.beyaz }]}>{x}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                {(destek.dosyalar ?? []).length ? <Text style={s.dosyaAdi}>✓ {destek.dosyalar.join(", ")}</Text> : null}
                <YukleDugmesi k={destek} />
                <KaynakSecimi kalem="destek" />
              </Adim>
            ) : null}

            <Adim
              no={no++}
              son
              bitti={asil}
              baslik="Aslını İnsan Kaynakları'na gönderin"
              alt={
                asil
                  ? "Gönderdiğinizi bildirdiniz. İK ıslak imzalı aslını aldığında talebinizi sonuçlandırır."
                  : "Islak imzalı formu (ve belgenin aslını) şube çantasıyla ya da elden İK'ya ulaştırın, sonra buradan bildirin."
              }
            >
              {!asil ? (
                <TouchableOpacity
                  style={[s.birincilDar, !hepsiYuklendi && { backgroundColor: "#c5c9c0" }]}
                  disabled={!hepsiYuklendi}
                  onPress={asilGonder}
                >
                  <Text style={s.birincilYazi}>Aslını gönderdim</Text>
                </TouchableOpacity>
              ) : null}
              {!hepsiYuklendi ? <Text style={s.ipucu}>Önce evrakı yükleyin.</Text> : null}
            </Adim>
          </View>
        </ScrollView>
      </ModalAlani>
    </Modal>
  );
}

/** Eski ad: ana sayfa ve Ekibim bu adla da açabiliyor */
export const MazeretBelgePenceresi = EvrakPenceresi;

/* ========================================================================== */
/* Oryantasyon formu                                                          */
/* ========================================================================== */

/**
 * mod = "calisan": kod (anketin bağlantı kodu) ile personelin kendi anketi.
 * mod = "yonetici": kisi ({ sicil, adSoyad, asama }) için değerlendirme.
 */
export function OryantasyonFormu({ mod, kod, kisi, asama: asamaGirdi, adSoyad, kapat, tamam }) {
  const [asama, setAsama] = useState(asamaGirdi ?? kisi?.asama ?? null);
  const [durum, setDurum] = useState(mod === "calisan" ? "yukleniyor" : "acik");
  const [mesaj, setMesaj] = useState("");
  const [yanitlar, setYanitlar] = useState({});
  const [aciklamalar, setAciklamalar] = useState({});
  const [gonderiliyor, setGonderiliyor] = useState(false);

  /* Personelin anketi önce sunucuda açılıyor: süresi dolmuş ya da
     doldurulmuşsa form yerine açıklama gösteriliyor. */
  useEffect(() => {
    if (mod !== "calisan") return;

    let iptal = false;

    uyumAc(kod)
      .then((c) => {
        if (iptal) return;

        if (c?.durum === "acik") {
          setAsama(c.kayit?.asama ?? asama);
          setDurum("acik");
        } else {
          setDurum(c?.durum ?? "hata");
          setMesaj(
            c?.durum === "dolduruldu"
              ? "Bu anketi daha önce doldurdunuz. Teşekkürler!"
              : c?.aciklama ?? "Anket açılamadı."
          );
        }
      })
      .catch((h) => {
        if (iptal) return;
        setDurum("hata");
        setMesaj(h.message);
      });

    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod, kod]);

  const sorular = useMemo(() => ((mod === "yonetici" ? YONETICI : CALISAN)[asama] ?? []), [mod, asama]);

  const cevaplanan = sorular.filter((x, i) => x.tur === "acik" || yanitlar[i] != null).length;

  const eksikVar = sorular.some(
    (x, i) =>
      (x.tur !== "acik" && yanitlar[i] == null) ||
      (aciklamaGerek(x, yanitlar[i]) && (aciklamalar[i] ?? "").trim().length < 3)
  );

  const gonder = async () => {
    if (eksikVar) {
      const aciklamaEksik = sorular.some(
        (x, i) => aciklamaGerek(x, yanitlar[i]) && (aciklamalar[i] ?? "").trim().length < 3
      );

      Alert.alert(
        "Eksik var",
        aciklamaEksik ? "\"Evet\" işaretlediğiniz soruda açıklama yazmanız gerekiyor." : "Lütfen işaretlenmemiş soruları tamamlayınız."
      );
      return;
    }

    setGonderiliyor(true);

    try {
      if (mod === "yonetici") {
        const govde = cevapGovdesi({
          asama,
          tur: "yonetici",
          personelKodu: kisi.sicil,
          adSoyad: kisi.adSoyad,
          sorular,
          yanitlar,
          aciklamalar,
        });

        /* Panelden gönderilen test: bağlantı koduyla, SMS'teki yönetici
           formuyla aynı kayda yazılıyor */
        if (kisi.test && kisi.kod) await uyumCevapla(kisi.kod, govde);
        else await oryantasyonDegerlendir({ ...govde, asama });
        Alert.alert("Kaydedildi", `${kisi.adSoyad} için değerlendirmeniz İK'ya iletildi.`);
      } else {
        const govde = cevapGovdesi({
          asama,
          tur: "calisan",
          personelKodu: null,
          adSoyad,
          sorular,
          yanitlar,
          aciklamalar,
        });

        await uyumCevapla(kod, govde);
        setDurum("bitti");
        return;
      }

      tamam?.();
    } catch (h) {
      Alert.alert("Gönderilemedi", h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const baslik =
    mod === "yonetici" ? `${kisi?.adSoyad ?? ""}` : `${ASAMA_ADI[asama] ?? ""} oryantasyon anketi`;

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.beyaz }]} edges={["top", "bottom"]}>
        <View style={s.ust}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.ustBaslik} numberOfLines={1}>
              {baslik}
            </Text>
            {mod === "yonetici" ? (
              <Text style={s.ustAlt}>{ASAMA_ADI[asama] ?? ""} değerlendirmesi</Text>
            ) : durum === "acik" ? (
              <Text style={s.ustAlt}>
                {cevaplanan} / {sorular.length} soru
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={durum === "bitti" ? tamam ?? kapat : kapat} hitSlop={12}>
            <Text style={s.ustKapat}>{durum === "bitti" ? "Kapat" : "Vazgeç"}</Text>
          </TouchableOpacity>
        </View>

        {durum === "yukleniyor" ? (
          <ActivityIndicator color={renk.yesilKoyu} style={{ marginTop: 40 }} />
        ) : durum === "bitti" ? (
          <View style={s.bitti}>
            <View style={s.bittiDaire}>
              <Text style={s.bittiTik}>✓</Text>
            </View>
            <Text style={s.bittiBaslik}>Teşekkürler!</Text>
            <Text style={s.bittiYazi}>Yanıtlarınız İnsan Kaynakları'na iletildi.</Text>
            <TouchableOpacity style={[s.gonder, { alignSelf: "stretch", marginTop: 24 }]} onPress={tamam ?? kapat}>
              <Text style={s.gonderYazi}>Ana sayfaya dön</Text>
            </TouchableOpacity>
          </View>
        ) : durum !== "acik" ? (
          <View style={s.bitti}>
            <Text style={s.bittiYazi}>{mesaj}</Text>
          </View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
              {mod === "calisan" ? (
                <Text style={s.giris}>
                  Görüşleriniz yalnızca İnsan Kaynakları ile paylaşılır. Yaklaşık 3 dakika sürer.
                </Text>
              ) : (
                <Text style={s.giris}>1 = çok zayıf, 5 = çok iyi. Değerlendirmeniz personele gösterilmez.</Text>
              )}

              {sorular.map((x, i) => (
                <View key={i} style={s.soru}>
                  <Text style={s.soruMetin}>
                    {i + 1}. {x.metin}
                  </Text>

                  {x.tur === "olcek" || x.tur === "on" ? (
                    <>
                      <View style={s.olcek}>
                        {Array.from({ length: x.tur === "on" ? 11 : 5 }, (_, k) => (x.tur === "on" ? k : k + 1)).map((d) => (
                          <TouchableOpacity
                            key={d}
                            style={[s.olcekDugme, x.tur === "on" && s.olcekDar, yanitlar[i] === d && s.olcekSecili]}
                            onPress={() => setYanitlar({ ...yanitlar, [i]: d })}
                          >
                            <Text style={[s.olcekYazi, yanitlar[i] === d && { color: renk.beyaz }]}>{d}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={s.olcekUclar}>
                        <Text style={s.olcekUc}>{x.tur === "on" ? "Hiç" : mod === "yonetici" ? "Çok zayıf" : "Hiç katılmıyorum"}</Text>
                        <Text style={s.olcekUc}>{x.tur === "on" ? "Kesinlikle" : mod === "yonetici" ? "Çok iyi" : "Tamamen katılıyorum"}</Text>
                      </View>
                    </>
                  ) : x.tur === "secim" ? (
                    <View style={s.cipler}>
                      {x.secenekler.map((sc) => (
                        <TouchableOpacity
                          key={sc}
                          style={[s.cip, yanitlar[i] === sc && s.cipSecili]}
                          onPress={() => setYanitlar({ ...yanitlar, [i]: sc })}
                        >
                          <Text style={[s.cipYazi, yanitlar[i] === sc && { color: renk.beyaz }]}>{sc}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <TextInput
                      style={s.acik}
                      multiline
                      value={yanitlar[i] ?? ""}
                      onChangeText={(t) => setYanitlar({ ...yanitlar, [i]: t })}
                      placeholder="İsteğe bağlı"
                      placeholderTextColor="#a3a9a0"
                    />
                  )}

                  {aciklamaGerek(x, yanitlar[i]) ? (
                    <TextInput
                      style={[s.acik, { marginTop: 8, borderColor: renk.turuncu }]}
                      multiline
                      value={aciklamalar[i] ?? ""}
                      onChangeText={(t) => setAciklamalar({ ...aciklamalar, [i]: t })}
                      placeholder="Konuyu kısaca yazınız (zorunlu)"
                      placeholderTextColor="#a3a9a0"
                    />
                  ) : null}
                </View>
              ))}
            </ScrollView>

            <View style={s.alt}>
              <TouchableOpacity style={[s.gonder, (eksikVar || gonderiliyor) && s.gonderPasif]} disabled={gonderiliyor} onPress={gonder}>
                {gonderiliyor ? (
                  <ActivityIndicator color={renk.beyaz} />
                ) : (
                  <Text style={s.gonderYazi}>{mod === "yonetici" ? "Değerlendirmeyi gönder" : "Gönder"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */
/* Yönetici listeleri                                                         */
/* ========================================================================== */

/** mod = "belge" | "oryantasyon"; veri = /api/Gorev/Bekleyenler yanıtı */
export function EkipGorevleri({ mod, veri, kapat, yenile }) {
  const [form, setForm] = useState(null);
  const [bekleyen, setBekleyen] = useState(null);

  const belge = mod === "belge";
  const liste = belge ? veri?.ekipBelge ?? [] : veri?.ekipOryantasyon ?? [];

  const hatirlat = async (anahtar, islem) => {
    setBekleyen(anahtar);

    try {
      const c = await islem();
      Alert.alert(c?.tamam ? "Gönderildi" : "Bilgi", c?.mesaj ?? "Hatırlatma gönderildi.");
    } catch (h) {
      Alert.alert("Gönderilemedi", h.message);
    } finally {
      setBekleyen(null);
    }
  };

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.zemin }]} edges={["top", "bottom"]}>
        <View style={[s.ust, { backgroundColor: renk.beyaz }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.ustBaslik}>{belge ? "Evrak yüklemesi beklenenler" : "Oryantasyon bekleyenler"}</Text>
            <Text style={s.ustAlt}>
              {belge ? "İzin talebinin imzalı evrakı · 3 gün süre" : "Personel anketi ve sizin değerlendirmeniz"}
            </Text>
          </View>
          <TouchableOpacity onPress={kapat} hitSlop={12}>
            <Text style={s.ustKapat}>Kapat</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[s.govde, { gap: 10 }]}>
          {liste.length === 0 ? <Text style={s.bos}>Bekleyen kimse yok.</Text> : null}

          {liste.map((k) => (
            <View key={`${k.sicil}-${k.id ?? k.asama}`} style={s.kisiKart}>
              <View style={s.kisiUst}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.kisiAd} numberOfLines={1}>
                    {k.adSoyad}
                  </Text>
                  <Text style={s.kisiAlt} numberOfLines={1}>
                    {k.pozisyon ?? ""}
                    {belge ? ` · ${k.tur}` : ` · ${k.asamaAdi}`}
                  </Text>
                </View>
                <View style={[s.etk, (belge ? k.gecikti : k.kalanSaat < 24) ? s.etkTuruncu : s.etkYesil]}>
                  <Text style={[s.etkYazi, (belge ? k.gecikti : k.kalanSaat < 24) && { color: "#8f2f0b" }]}>
                    {belge ? (k.gecikti ? "gecikti" : kalanYaz(k.kalanSaat)) : kalanYaz(k.kalanSaat)}
                  </Text>
                </View>
              </View>

              {belge ? (
                <Text style={s.kisiNot}>
                  {gunAy(k.cikis)}
                  {gunAy(k.donus) !== gunAy(k.cikis) ? ` – ${gunAy(k.donus)}` : ""} izni · son gün {gunAy(k.son)}
                </Text>
              ) : (
                <View style={{ gap: 4, marginTop: 8 }}>
                  {k.test ? (
                    <Text style={s.kisiNot}>İK'nın gönderdiği deneme · yönetici formunu inceleyip gönderebilirsiniz</Text>
                  ) : (
                    <>
                      <Text style={s.kisiNot}>
                        {k.personelDoldurdu ? "✓ Personel anketini doldurdu" : "○ Personel anketi bekleniyor"}
                      </Text>
                      <Text style={s.kisiNot}>○ Sizin değerlendirmeniz bekleniyor</Text>
                    </>
                  )}
                </View>
              )}

              <View style={s.kisiDugmeler}>
                {belge ? (
                  <TouchableOpacity
                    style={s.ikincil}
                    disabled={bekleyen === k.id}
                    onPress={() => hatirlat(k.id, () => mazeretBelgeHatirlat(k.id))}
                  >
                    <Text style={s.ikincilYazi}>{bekleyen === k.id ? "Gönderiliyor" : "Hatırlat"}</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    {!k.personelDoldurdu && !k.test ? (
                      <TouchableOpacity
                        style={s.ikincil}
                        disabled={bekleyen === k.sicil}
                        onPress={() => hatirlat(k.sicil, () => oryantasyonHatirlat(k.sicil))}
                      >
                        <Text style={s.ikincilYazi}>{bekleyen === k.sicil ? "Gönderiliyor" : "Hatırlat"}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={s.birincil} onPress={() => setForm(k)}>
                      <Text style={s.birincilYazi}>Değerlendir</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {form ? (
          <OryantasyonFormu
            mod="yonetici"
            kisi={form}
            kapat={() => setForm(null)}
            tamam={() => {
              setForm(null);
              yenile?.();
            }}
          />
        ) : null}
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1 },

  ust: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  ustBaslik: { fontSize: 18, fontWeight: "800", color: renk.metin },
  ustAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },
  ustKapat: { fontSize: 14, fontWeight: "700", color: renk.pasif },

  govde: { padding: 18, paddingBottom: 40 },

  bilgi: {
    backgroundColor: "#fff1ea",
    borderRadius: 16,
    padding: 14,
    marginBottom: 6,
  },
  bilgiGecikti: { borderWidth: 1.5, borderColor: renk.turuncu },
  bilgiBaslik: { fontSize: 16, fontWeight: "800", color: renk.metin },
  bilgiAlt: { fontSize: 13, color: renk.pasif, marginTop: 2 },
  bilgiSure: { fontSize: 13, fontWeight: "800", color: "#8f2f0b", marginTop: 8 },

  etiket: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },

  cipler: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cip: {
    borderWidth: 1.5,
    borderColor: "#d5dbcf",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: renk.beyaz,
  },
  cipSecili: { backgroundColor: "#4f7a0b", borderColor: "#4f7a0b" },
  cipYazi: { fontSize: 13, fontWeight: "700", color: renk.metin },

  secDugme: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#b8c2ad",
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fafcf7",
  },
  secDugmeYazi: { fontSize: 15, fontWeight: "800", color: renk.metin },
  secDugmeAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },

  secilen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 10,
  },
  onizleme: { width: 72, height: 72, borderRadius: 10, backgroundColor: renk.zemin },
  pdf: { alignItems: "center", justifyContent: "center", backgroundColor: "#fdece7" },
  pdfYazi: { fontSize: 15, fontWeight: "800", color: renk.turuncu },
  secilenAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  degistir: { fontSize: 13, fontWeight: "800", color: renk.yesilKoyu, marginTop: 6 },

  alt: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: renk.cizgi, backgroundColor: renk.beyaz },
  gonder: { height: 52, borderRadius: 14, backgroundColor: "#4f7a0b", alignItems: "center", justifyContent: "center" },
  gonderPasif: { backgroundColor: "#c5c9c0" },
  gonderYazi: { color: renk.beyaz, fontSize: 15.5, fontWeight: "800" },
  ipucu: { fontSize: 12, color: renk.pasif, textAlign: "center", marginTop: 8 },

  giris: { fontSize: 13, color: renk.pasif, lineHeight: 19, marginBottom: 6 },
  soru: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#edf0ea" },
  soruMetin: { fontSize: 14.5, fontWeight: "700", color: renk.metin, lineHeight: 20, marginBottom: 10 },
  olcek: { flexDirection: "row", gap: 6 },
  olcekDugme: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#d5dbcf",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: renk.beyaz,
  },
  olcekDar: { height: 36, borderRadius: 8 },
  olcekSecili: { backgroundColor: "#4f7a0b", borderColor: "#4f7a0b" },
  olcekYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },
  olcekUclar: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  olcekUc: { fontSize: 11, color: renk.pasif },
  acik: {
    borderWidth: 1.5,
    borderColor: "#d5dbcf",
    borderRadius: 12,
    padding: 11,
    minHeight: 64,
    fontSize: 14,
    color: renk.metin,
    textAlignVertical: "top",
  },

  bitti: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  bittiDaire: { width: 72, height: 72, borderRadius: 36, backgroundColor: renk.yesilAcik, alignItems: "center", justifyContent: "center" },
  bittiTik: { fontSize: 34, fontWeight: "800", color: renk.yesilKoyu },
  bittiBaslik: { fontSize: 20, fontWeight: "800", color: renk.metin, marginTop: 14 },
  bittiYazi: { fontSize: 14, color: renk.pasif, textAlign: "center", marginTop: 6, lineHeight: 20 },

  bos: { fontSize: 13, color: renk.pasif, textAlign: "center", marginTop: 30 },
  kisiKart: { backgroundColor: renk.beyaz, borderRadius: 16, borderWidth: 1, borderColor: renk.cizgi, padding: 14 },
  kisiUst: { flexDirection: "row", alignItems: "center", gap: 10 },
  kisiAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  kisiAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },
  kisiNot: { fontSize: 12.5, color: renk.metin, marginTop: 6 },
  etk: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  etkTuruncu: { backgroundColor: "#fff1ea" },
  etkYesil: { backgroundColor: renk.yesilAcik },
  etkYazi: { fontSize: 11.5, fontWeight: "800", color: "#3f6507" },
  kisiDugmeler: { flexDirection: "row", gap: 8, marginTop: 12 },
  ikincil: { flex: 1, height: 40, borderRadius: 11, borderWidth: 1.5, borderColor: "#d5dbcf", alignItems: "center", justifyContent: "center" },
  ikincilYazi: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  adim: { flexDirection: "row", gap: 12 },
  adimSol: { alignItems: "center", width: 28 },
  adimNo: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "#c9d1c1", alignItems: "center", justifyContent: "center", backgroundColor: renk.beyaz },
  adimNoBitti: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  adimNoYazi: { fontSize: 13, fontWeight: "800", color: renk.pasif },
  adimCizgi: { flex: 1, width: 2, backgroundColor: "#e3e8dc", marginTop: 2 },
  adimBaslik: { fontSize: 15, fontWeight: "800", color: renk.metin, marginTop: 3 },
  adimAlt: { fontSize: 12.5, color: renk.pasif, lineHeight: 18, marginTop: 3 },
  baglanti: { marginTop: 8, alignSelf: "flex-start" },
  baglantiYazi: { fontSize: 13.5, fontWeight: "800", color: renk.yesilKoyu, textDecorationLine: "underline" },
  dosyaAdi: { fontSize: 12.5, color: renk.yesilKoyu, fontWeight: "700", marginTop: 8 },
  ikincilDar: { alignSelf: "flex-start", marginTop: 10, height: 38, paddingHorizontal: 16, borderRadius: 11, borderWidth: 1.5, borderColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  birincilDar: { alignSelf: "flex-start", marginTop: 10, height: 40, paddingHorizontal: 18, borderRadius: 11, backgroundColor: "#4f7a0b", alignItems: "center", justifyContent: "center" },
  kaynaklar: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  kaynak: { borderWidth: 1.5, borderStyle: "dashed", borderColor: "#b8c2ad", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "#fafcf7" },
  kaynakYazi: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  birincil: { flex: 1, height: 40, borderRadius: 11, backgroundColor: "#4f7a0b", alignItems: "center", justifyContent: "center" },
  birincilYazi: { fontSize: 13.5, fontWeight: "800", color: renk.beyaz },
});

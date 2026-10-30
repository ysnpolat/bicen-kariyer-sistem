/**
 * Biçen'den Haberler (08.10.2026, 1.7)
 * ---------------------------------------------------------------------------
 * Şirket içi sosyal akış: panelden yetki verilen kişiler (ve İK, kurum
 * adına) fotoğraflı gönderi paylaşıyor; bütün personel beğeniyor ve yorum
 * yazıyor. Görünüm bilinçli olarak Instagram'a yakın: kare görsel, çift
 * dokunuşla beğeni, altında beğeni sayısı, açıklama ve son yorumlar.
 *
 * Gönderiler kategorili (Duyuru, Mağazalarımız, Etkinlik, Tebrik…); üstteki
 * şeritten süzülüyor. Sabitlenen gönderi akışın başında kalıyor. Yorumu
 * kapatılan gönderide yorum alanı görünmüyor. Uygunsuz yorumu İK panelden
 * gizliyor.
 *
 * İki özel tür İK panelinden gönderiliyor:
 *  - "Kasada bu hafta": kampanya ürünleri (eski fiyat üstü çizili, yeni
 *    fiyat), dönem ve kasiyerin müşteriye söyleyeceği cümle.
 *  - Anket: tek seçim; oy veren yüzdeleri görür, kim ne verdi gizli.
 * İkisi de fotoğrafsız olabilir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Modal,
  TextInput,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
  Animated,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { haberAkisAl, haberBegen, haberYorumlarAl, haberYorumYaz, haberBegenenlerAl, haberPaylas, haberOy, haberProfilAl } from "../api";
import { renk } from "../tema";
import { Hata } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import ModalAlani, { modalTamEkran } from "../bilesenler/ModalAlani";
import KartZemin, { YESIL } from "../bilesenler/KartZemin";
import { ZoomluGorsel, TamEkranGorseller, HaberVideo } from "../bilesenler/HaberMedya";
import KART_LOGO from "../../assets/kart-logo.png";

import { galeridenSec } from "../dosyaSecici";
let ImagePicker = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  /* web ön izlemesinde yok */
}

const GENISLIK = Dimensions.get("window").width;
const KIRMIZI = "#ed4956";

/* ------------------------------------------------------------ yardımcılar */

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** "şimdi", "5 dk", "3 sa", "2 g", "12 Eki" */
export const goreceZaman = (v) => {
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "";
  const dk = Math.floor((Date.now() - t.getTime()) / 60000);
  if (dk < 1) return "şimdi";
  if (dk < 60) return `${dk} dk`;
  if (dk < 60 * 24) return `${Math.floor(dk / 60)} sa`;
  if (dk < 60 * 24 * 7) return `${Math.floor(dk / 1440)} g`;
  return `${t.getDate()} ${AYLAR[t.getMonth()]}${t.getFullYear() !== new Date().getFullYear() ? ` ${t.getFullYear()}` : ""}`;
};

const sayiYaz = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(".", ",")} B` : n.toLocaleString("tr-TR"));

const basHarf = (ad) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");

function Avatar({ kisi, boyut = 34, halka = false }) {
  const ic = kisi?.foto ? (
    <Image source={{ uri: kisi.foto }} style={{ width: boyut, height: boyut, borderRadius: boyut / 2 }} />
  ) : (
    <View
      style={{
        width: boyut,
        height: boyut,
        borderRadius: boyut / 2,
        backgroundColor: kisi?.kurum ? renk.yesil : "#e8efe0",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: boyut * 0.36, fontWeight: "800", color: kisi?.kurum ? "#fff" : renk.yesilKoyu }}>
        {kisi?.kurum ? "b" : basHarf(kisi?.ad)}
      </Text>
    </View>
  );

  if (!halka) return ic;

  return (
    <View style={{ padding: 2, borderRadius: boyut, borderWidth: 2, borderColor: renk.yesil }}>
      <View style={{ padding: 1.5, borderRadius: boyut, backgroundColor: "#fff" }}>{ic}</View>
    </View>
  );
}

function Onayli() {
  return (
    <View style={s.onayli}>
      <Text style={s.onayliYazi}>✓</Text>
    </View>
  );
}

/* --------------------------------------------------------- özel türler */

const fiyat = (v) => `₺${v}`;

/** Kasada bu hafta: ürün satırları ve müşteriye söylenecek cümle */
function KampanyaKart({ k }) {
  if (!k) return null;

  return (
    <View style={s.kampanya}>
      <View style={s.kampanyaBas}>
        <Text style={s.kampanyaBaslik} numberOfLines={2}>
          🏷️ {k.baslik}
        </Text>
        {k.donem ? (
          <View style={s.donem}>
            <Text style={s.donemYazi}>{k.donem}</Text>
          </View>
        ) : null}
      </View>

      {(k.urunler ?? []).map((u, i) => {
        const indirim = u.eski ? Math.round((100 * (u.eski - u.yeni)) / u.eski) : 0;
        return (
          <View key={i} style={[s.urun, i > 0 && { borderTopWidth: 1, borderTopColor: "#e3eaf3" }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.urunAd} numberOfLines={2}>
                {u.ad}
              </Text>
              {u.birim ? <Text style={s.urunBirim}>{u.birim}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {u.eskiYazi ? <Text style={s.eskiFiyat}>{fiyat(u.eskiYazi)}</Text> : null}
              <Text style={s.yeniFiyat}>{fiyat(u.yeniYazi)}</Text>
            </View>
            {indirim > 0 ? (
              <View style={s.indirim}>
                <Text style={s.indirimYazi}>%{indirim}</Text>
              </View>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>
        );
      })}

      {k.soyle ? (
        <View style={s.soyle}>
          <Text style={s.soyleEtiket}>💬 MÜŞTERİYE SÖYLE</Text>
          <Text style={s.soyleYazi}>{k.soyle}</Text>
        </View>
      ) : null}
    </View>
  );
}

const bitisYaz = (a) => {
  if (a.bitti) return "Anket sona erdi";
  if (!a.bitis) return null;
  const [y, m, d] = a.bitis.split("-").map(Number);
  const bugun = new Date();
  const gun = Math.round((new Date(y, m - 1, d) - new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate())) / 86400000);
  if (gun <= 0) return "Bugün kapanıyor";
  if (gun === 1) return "Yarın kapanıyor";
  return `${gun} gün kaldı`;
};

/** Anket: oy verilene kadar düğme, sonra yüzde çubukları */
function AnketKart({ g, onOy }) {
  const a = g.anket;
  const [bekliyor, setBekliyor] = useState(null);
  if (!a) return null;

  const oyVerebilir = a.oyum === null && !a.bitti;
  const sonuc = a.sonucGorunur;

  const sec = async (i) => {
    if (!oyVerebilir || bekliyor !== null) return;
    setBekliyor(i);
    try {
      await onOy(g, i);
    } finally {
      setBekliyor(null);
    }
  };

  return (
    <View style={s.anket}>
      <Text style={s.anketSoru}>📊 {a.soru}</Text>

      {(a.secenekler ?? []).map((x, i) => {
        const secili = a.oyum === i;
        const yuzde = x.yuzde ?? 0;
        return (
          <TouchableOpacity
            key={i}
            activeOpacity={oyVerebilir ? 0.7 : 1}
            onPress={() => sec(i)}
            disabled={!oyVerebilir}
            style={[s.anketSecenek, secili && { borderColor: renk.mor }]}
          >
            {sonuc ? <View style={[s.anketDolgu, { width: `${yuzde}%` }, secili && { backgroundColor: "#e6d8fb" }]} /> : null}
            <Text style={[s.anketAd, secili && { color: renk.mor }]} numberOfLines={2}>
              {secili ? "✓ " : ""}
              {x.ad}
            </Text>
            {bekliyor === i ? (
              <ActivityIndicator size="small" color={renk.mor} />
            ) : sonuc ? (
              <Text style={[s.anketYuzde, secili && { color: renk.mor }]}>%{yuzde}</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}

      <Text style={s.anketAlt}>
        {[
          sonuc ? `${sayiYaz(a.toplam ?? 0)} oy` : "Sonuçlar oy verince görünür",
          bitisYaz(a),
          "kim ne verdi gizli",
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </View>
  );
}

/* --------------------------------------------------------------- gönderi */

/* Görselin en/boy oranı (09.10.2026): kare kırpma yerine görselin
   tamamı görünsün. Oran 3:4 (dik) ile 1.91:1 (yatay) arasında tutuluyor;
   bunun dışındaki görsel kenarlarında boşlukla, kırpılmadan sığdırılıyor. */
const oranlar = new Map();

function useOran(uri) {
  const [oran, setOran] = useState(() => (uri ? oranlar.get(uri) ?? null : null));

  useEffect(() => {
    if (!uri) return;
    if (oranlar.has(uri)) {
      setOran(oranlar.get(uri));
      return;
    }
    let iptal = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (w > 0 && h > 0) {
          oranlar.set(uri, w / h);
          if (!iptal) setOran(w / h);
        }
      },
      () => {}
    );
    return () => {
      iptal = true;
    };
  }, [uri]);

  return oran;
}

export const gorselYuksekligi = (oran, genislik = GENISLIK) => genislik / Math.min(1.91, Math.max(0.75, oran ?? 1));

function Gorseller({ gorseller, onCiftDokun }) {
  const [sira, setSira] = useState(0);
  const oran = useOran(gorseller?.[0]);
  const yukseklik = gorselYuksekligi(oran);

  /* İki parmakla büyütürken sayfalar kaymasın; tam ekran (12.10.2026) */
  const [zoomda, setZoomda] = useState(false);
  const [tamEkran, setTamEkran] = useState(null);

  if (!gorseller?.length) return null;

  return (
    <View style={{ zIndex: zoomda ? 30 : 0, elevation: zoomda ? 30 : 0 }}>
      <ScrollView
        horizontal
        pagingEnabled
        scrollEnabled={!zoomda}
        showsHorizontalScrollIndicator={false}
        onScroll={(e) => setSira(Math.round(e.nativeEvent.contentOffset.x / GENISLIK))}
        scrollEventThrottle={32}
        style={{ overflow: zoomda ? "visible" : "hidden" }}
      >
        {gorseller.map((g, i) => (
          <ZoomluGorsel
            key={i}
            uri={g}
            genislik={GENISLIK}
            yukseklik={yukseklik}
            onZoom={setZoomda}
            onCiftDokun={onCiftDokun}
          />
        ))}
      </ScrollView>

      {/* Tam ekran: büyütüp gezmek için */}
      {!zoomda ? (
        <TouchableOpacity style={s.tamEkranDugme} onPress={() => setTamEkran(sira)} hitSlop={8} accessibilityLabel="Tam ekran">
          <Text style={s.tamEkranYazi}>⤢</Text>
        </TouchableOpacity>
      ) : null}

      {tamEkran !== null ? <TamEkranGorseller gorseller={gorseller} baslangic={tamEkran} kapat={() => setTamEkran(null)} /> : null}

      {gorseller.length > 1 ? (
        <>
          <View style={s.sayac}>
            <Text style={s.sayacYazi}>
              {sira + 1}/{gorseller.length}
            </Text>
          </View>
          <View style={s.noktalar}>
            {gorseller.map((_, i) => (
              <View key={i} style={[s.nokta, i === sira && s.noktaSecili]} />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function GonderiKart({ g, gorunur, onBegen, onYorumlar, onBegenenler, onOy, onProfil }) {
  const [acik, setAcik] = useState(false);
  const kalp = useRef(new Animated.Value(0)).current;

  const ciftDokun = () => {
    if (!g.begendim) onBegen(g, true);
    kalp.setValue(0);
    Animated.sequence([
      Animated.spring(kalp, { toValue: 1, useNativeDriver: true, friction: 4 }),
      Animated.delay(450),
      Animated.timing(kalp, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const uzun = (g.metin ?? "").length > 110;

  return (
    <View style={s.kart}>
      <View style={s.ust}>
        {/* Ada ya da fotoğrafa dokununca gönderenin profili (09.10.2026) */}
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={!onProfil || !g.yazar?.profil}
          onPress={() => onProfil?.(g.yazar)}
          style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}
        >
          <Avatar kisi={g.yazar} halka={g.yazar?.kurum} />
          <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={s.yazar} numberOfLines={1}>
                {g.yazar?.ad}
              </Text>
              {g.yazar?.kurum ? <Onayli /> : null}
            </View>
            <Text style={s.yazarAlt} numberOfLines={1}>
              {[g.yazar?.unvan, g.konum].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </TouchableOpacity>
        {g.sabit ? (
          <View style={s.sabit}>
            <Simge ad="sabit" boyut={12} renkli={renk.yesilKoyu} />
            <Text style={s.sabitYazi}>Sabit</Text>
          </View>
        ) : null}
        {g.kategori ? (
          <View
            style={[
              s.kategori,
              g.tur === "kampanya" && { backgroundColor: renk.maviAcik, borderColor: renk.maviAcik },
              g.tur === "anket" && { backgroundColor: renk.morAcik, borderColor: renk.morAcik },
            ]}
          >
            <Text
              style={[
                s.kategoriYazi,
                g.tur === "kampanya" && { color: renk.mavi },
                g.tur === "anket" && { color: renk.mor },
              ]}
            >
              {g.kategori}
            </Text>
          </View>
        ) : null}
      </View>

      <View>
        {/* Video (1.7): ekrana gelince sessiz oynar */}
        {g.video ? <HaberVideo uri={g.video} genislik={GENISLIK} gorunur={gorunur} onCiftDokun={ciftDokun} /> : null}
        <Gorseller gorseller={g.gorseller} onCiftDokun={ciftDokun} />
        <Animated.View
          pointerEvents="none"
          style={[
            s.buyukKalp,
            { opacity: kalp, transform: [{ scale: kalp.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
          ]}
        >
          {/* Çift dokunuş: kırmızı kalp (12.10.2026) */}
          <Simge ad="kalp" boyut={96} renkli={KIRMIZI} dolgu />
        </Animated.View>
      </View>

      {/* Çoklu fotoğrafın noktaları görselin altına taşıyor: blok onlardan sonra başlasın */}
      {g.tur === "kampanya" || g.tur === "anket" ? (
        <View style={{ marginTop: g.gorseller?.length > 1 ? 14 : 0 }}>
          {g.tur === "kampanya" ? <KampanyaKart k={g.kampanya} /> : <AnketKart g={g} onOy={onOy} />}
        </View>
      ) : null}

      <View style={s.eylemler}>
        <TouchableOpacity onPress={() => onBegen(g, !g.begendim)} hitSlop={8} style={s.eylem}>
          {g.begendim ? <Simge ad="kalp" boyut={26} renkli={KIRMIZI} dolgu /> : <Simge ad="kalp" boyut={26} renkli={renk.metin} />}
        </TouchableOpacity>
        {g.yorumAcik ? (
          <TouchableOpacity onPress={() => onYorumlar(g)} hitSlop={8} style={s.eylem}>
            <Simge ad="yorum" boyut={25} renkli={renk.metin} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }} />
        <Text style={s.zaman}>{goreceZaman(g.tarih)}</Text>
      </View>

      <View style={s.govde}>
        {g.begeni > 0 ? (
          <TouchableOpacity onPress={() => onBegenenler(g)}>
            <Text style={s.begeni}>
              {g.begeniOzet ? (
                <>
                  <Text style={{ fontWeight: "800" }}>{g.begeniOzet}</Text>
                  {g.begeni > 1 ? ` ve ${sayiYaz(g.begeni - 1)} kişi beğendi` : " beğendi"}
                </>
              ) : (
                `${sayiYaz(g.begeni)} beğenme`
              )}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[s.begeni, { color: renk.pasif, fontWeight: "500" }]}>İlk beğenen sen ol</Text>
        )}

        {g.metin ? (
          <Text style={s.metin} numberOfLines={acik ? undefined : 2} onPress={() => setAcik(true)}>
            <Text style={{ fontWeight: "800" }} onPress={onProfil && g.yazar?.profil ? () => onProfil(g.yazar) : undefined}>
              {g.yazar?.ad}{" "}
            </Text>
            {g.metin}
          </Text>
        ) : null}
        {uzun && !acik ? (
          <Text style={s.devami} onPress={() => setAcik(true)}>
            devamı
          </Text>
        ) : null}

        {g.yorumAcik && g.yorumSayisi > 0 ? (
          <TouchableOpacity onPress={() => onYorumlar(g)}>
            <Text style={s.tumYorumlar}>
              {g.yorumSayisi > 2 ? `${g.yorumSayisi} yorumun tümünü gör` : "Yorumları gör"}
            </Text>
          </TouchableOpacity>
        ) : null}

        {g.yorumAcik
          ? (g.sonYorumlar ?? []).slice(0, 2).map((y, i) => (
              <Text key={i} style={s.kisaYorum} numberOfLines={1}>
                <Text style={{ fontWeight: "800" }}>{y.ad} </Text>
                {y.metin}
              </Text>
            ))
          : null}

        {g.yorumAcik ? (
          <TouchableOpacity onPress={() => onYorumlar(g, true)} style={s.yorumEkle}>
            <Avatar kisi={{ ad: g.benAd }} boyut={24} />
            <Text style={s.yorumEkleYazi}>Yorum ekle…</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[s.tumYorumlar, { fontStyle: "italic" }]}>Bu gönderide yorumlar kapalı.</Text>
        )}
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- yorumlar */

export function YorumlarPenceresi({ gonderi, odak, kapat, yorumEklendi }) {
  const [yorumlar, setYorumlar] = useState(null);
  const [metin, setMetin] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (!gonderi) return;
    setYorumlar(null);
    setMetin("");
    haberYorumlarAl(gonderi.id)
      .then((v) => setYorumlar(v?.yorumlar ?? []))
      .catch(() => setYorumlar([]));
  }, [gonderi]);

  const gonder = async () => {
    const m = metin.trim();
    if (!m) return;
    setGonderiliyor(true);
    try {
      const c = await haberYorumYaz(gonderi.id, m);
      setYorumlar((l) => [...(l ?? []), c?.yorum ?? { id: Date.now(), ad: gonderi.benAd, metin: m, tarih: new Date().toISOString(), benim: true }]);
      setMetin("");
      yorumEklendi?.(gonderi.id);
    } catch (e) {
      Alert.alert("Yorum gönderilemedi", e?.message ?? "");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal visible={!!gonderi} animationType="slide" onRequestClose={kapat} {...modalTamEkran}>
      <ModalAlani style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
        <View style={s.pencereBas}>
          <TouchableOpacity onPress={kapat} hitSlop={10} style={{ transform: [{ rotate: "180deg" }] }}>
            <Simge ad="ok" boyut={22} renkli={renk.metin} />
          </TouchableOpacity>
          <Text style={s.pencereBaslik}>Yorumlar</Text>
          <View style={{ width: 20 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 16 }}>
            {gonderi?.metin ? (
              <View style={[s.yorum, { paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: renk.cizgi }]}>
                <Avatar kisi={gonderi.yazar} boyut={32} />
                <View style={{ flex: 1 }}>
                  <Text style={s.yorumMetin}>
                    <Text style={{ fontWeight: "800" }}>{gonderi.yazar?.ad} </Text>
                    {gonderi.metin}
                  </Text>
                  <Text style={s.yorumZaman}>{goreceZaman(gonderi.tarih)}</Text>
                </View>
              </View>
            ) : null}

            {yorumlar === null ? (
              <ActivityIndicator color={renk.yesil} />
            ) : yorumlar.length === 0 ? (
              <Text style={{ textAlign: "center", color: renk.pasif, marginTop: 20 }}>Henüz yorum yok. İlk yorumu sen yaz.</Text>
            ) : (
              yorumlar.map((y) => (
                <View key={y.id} style={s.yorum}>
                  <Avatar kisi={y} boyut={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.yorumMetin}>
                      <Text style={{ fontWeight: "800" }}>{y.ad} </Text>
                      {y.metin}
                    </Text>
                    <Text style={s.yorumZaman}>
                      {goreceZaman(y.tarih)}
                      {y.unvan ? ` · ${y.unvan}` : ""}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={s.yorumGiris}>
            <Avatar kisi={{ ad: gonderi?.benAd }} boyut={32} />
            <TextInput
              style={s.yorumKutu}
              placeholder={`${gonderi?.yazar?.ad ?? ""} için yorum ekle…`}
              placeholderTextColor="#9aa1a9"
              value={metin}
              onChangeText={setMetin}
              autoFocus={!!odak}
              multiline
              maxLength={500}
            />
            <TouchableOpacity onPress={gonder} disabled={!metin.trim() || gonderiliyor} hitSlop={8}>
              <Text style={[s.paylasYazi, (!metin.trim() || gonderiliyor) && { opacity: 0.4 }]}>Paylaş</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.kural}>Yorumlar bütün çalışma arkadaşlarına görünür. Saygılı bir dil kullanalım.</Text>
        </KeyboardAvoidingView>
      </ModalAlani>
    </Modal>
  );
}

function BegenenlerPenceresi({ gonderi, kapat }) {
  const [liste, setListe] = useState(null);

  useEffect(() => {
    if (!gonderi) return;
    setListe(null);
    haberBegenenlerAl(gonderi.id)
      .then((v) => setListe(v?.kisiler ?? []))
      .catch(() => setListe([]));
  }, [gonderi]);

  return (
    <Modal visible={!!gonderi} animationType="slide" onRequestClose={kapat} {...modalTamEkran}>
      <ModalAlani style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
        <View style={s.pencereBas}>
          <TouchableOpacity onPress={kapat} hitSlop={10} style={{ transform: [{ rotate: "180deg" }] }}>
            <Simge ad="ok" boyut={22} renkli={renk.metin} />
          </TouchableOpacity>
          <Text style={s.pencereBaslik}>Beğenenler</Text>
          <View style={{ width: 20 }} />
        </View>
        {liste === null ? (
          <ActivityIndicator color={renk.yesil} style={{ marginTop: 30 }} />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }}>
            {liste.map((k, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar kisi={k} boyut={40} />
                <View>
                  <Text style={{ fontWeight: "700", color: renk.metin }}>{k.ad}</Text>
                  <Text style={{ fontSize: 12.5, color: renk.pasif }}>{[k.unvan, k.sube].filter(Boolean).join(" · ")}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </ModalAlani>
    </Modal>
  );
}

/* ---------------------------------------------------------- yeni gönderi */

/** Seçilen fotoğraf akışta nasıl görünecekse öyle: tamamı, kırpılmadan */
function OnizlemeGorsel({ uri }) {
  const oran = useOran(uri);
  return (
    <Image source={{ uri }} style={{ width: GENISLIK, height: gorselYuksekligi(oran), backgroundColor: "#f4f5f2" }} resizeMode="contain" />
  );
}

export function YeniGonderi({ acik, kapat, kategoriler, paylasildi, onizleme }) {
  const [gorseller, setGorseller] = useState(onizleme?.gorseller ?? []);
  const [secili, setSecili] = useState(0);
  const [metin, setMetin] = useState(onizleme?.metin ?? "");
  const [kategori, setKategori] = useState(onizleme?.kategori ?? kategoriler?.[0] ?? null);
  const [yorumAcik, setYorumAcik] = useState(true);
  const [bildirim, setBildirim] = useState(true);
  const [paylasiliyor, setPaylasiliyor] = useState(false);

  /* Video (12.10.2026): bir gönderide bir video; en çok 300 MB */
  const [video, setVideo] = useState(null);
  const [ilerleme, setIlerleme] = useState(null);

  const videoSec = async () => {
    if (!ImagePicker) return;
    const izin = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
    if (izin && !izin.granted) {
      Alert.alert("İzin gerekli", "Video seçmek için galeri izni verin.");
      return;
    }
    let c;
    try {
      c = await galeridenSec({ mediaTypes: ["videos"], allowsMultipleSelection: false, videoMaxDuration: 600 });
    } catch (e) {
      Alert.alert("Video seçilemedi", e?.message ?? "");
      return;
    }
    if (c?.canceled || !c?.assets?.length) return;
    const a = c.assets[0];
    if (a.fileSize && a.fileSize > 300 * 1024 * 1024) {
      Alert.alert("Video çok büyük", "Video en çok 300 MB olabilir. Daha kısa bir video seçin.");
      return;
    }
    setVideo({ uri: a.uri, boyut: a.fileSize ?? null, ad: a.fileName ?? a.uri, sure: a.duration ?? null });
  };

  const fotografSec = async () => {
    if (!ImagePicker) return;
    const izin = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
    if (izin && !izin.granted) {
      Alert.alert("İzin gerekli", "Fotoğraf seçmek için galeri izni verin.");
      return;
    }
    let c;
    try {
      /* Android'de seçici açılamazsa yeniden dener, sistem dosya seçicisine geçer */
      c = await galeridenSec({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 10 - gorseller.length,
        quality: 0.7,
      });
    } catch (e) {
      Alert.alert("Fotoğraf seçilemedi", e?.message ?? "");
      return;
    }
    if (!c.canceled) setGorseller((l) => [...l, ...c.assets.map((a) => a.uri)].slice(0, 10));
  };

  const paylas = async () => {
    if (gorseller.length === 0 && !video) {
      Alert.alert("Fotoğraf ya da video ekleyin", "Gönderide en az bir fotoğraf ya da video olmalı.");
      return;
    }
    setPaylasiliyor(true);
    try {
      await haberPaylas({
        gorseller,
        video,
        metin: metin.trim(),
        kategori,
        yorumAcik,
        bildirim,
        ilerleme: video ? setIlerleme : undefined,
      });
      setGorseller([]);
      setVideo(null);
      setMetin("");
      paylasildi?.();
    } catch (e) {
      Alert.alert("Paylaşılamadı", e?.message ?? "");
    } finally {
      setPaylasiliyor(false);
      setIlerleme(null);
    }
  };

  const kucuk = (GENISLIK - 28 - 8 * 4) / 5;

  return (
    <Modal visible={acik} animationType="slide" onRequestClose={kapat} {...modalTamEkran}>
      <ModalAlani style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
        <View style={s.pencereBas}>
          <TouchableOpacity onPress={kapat} hitSlop={10}>
            <Text style={{ fontSize: 15, color: renk.metin }}>Vazgeç</Text>
          </TouchableOpacity>
          <Text style={s.pencereBaslik}>Yeni gönderi</Text>
          <TouchableOpacity onPress={paylas} disabled={paylasiliyor} hitSlop={10}>
            {paylasiliyor ? (
              ilerleme != null ? (
                <Text style={s.paylasYazi}>%{Math.round(ilerleme * 100)}</Text>
              ) : (
                <ActivityIndicator color={renk.yesil} />
              )
            ) : (
              <Text style={s.paylasYazi}>Paylaş</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {gorseller.length > 0 ? (
            <OnizlemeGorsel uri={gorseller[Math.min(secili, gorseller.length - 1)]} />
          ) : video ? null : (
            <View style={[s.bosGorsel, { height: GENISLIK * 0.82, flexDirection: "row", gap: 12 }]}>
              <TouchableOpacity onPress={fotografSec} style={s.secimKutu} activeOpacity={0.85}>
                <Simge ad="foto" boyut={40} renkli={renk.yesilKoyu} />
                <Text style={{ marginTop: 10, fontWeight: "800", color: renk.yesilKoyu }}>Fotoğraf seç</Text>
                <Text style={{ fontSize: 12, color: renk.pasif, marginTop: 2 }}>En fazla 10</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={videoSec} style={s.secimKutu} activeOpacity={0.85}>
                <Text style={{ fontSize: 34, color: renk.yesilKoyu }}>▶</Text>
                <Text style={{ marginTop: 6, fontWeight: "800", color: renk.yesilKoyu }}>Video seç</Text>
                <Text style={{ fontSize: 12, color: renk.pasif, marginTop: 2 }}>En çok 300 MB</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Seçilen video */}
          {video ? (
            <View style={s.videoSecili}>
              <View style={s.videoSeciliSimge}>
                <Text style={{ color: "#fff", fontSize: 18 }}>▶</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: "800", color: renk.metin }}>Video eklendi</Text>
                <Text style={{ fontSize: 12.5, color: renk.pasif, marginTop: 1 }} numberOfLines={1}>
                  {[
                    video.boyut ? `${(video.boyut / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : null,
                    video.sure ? `${Math.floor(video.sure / 60000)}:${String(Math.round((video.sure % 60000) / 1000)).padStart(2, "0")}` : null,
                    ilerleme != null ? `yükleniyor %${Math.round(ilerleme * 100)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "paylaşınca yüklenecek"}
                </Text>
              </View>
              {!paylasiliyor ? (
                <TouchableOpacity onPress={() => setVideo(null)} hitSlop={10}>
                  <Text style={{ color: renk.kirmizi, fontWeight: "700" }}>Kaldır</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : gorseller.length > 0 ? (
            <TouchableOpacity onPress={videoSec} style={s.videoEkle} activeOpacity={0.85}>
              <Text style={{ color: renk.yesilKoyu, fontWeight: "800" }}>▶  Video da ekle</Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 14, gap: 8 }}>
            {gorseller.map((g, i) => (
              <TouchableOpacity key={i} onPress={() => setSecili(i)} onLongPress={() => setGorseller((l) => l.filter((_, j) => j !== i))}>
                <Image source={{ uri: g }} style={[{ width: kucuk, height: kucuk, borderRadius: 8 }, i === secili && { borderWidth: 2.5, borderColor: renk.yesil }]} />
              </TouchableOpacity>
            ))}
            {gorseller.length < 10 ? (
              <TouchableOpacity onPress={fotografSec} style={[s.ekleKutu, { width: kucuk, height: kucuk }]}>
                <Text style={{ fontSize: 26, color: renk.yesilKoyu, fontWeight: "300" }}>+</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>

          <View style={{ paddingHorizontal: 14 }}>
            <TextInput
              style={s.aciklamaKutu}
              placeholder="Açıklama yaz…"
              placeholderTextColor="#9aa1a9"
              value={metin}
              onChangeText={setMetin}
              multiline
              maxLength={2200}
            />

            <Text style={s.etiket}>KATEGORİ</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(kategoriler ?? []).map((k) => (
                <TouchableOpacity key={k} onPress={() => setKategori(k)} style={[s.secenek, kategori === k && s.secenekSecili]}>
                  <Text style={[s.secenekYazi, kategori === k && { color: "#fff" }]}>{k}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.ayar}>
              <View style={{ flex: 1 }}>
                <Text style={s.ayarAd}>Yorumlara izin ver</Text>
                <Text style={s.ayarAlt}>Kapalıysa yalnızca beğenilebilir</Text>
              </View>
              <Switch value={yorumAcik} onValueChange={setYorumAcik} trackColor={{ true: renk.yesil }} />
            </View>
            <View style={s.ayar}>
              <View style={{ flex: 1 }}>
                <Text style={s.ayarAd}>Herkese bildirim gönder</Text>
                <Text style={s.ayarAlt}>"Biçen'den Haberler'de yeni gönderi"</Text>
              </View>
              <Switch value={bildirim} onValueChange={setBildirim} trackColor={{ true: renk.yesil }} />
            </View>
          </View>
        </ScrollView>
      </ModalAlani>
    </Modal>
  );
}

/* ---------------------------------------------------------------- profil */

const KARE = (GENISLIK - 4) / 3;

function Sayi({ deger, ad }) {
  return (
    <View style={{ alignItems: "center", minWidth: 64 }}>
      <Text style={s.profilSayi}>{sayiYaz(deger ?? 0)}</Text>
      <Text style={s.profilSayiAd}>{ad}</Text>
    </View>
  );
}

/** Izgaradaki kare: ilk fotoğraf ya da fotoğrafsız gönderinin özeti */
function Kare({ g, onPress }) {
  const ilk = g.gorseller?.[0];
  const ozet = g.tur === "anket" ? g.anket?.soru : g.tur === "kampanya" ? g.kampanya?.baslik : g.metin;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={{ width: KARE, height: KARE, backgroundColor: "#f1f3ee" }}>
      {ilk ? (
        <Image source={{ uri: ilk }} style={{ width: KARE, height: KARE }} resizeMode="cover" />
      ) : (
        <View
          style={[
            s.kareBos,
            g.tur === "anket" && { backgroundColor: renk.morAcik },
            g.tur === "kampanya" && { backgroundColor: renk.maviAcik },
          ]}
        >
          <Text style={{ fontSize: 22 }}>{g.tur === "anket" ? "📊" : g.tur === "kampanya" ? "🏷️" : "📝"}</Text>
          <Text
            style={[s.kareYazi, g.tur === "anket" && { color: renk.mor }, g.tur === "kampanya" && { color: renk.mavi }]}
            numberOfLines={3}
          >
            {ozet}
          </Text>
        </View>
      )}
      {g.gorseller?.length > 1 ? (
        <View style={[s.kareRozet, { right: 6 }]}>
          <Text style={s.kareRozetYazi}>{g.gorseller.length}</Text>
        </View>
      ) : null}
      {g.sabit ? (
        <View style={[s.kareRozet, { left: 6 }]}>
          <Simge ad="sabit" boyut={11} renkli="#fff" />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/**
 * Gönderenin sayfası (09.10.2026): fotoğraf, ad, ünvan, tanıtım, gönderi /
 * beğeni / yorum sayısı ve gönderileri ızgara hâlinde. Kareye dokununca
 * gönderiler akış düzeninde o gönderiden başlayarak açılıyor; beğeni ve
 * yorum burada da yapılabiliyor, ana akış da güncelleniyor.
 */
export function ProfilPenceresi({ yazar, kapat, guncellendi }) {
  const [v, setV] = useState(null);
  const [hata, setHata] = useState("");
  const [bas, setBas] = useState(null);
  const [yorumlar, setYorumlar] = useState(null);
  const [yorumOdak, setYorumOdak] = useState(false);
  const [begenenler, setBegenenler] = useState(null);

  const anahtar = yazar?.profil;

  useEffect(() => {
    if (!anahtar) return;
    setV(null);
    setHata("");
    setBas(null);
    haberProfilAl(anahtar)
      .then(setV)
      .catch((e) => setHata(e?.message ?? "Profil açılamadı."));
  }, [anahtar]);

  const degistir = (id, f) => {
    setV((x) => (x ? { ...x, gonderiler: x.gonderiler.map((g) => (g.id === id ? f(g) : g)) } : x));
    guncellendi?.(id, f);
  };

  const begen = async (g, b) => {
    const f = (x) => ({ ...x, begendim: b, begeni: Math.max(0, x.begeni + (b ? 1 : -1)) });
    const geri = (x) => ({ ...x, begendim: !b, begeni: Math.max(0, x.begeni + (b ? -1 : 1)) });
    degistir(g.id, f);
    try {
      await haberBegen(g.id, b);
    } catch {
      degistir(g.id, geri);
    }
  };

  const oyla = async (g, secenek) => {
    try {
      const yeni = await haberOy(g.id, secenek);
      if (yeni) degistir(g.id, () => yeni);
    } catch (e) {
      Alert.alert("Oy kaydedilemedi", e?.message ?? "");
    }
  };

  const p = v?.profil ?? yazar ?? {};
  const liste = (v?.gonderiler ?? []).map((g) => ({ ...g, benAd: v?.ben?.ad }));

  const basBilgi = (
    <View style={s.profilBas}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Avatar kisi={p} boyut={82} halka={!!p.kurum} />
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-around" }}>
          <Sayi deger={v?.gonderiSayisi} ad="gönderi" />
          <Sayi deger={v?.begeniToplam} ad="beğeni" />
          <Sayi deger={v?.yorumToplam} ad="yorum" />
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 }}>
        <Text style={s.profilAd}>{p.ad}</Text>
        {p.kurum ? <Onayli /> : null}
      </View>
      {p.unvan ? <Text style={s.profilUnvan}>{p.unvan}</Text> : null}
      {p.aciklama ? <Text style={s.profilAciklama}>{p.aciklama}</Text> : null}
      <View style={s.profilSekme}>
        <Simge ad="izgara" boyut={20} renkli={renk.metin} />
        <Text style={s.profilSekmeYazi}>GÖNDERİLER</Text>
      </View>
    </View>
  );

  return (
    <Modal visible={!!yazar} animationType="slide" onRequestClose={() => (bas !== null ? setBas(null) : kapat())} {...modalTamEkran}>
      <ModalAlani style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "bottom"]}>
        <View style={s.pencereBas}>
          <TouchableOpacity
            onPress={() => (bas !== null ? setBas(null) : kapat())}
            hitSlop={12}
            style={{ transform: [{ rotate: "180deg" }] }}
          >
            <Simge ad="ok" boyut={22} renkli={renk.metin} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            {bas !== null ? <Text style={s.profilKucukAd}>{(p.ad ?? "").toLocaleUpperCase("tr")}</Text> : null}
            <Text style={s.pencereBaslik} numberOfLines={1}>
              {bas !== null ? "Gönderiler" : p.ad}
            </Text>
          </View>
          <View style={{ width: 22 }} />
        </View>

        {hata ? (
          <View style={{ padding: 14 }}>
            <Hata metin={hata} />
          </View>
        ) : !v ? (
          <ActivityIndicator color={renk.yesil} style={{ marginTop: 40 }} />
        ) : bas === null ? (
          <FlatList
            key="izgara"
            data={liste}
            numColumns={3}
            keyExtractor={(g) => String(g.id)}
            columnWrapperStyle={{ gap: 2 }}
            ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
            ListHeaderComponent={basBilgi}
            ListEmptyComponent={<Text style={{ textAlign: "center", color: renk.pasif, marginTop: 30 }}>Henüz gönderi yok.</Text>}
            renderItem={({ item, index }) => <Kare g={item} onPress={() => setBas(index)} />}
          />
        ) : (
          <FlatList
            key={`liste-${bas}`}
            data={liste.slice(bas)}
            keyExtractor={(g) => String(g.id)}
            contentContainerStyle={{ paddingTop: 6 }}
            renderItem={({ item }) => (
              <GonderiKart
                g={item}
                onBegen={begen}
                onYorumlar={(g, odak) => {
                  setYorumOdak(!!odak);
                  setYorumlar(g);
                }}
                onBegenenler={setBegenenler}
                onOy={oyla}
              />
            )}
          />
        )}

        <YorumlarPenceresi
          gonderi={yorumlar}
          odak={yorumOdak}
          kapat={() => setYorumlar(null)}
          yorumEklendi={(id) => degistir(id, (x) => ({ ...x, yorumSayisi: x.yorumSayisi + 1 }))}
        />
        <BegenenlerPenceresi gonderi={begenenler} kapat={() => setBegenenler(null)} />
      </ModalAlani>
    </Modal>
  );
}

/* ----------------------------------------------------------------- ekran */

export default function Haberler() {
  const [veri, setVeri] = useState(null);
  const [kategori, setKategori] = useState("Tümü");
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [yorumlar, setYorumlar] = useState(null);
  const [yorumOdak, setYorumOdak] = useState(false);
  const [begenenler, setBegenenler] = useState(null);
  const [yeni, setYeni] = useState(false);
  const [profil, setProfil] = useState(null);

  /* Profilde yapılan beğeni / oy / yorum akışa da yansısın */
  const guncelle = (id, f) =>
    setVeri((v) => (v ? { ...v, gonderiler: v.gonderiler.map((x) => (x.id === id ? f(x) : x)) } : v));

  const getir = useCallback(async (sessiz) => {
    if (sessiz) setYenileniyor(true);
    try {
      setVeri(await haberAkisAl());
      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Gönderiler alınamadı.");
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const begen = async (g, begen) => {
    /* Anında göster; sunucu reddederse geri al */
    const degistir = (b) =>
      setVeri((v) => ({
        ...v,
        gonderiler: v.gonderiler.map((x) => (x.id === g.id ? { ...x, begendim: b, begeni: x.begeni + (b ? 1 : -1) } : x)),
      }));
    degistir(begen);
    try {
      await haberBegen(g.id, begen);
    } catch {
      degistir(!begen);
    }
  };

  /* Oy: sunucu güncel kartı döndürüyor (yüzdeler ancak oydan sonra geliyor) */
  const oyla = async (g, secenek) => {
    try {
      const yeni = await haberOy(g.id, secenek);
      if (yeni) setVeri((v) => ({ ...v, gonderiler: v.gonderiler.map((x) => (x.id === g.id ? yeni : x)) }));
    } catch (e) {
      Alert.alert("Oy kaydedilemedi", e?.message ?? "");
      getir(true);
    }
  };

  const ust = useSafeAreaInsets().top;

  /* Küçülen başlık (12.10.2026) */
  const kaydirma = useRef(new Animated.Value(0)).current;
  const [basYuk, setBasYuk] = useState(ust + 116);
  const inceYuk = ust + 52;
  const fark = Math.max(1, basYuk - inceYuk);
  const basY = kaydirma.interpolate({ inputRange: [0, fark], outputRange: [0, -fark], extrapolate: "clamp" });
  const basSaydam = kaydirma.interpolate({ inputRange: [0, fark * 0.7], outputRange: [1, 0], extrapolate: "clamp" });
  const inceSaydam = kaydirma.interpolate({ inputRange: [fark * 0.6, fark], outputRange: [0, 1], extrapolate: "clamp" });
  const [kucukAcik, setKucukAcik] = useState(false);
  const kucukRef = useRef(false);
  const kaydirmaOlayi = Animated.event([{ nativeEvent: { contentOffset: { y: kaydirma } } }], {
    useNativeDriver: true,
    listener: (e) => {
      const k = e.nativeEvent.contentOffset.y > fark * 0.8;
      if (k !== kucukRef.current) {
        kucukRef.current = k;
        setKucukAcik(k);
      }
    },
  });

  /* Video: ekranda en çok görünen gönderi oynar; ekrandan çıkınca durur */
  const [gorunenId, setGorunenId] = useState(null);
  const [odakta, setOdakta] = useState(true);
  const gorunurAyari = useRef({ itemVisiblePercentThreshold: 60 });
  const gorunurDegisti = useRef(({ viewableItems }) => {
    const v = (viewableItems ?? []).find((x) => x.item?.video);
    setGorunenId(v ? v.item.id : null);
  });
  useFocusEffect(
    useCallback(() => {
      setOdakta(true);
      return () => setOdakta(false);
    }, [])
  );

  const kategoriler = ["Tümü", ...(veri?.kategoriler ?? [])];
  const liste = (veri?.gonderiler ?? [])
    .filter((g) => kategori === "Tümü" || g.kategori === kategori)
    .map((g) => ({ ...g, benAd: veri?.ben?.ad }));

  return (
    <SafeAreaView style={s.sayfa} edges={[]}>
      {/* Başlık (12.10.2026): Biçen yeşili zemin, beyaz logo, turuncu vurgu.
          Aşağı kaydırınca büyük başlık yukarı kayıp kayboluyor, yerine ince
          bir şerit geliyor (iOS'taki büyük başlık gibi); yukarı çıkınca
          geri açılıyor. Zemin durum çubuğunun altına kadar uzanıyor. */}
      <Animated.View
        style={[s.basKatman, { transform: [{ translateY: basY }] }]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 0 && h !== basYuk) setBasYuk(h);
        }}
      >
        <KartZemin renkler={YESIL} yuvarlak={0} stil={[s.bas, { paddingTop: ust + 12 }]}>
          <Animated.View style={{ flex: 1, minWidth: 0, opacity: basSaydam }}>
            <View style={s.basUst}>
              <Image source={KART_LOGO} style={s.basLogo} resizeMode="contain" />
              <View style={s.basCizgi} />
              <Text style={s.basEtiket}>{"İÇ İLETİŞİM"}</Text>
            </View>
            <Text style={s.baslik} numberOfLines={1}>
              <Text style={s.baslikInce}>Biçen'den </Text>Haberler
            </Text>
            <View style={s.basAltSatir}>
              <View style={s.basVurgu} />
              <Text style={s.basAlt} numberOfLines={1}>
                Haberler, kampanyalar ve anketler
              </Text>
            </View>
          </Animated.View>
          {veri?.paylasabilir ? (
            <TouchableOpacity style={s.paylasDugme} onPress={() => setYeni(true)} activeOpacity={0.85} hitSlop={8}>
              <Simge ad="arti" boyut={22} renkli={renk.yesilKoyu} />
            </TouchableOpacity>
          ) : null}
        </KartZemin>
      </Animated.View>

      {/* İnce şerit: büyük başlık kaybolunca beliriyor */}
      <Animated.View pointerEvents={kucukAcik ? "auto" : "none"} style={[s.inceKatman, { opacity: inceSaydam }]}>
        <KartZemin renkler={YESIL} yuvarlak={0} stil={[s.ince, { paddingTop: ust + 8 }]}>
          <Image source={KART_LOGO} style={s.inceLogo} resizeMode="contain" />
          <Text style={s.inceBaslik} numberOfLines={1}>
            <Text style={{ fontWeight: "600" }}>Biçen'den </Text>Haberler
          </Text>
          {veri?.paylasabilir ? (
            <TouchableOpacity style={s.incePaylas} onPress={() => setYeni(true)} hitSlop={10}>
              <Simge ad="arti" boyut={18} renkli={renk.yesilKoyu} />
            </TouchableOpacity>
          ) : null}
        </KartZemin>
      </Animated.View>

      <Animated.FlatList
        data={liste}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={{ paddingTop: basYuk }}
        scrollIndicatorInsets={{ top: basYuk }}
        onScroll={kaydirmaOlayi}
        scrollEventThrottle={16}
        onViewableItemsChanged={gorunurDegisti.current}
        viewabilityConfig={gorunurAyari.current}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
            progressViewOffset={basYuk}
          />
        }
        ListHeaderComponent={
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.serit}>
              {kategoriler.map((k) => (
                <TouchableOpacity key={k} onPress={() => setKategori(k)} style={[s.secenek, kategori === k && s.secenekSecili]}>
                  <Text style={[s.secenekYazi, kategori === k && { color: "#fff" }]}>{k}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {hata ? (
              <View style={{ padding: 14 }}>
                <Hata metin={hata} />
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          veri ? (
            <Text style={{ textAlign: "center", color: renk.pasif, marginTop: 40 }}>Bu kategoride henüz gönderi yok.</Text>
          ) : (
            <ActivityIndicator color={renk.yesil} style={{ marginTop: 40 }} />
          )
        }
        renderItem={({ item }) => (
          <GonderiKart
            g={item}
            gorunur={odakta && gorunenId === item.id}
            onBegen={begen}
            onYorumlar={(g, odak) => {
              setYorumOdak(!!odak);
              setYorumlar(g);
            }}
            onBegenenler={setBegenenler}
            onOy={oyla}
            onProfil={setProfil}
          />
        )}
      />

      <ProfilPenceresi yazar={profil} kapat={() => setProfil(null)} guncellendi={guncelle} />

      <YorumlarPenceresi
        gonderi={yorumlar}
        odak={yorumOdak}
        kapat={() => setYorumlar(null)}
        yorumEklendi={(id) =>
          setVeri((v) => ({ ...v, gonderiler: v.gonderiler.map((x) => (x.id === id ? { ...x, yorumSayisi: x.yorumSayisi + 1 } : x)) }))
        }
      />
      <BegenenlerPenceresi gonderi={begenenler} kapat={() => setBegenenler(null)} />
      <YeniGonderi
        acik={yeni}
        kapat={() => setYeni(false)}
        kategoriler={veri?.paylasimKategorileri ?? (veri?.kategoriler ?? []).filter((k) => k !== "Kasada bu hafta" && k !== "Anket")}
        paylasildi={() => {
          setYeni(false);
          getir(true);
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: "#fff" },
  basKatman: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, elevation: 6 },
  inceKatman: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 11, elevation: 7 },
  ince: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  inceLogo: { width: 46, height: 15 },
  inceBaslik: { flex: 1, fontSize: 17, fontWeight: "900", color: "#fff", letterSpacing: -0.3 },
  incePaylas: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  bas: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 18,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  basUst: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 6 },
  basLogo: { width: 62, height: 20 },
  basCizgi: { width: 1, height: 14, backgroundColor: "rgba(255,255,255,.45)" },
  basEtiket: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.4, color: "rgba(255,255,255,.85)" },
  baslik: { fontSize: 28, fontWeight: "900", color: "#fff", letterSpacing: -0.8 },
  baslikInce: { fontWeight: "600", color: "rgba(255,255,255,.88)" },
  basAltSatir: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  basVurgu: { width: 22, height: 4, borderRadius: 2, backgroundColor: renk.turuncu },
  basAlt: { fontSize: 12.5, fontWeight: "600", color: "rgba(255,255,255,.9)", flexShrink: 1 },
  paylasDugme: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  serit: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  secenek: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: "#f1f3ee" },
  secenekSecili: { backgroundColor: renk.yesilKoyu },
  secenekYazi: { fontSize: 13, fontWeight: "700", color: renk.metin },

  kart: { marginBottom: 14 },
  ust: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 9, gap: 6 },
  yazar: { fontSize: 14, fontWeight: "800", color: renk.metin, flexShrink: 1 },
  yazarAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  onayli: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#3897f0", alignItems: "center", justifyContent: "center" },
  onayliYazi: { color: "#fff", fontSize: 9, fontWeight: "900", marginTop: -1 },
  sabit: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: renk.yesilAcik, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  sabitYazi: { fontSize: 11, fontWeight: "800", color: renk.yesilKoyu },
  kategori: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, borderWidth: 1, borderColor: renk.cizgi },
  kategoriYazi: { fontSize: 11, fontWeight: "700", color: renk.pasif },

  sayac: { position: "absolute", top: 12, right: 12, backgroundColor: "rgba(20,20,20,.65)", borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  sayacYazi: { color: "#fff", fontSize: 12, fontWeight: "700" },
  noktalar: { flexDirection: "row", justifyContent: "center", gap: 4, position: "absolute", bottom: -20, left: 0, right: 0 },
  nokta: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#c7ccd1" },
  noktaSecili: { backgroundColor: renk.yesil },
  tamEkranDugme: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(20,20,20,.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  tamEkranYazi: { color: "#fff", fontSize: 16, fontWeight: "700" },
  buyukKalp: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  eylemler: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2, gap: 14 },
  eylem: { padding: 2 },
  zaman: { fontSize: 11.5, color: renk.pasif },
  govde: { paddingHorizontal: 14, gap: 4 },
  begeni: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  metin: { fontSize: 14, color: renk.metin, lineHeight: 19.5 },
  devami: { fontSize: 13.5, color: renk.pasif, marginTop: -2 },
  tumYorumlar: { fontSize: 13.5, color: renk.pasif, marginTop: 2 },
  kisaYorum: { fontSize: 13.5, color: renk.metin },
  yorumEkle: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  yorumEkleYazi: { fontSize: 13.5, color: "#9aa1a9" },

  kampanya: { marginHorizontal: 12, marginTop: 10, borderRadius: 14, backgroundColor: "#f5f8fc", borderWidth: 1, borderColor: "#dde7f2", overflow: "hidden" },
  kampanyaBas: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 8 },
  kampanyaBaslik: { flex: 1, fontSize: 15, fontWeight: "900", color: renk.mavi, letterSpacing: -0.2 },
  donem: { backgroundColor: "#fff", borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: "#dde7f2" },
  donemYazi: { fontSize: 11.5, fontWeight: "800", color: renk.mavi },
  urun: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fff" },
  urunAd: { fontSize: 14, fontWeight: "700", color: renk.metin },
  urunBirim: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  eskiFiyat: { fontSize: 12, color: renk.pasif, textDecorationLine: "line-through" },
  yeniFiyat: { fontSize: 17, fontWeight: "900", color: renk.turuncu, fontVariant: ["tabular-nums"] },
  indirim: { width: 44, alignItems: "center", backgroundColor: renk.turuncuAcik, borderRadius: 8, paddingVertical: 4 },
  indirimYazi: { fontSize: 12, fontWeight: "900", color: renk.turuncuKoyu },
  soyle: { margin: 10, marginTop: 8, backgroundColor: renk.maviAcik, borderRadius: 11, padding: 10 },
  soyleEtiket: { fontSize: 10.5, fontWeight: "900", color: renk.mavi, letterSpacing: 0.5, marginBottom: 3 },
  soyleYazi: { fontSize: 13.5, fontWeight: "600", color: renk.mavi, lineHeight: 19 },

  anket: { marginHorizontal: 12, marginTop: 10, gap: 7 },
  anketSoru: { fontSize: 15.5, fontWeight: "800", color: renk.metin, marginBottom: 2, lineHeight: 21 },
  anketSecenek: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  anketDolgu: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: renk.morAcik },
  anketAd: { flex: 1, fontSize: 14, fontWeight: "700", color: renk.metin },
  anketYuzde: { fontSize: 13.5, fontWeight: "800", color: renk.pasif, fontVariant: ["tabular-nums"] },
  anketAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },

  pencereBas: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eef0eb",
  },
  pencereBaslik: { fontSize: 16, fontWeight: "800", color: renk.metin },
  yorum: { flexDirection: "row", gap: 10 },
  yorumMetin: { fontSize: 14, color: renk.metin, lineHeight: 19.5 },
  yorumZaman: { fontSize: 12, color: renk.pasif, marginTop: 3 },
  yorumGiris: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#eef0eb" },
  yorumKutu: { flex: 1, minHeight: 40, maxHeight: 110, borderWidth: 1, borderColor: renk.cizgi, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: renk.metin },
  paylasYazi: { fontSize: 15, fontWeight: "800", color: renk.yesilKoyu },
  kural: { fontSize: 11, color: renk.pasif, textAlign: "center", paddingBottom: 6 },

  profilBas: { paddingHorizontal: 16, paddingTop: 16 },
  profilSayi: { fontSize: 17, fontWeight: "900", color: renk.metin, fontVariant: ["tabular-nums"] },
  profilSayiAd: { fontSize: 12.5, color: renk.metin, marginTop: 1 },
  profilAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  profilUnvan: { fontSize: 13, color: renk.pasif, marginTop: 2 },
  profilAciklama: { fontSize: 13.5, color: renk.metin, marginTop: 6, lineHeight: 19 },
  profilKucukAd: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.4 },
  profilSekme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 16,
    marginHorizontal: -16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#eef0eb",
    borderBottomWidth: 1.5,
    borderBottomColor: renk.metin,
    marginBottom: 2,
  },
  profilSekmeYazi: { fontSize: 11.5, fontWeight: "800", color: renk.metin, letterSpacing: 0.6 },
  kareBos: { flex: 1, padding: 10, alignItems: "flex-start", justifyContent: "space-between", backgroundColor: renk.yesilAcik },
  kareYazi: { fontSize: 12, fontWeight: "700", color: renk.yesilKoyu, lineHeight: 16 },
  kareRozet: {
    position: "absolute",
    top: 6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: "rgba(20,20,20,.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  kareRozetYazi: { color: "#fff", fontSize: 11, fontWeight: "800" },

  secimKutu: {
    width: (GENISLIK - 60) / 2,
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#cfe6a6",
  },
  videoSecili: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 14,
    marginBottom: 0,
    padding: 12,
    borderRadius: 14,
    backgroundColor: renk.yesilAcik,
  },
  videoSeciliSimge: { width: 42, height: 42, borderRadius: 12, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  videoEkle: {
    marginHorizontal: 14,
    marginTop: 4,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#b7dc7a",
  },
  bosGorsel: { width: GENISLIK, backgroundColor: renk.yesilAcik, alignItems: "center", justifyContent: "center" },
  ekleKutu: { borderRadius: 8, borderWidth: 1.5, borderStyle: "dashed", borderColor: renk.yesil, alignItems: "center", justifyContent: "center" },
  aciklamaKutu: { minHeight: 90, borderWidth: 1, borderColor: renk.cizgi, borderRadius: 12, padding: 12, fontSize: 14.5, color: renk.metin, textAlignVertical: "top" },
  etiket: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, marginTop: 18, marginBottom: 8, letterSpacing: 0.4 },
  ayar: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f0f2ee", marginTop: 6 },
  ayarAd: { fontSize: 14.5, fontWeight: "700", color: renk.metin },
  ayarAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },
});

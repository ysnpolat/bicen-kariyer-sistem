/**
 * Patron görünümü alt sayfaları
 * ---------------------------------------------------------------------------
 * Personel kartı, aday kartı, onay/red gerekçesi ve hesap menüsü.
 *
 * Hepsi tek bir AltSayfa (Modal) içinde, içerik değişerek gösteriliyor:
 * aday kartından "Reddet"e basınca ikinci bir pencere açmak, iOS'ta
 * "zaten bir pencere açık" hatasıyla hiç açılmıyordu.
 */

import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Platform, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";

import { patronRenk as P } from "../../tema";
import { usePatron, basvuruNotuYaz } from "../../patronApi";
import Ikon from "./Ikon";
import {
  Avatar,
  DurumEtiket,
  MiniEtiket,
  BilgiIzgara,
  Dugme,
  Dugmeler,
  UyariKutu,
  NotKutu,
  IkonSatir,
  stiller,
} from "./Parcalar";
import { iletisim } from "./Baglam";
import { durumBilgi, kidemYaz, basvuruTon, kisaTarihSaat, sayi } from "./bicim";

/* ========================================================================== */
/* Personel                                                                   */
/* ========================================================================== */

export function PersonelSayfasi({ kod, tost }) {
  const { veri, ilkYukleme, hata } = usePatron(kod ? `Personel/${encodeURIComponent(kod)}` : null, {
    tazeSure: 60_000,
  });

  if (!veri) return <SayfaDurum yukleniyor={ilkYukleme} hata={hata} />;

  const [etiket, tonAd] = durumBilgi(veri.durum, veri.saat);

  return (
    <View>
      <View style={s.profil}>
        <Avatar fotoUrl={veri.fotoUrl} ad={veri.ad} tonAd="yesil" boyut={58} yuvarlak={18} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profilAd}>{veri.ad}</Text>
          <Text style={s.profilAlt}>{[veri.poz, veri.sube].filter(Boolean).join(" · ")}</Text>
          {veri.durum ? <DurumEtiket metin={etiket} tonAd={tonAd} stil={{ alignSelf: "flex-start", marginTop: 5 }} /> : null}
        </View>
      </View>

      <BilgiIzgara
        ogeler={[
          ["Kıdem", kidemYaz(veri.kidemGun)],
          ["Performans", veri.performans !== null && veri.performans !== undefined ? `${sayi(veri.performans)} puan` : "—"],
          ["Kalan izin", veri.izinBakiye !== null && veri.izinBakiye !== undefined ? `${sayi(veri.izinBakiye)} gün` : "—"],
          ["Sicil", veri.kod ?? "—"],
        ]}
      />

      <Dugmeler stil={{ marginTop: 2 }}>
        <Dugme yazi="Ara" ikon="telefon" tur="ikincil" bas={() => iletisim("tel", veri.telefon, tost)} />
        <Dugme yazi="Mesaj" ikon="mesaj" tur="ikincil" bas={() => iletisim("sms", veri.telefon, tost)} />
      </Dugmeler>
    </View>
  );
}

/* ========================================================================== */
/* Aday                                                                       */
/* ========================================================================== */

const HAZIR_IK_NOTU = ["Bu adayla görüşelim", "Öncelik verilsin", "Ücret konuşulsun", "Uygun değil"];

/**
 * Aday kartı. Onay kartından açıldıysa (`onay`) altta Onayla / Reddet,
 * başvuru listesinden açıldıysa "İK'ya not" var.
 */
export function AdaySayfasi({ id, onay, karar, tost }) {
  const { veri, ilkYukleme, hata, yenile } = usePatron(id ? `Basvuru/${id}` : null, { tazeSure: 30_000 });

  const [mod, setMod] = useState("detay");
  const [not, setNot] = useState("");
  const [notHata, setNotHata] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [gonderildi, setGonderildi] = useState(false);

  useEffect(() => {
    setMod("detay");
    setNot("");
    setNotHata("");
    setGonderildi(false);
  }, [id]);

  /* Onay kartında başvuru kaydı yoksa (rotasyon, norm…) kartın kendi
     bilgileri gösteriliyor */
  if (!veri && !id && onay)
    return (
      <View>
        <Text style={stiller.sayfaBaslik}>{onay.baslik}</Text>
        <Text style={stiller.sayfaAlt}>{onay.alt}</Text>
        <OnayDugmeleri karar={karar} />
      </View>
    );

  if (!veri) return <SayfaDurum yukleniyor={ilkYukleme} hata={hata} />;

  const notGonder = async () => {
    const m = not.trim();

    if (!m) {
      setNotHata("Bir not yazın.");
      return;
    }

    setGonderiliyor(true);

    try {
      await basvuruNotuYaz(veri.id, m);
      setGonderildi(true);
      setNot("");
      setMod("detay");
      yenile();
      tost?.("Not İK'ya iletildi");
    } catch (e) {
      setNotHata(e?.message ?? "Not gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  if (mod === "not")
    return (
      <View>
        <Text style={stiller.sayfaBaslik}>İK'ya not · {veri.ad}</Text>
        <Text style={stiller.sayfaAlt}>{[veri.poz, veri.sube].filter(Boolean).join(" · ")}</Text>

        <HazirNotlar ogeler={HAZIR_IK_NOTU} metin={not} degistir={(m) => { setNot(m); setNotHata(""); }} />
        <NotGirdisi deger={not} degistir={(m) => { setNot(m); setNotHata(""); }} yer="Notunuz (panelde başvurunun notlarında görünür)" hatali={!!notHata} />
        {notHata ? <Text style={s.hataYazi}>{notHata}</Text> : null}

        <Dugmeler>
          <Dugme yazi="Vazgeç" tur="ikincil" bas={() => setMod("detay")} />
          <Dugme yazi="Gönder" ikon="mesaj" bas={notGonder} yukleniyor={gonderiliyor} />
        </Dugmeler>
      </View>
    );

  const tonAd = basvuruTon(veri.durum);

  return (
    <View>
      <View style={s.profil}>
        <Avatar fotoUrl={veri.fotoUrl} ad={veri.ad} tonAd={tonAd} boyut={58} yuvarlak={18} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profilAd}>
            {veri.ad}
            {veri.eskiCalisan ? <MiniEtiket metin="eski çalışan" tonAd="mor" /> : null}
          </Text>
          <Text style={s.profilAlt}>
            {[veri.poz, veri.sube, veri.yas ? `${veri.yas} yaş` : null].filter(Boolean).join(" · ")}
          </Text>
          {veri.durum ? <DurumEtiket metin={veri.durum} tonAd={tonAd} stil={{ alignSelf: "flex-start", marginTop: 5 }} /> : null}
        </View>
      </View>

      <BilgiIzgara
        ogeler={[
          ["Başvuru", veri.gun === 0 ? "Bugün" : veri.gun !== null && veri.gun !== undefined ? `${veri.gun} gün önce` : "—"],
          ["Tecrübe", veri.tecrube || "—"],
          ["Ücret beklentisi", veri.ucretBeklenti || "—"],
          ["Referans puanı", veri.referansPuani !== null && veri.referansPuani !== undefined ? `${veri.referansPuani} / 10` : "—"],
          ["Daha önce", veri.eskiCalisan ? "Biçen'de çalışmış" : "Çalışmamış"],
          ["Başvuru no", String(veri.id ?? "—")],
        ]}
      />

      <Text style={stiller.kucukBaslik}>İK NOTLARI</Text>
      {(veri.notlar ?? []).length ? (
        veri.notlar.map((n, i) => (
          <NotKutu
            key={i}
            metin={`${n.metin}${n.kisi ? ` — ${n.kisi}` : ""}${n.tarih ? ` · ${kisaTarihSaat(n.tarih)}` : ""}`}
            cizgi={/Biçen360/.test(n.kisi ?? "") ? P.yesil : undefined}
            stil={{ marginBottom: 8 }}
          />
        ))
      ) : (
        <Text style={s.notYok}>Henüz not yok.</Text>
      )}

      {gonderildi ? (
        <View style={s.basari}>
          <Ikon ad="tik" boyut={15} renkli={P.yesilKoyu} />
          <Text style={s.basariYazi}>Notunuz İK'ya iletildi.</Text>
        </View>
      ) : null}

      {onay ? (
        <View style={{ marginTop: 8 }}>
          {onay.uyari ? <UyariKutu metin={onay.uyari} /> : null}
          <OnayDugmeleri karar={karar} />
        </View>
      ) : (
        <Dugmeler stil={{ marginTop: 8 }}>
          <Dugme yazi="İK'ya not" ikon="mesaj" tur="ikincil" bas={() => setMod("not")} />
        </Dugmeler>
      )}
    </View>
  );
}

function OnayDugmeleri({ karar }) {
  return (
    <Dugmeler>
      <Dugme yazi="Reddet" ikon="carpi" tur="red" bas={() => karar?.("red")} />
      <Dugme yazi="Onayla" ikon="tik" bas={() => karar?.("onay")} />
    </Dugmeler>
  );
}

/* ========================================================================== */
/* Onay / red gerekçesi                                                       */
/* ========================================================================== */

const HAZIR_ONAY = ["Uygundur", "Ücret onaylandı", "Evraklar tamamlansın"];
const HAZIR_RED = ["Ücret yüksek", "Kadro ihtiyacı yok", "Önce görüşelim", "Başka aday bakılsın"];

/* 1.8: avansın ret gerekçeleri sunucudan (Yönetim › Avans kuralları)
   geliyor; sunucu göndermezse bunlar */
const AVANS_RED = ["Avans kriterlerine uygun değil", "Avans hakkı dolmuştur"];

const redGerekceleri = (onay) =>
  Array.isArray(onay?.hazirRed) ? onay.hazirRed : onay?.tur === "avans" ? AVANS_RED : HAZIR_RED;

/**
 * Onaylarken not isteğe bağlı, reddederken zorunlu: gerekçe İK'ya
 * iletiliyor ve adaya / personele dönüş onunla yapılıyor. Sunucu da
 * gerekçesiz reddi kabul etmiyor; burada önceden söylenmesi gidiş-dönüşü
 * kısaltıyor.
 */
export function KararSayfasi({ onay, sonuc, gonder, kapat }) {
  const [not, setNot] = useState("");
  const [hata, setHata] = useState("");

  const red = sonuc !== "onay";

  const kaydet = () => {
    const m = not.trim();

    if (red && !m) {
      setHata("Reddederken kısa bir gerekçe yazın.");
      return;
    }

    kapat();
    gonder(m);
  };

  return (
    <View>
      <Text style={stiller.sayfaBaslik}>
        {red ? "Reddet" : "Onayla"} · {onay?.baslik}
      </Text>
      <Text style={stiller.sayfaAlt}>{onay?.alt}</Text>

      {onay?.uyari && !red ? <UyariKutu metin={onay.uyari} /> : null}

      <HazirNotlar ogeler={red ? redGerekceleri(onay) : HAZIR_ONAY} metin={not} degistir={(m) => { setNot(m); setHata(""); }} />
      <NotGirdisi
        deger={not}
        degistir={(m) => {
          setNot(m);
          setHata("");
        }}
        yer={red ? "Gerekçe (İK'ya iletilir)" : "Not (isteğe bağlı)"}
        hatali={!!hata}
      />
      {hata ? <Text style={s.hataYazi}>{hata}</Text> : null}

      <Dugmeler>
        <Dugme yazi="Vazgeç" tur="ikincil" bas={kapat} />
        <Dugme yazi={red ? "Reddet" : "Onayla"} ikon={red ? "carpi" : "tik"} tur={red ? "koyu" : "ana"} bas={kaydet} />
      </Dugmeler>
    </View>
  );
}

/* ========================================================================== */
/* Hesap menüsü                                                               */
/* ========================================================================== */

export function MenuSayfasi({ kisi, ben, personeleGec, ara, cikis }) {
  const ad = kisi?.adSoyad || ben?.ad || "";

  return (
    <View>
      <View style={s.profil}>
        <Avatar fotoUrl={ben?.fotoUrl} ad={ad || "B"} tonAd="yesil" boyut={58} yuvarlak={18} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profilAd}>{ad || "—"}</Text>
          <Text style={s.profilAlt}>Patron görünümü</Text>
        </View>
      </View>

      <IkonSatir
        ilk
        ikon="rotasyon"
        tonAd="yesil"
        baslik="Personel görünümüne geç"
        alt="Vardiya, izin, duyurular ve diğer modüller"
        bas={personeleGec}
      />
      <IkonSatir ikon="ara" tonAd="gri" baslik="Ara" alt="Personel, şube ya da aday" bas={ara} />
      <IkonSatir ikon="cikis" tonAd="turuncu" baslik="Çıkış yap" alt="Yeniden giriş için SMS doğrulaması gerekir" bas={cikis} />

      <Text style={s.surum}>Biçen360 · sürüm {Constants.expoConfig?.version ?? "—"}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Ortak                                                                      */
/* ========================================================================== */

/** Hazır not çipleri: dokununca kutuya eklenir */
function HazirNotlar({ ogeler, metin, degistir }) {
  return (
    <View style={s.hazirlar}>
      {ogeler.map((h) => (
        <TouchableOpacity
          key={h}
          style={s.hazir}
          activeOpacity={0.7}
          onPress={() => degistir(metin ? `${metin}, ${h.charAt(0).toLocaleLowerCase("tr-TR")}${h.slice(1)}` : h)}
        >
          <Text style={s.hazirYazi}>{h}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function NotGirdisi({ deger, degistir, yer, hatali }) {
  return (
    <TextInput
      value={deger}
      onChangeText={degistir}
      placeholder={yer}
      placeholderTextColor={P.soluk}
      multiline
      textAlignVertical="top"
      style={[s.girdi, hatali && { borderColor: P.turuncu }]}
      maxLength={500}
    />
  );
}

function SayfaDurum({ yukleniyor, hata }) {
  return (
    <View style={s.durum}>
      {yukleniyor ? (
        <ActivityIndicator color={P.yesil} />
      ) : (
        <Text style={s.durumYazi}>{hata || "Bilgi alınamadı."}</Text>
      )}
    </View>
  );
}

/* ========================================================================== */
/* Tost                                                                       */
/* ========================================================================== */

/**
 * Üstten inen kısa bildirim. Karar verildiğinde ne olduğunu söylüyor:
 * kart kayıp gidince "işlem oldu mu?" sorusu kalıyordu.
 *
 * @param tost { metin, tur: "tamam" | "hata", n } — n her yeni bildirimde artar
 */
export function Tost({ tost }) {
  const kenar = useSafeAreaInsets();
  const a = useRef(new Animated.Value(0)).current;
  const [gorunen, setGorunen] = useState(null);

  useEffect(() => {
    if (!tost?.n) return undefined;

    setGorunen(tost);

    const surucu = Platform.OS !== "web";

    Animated.timing(a, { toValue: 1, duration: 260, useNativeDriver: surucu }).start();

    const z = setTimeout(() => {
      Animated.timing(a, { toValue: 0, duration: 260, useNativeDriver: surucu }).start(() => setGorunen(null));
    }, tost.tur === "hata" ? 3600 : 2400);

    return () => clearTimeout(z);
  }, [tost?.n, a]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!gorunen) return null;

  return (
    <View pointerEvents="none" style={[s.tostKap, { top: Math.max(kenar.top, 12) + 8 }]}>
      <Animated.View
        style={[
          s.tost,
          {
            opacity: a,
            transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
          },
        ]}
      >
        <Ikon ad={gorunen.tur === "hata" ? "uyari" : "tik"} boyut={17} renkli={gorunen.tur === "hata" ? "#ffb199" : "#a4d64a"} />
        <Text style={s.tostYazi}>{gorunen.metin}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  profil: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, marginBottom: 14 },
  profilAd: { fontSize: 18, fontWeight: "800", color: P.metin },
  profilAlt: { fontSize: 12.5, color: P.soluk, marginTop: 1 },

  notYok: { fontSize: 12.5, color: P.soluk, marginBottom: 10 },
  basari: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: P.yesilAcik, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, marginBottom: 10 },
  basariYazi: { fontSize: 12.5, fontWeight: "600", color: P.yesilYazi },

  hazirlar: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  hazir: { borderWidth: 1, borderColor: P.cizgi, backgroundColor: "#fff", borderRadius: 99, paddingVertical: 5, paddingHorizontal: 10 },
  hazirYazi: { fontSize: 12, color: P.metin },

  girdi: {
    borderWidth: 1,
    borderColor: P.cizgi,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 84,
    fontSize: 14,
    color: P.metin,
    marginTop: 6,
    marginBottom: 12,
  },
  hataYazi: { fontSize: 12.5, color: P.turuncuYazi, fontWeight: "600", marginTop: -6, marginBottom: 10 },

  surum: { fontSize: 11.5, color: P.soluk, textAlign: "center", marginTop: 14 },

  durum: { paddingVertical: 40, alignItems: "center" },
  durumYazi: { fontSize: 13, color: P.ikincil, textAlign: "center" },

  tostKap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 60, elevation: 60 },
  tost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "88%",
    backgroundColor: "#1c2419",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 12 },
      android: { elevation: 8 },
      default: {},
    }),
  },
  tostYazi: { color: "#fff", fontSize: 13, fontWeight: "600", flexShrink: 1 },
});

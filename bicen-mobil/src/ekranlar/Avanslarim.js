/**
 * Avanslarım (1.6)
 * ---------------------------------------------------------------------------
 * Devam eden avans ve taksitleri (kesildi / sıradaki / bekliyor), bu yılki
 * talep hakkı, geçmiş avanslar ve yeni avans talebi.
 *
 * Personel maaşını ve üst limitini görmüyor: tutarı yazıp gönderiyor,
 * limit aşılırsa sunucu "Bu tutarda avans talebi oluşturamazsınız. Üst
 * limitiniz …" diyor ve metin olduğu gibi gösteriliyor. Taksit sayısı ve
 * ilk kesinti ayı sunucunun gönderdiği seçeneklerden seçiliyor; İnsan
 * Kaynakları onayda tutarı, taksiti ve ilk kesintiyi değiştirebiliyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Platform,
  Alert,
  ActivityIndicator,
  BackHandler,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { avansAl, avansTalep, avansIptal, avansBelgeYukle } from "../api";
import { dosyaAl } from "../bilesenler/Gorevler";
import { renk, AYLAR } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";

const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const tarihOku = (t) => {
  const s = String(t ?? "").slice(0, 10).split("-").map(Number);
  return s.length === 3 && s[0] ? new Date(s[0], s[1] - 1, s[2]) : new Date(t);
};

const lira = (v) => `₺${Number(v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
const gunAy = (t) => {
  const d = tarihOku(t);
  return `${d.getDate()} ${AY_KISA[d.getMonth()]}`;
};
const uzunTarih = (t) => {
  const d = tarihOku(t);
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}`;
};
const ayYil = (t) => {
  const d = tarihOku(t);
  return `${AYLAR[d.getMonth()]} ${d.getFullYear()}`;
};
const gunMetni = (t) => {
  const d = tarihOku(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sunucudaki Plan() ile aynı: eşit taksit, kalan son taksitte */
const planHesapla = (tutar, taksit, ilk) => {
  const n = Math.max(1, taksit);
  const temel = Math.floor(tutar / n);
  const bas = tarihOku(ilk);
  const gun = bas.getDate();
  const l = [];
  let toplam = 0;

  for (let i = 0; i < n; i++) {
    const ay = new Date(bas.getFullYear(), bas.getMonth() + i, 1);
    const son = new Date(ay.getFullYear(), ay.getMonth() + 1, 0).getDate();
    const t = new Date(ay.getFullYear(), ay.getMonth(), Math.min(gun, son));
    const tt = i === n - 1 ? Math.round((tutar - toplam) * 100) / 100 : temel;
    toplam += tt;
    l.push({ no: i + 1, tarih: t, tutar: tt });
  }

  return l;
};

const DURUM_RENK = {
  bekliyor: { zemin: "#fff2e8", yazi: "#ad4e00" },
  belge: { zemin: "#fff2e8", yazi: "#ad4e00" },
  onaylandi: { zemin: "#eef4fb", yazi: "#1a4d80" },
  odendi: { zemin: "#eef4fb", yazi: "#1a4d80" },
  kapandi: { zemin: renk.yesilAcik, yazi: "#3f6108" },
  reddedildi: { zemin: "#fdecec", yazi: renk.kirmizi },
  iptal: { zemin: renk.zemin, yazi: renk.pasif },
};

const durumRengi = (a) =>
  (a.durum === "odendi" || a.durum === "onaylandi") && !a.devamEdiyor
    ? DURUM_RENK.kapandi
    : DURUM_RENK[a.durum] ?? DURUM_RENK.iptal;

/* ========================================================================== */

export default function Avanslarim() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  /* "liste" | "talep" | "tamam" */
  const [gorunum, setGorunum] = useState("liste");
  const [tamamOzet, setTamamOzet] = useState("");

  /* Belge yüklenirken bekleyen kartındaki düğme (09.10.2026) */
  const [belgeYukleniyor, setBelgeYukleniyor] = useState(false);

  /* Avans talep kuralları penceresi (1.8): ekrana her girişte bir kez */
  const [kuralAcik, setKuralAcik] = useState(false);
  const kuralGoster = useRef(false);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      const d = await avansAl();
      setVeri(d);
      if (kuralGoster.current && d?.bilgilendirme) {
        kuralGoster.current = false;
        setKuralAcik(true);
      }
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
      kuralGoster.current = true;
      getir();
    }, [getir])
  );

  /* Talep ekranındayken geri tuşu listeye döner */
  useEffect(() => {
    if (gorunum === "liste") return undefined;

    const abone = BackHandler.addEventListener("hardwareBackPress", () => {
      setGorunum("liste");
      return true;
    });

    return () => abone.remove();
  }, [gorunum]);

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  if (gorunum === "talep")
    return (
      <YeniTalep
        veri={veri}
        geri={() => setGorunum("liste")}
        gonderildi={(ozet) => {
          setTamamOzet(ozet);
          setGorunum("tamam");
          getir();
        }}
      />
    );

  if (gorunum === "tamam")
    return (
      <SafeAreaView style={s.tam} edges={["top"]}>
        <BarBaslik ad="Avans talebi" acik kendi geri={() => setGorunum("liste")} yardim={false} />
        <View style={s.tamam}>
          <View style={s.tamamSimge}>
            <Text style={s.tamamTik}>✓</Text>
          </View>
          <Text style={s.tamamBaslik}>Avans talebiniz alındı</Text>
          <Text style={s.tamamMetin}>
            {tamamOzet}. İnsan Kaynakları onayladığında bildirim alacaksınız.
          </Text>
          <TouchableOpacity style={s.anaDugme} onPress={() => setGorunum("liste")}>
            <Text style={s.anaDugmeYazi}>Avanslarıma dön</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );

  const k = veri?.kural ?? {};
  const devam = veri?.devamEden;
  const avanslar = veri?.avanslar ?? [];
  const bekleyen = avanslar.find((a) => a.durum === "bekliyor" || a.durum === "belge");
  /* Belge bekleyen talep (09.10.2026): belge buradan da yüklenebilir */
  const belgeYukle = (a) =>
    Alert.alert("Belgeyi yükle", a.belgeAdi ?? "Talebinizi destekleyen belge", [
      { text: "Vazgeç", style: "cancel" },
      ...[
        ["kamera", "Fotoğraf çek"],
        ["galeri", "Galeriden seç"],
        ["dosya", "PDF / dosya"],
      ].map(([k, ad]) => ({
        text: ad,
        onPress: async () => {
          try {
            const d = await dosyaAl(k);
            if (!d) return;
            setBelgeYukleniyor(true);
            await avansBelgeYukle(a.id, a.belgeAdi, d);
            Alert.alert("Belge yüklendi", "Talebiniz onaya gönderildi.");
            getir();
          } catch (h) {
            Alert.alert("Yüklenemedi", h?.message ?? "Belge yüklenemedi.");
          } finally {
            setBelgeYukleniyor(false);
          }
        },
      })),
    ]);
  const gecmis = avanslar.filter((a) => a.durum !== "bekliyor" && (!devam || a.id !== devam.id));

  const geriCek = (a) =>
    Alert.alert("Talebi geri çek", `${lira(a.tutar)} tutarındaki avans talebiniz geri çekilsin mi?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Geri çek",
        style: "destructive",
        onPress: async () => {
          try {
            await avansIptal(a.id);
            getir();
          } catch (h) {
            Alert.alert("Geri çekilemedi", h.message);
          }
        },
      },
    ]);

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Avanslarım" acik kendi />

      <KuralPenceresi bilgi={veri?.bilgilendirme} acik={kuralAcik} kapat={() => setKuralAcik(false)} />

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        <Text style={s.ust}>Kesintiler her ayın {k.kesintiGunu ?? 5}'inde, bir önceki ayın maaşından yapılır.</Text>

        {veri?.bilgilendirme ? (
          <TouchableOpacity style={s.kuralSerit} activeOpacity={0.8} onPress={() => setKuralAcik(true)}>
            <Simge ad="bilgi" boyut={16} renkli="#8a6500" />
            <Text style={s.kuralSeritYazi}>{veri.bilgilendirme.baslik}</Text>
            <Text style={s.kuralSeritOk}>Oku ›</Text>
          </TouchableOpacity>
        ) : null}

        {/* ------------------------------------------------ devam eden */}
        {devam ? (
          <View style={s.koyu}>
            <Text style={s.koyuEt}>DEVAM EDEN AVANS</Text>
            <View style={s.koyuSatir}>
              <Text style={s.koyuTutar}>{lira(devam.ozet.kalan)}</Text>
              <Text style={s.koyuKalan}>kalan</Text>
            </View>
            <Text style={s.koyuAlt}>
              {devam.ozet.kalanTaksit} taksit kaldı · {lira(devam.ozet.odenen)} ödendi
            </Text>
            <Text style={s.koyuAlt2}>
              Toplam {lira(devam.tutar)} · {devam.taksit === 1 ? "tek seferde" : `${devam.taksit} taksit`}
            </Text>

            <View style={s.taksitler}>
              {devam.ozet.taksitler.map((t) => (
                <View key={t.sira} style={[s.taksit, t.durum === "kesildi" && s.taksitKesildi, t.durum === "siradaki" && s.taksitSiradaki]}>
                  <Text style={[s.taksitEt, t.durum === "siradaki" && { color: "#ffb38f" }]}>
                    {t.durum === "kesildi" ? "ÖDENDİ" : t.durum === "siradaki" ? "SIRADAKİ" : "BEKLİYOR"}
                  </Text>
                  <Text style={s.taksitTarih}>{gunAy(t.tarih)}</Text>
                  <Text style={s.taksitTutar}>{lira(t.tutar)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* --------------------------------------------- bekleyen talep */}
        {bekleyen ? (
          <View style={s.kart}>
            <View style={s.kartUst}>
              <View style={{ flex: 1 }}>
                <Text style={s.kartBaslik}>Avans talebi · {lira(bekleyen.tutar)}</Text>
                <Text style={s.kartAlt}>
                  {bekleyen.taksit === 1 ? "Tek seferde" : `${bekleyen.taksit} taksit`} · ilk kesinti {uzunTarih(bekleyen.ilkKesinti)}
                </Text>
              </View>
              <View style={[s.rozet, { backgroundColor: DURUM_RENK.bekliyor.zemin }]}>
                <Text style={[s.rozetYazi, { color: DURUM_RENK.bekliyor.yazi }]}>
                  {bekleyen.durum === "belge" ? "Belge bekleniyor" : bekleyen.durumAdi ?? "Onaya gönderildi"}
                </Text>
              </View>
            </View>
            {bekleyen.durum === "belge" ? (
              <View style={s.belgeKutu}>
                <Text style={s.belgeBaslik}>Talebiniz belge yüklenince onaya gider</Text>
                <Text style={s.belgeAlt}>{bekleyen.belgeAdi ?? "Talebinizi destekleyen belge"}</Text>
                <TouchableOpacity style={s.belgeDugme} onPress={() => belgeYukle(bekleyen)} disabled={belgeYukleniyor}>
                  {belgeYukleniyor ? <ActivityIndicator color="#fff" /> : <Text style={s.belgeDugmeYazi}>Belgeyi yükle</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={s.adimlar}>
              <View style={[s.adim, { backgroundColor: renk.yesil }]} />
              <View style={[s.adim, { backgroundColor: renk.turuncu }]} />
              <View style={s.adim} />
            </View>
            <View style={s.adimYazilar}>
              <Text style={s.adimYazi}>Gönderildi</Text>
              <Text style={[s.adimYazi, { color: "#ad4e00", fontWeight: "700" }]}>{bekleyen.durum === "belge" ? "Belge" : "Onay"}</Text>
              <Text style={s.adimYazi}>Ödendi</Text>
            </View>
            <TouchableOpacity onPress={() => geriCek(bekleyen)} hitSlop={8} style={{ alignSelf: "flex-start", marginTop: 10 }}>
              <Text style={s.geriCek}>Talebi geri çek</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ------------------------------------------------ hak / engel */}
        <View style={s.bilgi}>
          <Text style={s.bilgiYazi}>
            Bu yıl <Text style={{ fontWeight: "800" }}>{veri?.buYil ?? 0} / {k.yillikHak ?? 2}</Text> talep hakkı kullanıldı
          </Text>
          {veri?.engel ? <Text style={s.engel}>{veri.engel}</Text> : null}
        </View>

        {/* --------------------------------------------------- geçmiş */}
        <Text style={s.bolum}>GEÇMİŞ AVANSLAR</Text>

        {gecmis.length === 0 && !devam ? (
          <Text style={s.bos}>Henüz avans almadınız.</Text>
        ) : null}

        {[...(devam ? avanslar.filter((a) => a.id === devam.id) : []), ...gecmis].map((a) => {
          const r = durumRengi(a);

          return (
            <View key={a.id} style={s.gecmis}>
              <View style={{ flex: 1 }}>
                <Text style={s.gecmisTutar}>{lira(a.tutar)}</Text>
                <Text style={s.gecmisAlt}>
                  {ayYil(a.olusturma)} · {a.taksit === 1 ? "tek seferde" : `${a.taksit} taksit`}
                  {a.devamEdiyor ? ` · ${a.taksit - a.ozet.kalanTaksit} ödendi` : ""}
                </Text>
                {a.degisti && a.durum !== "reddedildi" ? (
                  <Text style={s.gecmisNot}>Düzenlenerek onaylandı · talebiniz {lira(a.talepTutar)}, {a.talepTaksit} taksit</Text>
                ) : null}
                {a.durum === "reddedildi" && (a.redNedeni ?? a.ikNotu) ? <Text style={s.gecmisNot}>Red sebebi: {a.redNedeni ?? a.ikNotu}</Text> : null}
              </View>
              <View style={[s.rozet, { backgroundColor: r.zemin }]}>
                <Text style={[s.rozetYazi, { color: r.yazi }]}>{a.durumAdi}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={s.altCubuk}>
        <TouchableOpacity
          style={[s.anaDugme, !veri?.yeniTalep && s.anaDugmePasif]}
          disabled={!veri?.yeniTalep}
          onPress={() => setGorunum("talep")}
        >
          <Text style={s.anaDugmeYazi}>Yeni avans talebi</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Yeni talep                                                                 */
/* ========================================================================== */

/**
 * Klavyenin sayfanın altını ne kadar kapattığı. Android'de uygulama kenardan
 * kenara çiziliyor; klavye açılınca pencere küçülmüyor ve alttaki "Avans
 * talebini gönder" klavyenin altında kalıyordu. Pencere küçülen cihazda
 * (adjustResize) örtüşme 0 çıkar; iki durumda da doğru.
 */
/* ========================================================================== */
/* Avans talep kuralları penceresi (1.8)                                      */
/* ========================================================================== */

function KuralPenceresi({ bilgi, acik, kapat }) {
  if (!bilgi) return null;
  return (
    <Modal visible={acik} transparent animationType="fade" onRequestClose={kapat}>
      <View style={s.perde}>
        <View style={s.pencere}>
          <View style={s.pencereIkon}>
            <Simge ad="para" boyut={28} renkli="#fff" />
          </View>
          <Text style={s.pencereBaslik}>{bilgi.baslik}</Text>
          {bilgi.metin ? <Text style={s.pencereMetin}>{bilgi.metin}</Text> : null}
          <ScrollView style={{ maxHeight: 300, alignSelf: "stretch" }} contentContainerStyle={{ gap: 8 }}>
            {(bilgi.maddeler ?? []).map((m, i) => (
              <View key={i} style={s.madde}>
                <View style={s.maddeIkon}>
                  <Simge ad="onay" boyut={13} renkli="#fff" />
                </View>
                <Text style={s.maddeYazi}>{m}</Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={s.pencereDugme} activeOpacity={0.85} onPress={kapat}>
            <Text style={s.pencereDugmeYazi}>Okudum, anladım</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function useKlavyeOrtusmesi(kok) {
  const [ortu, setOrtu] = useState(0);

  useEffect(() => {
    const acilis = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const kapanis = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const a = Keyboard.addListener(acilis, (e) => {
      const ust = e?.endCoordinates?.screenY;
      const yukseklik = e?.endCoordinates?.height ?? 0;

      if (!kok.current?.measureInWindow || typeof ust !== "number") {
        setOrtu(yukseklik);
        return;
      }

      kok.current.measureInWindow((x, y, w, h) => setOrtu(Math.max(0, Math.round(y + h - ust))));
    });
    const k = Keyboard.addListener(kapanis, () => setOrtu(0));

    return () => {
      a.remove();
      k.remove();
    };
  }, [kok]);

  return ortu;
}

function YeniTalep({ veri, geri, gonderildi }) {
  const k = veri?.kural ?? {};
  const taksitler = k.taksitler?.length ? k.taksitler : [1];
  const ilkler = k.ilkKesintiler ?? [];

  const [tutarYazi, setTutarYazi] = useState("");
  const [taksit, setTaksit] = useState(taksitler[0]);
  const [ilk, setIlk] = useState(ilkler[0] ?? null);
  const [aciklama, setAciklama] = useState("");
  const [neden, setNeden] = useState(null);
  const [hata, setHata] = useState("");

  /* Avans talep nedeni zorunlu (07.10.2026); "Diğer"de açıklama da zorunlu.
     Liste sunucudan, eski sunucuda yedek liste. */
  const nedenler = k.nedenler?.length
    ? k.nedenler
    : ["Sağlık giderleri", "Eğitim / okul giderleri", "Kira / konut", "Fatura / borç ödemesi", "Düğün / nişan", "Ev eşyası / beyaz eşya", "Araç / ulaşım", "Acil aile ihtiyacı", "Diğer"];
  /* Açıklama her nedende zorunlu (08.10.2026); alan neden seçilince açılır.
     Sunucu da denetliyor (1.6 için tüm nedenleri "açıklaması zorunlu" gönderiyor). */
  const diger = !!neden;
  /* Belge (09.10.2026): nedene göre belge zorunlu; adı sunucudan */
  const belgeGerek = !!neden && (k.belgeliNedenler ?? []).includes(neden);
  const belgeAdi = (k.belgeAdlari ?? {})[neden] ?? "Talebinizi destekleyen belge";
  const [belge, setBelge] = useState(null);
  const eksikNeden = !neden || (diger && aciklama.trim().length < 3) || (belgeGerek && !belge);
  const nedenHatasi = /neden|Diğer/i.test(hata);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const kok = useRef(null);
  const kaydirma = useRef(null);
  const ortu = useKlavyeOrtusmesi(kok);

  /* Açıklamaya yazarken alan ve gönder düğmesi görünür kalsın */
  useEffect(() => {
    if (ortu > 0) setTimeout(() => kaydirma.current?.scrollToEnd({ animated: true }), 60);
  }, [ortu]);

  const tutar = Number(String(tutarYazi).replace(/\./g, "").replace(",", ".")) || 0;
  const plan = useMemo(() => (tutar > 0 && ilk ? planHesapla(tutar, taksit, ilk) : []), [tutar, taksit, ilk]);

  const hizli = [5000, 10000, 15000, 20000];

  const gonder = async () => {
    setHata("");

    if (tutar <= 0) {
      setHata("Talep etmek istediğiniz tutarı yazınız.");
      return;
    }

    if (!neden) {
      setHata("Avans talep nedenini seçiniz.");
      return;
    }

    if (diger && aciklama.trim().length < 3) {
      setHata("Avans talep nedeninizi açıklama alanına kısaca yazınız.");
      return;
    }

    if (belgeGerek && !belge) {
      setHata(`Belge ekleyiniz: ${belgeAdi}.`);
      return;
    }

    setGonderiliyor(true);

    try {
      const c = await avansTalep({
        tutar,
        taksit,
        ilkKesinti: ilk ? gunMetni(ilk) : null,
        aciklama: aciklama.trim() || null,
        neden,
      });

      /* Talep belge durumunda açıldı: belge hemen yükleniyor, gelince onaya gider */
      if (c?.belgeBekleniyor && belge) {
        try {
          await avansBelgeYukle(c.id, belgeAdi, belge);
          gonderildi(`${lira(tutar)} · ${taksit === 1 ? "tek seferde" : `${taksit} taksit`} · belgeniz yüklendi`);
        } catch (h) {
          Alert.alert(
            "Belge yüklenemedi",
            `Talebiniz kaydedildi ama belge yüklenemedi (${h?.message ?? "bağlantı"}). Avanslarım ekranındaki "Belgeyi yükle" ile yeniden deneyin; belge gelene kadar talep onaya gitmez.`
          );
          gonderildi(c?.ozet ?? `${lira(tutar)} · ${taksit} taksit`);
        }
        return;
      }

      gonderildi(c?.ozet ?? `${lira(tutar)} · ${taksit} taksit`);
    } catch (h) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Yeni avans talebi" acik kendi geri={geri} yardim={false} />
      {/* Ölçü için: sayfanın görünen alt kenarı */}
      <View ref={kok} collapsable={false} style={{ flex: 1 }}>

      <ScrollView
        ref={kaydirma}
        contentContainerStyle={[s.govde, ortu > 0 && { paddingBottom: ortu + 90 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.etiket}>
          Talep etmek istediğiniz tutar <Text style={{ color: renk.turuncu }}>*</Text>
        </Text>
        <View style={[s.tutarKutu, hata && /limit/i.test(hata) && { borderColor: renk.turuncu }]}>
          <Text style={s.tutarTl}>₺</Text>
          <TextInput
            style={s.tutarGirdi}
            value={tutarYazi}
            onChangeText={(v) => {
              setHata("");
              const sade = v.replace(/[^\d]/g, "");
              setTutarYazi(sade ? Number(sade).toLocaleString("tr-TR") : "");
            }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor="#c8ccc4"
            maxLength={9}
          />
        </View>

        <View style={s.cipler}>
          {hizli.map((h) => (
            <TouchableOpacity
              key={h}
              style={[s.cip, tutar === h && s.cipSecili]}
              onPress={() => {
                setHata("");
                setTutarYazi(h.toLocaleString("tr-TR"));
              }}
            >
              <Text style={[s.cipYazi, tutar === h && s.cipYaziSecili]}>{lira(h)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {hata && !nedenHatasi ? (
          <View style={s.hataKutu}>
            <Text style={s.hataYazi}>{hata}</Text>
          </View>
        ) : null}

        <Text style={s.etiket}>Taksit sayısı</Text>
        <View style={s.cipler}>
          {taksitler.map((t) => (
            <TouchableOpacity key={t} style={[s.cip, s.cipGenis, taksit === t && s.cipSecili]} onPress={() => { setHata(""); setTaksit(t); }}>
              <Text style={[s.cipYazi, taksit === t && s.cipYaziSecili]}>{t === 1 ? "Tek seferde" : `${t} taksit`}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.etiket}>İlk kesinti</Text>
        <View style={s.cipler}>
          {ilkler.map((t) => (
            <TouchableOpacity key={t} style={[s.cip, s.cipGenis, ilk === t && s.cipSecili]} onPress={() => setIlk(t)}>
              <Text style={[s.cipYazi, ilk === t && s.cipYaziSecili]}>{uzunTarih(t)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {plan.length > 0 ? (
          <View style={s.kart}>
            <Text style={s.kartBaslik}>Ödeme planı</Text>
            {plan.map((p) => (
              <View key={p.no} style={s.planSatir}>
                <Text style={s.planNo}>{p.no}.</Text>
                <Text style={s.planTarih}>{uzunTarih(p.tarih)}</Text>
                <Text style={s.planTutar}>{lira(p.tutar)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={s.etiket}>
          Avans talep nedeni <Text style={{ color: renk.turuncu }}>*</Text>
        </Text>
        <View style={s.cipler}>
          {nedenler.map((n) => (
            <TouchableOpacity
              key={n}
              style={[s.cip, neden === n && s.cipSecili]}
              onPress={() => {
                setHata("");
                setNeden(n);
                setTimeout(() => kaydirma.current?.scrollToEnd({ animated: true }), 120);
              }}
            >
              <Text style={[s.cipYazi, neden === n && s.cipYaziSecili]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {diger ? (
          <>
            <Text style={s.etiket}>
              Açıklama <Text style={{ color: renk.turuncu }}>*</Text>
            </Text>
            <TextInput
              style={[s.aciklama, aciklama.trim().length < 3 && nedenHatasi && { borderColor: renk.turuncu }]}
              value={aciklama}
              onChangeText={(v) => {
                setHata("");
                setAciklama(v);
              }}
              placeholder="Avansı ne için istediğinizi kısaca yazın"
              placeholderTextColor="#a3a9a0"
              multiline
              maxLength={500}
              autoFocus
              onFocus={() => setTimeout(() => kaydirma.current?.scrollToEnd({ animated: true }), 300)}
            />
          </>
        ) : null}

        {belgeGerek ? (
          <>
            <Text style={s.etiket}>
              Belge <Text style={{ color: renk.turuncu }}>*</Text>
            </Text>
            <View style={s.belgeSecim}>
              <Text style={s.belgeSecimAd}>{belgeAdi}</Text>
              {belge ? (
                <View style={s.belgeSecili}>
                  <Text style={s.belgeSeciliYazi} numberOfLines={1}>
                    ✓ {belge.ad}
                  </Text>
                  <TouchableOpacity onPress={() => setBelge(null)} hitSlop={8}>
                    <Text style={s.belgeKaldir}>Kaldır</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={s.cipler}>
                  {[
                    ["kamera", "Fotoğraf çek"],
                    ["galeri", "Galeriden seç"],
                    ["dosya", "PDF / dosya"],
                  ].map(([kk, ad]) => (
                    <TouchableOpacity
                      key={kk}
                      style={s.cip}
                      onPress={async () => {
                        try {
                          const d = await dosyaAl(kk);
                          if (d) {
                            setHata("");
                            setBelge(d);
                          }
                        } catch (h) {
                          Alert.alert("Seçilemedi", h?.message ?? "Dosya seçilemedi.");
                        }
                      }}
                    >
                      <Text style={s.cipYazi}>{ad}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={s.belgeNot}>Belge yüklenmeden talep onaya gönderilmez.</Text>
            </View>
          </>
        ) : null}

        {hata && nedenHatasi ? (
          <View style={s.hataKutu}>
            <Text style={s.hataYazi}>{hata}</Text>
          </View>
        ) : null}

        <Text style={s.not}>
          Tutar, taksit ve ilk kesinti ayını İnsan Kaynakları değiştirebilir; değişiklik size bildirilir.
        </Text>
      </ScrollView>

      <View style={[s.altCubuk, ortu > 0 && { bottom: ortu, paddingBottom: 10, backgroundColor: renk.zemin }]}>
        <TouchableOpacity style={[s.anaDugme, (gonderiliyor || tutar <= 0 || eksikNeden) && s.anaDugmePasif]} disabled={gonderiliyor || tutar <= 0 || eksikNeden} onPress={gonder}>
          {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Text style={s.anaDugmeYazi}>Avans talebini gönder</Text>}
        </TouchableOpacity>
      </View>
      </View>
    </SafeAreaView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  kuralSerit: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff6dc", borderRadius: 12,
    borderWidth: 1, borderColor: "#f1dfa7", paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  kuralSeritYazi: { flex: 1, color: "#6b4f00", fontWeight: "700", fontSize: 13 },
  kuralSeritOk: { color: "#8a6500", fontWeight: "800", fontSize: 13 },
  perde: { flex: 1, backgroundColor: "rgba(15,20,10,.55)", alignItems: "center", justifyContent: "center", padding: 22 },
  pencere: {
    width: "100%", maxWidth: 420, backgroundColor: "#fff", borderRadius: 24, padding: 22, alignItems: "center", gap: 12,
  },
  pencereIkon: {
    width: 62, height: 62, borderRadius: 20, backgroundColor: renk.yesil, alignItems: "center", justifyContent: "center",
    marginTop: -2,
  },
  pencereBaslik: { fontSize: 19, fontWeight: "900", color: renk.metin, textAlign: "center" },
  pencereMetin: { fontSize: 14, color: "#475467", lineHeight: 21, textAlign: "center" },
  madde: {
    flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: renk.yesilAcik, borderRadius: 12, padding: 11,
  },
  maddeIkon: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: renk.yesil, alignItems: "center", justifyContent: "center",
  },
  maddeYazi: { flex: 1, fontSize: 14, color: renk.metin, fontWeight: "600", lineHeight: 20 },
  pencereDugme: {
    alignSelf: "stretch", height: 50, borderRadius: 15, backgroundColor: renk.yesil, alignItems: "center",
    justifyContent: "center", marginTop: 4,
  },
  pencereDugmeYazi: { color: "#fff", fontSize: 16, fontWeight: "800" },
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 150, gap: 10 },
  ust: { fontSize: 12.5, color: renk.pasif },

  koyu: { backgroundColor: "#1d2126", borderRadius: 18, padding: 16, gap: 2 },
  koyuEt: { color: "#b9c2b0", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  koyuSatir: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 },
  koyuTutar: { color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  koyuKalan: { color: "#b9c2b0", fontSize: 14, fontWeight: "600" },
  koyuAlt: { color: "#e6ebe0", fontSize: 13, fontWeight: "600" },
  koyuAlt2: { color: "#b9c2b0", fontSize: 12.5 },
  taksitler: { flexDirection: "row", gap: 8, marginTop: 12 },
  taksit: { flex: 1, borderRadius: 12, padding: 9, backgroundColor: "rgba(255,255,255,.06)", gap: 1 },
  taksitKesildi: { backgroundColor: "rgba(124,181,24,.22)" },
  taksitSiradaki: { backgroundColor: "rgba(232,72,28,.22)" },
  taksitEt: { color: "#b9c2b0", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  taksitTarih: { color: "#fff", fontSize: 14, fontWeight: "700" },
  taksitTutar: { color: "#e6ebe0", fontSize: 12.5 },

  kart: { backgroundColor: renk.beyaz, borderRadius: 16, borderWidth: 1, borderColor: renk.cizgi, padding: 14, gap: 4 },
  kartUst: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  kartBaslik: { fontSize: 15, fontWeight: "800", color: renk.metin },
  kartAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },
  rozet: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  belgeKutu: { marginTop: 12, backgroundColor: "#fff7ef", borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: "#fde0c7" },
  belgeBaslik: { fontSize: 14, fontWeight: "800", color: "#ad4e00" },
  belgeAlt: { fontSize: 13, color: renk.metin },
  belgeDugme: { marginTop: 8, height: 42, borderRadius: 11, backgroundColor: renk.turuncu, alignItems: "center", justifyContent: "center" },
  belgeDugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  belgeSecim: { backgroundColor: renk.beyaz, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: renk.cizgi, gap: 8 },
  belgeSecimAd: { fontSize: 14, fontWeight: "700", color: renk.metin },
  belgeSecili: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: renk.yesilAcik, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  belgeSeciliYazi: { flex: 1, fontSize: 13.5, fontWeight: "700", color: renk.yesilKoyu },
  belgeKaldir: { fontSize: 13, fontWeight: "700", color: renk.kirmizi },
  belgeNot: { fontSize: 12, color: renk.pasif },
  rozetYazi: { fontSize: 11.5, fontWeight: "800" },
  adimlar: { flexDirection: "row", gap: 6, marginTop: 10 },
  adim: { flex: 1, height: 6, borderRadius: 3, backgroundColor: renk.cizgi },
  adimYazilar: { flexDirection: "row", marginTop: 4 },
  adimYazi: { flex: 1, fontSize: 11.5, color: renk.pasif },
  geriCek: { fontSize: 13, fontWeight: "700", color: renk.kirmizi },

  bilgi: { backgroundColor: renk.beyaz, borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 12, gap: 4 },
  bilgiYazi: { fontSize: 13, color: renk.metin },
  engel: { fontSize: 12.5, color: "#ad4e00", fontWeight: "600" },

  bolum: { fontSize: 11, fontWeight: "800", color: renk.pasif, letterSpacing: 0.7, marginTop: 8 },
  bos: { fontSize: 13, color: renk.pasif },
  gecmis: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 12,
  },
  gecmisTutar: { fontSize: 15.5, fontWeight: "800", color: renk.metin },
  gecmisAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  gecmisNot: { fontSize: 12, color: "#4b5563", marginTop: 3 },

  altCubuk: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 96, backgroundColor: "transparent" },
  anaDugme: { backgroundColor: renk.yesilKoyu, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  anaDugmePasif: { backgroundColor: "#c5c9c0" },
  anaDugmeYazi: { color: "#fff", fontSize: 15.5, fontWeight: "800" },

  etiket: { fontSize: 13, fontWeight: "700", color: renk.metin, marginTop: 8 },
  tutarKutu: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    paddingHorizontal: 14,
  },
  tutarTl: { fontSize: 26, fontWeight: "800", color: renk.pasif, marginRight: 6 },
  tutarGirdi: { flex: 1, fontSize: 28, fontWeight: "800", color: renk.metin, paddingVertical: 12 },
  cipler: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cip: { borderRadius: 999, borderWidth: 1, borderColor: renk.cizgi, backgroundColor: renk.beyaz, paddingHorizontal: 13, paddingVertical: 8 },
  cipGenis: { borderRadius: 12 },
  cipSecili: { backgroundColor: renk.yesilAcik, borderColor: renk.yesil },
  cipYazi: { fontSize: 13.5, fontWeight: "600", color: renk.metin },
  cipYaziSecili: { color: "#3f6108", fontWeight: "800" },
  hataKutu: { backgroundColor: "#fff2e8", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#f6c7a8" },
  hataYazi: { color: "#ad4e00", fontSize: 13.5, fontWeight: "700", lineHeight: 19 },
  planSatir: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#eef0ec" },
  planNo: { width: 26, color: renk.pasif, fontWeight: "700" },
  planTarih: { flex: 1, color: renk.metin, fontSize: 13.5 },
  planTutar: { color: renk.metin, fontWeight: "800", fontSize: 13.5 },
  aciklama: {
    backgroundColor: renk.beyaz,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 12,
    minHeight: 70,
    fontSize: 14,
    color: renk.metin,
    textAlignVertical: "top",
  },
  not: { fontSize: 12, color: renk.pasif, lineHeight: 17, marginTop: 4 },

  tamam: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  tamamSimge: { width: 72, height: 72, borderRadius: 36, backgroundColor: renk.yesilAcik, alignItems: "center", justifyContent: "center" },
  tamamTik: { fontSize: 34, color: renk.yesilKoyu, fontWeight: "800" },
  tamamBaslik: { fontSize: 19, fontWeight: "800", color: renk.metin },
  tamamMetin: { fontSize: 14, color: renk.pasif, textAlign: "center", lineHeight: 20, marginBottom: 10 },
});

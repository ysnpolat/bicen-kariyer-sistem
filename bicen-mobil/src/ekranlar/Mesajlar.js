/**
 * Mesajlar (1.9 · 23.10.2026)
 * ---------------------------------------------------------------------------
 * Panelde kurulan mesajlaşmanın mobil yüzü: aynı sohbetler, aynı uçlar
 * (/api/Mesajlasma). Personelin üye anahtarı sunucuda "p-sicil".
 *
 * Liste ve sohbet tek ekranda iki görünüm: alt menüde sekme olduğu için
 * sohbetten geri dönünce yine listeye düşülüyor. Açık sohbet 3 saniyede
 * bir yeni mesaj soruyor (panel gibi; WebSocket gerekmiyor), liste 8
 * saniyede bir tazeleniyor.
 *
 * Uzun basış: kendi mesajında Yanıtla / Düzenle / Sil, başkasınınkinde
 * Yanıtla. Ek: kamera, galeri ya da dosya (50 MB'a kadar).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Image,
  Alert,
  Modal,
  ActivityIndicator,
  Linking,
  RefreshControl,
  Platform,
  KeyboardAvoidingView,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import {
  mesajSohbetleri,
  mesajKisileri,
  mesajlarAl,
  mesajGonder,
  mesajDosyaGonder,
  mesajOkundu,
  mesajSil,
  mesajDuzenle,
  sohbetOlustur,
  sohbetSessiz,
  mesajDosyaAdresi,
} from "../api";
import { renk } from "../tema";
import Simge from "../bilesenler/Simge";
import { useKlavye, altBosluk, klavyePayi } from "../klavye";
import { galeridenSec, kameradanCek, dosyaSec } from "../dosyaSecici";

/** Şu an ekranda açık sohbet: üst balon bu sohbetin mesajını göstermesin */
export const aktifSohbet = { id: null };

/* Liste her açılışta boş başlamasın: son liste bellekte */
let sonListe = null;

const basHarf = (ad) =>
  `${ad ?? ""}`
    .split(" ")
    .filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(w))
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr");

const RENKLER = ["#5f8c10", "#1a5fb4", "#c2410c", "#7a3fd1", "#0f8a7e", "#b8860b", "#c41d7f", "#0b7fab"];
const renkSec = (s) => RENKLER[Math.abs([...`${s ?? ""}`].reduce((t, c) => t * 31 + c.charCodeAt(0), 7)) % RENKLER.length];

const saat = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const listeZamani = (t) => {
  const d = new Date(t);
  const bugun = new Date();
  if (d.toDateString() === bugun.toDateString()) return saat(t);
  const dun = new Date(bugun.getTime() - 864e5);
  if (d.toDateString() === dun.toDateString()) return "Dün";
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
};

const gunBasligi = (t) => {
  const d = new Date(t);
  const bugun = new Date();
  if (d.toDateString() === bugun.toDateString()) return "Bugün";
  if (d.toDateString() === new Date(bugun.getTime() - 864e5).toDateString()) return "Dün";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: d.getFullYear() === bugun.getFullYear() ? undefined : "numeric" });
};

function Avatar({ ad, boyut = 44, grup }) {
  return (
    <View style={[s.avatar, { width: boyut, height: boyut, borderRadius: boyut / 2, backgroundColor: renkSec(ad) }]}>
      {grup ? <Simge ad="ekip" renkli="#fff" boyut={boyut * 0.48} /> : <Text style={[s.avatarYazi, { fontSize: boyut * 0.36 }]}>{basHarf(ad)}</Text>}
    </View>
  );
}

/* ========================================================================== */

export default function Mesajlar({ navigation, route }) {
  const [sohbetId, setSohbetId] = useState(null);
  const istenen = route?.params?.sohbetId;
  const istekZamani = route?.params?.t;

  /* Bildirimden ya da balondan gelindi: o sohbet açılsın */
  useEffect(() => {
    if (istenen) setSohbetId(Number(istenen));
  }, [istenen, istekZamani]);

  if (sohbetId) return <Sohbet id={sohbetId} kapat={() => setSohbetId(null)} navigation={navigation} />;

  return <Liste ac={setSohbetId} navigation={navigation} />;
}

/* ========================================================================== */
/* Liste                                                                      */
/* ========================================================================== */

function Liste({ ac }) {
  const [veri, setVeri] = useState(sonListe);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [ara, setAra] = useState("");
  const [yeni, setYeni] = useState(false);

  const getir = useCallback(async (gosterge = false) => {
    if (gosterge) setYenileniyor(true);
    try {
      const d = await mesajSohbetleri();
      sonListe = d;
      setVeri(d);
      setHata("");
    } catch (h) {
      setHata(h?.message ?? "Sohbetler alınamadı.");
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
      const z = setInterval(() => {
        if (AppState.currentState === "active") getir();
      }, 8000);
      return () => clearInterval(z);
    }, [getir])
  );

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (veri?.sohbetler ?? []).filter((x) => !q || `${x.ad}`.toLocaleLowerCase("tr").includes(q));
  }, [veri, ara]);

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <View style={s.ustBar}>
        <Text style={s.baslik}>Mesajlar</Text>
        <TouchableOpacity style={s.yeniDugme} onPress={() => setYeni(true)} hitSlop={8}>
          <Simge ad="kalem" renkli="#fff" boyut={18} />
        </TouchableOpacity>
      </View>

      <View style={s.araKutu}>
        <TextInput
          value={ara}
          onChangeText={setAra}
          placeholder="Sohbet ara"
          placeholderTextColor="#9aa093"
          style={s.araGirdi}
        />
      </View>

      {hata ? (
        <TouchableOpacity style={s.hata} onPress={() => getir(true)}>
          <Text style={s.hataYazi}>{hata}</Text>
          <Text style={[s.hataYazi, { fontWeight: "700" }]}>Tekrar dene</Text>
        </TouchableOpacity>
      ) : null}

      {!veri && !hata ? (
        <ActivityIndicator color={renk.yesil} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={liste}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
          ListEmptyComponent={
            <View style={s.bos}>
              <Simge ad="mesaj" renkli="#b9bfb2" boyut={44} />
              <Text style={s.bosBaslik}>Henüz sohbet yok</Text>
              <Text style={s.bosAlt}>Sağ üstteki kalemle bir kişiye yazabilir ya da grup kurabilirsiniz.</Text>
            </View>
          }
          renderItem={({ item: x }) => {
            const son = x.son;
            const onEk = son ? (son.ben ? "Siz: " : x.tur === "grup" && son.gonderenAd ? `${son.gonderenAd.split(" ")[0]}: ` : "") : "";
            const metin = !son ? "Sohbet başladı" : son.tur === "gorsel" ? "📷 Görsel" : son.tur === "video" ? "🎬 Video" : son.tur === "dosya" ? `📎 ${son.dosya ?? "Dosya"}` : son.metin ?? "";
            return (
              <TouchableOpacity style={s.satir} activeOpacity={0.7} onPress={() => ac(x.id)}>
                <Avatar ad={x.ad} grup={x.tur === "grup"} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.satirUst}>
                    <Text style={s.satirAd} numberOfLines={1}>
                      {x.ad}
                    </Text>
                    <Text style={[s.satirZaman, x.okunmamis > 0 && { color: renk.yesilKoyu, fontWeight: "700" }]}>{listeZamani(x.sonZaman)}</Text>
                  </View>
                  <View style={s.satirUst}>
                    <Text style={[s.satirMetin, x.okunmamis > 0 && { color: renk.metin, fontWeight: "600" }]} numberOfLines={1}>
                      {x.sessiz ? "🔕 " : ""}
                      {onEk}
                      {metin}
                    </Text>
                    {x.okunmamis > 0 ? (
                      <View style={s.rozet}>
                        <Text style={s.rozetYazi}>{x.okunmamis > 99 ? "99+" : x.okunmamis}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {yeni && (
        <YeniSohbet
          kapat={() => setYeni(false)}
          acildi={(id) => {
            setYeni(false);
            ac(id);
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Yeni sohbet                                                                 */
/* ========================================================================== */

function YeniSohbet({ kapat, acildi }) {
  const klavye = useKlavye();
  const [q, setQ] = useState("");
  const [kisiler, setKisiler] = useState([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [grup, setGrup] = useState(false);
  const [secili, setSecili] = useState([]);
  const [grupAdi, setGrupAdi] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    setYukleniyor(true);
    const z = setTimeout(() => {
      mesajKisileri(q.trim())
        .then((d) => setKisiler(Array.isArray(d) ? d : []))
        .catch(() => setKisiler([]))
        .finally(() => setYukleniyor(false));
    }, q ? 300 : 0);
    return () => clearTimeout(z);
  }, [q]);

  const baslat = async (uyeler, tur, ad) => {
    setGonderiliyor(true);
    try {
      const c = await sohbetOlustur({ tur, ad, uyeler });
      acildi(c.id);
    } catch (h) {
      Alert.alert("Sohbet açılamadı", h?.message ?? "");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={kapat}>
      <SafeAreaView style={s.tam}>
        <View style={s.modalBar}>
          <TouchableOpacity onPress={kapat} hitSlop={10}>
            <Text style={s.modalIptal}>Vazgeç</Text>
          </TouchableOpacity>
          <Text style={s.modalBaslik}>{grup ? "Yeni grup" : "Yeni sohbet"}</Text>
          {grup ? (
            <TouchableOpacity
              disabled={secili.length === 0 || grupAdi.trim().length < 2 || gonderiliyor}
              onPress={() => baslat(secili.map((x) => x.kod), "grup", grupAdi.trim())}
              hitSlop={10}
            >
              <Text style={[s.modalTamam, (secili.length === 0 || grupAdi.trim().length < 2) && { opacity: 0.4 }]}>Kur</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 50 }} />
          )}
        </View>

        <View style={s.araKutu}>
          <TextInput value={q} onChangeText={setQ} placeholder="Ad, sicil ya da şube ara" placeholderTextColor="#9aa093" style={s.araGirdi} autoFocus />
        </View>

        <TouchableOpacity style={s.grupSec} onPress={() => setGrup((g) => !g)}>
          <Avatar ad="Grup" grup boyut={38} />
          <Text style={{ fontWeight: "600", color: renk.metin, flex: 1 }}>{grup ? "Tek kişiye yaz" : "Grup kur"}</Text>
        </TouchableOpacity>

        {grup && (
          <View style={{ paddingHorizontal: 14, gap: 8, paddingBottom: 8 }}>
            <TextInput value={grupAdi} onChangeText={setGrupAdi} placeholder="Grup adı" placeholderTextColor="#9aa093" style={s.araGirdi} />
            {secili.length > 0 && (
              <Text style={{ fontSize: 12.5, color: renk.pasif }}>
                {secili.length} kişi: {secili.map((x) => x.ad.split(" ")[0]).join(", ")}
              </Text>
            )}
          </View>
        )}

        <Text style={s.bolum}>{q.trim().length >= 2 ? "Sonuçlar" : "Şubeniz ve yöneticiler"}</Text>

        {yukleniyor ? (
          <ActivityIndicator color={renk.yesil} style={{ marginTop: 20 }} />
        ) : (
          <FlatList
            data={kisiler}
            keyExtractor={(x) => x.kod}
            keyboardShouldPersistTaps="handled"
            /* 23.10.2026: klavye listenin altını kapatıyordu; kaydırınca kapanır, liste klavyenin üstünde biter */
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: klavyePayi(klavye) + 24 }}
            ListEmptyComponent={<Text style={[s.bosAlt, { padding: 20 }]}>Kimse bulunamadı. En az iki harf yazın.</Text>}
            renderItem={({ item: k }) => {
              const sec = secili.some((x) => x.kod === k.kod);
              return (
                <TouchableOpacity
                  style={s.satir}
                  disabled={gonderiliyor}
                  onPress={() =>
                    grup ? setSecili((o) => (sec ? o.filter((x) => x.kod !== k.kod) : [...o, k])) : baslat([k.kod], "kisi")
                  }
                >
                  <Avatar ad={k.ad} boyut={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.satirAd} numberOfLines={1}>
                      {k.ad}
                    </Text>
                    <Text style={s.satirMetin} numberOfLines={1}>
                      {k.tur === "panel" ? `Merkez · ${k.rol ?? ""}` : [k.rol, k.sube].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {grup && (
                    <View style={[s.secKutu, sec && s.secKutuOn]}>{sec ? <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text> : null}</View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ========================================================================== */
/* Sohbet                                                                     */
/* ========================================================================== */

const birlestir = (eski, gelen) => {
  const m = new Map(eski.map((x) => [x.id, x]));
  for (const x of gelen) m.set(x.id, x);
  return [...m.values()].sort((a, b) => a.id - b.id);
};

function Sohbet({ id, kapat }) {
  const [bilgi, setBilgi] = useState(null);
  const [mesajlar, setMesajlar] = useState([]);
  const [okundu, setOkundu] = useState(0);
  const [dahaVar, setDahaVar] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [metin, setMetin] = useState("");
  const [yanit, setYanit] = useState(null);
  const [duzenlenen, setDuzenlenen] = useState(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [gorsel, setGorsel] = useState(null);
  const klavye = useKlavye();
  const enBuyuk = useRef(0);
  const okunanGonderilen = useRef(0);

  useEffect(() => {
    aktifSohbet.id = id;
    return () => {
      aktifSohbet.id = null;
    };
  }, [id]);

  /* Başlık bilgisi listeden (ayrı uç yok) */
  useEffect(() => {
    const bul = (d) => (d?.sohbetler ?? []).find((x) => x.id === id);
    const b = bul(sonListe);
    if (b) setBilgi(b);
    mesajSohbetleri()
      .then((d) => {
        sonListe = d;
        setBilgi(bul(d) ?? { id, ad: "Sohbet", tur: "kisi" });
      })
      .catch(() => undefined);
  }, [id]);

  const okunduBildir = useCallback(
    (liste) => {
      const son = liste.length ? liste[liste.length - 1].id : 0;
      if (son > okunanGonderilen.current) {
        okunanGonderilen.current = son;
        mesajOkundu(id, son).catch(() => undefined);
      }
    },
    [id]
  );

  const ilkYukle = useCallback(async () => {
    try {
      const d = await mesajlarAl(id);
      const l = d?.mesajlar ?? [];
      setMesajlar(l);
      setOkundu(d?.digerleriOkudu ?? 0);
      setDahaVar(!!d?.dahaVar);
      enBuyuk.current = l.length ? l[l.length - 1].id : 0;
      okunduBildir(l);
    } catch (h) {
      Alert.alert("Mesajlar alınamadı", h?.message ?? "");
    } finally {
      setYukleniyor(false);
    }
  }, [id, okunduBildir]);

  useEffect(() => {
    ilkYukle();
  }, [ilkYukle]);

  /* Anlık: 3 saniyede bir yeniler ve son 20 sn'de değişenler (düzenle/sil) */
  useEffect(() => {
    const z = setInterval(async () => {
      if (AppState.currentState !== "active") return;
      try {
        const d = await mesajlarAl(id, { sonra: enBuyuk.current || 0 });
        const gelen = d?.mesajlar ?? [];
        setOkundu(d?.digerleriOkudu ?? 0);
        if (gelen.length) {
          setMesajlar((o) => {
            const y = birlestir(o, gelen);
            enBuyuk.current = Math.max(enBuyuk.current, ...gelen.map((x) => x.id));
            okunduBildir(y);
            return y;
          });
        }
      } catch {
        /* bir sonraki turda yeniden denenir */
      }
    }, 3000);
    return () => clearInterval(z);
  }, [id, okunduBildir]);

  const eskileriYukle = async () => {
    if (!dahaVar || !mesajlar.length) return;
    try {
      const d = await mesajlarAl(id, { once: mesajlar[0].id });
      setMesajlar((o) => birlestir(o, d?.mesajlar ?? []));
      setDahaVar(!!d?.dahaVar);
    } catch {
      /* sessiz */
    }
  };

  const gonder = async () => {
    const t = metin.trim();
    if (!t || gonderiliyor) return;
    setGonderiliyor(true);
    try {
      if (duzenlenen) {
        await mesajDuzenle(duzenlenen.id, t);
        setMesajlar((o) => o.map((x) => (x.id === duzenlenen.id ? { ...x, metin: t, duzenlendi: true } : x)));
        setDuzenlenen(null);
      } else {
        const c = await mesajGonder(id, t, yanit?.id ?? null);
        const yeni = {
          id: c.id,
          ben: true,
          tur: "metin",
          metin: t,
          tarih: new Date().toISOString(),
          yanit: yanit ? { id: yanit.id, gonderenAd: yanit.gonderenAd, metin: yanit.metin ?? yanit.dosyaAd } : null,
        };
        setMesajlar((o) => birlestir(o, [yeni]));
        enBuyuk.current = Math.max(enBuyuk.current, c.id);
        okunanGonderilen.current = Math.max(okunanGonderilen.current, c.id);
        setYanit(null);
      }
      setMetin("");
    } catch (h) {
      Alert.alert("Gönderilemedi", h?.message ?? "");
    } finally {
      setGonderiliyor(false);
    }
  };

  const dosyaYolla = async (secim) => {
    const a = secim?.assets?.[0];
    if (!a || secim?.canceled) return;
    setGonderiliyor(true);
    try {
      const ad = a.fileName ?? a.name ?? `ek_${Date.now()}.${(a.mimeType ?? "image/jpeg").includes("video") ? "mp4" : "jpg"}`;
      const c = await mesajDosyaGonder(id, { uri: a.uri, ad, tip: a.mimeType ?? "image/jpeg" }, metin.trim(), yanit?.id ?? null);
      setMetin("");
      setYanit(null);
      enBuyuk.current = Math.max(enBuyuk.current, (c?.id ?? 0) - 1);
    } catch (h) {
      Alert.alert("Dosya gönderilemedi", h?.message ?? "");
    } finally {
      setGonderiliyor(false);
    }
  };

  const ekMenusu = () =>
    Alert.alert("Ek gönder", undefined, [
      { text: "Kamera", onPress: () => kameradanCek({ quality: 0.7 }).then(dosyaYolla).catch((h) => Alert.alert("Kamera", h?.message)) },
      {
        text: "Galeri",
        onPress: () => galeridenSec({ quality: 0.7, mediaTypes: ["images", "videos"] }).then(dosyaYolla).catch((h) => Alert.alert("Galeri", h?.message)),
      },
      {
        text: "Dosya",
        onPress: () =>
          dosyaSec({ copyToCacheDirectory: true })
            .then((r) => dosyaYolla(r?.assets ? r : r?.uri ? { assets: [r] } : r))
            .catch((h) => Alert.alert("Dosya", h?.message)),
      },
      { text: "Vazgeç", style: "cancel" },
    ]);

  const islem = (m) => {
    if (m.silindi || m.tur === "sistem") return;
    const secenek = [{ text: "Yanıtla", onPress: () => (setDuzenlenen(null), setYanit(m)) }];
    if (m.ben && m.tur === "metin")
      secenek.push({
        text: "Düzenle",
        onPress: () => {
          setYanit(null);
          setDuzenlenen(m);
          setMetin(m.metin ?? "");
        },
      });
    if (m.ben)
      secenek.push({
        text: "Sil",
        style: "destructive",
        onPress: () =>
          Alert.alert("Mesaj silinsin mi?", "Herkes için \"Bu mesaj silindi\" görünür.", [
            { text: "Vazgeç", style: "cancel" },
            {
              text: "Sil",
              style: "destructive",
              onPress: () =>
                mesajSil(m.id)
                  .then(() => setMesajlar((o) => o.map((x) => (x.id === m.id ? { ...x, silindi: true, metin: null, tur: "metin" } : x))))
                  .catch((h) => Alert.alert("Silinemedi", h?.message)),
            },
          ]),
      });
    secenek.push({ text: "Vazgeç", style: "cancel" });
    Alert.alert(m.ben ? "Mesajınız" : m.gonderenAd ?? "Mesaj", (m.metin ?? m.dosyaAd ?? "").slice(0, 80), secenek);
  };

  const grup = bilgi?.tur === "grup";

  /* Ters liste: en yeni altta. Gün başlıkları araya ekleniyor. */
  const satirlar = useMemo(() => {
    const l = [];
    let onceki = null;
    for (const m of mesajlar) {
      const g = new Date(m.tarih).toDateString();
      if (g !== onceki) l.push({ gun: true, id: `g-${g}`, tarih: m.tarih });
      onceki = g;
      l.push(m);
    }
    return l.reverse();
  }, [mesajlar]);

  const alt = klavye.acik ? altBosluk(klavye) : 92;

  return (
    <SafeAreaView style={[s.tam, { backgroundColor: "#efeae2" }]} edges={["top"]}>
      <View style={s.sohbetBar}>
        <TouchableOpacity onPress={kapat} hitSlop={12} style={s.geri}>
          <Text style={{ color: "#fff", fontSize: 26, marginTop: -3 }}>‹</Text>
        </TouchableOpacity>
        <Avatar ad={bilgi?.ad} grup={grup} boyut={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.sohbetAd} numberOfLines={1}>
            {bilgi?.ad ?? "…"}
          </Text>
          <Text style={s.sohbetAlt} numberOfLines={1}>
            {grup ? `${bilgi?.uyeSayisi ?? ""} üye${bilgi?.duyuru ? " · duyuru grubu" : ""}` : "Özel sohbet"}
          </Text>
        </View>
        {bilgi && (
          <TouchableOpacity
            hitSlop={10}
            onPress={() =>
              sohbetSessiz(id, !bilgi.sessiz)
                .then(() => setBilgi((b) => ({ ...b, sessiz: !b.sessiz })))
                .catch(() => undefined)
            }
          >
            <Text style={{ fontSize: 18 }}>{bilgi.sessiz ? "🔕" : "🔔"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {yukleniyor ? (
        <ActivityIndicator color={renk.yesil} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          inverted
          data={satirlar}
          keyExtractor={(x) => String(x.id)}
          onEndReached={eskileriYukle}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: 10, paddingTop: 8 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: m }) => {
            if (m.gun)
              return (
                <View style={s.gunKutu}>
                  <Text style={s.gunYazi}>{gunBasligi(m.tarih)}</Text>
                </View>
              );
            if (m.tur === "sistem")
              return (
                <View style={s.gunKutu}>
                  <Text style={[s.gunYazi, { backgroundColor: "#fff8d6" }]}>{m.metin}</Text>
                </View>
              );
            return (
              <Balon
                m={m}
                grup={grup}
                okundu={m.ben && m.id <= okundu}
                uzunBas={() => islem(m)}
                gorselAc={() => setGorsel(m)}
              />
            );
          }}
        />
      )}

      <View style={{ paddingBottom: alt }}>
        {(yanit || duzenlenen) && (
          <View style={s.yanitSerit}>
            <View style={{ flex: 1 }}>
              <Text style={s.yanitBaslik}>{duzenlenen ? "Mesajı düzenle" : `${yanit.ben ? "Kendinize" : yanit.gonderenAd ?? ""} yanıt`}</Text>
              <Text numberOfLines={1} style={s.yanitMetin}>
                {(duzenlenen ?? yanit).metin ?? (duzenlenen ?? yanit).dosyaAd ?? ""}
              </Text>
            </View>
            <TouchableOpacity
              hitSlop={10}
              onPress={() => {
                if (duzenlenen) setMetin("");
                setYanit(null);
                setDuzenlenen(null);
              }}
            >
              <Text style={{ fontSize: 18, color: renk.pasif }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {bilgi?.duyuru && !bilgi?.benYonetici ? (
          <Text style={s.duyuruNot}>Bu duyuru grubunda yalnızca yöneticiler yazabilir.</Text>
        ) : (
          <View style={s.girdiSatir}>
            {!duzenlenen && (
              <TouchableOpacity style={s.ekDugme} onPress={ekMenusu} disabled={gonderiliyor}>
                <Text style={{ fontSize: 24, color: renk.pasif, marginTop: -2 }}>+</Text>
              </TouchableOpacity>
            )}
            <TextInput
              value={metin}
              onChangeText={setMetin}
              placeholder="Mesaj"
              placeholderTextColor="#9aa093"
              multiline
              style={s.girdi}
            />
            <TouchableOpacity style={[s.gonderDugme, !metin.trim() && { opacity: 0.45 }]} onPress={gonder} disabled={!metin.trim() || gonderiliyor}>
              {gonderiliyor ? <ActivityIndicator color="#fff" size="small" /> : <Simge ad={duzenlenen ? "onay" : "gonder"} renkli="#fff" boyut={19} />}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Modal visible={!!gorsel} transparent animationType="fade" onRequestClose={() => setGorsel(null)}>
        <TouchableOpacity activeOpacity={1} style={s.gorselZemin} onPress={() => setGorsel(null)}>
          {gorsel && <Image source={{ uri: mesajDosyaAdresi(gorsel.id) }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />}
          <Text style={{ color: "#fff", marginTop: 12 }}>Kapatmak için dokunun</Text>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function Balon({ m, grup, okundu, uzunBas, gorselAc }) {
  const ben = m.ben;
  return (
    <View style={[s.balonSatir, ben ? { justifyContent: "flex-end" } : null]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={uzunBas}
        delayLongPress={300}
        onPress={() => {
          if (m.silindi) return;
          if (m.tur === "gorsel") gorselAc();
          else if (m.tur === "video" || m.tur === "dosya") Linking.openURL(mesajDosyaAdresi(m.id, m.tur === "dosya")).catch(() => undefined);
        }}
        style={[s.balon, ben ? s.balonBen : s.balonO]}
      >
        {grup && !ben ? <Text style={[s.balonAd, { color: renkSec(m.gonderenAd) }]}>{m.gonderenAd}</Text> : null}

        {m.yanit ? (
          <View style={s.alinti}>
            <Text style={s.alintiAd}>{m.yanit.gonderenAd ?? ""}</Text>
            <Text style={s.alintiMetin} numberOfLines={2}>
              {m.yanit.metin ?? ""}
            </Text>
          </View>
        ) : null}

        {m.silindi ? (
          <Text style={s.silindi}>🚫 Bu mesaj silindi</Text>
        ) : m.tur === "gorsel" ? (
          <Image source={{ uri: mesajDosyaAdresi(m.id) }} style={s.balonGorsel} resizeMode="cover" />
        ) : m.tur === "video" ? (
          <View style={s.dosyaKutu}>
            <Text style={{ fontSize: 22 }}>🎬</Text>
            <Text style={s.dosyaAd} numberOfLines={2}>
              {m.dosyaAd ?? "Video"} · oynatmak için dokunun
            </Text>
          </View>
        ) : m.tur === "dosya" ? (
          <View style={s.dosyaKutu}>
            <Text style={{ fontSize: 22 }}>📎</Text>
            <Text style={s.dosyaAd} numberOfLines={2}>
              {m.dosyaAd}
              {m.dosyaBoyut ? ` · ${Math.max(1, Math.round(m.dosyaBoyut / 1024))} KB` : ""}
            </Text>
          </View>
        ) : m.tur === "kaldirildi" ? (
          <Text style={s.silindi}>📦 Dosya arşivden kaldırıldı</Text>
        ) : null}

        {!m.silindi && m.metin && m.tur !== "metin" ? <Text style={[s.balonMetin, { marginTop: 6 }]}>{m.metin}</Text> : null}
        {!m.silindi && m.tur === "metin" && m.metin ? <Text style={s.balonMetin}>{m.metin}</Text> : null}

        <View style={s.balonAlt}>
          {m.duzenlendi ? <Text style={s.balonSaat}>düzenlendi · </Text> : null}
          <Text style={s.balonSaat}>{saat(m.tarih)}</Text>
          {ben ? <Text style={[s.balonSaat, { color: okundu ? "#34b7f1" : "#8a9a86", marginLeft: 3 }]}>✓✓</Text> : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  ustBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  baslik: { fontSize: 26, fontWeight: "800", color: renk.metin, flex: 1, letterSpacing: -0.5 },
  yeniDugme: { width: 40, height: 40, borderRadius: 20, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  araKutu: { paddingHorizontal: 14, paddingVertical: 8 },
  araGirdi: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: renk.cizgi, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 11 : 8, fontSize: 16, color: renk.metin },
  hata: { marginHorizontal: 14, padding: 12, borderRadius: 12, backgroundColor: "#fff2e8", gap: 4 },
  hataYazi: { color: renk.turuncuKoyu, fontSize: 13 },
  satir: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: "#fff", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  satirUst: { flexDirection: "row", alignItems: "center", gap: 8 },
  satirAd: { flex: 1, fontSize: 15.5, fontWeight: "700", color: renk.metin },
  satirZaman: { fontSize: 12, color: renk.pasif },
  satirMetin: { flex: 1, fontSize: 13.5, color: renk.pasif, marginTop: 2 },
  rozet: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: renk.yesil, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  rozetYazi: { color: "#fff", fontSize: 12, fontWeight: "800" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarYazi: { color: "#fff", fontWeight: "800" },
  bos: { alignItems: "center", padding: 40, gap: 8 },
  bosBaslik: { fontSize: 16, fontWeight: "700", color: renk.metin },
  bosAlt: { fontSize: 13, color: renk.pasif, textAlign: "center" },
  bolum: { fontSize: 12, fontWeight: "700", color: renk.pasif, textTransform: "uppercase", paddingHorizontal: 16, paddingVertical: 6, letterSpacing: 0.5 },
  modalBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: renk.cizgi, backgroundColor: "#fff" },
  modalIptal: { color: renk.pasif, fontSize: 15 },
  modalBaslik: { fontWeight: "800", fontSize: 16, color: renk.metin },
  modalTamam: { color: renk.yesilKoyu, fontWeight: "800", fontSize: 15, width: 50, textAlign: "right" },
  grupSec: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  secKutu: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#c9cec3", alignItems: "center", justifyContent: "center" },
  secKutuOn: { backgroundColor: renk.yesil, borderColor: renk.yesil },

  sohbetBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: renk.yesilKoyu },
  geri: { width: 30, alignItems: "center" },
  sohbetAd: { color: "#fff", fontWeight: "800", fontSize: 16 },
  sohbetAlt: { color: "#e3efcf", fontSize: 12 },
  gunKutu: { alignItems: "center", marginVertical: 8 },
  gunYazi: { backgroundColor: "#e2f0d9", color: "#4a5a45", fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
  balonSatir: { flexDirection: "row", marginVertical: 2 },
  balon: { maxWidth: "82%", borderRadius: 12, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  balonBen: { backgroundColor: "#dcf8c6", borderTopRightRadius: 3 },
  balonO: { backgroundColor: "#fff", borderTopLeftRadius: 3 },
  balonAd: { fontSize: 12.5, fontWeight: "800", marginBottom: 2 },
  balonMetin: { fontSize: 15.5, color: "#111b21", lineHeight: 21 },
  balonAlt: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 2 },
  balonSaat: { fontSize: 11, color: "#7a8a77" },
  balonGorsel: { width: 230, height: 230, borderRadius: 8, backgroundColor: "#e5e5e5" },
  silindi: { fontStyle: "italic", color: "#7a8a77", fontSize: 14 },
  alinti: { borderLeftWidth: 3, borderLeftColor: renk.yesil, backgroundColor: "#0000000a", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4 },
  alintiAd: { fontSize: 12, fontWeight: "800", color: renk.yesilKoyu },
  alintiMetin: { fontSize: 13, color: "#4a5a45" },
  dosyaKutu: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0000000a", borderRadius: 8, padding: 8, minWidth: 200 },
  dosyaAd: { flex: 1, fontSize: 13.5, color: "#111b21" },
  yanitSerit: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", marginHorizontal: 8, marginBottom: -4, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 10, borderLeftWidth: 4, borderLeftColor: renk.yesil },
  yanitBaslik: { fontSize: 12.5, fontWeight: "800", color: renk.yesilKoyu },
  yanitMetin: { fontSize: 13, color: renk.pasif },
  girdiSatir: { flexDirection: "row", alignItems: "flex-end", gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  ekDugme: { width: 42, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  girdi: { flex: 1, minHeight: 44, maxHeight: 130, backgroundColor: "#fff", borderRadius: 22, paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 12 : 9, paddingBottom: Platform.OS === "ios" ? 12 : 9, fontSize: 16, color: renk.metin },
  gonderDugme: { width: 46, height: 46, borderRadius: 23, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  duyuruNot: { textAlign: "center", color: renk.pasif, padding: 14, fontSize: 13 },
  gorselZemin: { flex: 1, backgroundColor: "#000e", alignItems: "center", justifyContent: "center" },
});

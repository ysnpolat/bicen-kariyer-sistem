/**
 * Devamsızlık girişi (1.9 · 23.10.2026)
 * ---------------------------------------------------------------------------
 * Birim yöneticisi, vardiya girişi yapmamış ekip personeline devamsızlık
 * girer. Liste son N günde (Ayarlar: devamsizlik.geriGun) girişi olmayan
 * günleri olan kişileri gösteriyor; kişiye dokununca günler açılıyor.
 * Yalnızca okutma, izin, rapor, haftalık izin ve tatil olmayan günler
 * seçilebiliyor (sunucu yeniden denetliyor).
 *
 * "X vardiya girişini yapmadı" bildirimine dokununca doğrudan o kişinin
 * günleri açılıyor (route.params.sicil).
 *
 * 26.10.2026: açıklama zorunlu, iki şahit personel (aynı şubeden, arama ile)
 * zorunlu. Sunucu tutanağı üretip mail atıyor; giren imzalı tutanağı ana
 * sayfadaki karttan yüklüyor, şahitler uygulamadan onaylıyor
 * (DevamsizlikTutanak ekranı).
 */

import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator, RefreshControl, Modal, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import BarBaslik from "../bilesenler/BarBaslik";
import { devamsizEkipAl, devamsizKisiAl, devamsizlikGir, devamsizlikKaldir, devamsizSahitlerAl } from "../api";
import { renk } from "../tema";
import { useKlavye, altBosluk } from "../klavye";

const GUNLER = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const gunAdi = (t) => {
  const d = new Date(t);
  return `${d.getDate()} ${d.toLocaleDateString("tr-TR", { month: "short" })} ${GUNLER[d.getDay()]}`;
};
const isoGun = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const sa = (t) => {
  const d = new Date(t);
  return isNaN(d) ? String(t) : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const DURUM = {
  okuttu: { ad: "Giriş yaptı", renk: renk.yesilKoyu, zemin: renk.yesilAcik },
  izinli: { ad: "İzinli", renk: "#1a5fb4", zemin: "#e7f0fc" },
  haftalik: { ad: "Haftalık izin", renk: "#1a5fb4", zemin: "#e7f0fc" },
  tatil: { ad: "Resmî tatil", renk: "#6b7280", zemin: "#f0f1ee" },
  devamsiz: { ad: "Devamsız", renk: "#cf1322", zemin: "#fff1f0" },
  okutmadi: { ad: "Giriş yok", renk: "#d97706", zemin: "#fff6e5" },
};

export default function Devamsizlik({ route, navigation }) {
  const [sicil, setSicil] = useState(null);
  const istenen = route?.params?.sicil;
  const t = route?.params?.t;

  useEffect(() => {
    setSicil(istenen || null);
  }, [istenen, t]);

  return sicil ? <Kisi sicil={sicil} geri={() => setSicil(null)} navigation={navigation} /> : <Ekip sec={setSicil} />;
}

/** Açıklama anlamlı mı: sunucuyla aynı kural (en az 5 karakter, harf içersin) */
const aciklamaGecerli = (a) => (a ?? "").trim().length >= 5 && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(a ?? "");

/** Türkçe duyarsız arama anahtarı */
const anahtar = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");

/**
 * Şahit seçici (26.10.2026): aynı şubedeki aktif personel, arama ile.
 * Diğer şahit olarak seçilen kişi listede kapalı.
 */
function SahitSecici({ acik, kapat, liste, yukleniyor, hata, sec, baslik, kapali }) {
  const [ara, setAra] = useState("");
  useEffect(() => {
    if (acik) setAra("");
  }, [acik]);
  const a = anahtar(ara.trim());
  const suzulmus = (liste ?? []).filter((p) => !a || anahtar(`${p.adSoyad} ${p.pozisyon ?? ""} ${p.sicil}`).includes(a));

  return (
    <Modal visible={acik} animationType="slide" onRequestClose={kapat}>
      <SafeAreaView style={s.tam} edges={["top", "bottom"]}>
        <View style={s.seciciBas}>
          <TouchableOpacity onPress={kapat} hitSlop={10}>
            <Text style={s.seciciKapat}>Vazgeç</Text>
          </TouchableOpacity>
          <Text style={s.seciciBaslik}>{baslik}</Text>
          <View style={{ width: 54 }} />
        </View>
        <TextInput
          value={ara}
          onChangeText={setAra}
          placeholder="Ad, görev ya da sicil ile ara"
          placeholderTextColor="#9aa093"
          autoFocus
          style={[s.aciklama, { minHeight: 44, margin: 14, marginBottom: 6 }]}
        />
        {yukleniyor ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 20 }} /> : null}
        {hata ? <Text style={s.hata}>{hata}</Text> : null}
        {!yukleniyor && !hata && suzulmus.length === 0 ? (
          <Text style={[s.alt, { textAlign: "center", marginTop: 20 }]}>Uygun personel bulunamadı</Text>
        ) : null}
        <FlatList
          data={suzulmus}
          keyExtractor={(p) => p.sicil}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
          renderItem={({ item: p }) => {
            const disabled = kapali === p.sicil;
            return (
              <TouchableOpacity
                disabled={disabled}
                activeOpacity={0.7}
                onPress={() => sec(p)}
                style={[s.kart, disabled && { opacity: 0.4 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.ad} numberOfLines={1}>{p.adSoyad}</Text>
                  <Text style={s.alt} numberOfLines={1}>{[p.pozisyon, p.sube].filter(Boolean).join(" · ")}{disabled ? " · diğer şahit" : ""}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

function Ekip({ sec }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);

  const getir = useCallback(async (g = false) => {
    if (g) setYenileniyor(true);
    try {
      setVeri(await devamsizEkipAl());
      setHata("");
    } catch (h) {
      setHata(h?.message ?? "Liste alınamadı.");
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const kisiler = veri?.kisiler ?? [];

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Devamsızlık Girişi" acik />
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        <View style={s.bilgiKutu}>
          <Text style={s.bilgiYazi}>
            Son {veri?.geriGun ?? 7} günde vardiya girişi olmayan ekip personeliniz. Personel gerçekten gelmediyse devamsızlık işleyin;
            izinli ya da raporluysa izin/rapor girilmesini isteyin.
          </Text>
        </View>

        {hata ? <Text style={s.hata}>{hata}</Text> : null}
        {!veri && !hata ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 30 }} /> : null}

        {veri && kisiler.length === 0 ? (
          <View style={s.bos}>
            <Text style={{ fontSize: 34 }}>✓</Text>
            <Text style={s.bosBaslik}>Girişi eksik personel yok</Text>
          </View>
        ) : null}

        {kisiler.map((k) => (
          <TouchableOpacity key={k.sicil} style={s.kart} activeOpacity={0.75} onPress={() => sec(k.sicil)}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.ad} numberOfLines={1}>
                {k.adSoyad}
              </Text>
              <Text style={s.alt} numberOfLines={1}>
                {[k.pozisyon, k.sube].filter(Boolean).join(" · ")}
              </Text>
              <View style={s.cipler}>
                {(k.eksik ?? []).slice(0, 5).map((g) => (
                  <Text key={g} style={[s.cip, { color: DURUM.okutmadi.renk, backgroundColor: DURUM.okutmadi.zemin }]}>
                    {gunAdi(g)}
                  </Text>
                ))}
                {(k.devamsiz ?? []).slice(0, 3).map((g) => (
                  <Text key={g} style={[s.cip, { color: DURUM.devamsiz.renk, backgroundColor: DURUM.devamsiz.zemin }]}>
                    {gunAdi(g)} · devamsız
                  </Text>
                ))}
              </View>
            </View>
            <View style={s.sayac}>
              <Text style={s.sayacSayi}>{(k.eksik ?? []).length}</Text>
              <Text style={s.sayacAlt}>giriş yok</Text>
            </View>
          </TouchableOpacity>
        ))}
        <View style={{ height: 110 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Kisi({ sicil, geri, navigation }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [secili, setSecili] = useState([]);
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const klavye = useKlavye();

  /* Şahitler (26.10.2026): liste kişi açılınca bir kez çekiliyor */
  const [sahitler, setSahitler] = useState(null);
  const [sahitHata, setSahitHata] = useState("");
  const [sahit1, setSahit1] = useState(null);
  const [sahit2, setSahit2] = useState(null);
  const [seciciAcik, setSeciciAcik] = useState(0); // 0 kapalı, 1 ya da 2

  useEffect(() => {
    setSahitler(null);
    setSahit1(null);
    setSahit2(null);
    devamsizSahitlerAl(sicil)
      .then((d) => {
        setSahitler(d?.sahitler ?? []);
        setSahitHata("");
      })
      .catch((h) => {
        setSahitler([]);
        setSahitHata(h?.message ?? "Şahit listesi alınamadı.");
      });
  }, [sicil]);

  const getir = useCallback(async () => {
    try {
      const d = await devamsizKisiAl(sicil);
      setVeri(d);
      setHata("");
      /* Bildirimden gelindiyse girişi olmayan günler hazır seçili gelmesin:
         yönetici bilerek seçsin. */
      setSecili([]);
    } catch (h) {
      setHata(h?.message ?? "Personel alınamadı.");
    }
  }, [sicil]);

  useEffect(() => {
    getir();
  }, [getir]);

  const eksik = !aciklamaGecerli(aciklama)
    ? "Açıklama yazın (en az 5 karakter)"
    : !sahit1 || !sahit2
    ? "İki şahit seçin"
    : sahit1.sicil === sahit2.sicil
    ? "Şahitler farklı kişi olmalı"
    : "";

  const kaydet = async () => {
    if (secili.length === 0) return;
    if (eksik) return Alert.alert("Eksik bilgi", eksik);
    setGonderiliyor(true);
    try {
      const c = await devamsizlikGir(sicil, secili, aciklama.trim(), sahit1.sicil, sahit2.sicil);
      const id = c?.tutanakId;
      Alert.alert(
        "Devamsızlık işlendi",
        c?.mesaj ?? "",
        id && navigation
          ? [
              { text: "Tamam", style: "cancel" },
              { text: "Tutanağı aç", onPress: () => navigation.navigate("DevamsizlikTutanak", { id, t: Date.now() }) },
            ]
          : undefined
      );
      setAciklama("");
      setSahit1(null);
      setSahit2(null);
      await getir();
    } catch (h) {
      Alert.alert("İşlenemedi", h?.message ?? "");
    } finally {
      setGonderiliyor(false);
    }
  };

  const SahitKutu = ({ sira, sahit, kapali }) => (
    <TouchableOpacity activeOpacity={0.7} onPress={() => setSeciciAcik(sira)} style={[s.sahit, sahit && s.sahitDolu]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.sahitEtiket}>{sira}. ŞAHİT</Text>
        {sahit ? (
          <>
            <Text style={s.ad} numberOfLines={1}>{sahit.adSoyad}</Text>
            <Text style={s.alt} numberOfLines={1}>{sahit.pozisyon}</Text>
          </>
        ) : (
          <Text style={[s.alt, { fontSize: 14, marginTop: 4 }]}>Personel seçin</Text>
        )}
      </View>
      <Text style={{ color: renk.pasif, fontSize: 18 }}>›</Text>
    </TouchableOpacity>
  );

  const kaldir = (g) =>
    Alert.alert("Devamsızlık kaldırılsın mı?", `${gunAdi(g.tarih)} günü devamsız kaydı silinecek.`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Kaldır",
        style: "destructive",
        onPress: () =>
          devamsizlikKaldir(g.devamsizId)
            .then(getir)
            .catch((h) => Alert.alert("Kaldırılamadı", h?.message)),
      },
    ]);

  const p = veri?.personel;

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Devamsızlık Girişi" acik geri={geri} />
      <ScrollView contentContainerStyle={[s.govde, { paddingBottom: 200 }]} keyboardShouldPersistTaps="handled">
        {hata ? <Text style={s.hata}>{hata}</Text> : null}
        {!veri && !hata ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 30 }} /> : null}

        {p ? (
          <View style={s.kisiKart}>
            <Text style={s.ad}>{p.adSoyad}</Text>
            <Text style={s.alt}>{[p.sicil, p.pozisyon, p.sube].filter(Boolean).join(" · ")}</Text>
          </View>
        ) : null}

        {veri ? <Text style={s.bolum}>Son {veri.geriGun} gün · giriş olmayan günü seçin</Text> : null}

        {(veri?.gunler ?? []).map((g) => {
          const kod = isoGun(g.tarih);
          const d = DURUM[g.durum] ?? DURUM.okutmadi;
          const sec = secili.includes(kod);
          const etiket = g.durum === "izinli" && g.izinTuru ? g.izinTuru : d.ad;
          return (
            <TouchableOpacity
              key={kod}
              disabled={!g.girilebilir}
              activeOpacity={0.7}
              onPress={() => setSecili((o) => (sec ? o.filter((x) => x !== kod) : [...o, kod]))}
              style={[s.gun, sec && s.gunSecili, !g.girilebilir && { opacity: g.durum === "devamsiz" ? 1 : 0.75 }]}
            >
              {g.girilebilir ? (
                <View style={[s.kutu, sec && s.kutuOn]}>{sec ? <Text style={s.tik}>✓</Text> : null}</View>
              ) : (
                <View style={{ width: 24 }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.gunAd}>{gunAdi(g.tarih)}</Text>
                {g.giris ? (
                  <Text style={s.alt}>
                    Giriş {sa(g.giris)}
                    {g.cikis ? ` · çıkış ${sa(g.cikis)}` : ""}
                  </Text>
                ) : null}
                {g.durum === "devamsiz" && (g.giren || g.aciklama) ? (
                  <Text style={s.alt}>{[g.giren, g.aciklama].filter(Boolean).join(" · ")}</Text>
                ) : null}
                {g.durum === "devamsiz" && g.tutanakId && navigation ? (
                  <TouchableOpacity onPress={() => navigation.navigate("DevamsizlikTutanak", { id: g.tutanakId, t: Date.now() })} hitSlop={6}>
                    <Text style={{ color: "#1a5fb4", fontWeight: "700", fontSize: 12.5, marginTop: 2 }}>Tutanağı aç ›</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={[s.etiket, { color: d.renk, backgroundColor: d.zemin }]}>{etiket}</Text>
              {g.durum === "devamsiz" && g.devamsizId ? (
                <TouchableOpacity onPress={() => kaldir(g)} hitSlop={8} style={{ marginLeft: 6 }}>
                  <Text style={{ color: renk.kirmizi, fontWeight: "700", fontSize: 13 }}>Kaldır</Text>
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          );
        })}

        {veri ? (
          <>
            <Text style={s.bolum}>{"Açıklama · zorunlu".toLocaleUpperCase("tr")}</Text>
            <TextInput
              value={aciklama}
              onChangeText={setAciklama}
              placeholder="Ör. haber vermeden gelmedi, telefona cevap vermedi"
              placeholderTextColor="#9aa093"
              multiline
              maxLength={500}
              style={[s.aciklama, aciklama.length > 0 && !aciklamaGecerli(aciklama) && { borderColor: renk.kirmizi }]}
            />

            <Text style={s.bolum}>{"Şahitler · iki personel zorunlu".toLocaleUpperCase("tr")}</Text>
            <View style={s.bilgiKutu}>
              <Text style={s.bilgiYazi}>
                Devamsız personelle aynı şubeden iki şahit seçin. Tutanak şube/İK adresine mail olarak gidecek; yazdırıp şahitlerle
                imzalayın ve ana sayfadaki karttan yükleyin. Şahitler ayrıca uygulamadan onaylayacak.
              </Text>
            </View>
            {sahitHata ? <Text style={s.hata}>{sahitHata}</Text> : null}
            <SahitKutu sira={1} sahit={sahit1} />
            <SahitKutu sira={2} sahit={sahit2} />
          </>
        ) : null}
      </ScrollView>

      <SahitSecici
        acik={seciciAcik > 0}
        kapat={() => setSeciciAcik(0)}
        liste={sahitler}
        yukleniyor={sahitler === null}
        hata={sahitHata}
        baslik={`${seciciAcik}. şahit`}
        kapali={seciciAcik === 1 ? sahit2?.sicil : sahit1?.sicil}
        sec={(p) => {
          if (seciciAcik === 1) setSahit1(p);
          else setSahit2(p);
          setSeciciAcik(0);
        }}
      />

      {veri ? (
        <View style={[s.altCubuk, { bottom: altBosluk(klavye) }]}>
          <TouchableOpacity
            style={[s.dugme, (secili.length === 0 || !!eksik || gonderiliyor) && { opacity: 0.45 }]}
            disabled={secili.length === 0 || gonderiliyor}
            onPress={kaydet}
          >
            {gonderiliyor ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.dugmeYazi}>{secili.length ? eksik || `${secili.length} günü devamsız işle` : "Gün seçin"}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 14, gap: 10 },
  bilgiKutu: { backgroundColor: "#fff6e5", borderRadius: 12, padding: 12 },
  bilgiYazi: { fontSize: 13, color: "#8a5a00", lineHeight: 18 },
  hata: { color: renk.kirmizi, padding: 10 },
  bos: { alignItems: "center", padding: 30, gap: 6 },
  bosBaslik: { fontSize: 15, fontWeight: "700", color: renk.metin },
  kart: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  ad: { fontSize: 15.5, fontWeight: "700", color: renk.metin },
  alt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },
  cipler: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  cip: { fontSize: 11.5, fontWeight: "700", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: "hidden" },
  sayac: { alignItems: "center", minWidth: 56 },
  sayacSayi: { fontSize: 22, fontWeight: "800", color: "#d97706" },
  sayacAlt: { fontSize: 11, color: renk.pasif },
  kisiKart: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: renk.cizgi },
  bolum: { fontSize: 12, fontWeight: "700", color: renk.pasif, textTransform: "uppercase", marginTop: 4, letterSpacing: 0.4 },
  gun: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: renk.cizgi, padding: 12 },
  gunSecili: { borderColor: renk.kirmizi, backgroundColor: "#fff7f6" },
  kutu: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: "#c9cec3", alignItems: "center", justifyContent: "center" },
  kutuOn: { backgroundColor: renk.kirmizi, borderColor: renk.kirmizi },
  tik: { color: "#fff", fontWeight: "800", fontSize: 14 },
  gunAd: { fontSize: 15, fontWeight: "600", color: renk.metin },
  etiket: { fontSize: 12, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden" },
  aciklama: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: renk.cizgi, padding: 12, minHeight: 70, fontSize: 15, textAlignVertical: "top", color: renk.metin },
  sahit: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: renk.cizgi, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  sahitDolu: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  sahitEtiket: { fontSize: 11, fontWeight: "800", color: renk.pasif, letterSpacing: 0.5 },
  seciciBas: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: renk.cizgi, backgroundColor: "#fff" },
  seciciKapat: { color: renk.kirmizi, fontWeight: "700", fontSize: 15, width: 54 },
  seciciBaslik: { fontSize: 16, fontWeight: "800", color: renk.metin },
  altCubuk: { position: "absolute", left: 14, right: 14 },
  dugme: { backgroundColor: renk.kirmizi, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  dugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 15.5 },
});

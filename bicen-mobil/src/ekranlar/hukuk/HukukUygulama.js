/**
 * Hukuk masası — mobil (24.10.2026)
 * ---------------------------------------------------------------------------
 * Dış hukuk danışmanı (kimlik + telefon + SMS ile girer) uygulamayı yalnız
 * bu ekranla kullanır. Biçen hukuk ekibindeki personel de ana sayfadaki
 * "Hukuk masası" kartıyla buraya geçer, "Diğer"den personel görünümüne döner.
 *
 * Sekmeler: Masa · Dosyalar · Ajanda · Yazışma · Diğer. Alt menü sabit ve
 * içerikle kaymaz; klavye açıkken gizlenir ki düğme ve yazıların üstüne
 * binmesin. Yazı yazma ekranında Gönder düğmesi üst çubukta durur.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import Simge from "../../bilesenler/Simge";
import Takvim from "../../bilesenler/Takvim";
import YardimDugmesi from "../../bilesenler/YardimDugmesi";
import { oturumKapat } from "../../api";
import { gorunumYaz, hukukMu } from "../../gorunum";
import { bildirimHazirla, bildirimDinle } from "../../bildirim";
import { dosyaSec } from "../../dosyaSecici";
import { useKlavye, klavyePayi } from "../../klavye";
import {
  basHarf, boyut, gunAy, hukukAjanda, hukukArsiv, hukukBelgeAdresi, hukukBelgeYukle, hukukBen, hukukDosya, hukukDosyalar,
  hukukKisiler, hukukMasa, hukukOlayEkle, hukukOlayGuncelle, hukukYazi, hukukYaziGonder, hukukYazilar, kalan, kisaZaman, saat, tarih,
} from "../../hukukApi";

/* ------------------------------------------------------------------ renk */

export const H = {
  m: "#14213d", m2: "#1f3157", m3: "#2c4372", mA: "#e9edf5",
  k: "#f7f4ee", kart: "#fffdf9", cizgi: "#e7e1d5", cizgi2: "#efe9de",
  a: "#b08d57", a2: "#8f6f3e", aA: "#f4ecdd", altinAcik: "#e6c88f",
  t: "#1b2233", s: "#6f7484", s2: "#9a9eab",
  kir: "#b4442a", kirA: "#fbece7", yes: "#3f7d4e", yesA: "#e8f2ea", mav: "#2f5d9e", mavA: "#e8eef8",
  tur: "#a8641c", turA: "#fbf0e2", mor: "#6a4c9c", morA: "#efe9f7", gri: "#efede8",
};
const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" });

const OLAY_RENK = {
  durusma: [H.mavA, H.mav], kesin_sure: [H.kirA, H.kir], arabuluculuk: [H.morA, H.mor], sure: [H.turA, H.tur],
  surec: [H.gri, H.s], yazi: [H.aA, H.a2],
};
const TUR_RENK = { ise_iade: H.kir, alacak: H.a, is_kazasi: H.tur, arabuluculuk: H.mav, ihtarname: H.mor, tespit: H.s, diger: H.s };
const AV_RENK = [H.m, H.a, H.mav, H.mor, H.yes, H.tur, H.m3];
const avRenk = (a = "") => AV_RENK[[...a].reduce((t, c) => t + c.charCodeAt(0), 0) % AV_RENK.length];
const HAK = { tam: "Tam yetki", standart: "Standart", okuma: "Yalnız okuma" };

/* ------------------------------------------------------------ parçalar */

function Av({ ad, boyut: b = 40, koyu }) {
  return (
    <View style={[st.av, { width: b, height: b, borderRadius: b / 2, backgroundColor: koyu ? H.a : avRenk(ad) }]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: b * 0.34 }}>{basHarf(ad)}</Text>
    </View>
  );
}
function Etiket({ metin, tur, renkler }) {
  const [z, r] = renkler ?? OLAY_RENK[tur] ?? [H.gri, H.s];
  return <Text style={[st.etiket, { backgroundColor: z, color: r }]}>{metin}</Text>;
}
function Risk({ d }) {
  const r = d >= 3 ? H.kir : d === 2 ? H.tur : H.yes;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {[1, 2, 3].map((i) => <View key={i} style={{ width: 5, height: 12, borderRadius: 2, backgroundColor: i <= Math.max(1, d) ? r : "#e4ded2" }} />)}
      <Text style={{ fontSize: 10.5, color: H.s, fontWeight: "600", marginLeft: 3 }}>{["Düşük", "Düşük", "Orta", "Yüksek"][d]}</Text>
    </View>
  );
}
function Sayac({ t }) {
  const k = kalan(t);
  return <Text style={{ fontWeight: "800", fontSize: 12, color: k.acil ? H.kir : k.yakin ? H.tur : H.s }}>{k.metin}</Text>;
}
function Bos({ baslik, metin }) {
  return (
    <View style={st.bos}>
      <Text style={st.bosB}>{baslik}</Text>
      {metin ? <Text style={st.bosM}>{metin}</Text> : null}
    </View>
  );
}
function Bar({ baslik, geri, sag }) {
  return (
    <View style={st.bar}>
      {geri ? (
        <TouchableOpacity onPress={geri} hitSlop={12} style={{ width: 28 }}>
          <Text style={{ fontSize: 26, color: H.m, marginTop: -4 }}>‹</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={st.barB} numberOfLines={1}>{baslik}</Text>
      {sag}
    </View>
  );
}
function Segment({ secenekler, deger, sec }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
      {secenekler.map(([k, a]) => (
        <TouchableOpacity key={k} onPress={() => sec(k)} style={[st.seg, deger === k && st.segOn]}>
          <Text style={[st.segT, deger === k && { color: "#fff" }]}>{a}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
function Baslik2({ metin, tikla, eylem }) {
  return (
    <View style={st.bas2}>
      <Text style={st.bas2B}>{metin}</Text>
      {tikla ? <Text onPress={tikla} style={st.bas2A}>{eylem ?? "Tümü"}</Text> : null}
    </View>
  );
}
const uzantiRenk = (u) =>
  u === "PDF" ? [H.kirA, H.kir] : u === "UDF" ? [H.morA, H.mor] : ["JPG", "JPEG", "PNG", "HEIC", "WEBP"].includes(u) ? [H.mA, H.m3]
    : ["DOC", "DOCX"].includes(u) ? [H.mavA, H.mav] : [H.aA, H.a2];
const belgeAc = (b) => Linking.openURL(hukukBelgeAdresi(b.id)).catch(() => Alert.alert("Açılamadı", "Belge açılamadı."));

function OlaySatiri({ x, tikla }) {
  const g = gunAy(x.tarih);
  const [z, r] = OLAY_RENK[x.tur] ?? [H.gri, H.s];
  return (
    <Pressable onPress={tikla} style={st.olay}>
      <View style={[st.gun, { backgroundColor: z }]}>
        <Text style={[st.gunB, { color: r }]}>{g.gun}</Text>
        <Text style={[st.gunA, { color: r }]}>{g.ay}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.olayB} numberOfLines={2}>{x.baslik}</Text>
        <Text style={st.kucuk} numberOfLines={1}>
          {[x.tur === "durusma" || x.tur === "arabuluculuk" ? saat(x.tarih) : null, x.davaciAd, x.mahkeme].filter(Boolean).join(" · ")}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 5, alignItems: "center" }}>
          <Etiket metin={x.turAdi} tur={x.tur} />
          {x.tamam ? <Etiket metin="Tamamlandı" renkler={[H.yesA, H.yes]} /> : <Sayac t={x.tarih} />}
        </View>
      </View>
    </Pressable>
  );
}

function YaziSatiri({ y, tikla }) {
  const kim = y.benGonderdim ? `Kime: ${y.kime.join(", ") || "—"}` : y.gonderenAd;
  return (
    <Pressable onPress={tikla} style={st.yaziOzet}>
      <Av ad={y.benGonderdim ? (y.kime[0] ?? "?") : y.gonderenAd} boyut={38} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={[st.yaziKim, y.okunmadi && { color: H.m }]} numberOfLines={1}>
            {y.okunmadi ? "● " : ""}{kim}
          </Text>
          <Text style={st.zaman}>{kisaZaman(y.tarih)}</Text>
        </View>
        <Text style={[st.yaziKonu, y.okunmadi && { fontWeight: "800", color: H.m }]} numberOfLines={2}>{y.konu}</Text>
        <Text style={st.kucuk} numberOfLines={1}>{y.ozet}</Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <Etiket metin={y.kayitNo} renkler={[H.gri, H.s]} />
          {y.dosyaNo ? <Etiket metin={y.dosyaNo} renkler={[H.aA, H.a2]} /> : null}
          {y.cevapSuresi && !y.yanitlandi ? <Etiket metin={`Cevap: ${kalan(y.cevapSuresi).metin}`} renkler={[H.kirA, H.kir]} /> : null}
          {y.yanitlandi ? <Etiket metin="Yanıtlandı" renkler={[H.yesA, H.yes]} /> : null}
          {y.ek > 0 ? <Etiket metin={`📎 ${y.ek}`} renkler={[H.gri, H.s]} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function DosyaKarti({ x, tikla }) {
  const d = x.dosya;
  const c = TUR_RENK[d.tur] ?? H.a;
  return (
    <Pressable onPress={tikla} style={st.dosya}>
      <View style={[st.dosyaCizgi, { backgroundColor: c }]} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.dosyaTur, { color: c }]}>{d.turAdi} · {d.dosyaNo}</Text>
          <Text style={st.dosyaAd} numberOfLines={1}>{d.davaciAd}</Text>
          <Text style={st.kucuk} numberOfLines={1}>{[d.gorev, d.sube].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        <Risk d={d.risk} />
      </View>
      <Text style={st.kucuk} numberOfLines={1}>{[d.mahkeme, d.esasNo].filter(Boolean).join(" · ") || "Mahkeme bilgisi yok"}</Text>
      <View style={st.dosyaAlt}>
        {d.durum === "kapandi" ? <Etiket metin="Kapandı" renkler={[H.gri, H.s]} />
          : d.sonraki ? (
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flex: 1 }}>
              <Etiket metin={d.sonraki.turAdi} tur={d.sonraki.tur} />
              <Text style={st.kucuk}>{tarih(d.sonraki.tarih, true)}</Text>
            </View>
          ) : <Text style={st.kucuk}>Bekleyen süre yok</Text>}
        {d.sonraki && d.durum !== "kapandi" ? <Sayac t={d.sonraki.tarih} /> : null}
      </View>
    </Pressable>
  );
}

/* ================================================================ Masa */

function Masa({ ben, ac, yaziAc, git }) {
  const [o, setO] = useState(null);
  const [ajanda, setAjanda] = useState([]);
  const [yazilar, setYazilar] = useState([]);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    const [m, a, y] = await Promise.allSettled([hukukMasa(), hukukAjanda(14), hukukYazilar("gelen")]);
    if (m.status === "fulfilled") setO(m.value);
    if (a.status === "fulfilled") setAjanda((a.value?.olaylar ?? []).filter((x) => !x.tamam).slice(0, 5));
    if (y.status === "fulfilled") setYazilar((y.value?.yazilar ?? []).slice(0, 4));
  }, []);
  useEffect(() => { yukle(); }, [yukle]);

  const s = new Date().getHours();
  const selam = s < 12 ? "Günaydın" : s < 18 ? "İyi günler" : "İyi akşamlar";
  const kesin = o?.kesinBugun ?? 0;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={async () => { setYenileniyor(true); await yukle(); setYenileniyor(false); }} tintColor="#fff" />}>
      <View style={st.kahraman}>
        <View style={st.halka} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Av ad={ben.ad} boyut={44} koyu />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#aab3c8", fontSize: 12 }}>{selam}</Text>
            <Text style={{ color: "#fff", fontFamily: SERIF, fontSize: 20, fontWeight: "600" }} numberOfLines={1}>{ben.ad}</Text>
            {ben.kurum ? <Text style={{ color: "#aab3c8", fontSize: 12 }} numberOfLines={1}>{ben.kurum}</Text> : null}
          </View>
          <YardimDugmesi kod="Hukuk" ad="Hukuk masası" kutu />
        </View>
        <Text style={st.gunluk}>
          {o == null ? " " : o.bugun > 0
            ? <>Bugün <Text style={{ color: H.altinAcik }}>{o.bugun} iş</Text> var{kesin ? `, ${kesin} kesin süre doluyor.` : "."}</>
            : "Bugün bekleyen duruşma ya da süre yok."}
        </Text>
        <View style={st.k3}>
          <Pressable style={st.k3k} onPress={() => git("dosyalar")}><Text style={st.k3b}>{o?.acik ?? "–"}</Text><Text style={st.k3s}>Açık dosya</Text></Pressable>
          <Pressable style={st.k3k} onPress={() => git("ajanda")}><Text style={st.k3b}>{o?.hafta ?? "–"}</Text><Text style={st.k3s}>Bu hafta</Text></Pressable>
          <Pressable style={st.k3k} onPress={() => git("yazilar")}><Text style={st.k3b}>{o?.okunmamis ?? "–"}</Text><Text style={st.k3s}>Okunmamış yazı</Text></Pressable>
        </View>
      </View>

      <View style={st.ic}>
        {kesin > 0 ? (
          <View style={st.uyari}>
            <Text style={{ fontFamily: SERIF, fontSize: 20, color: H.kir }}>!</Text>
            <Text style={{ flex: 1, color: "#7d2f1d", fontSize: 12.5 }}>Bugün dolan {kesin} kesin süre var. Ajandadan kontrol ediniz.</Text>
          </View>
        ) : null}

        <Baslik2 metin="Yaklaşan" tikla={() => git("ajanda")} eylem="Ajanda" />
        {ajanda.length === 0 ? <Text style={[st.kucuk, { marginLeft: 2 }]}>Önümüzdeki iki haftada kayıt yok.</Text>
          : ajanda.map((x) => <OlaySatiri key={x.kaynak + x.id} x={x} tikla={() => (x.kaynak === "yazi" ? yaziAc(x.id) : x.dosyaId && ac(x.dosyaId))} />)}

        <Baslik2 metin="Gelen yazılar" tikla={() => git("yazilar")} />
        <View style={st.kart}>
          {yazilar.length === 0 ? <Text style={st.kucuk}>Gelen yazı yok.</Text>
            : yazilar.map((y) => <YaziSatiri key={y.id} y={y} tikla={() => yaziAc(y.id)} />)}
        </View>
      </View>
    </ScrollView>
  );
}

/* ============================================================ Dosyalar */

function Dosyalar({ ben, ac }) {
  const [durum, setDurum] = useState("acik");
  const [q, setQ] = useState("");
  const [l, setL] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => hukukDosyalar(durum, q.trim()).then((d) => setL(d?.dosyalar ?? [])).catch(() => setL([])), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [durum, q]);
  return (
    <View style={{ flex: 1 }}>
      <Bar baslik="Dosyalar" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.ic} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={st.ara}>
          <Text style={{ color: H.s2 }}>⌕</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="Taraf, esas no, mahkeme" placeholderTextColor={H.s2} style={st.araG} returnKeyType="search" />
        </View>
        <Segment secenekler={[["acik", "Açık"], ["kapandi", "Kapanan"], ["hepsi", "Tümü"]]} deger={durum} sec={setDurum} />
        {l === null ? <ActivityIndicator color={H.m} style={{ marginTop: 30 }} />
          : l.length === 0 ? <Bos baslik="Dosya yok" metin={ben.danisman ? "Size erişim verilen dosya bulunmuyor." : "Bu filtrede dosya yok."} />
          : l.map((x) => <DosyaKarti key={x.dosya.id} x={x} tikla={() => ac(x.dosya.id)} />)}
      </ScrollView>
    </View>
  );
}

/* ============================================================== Ajanda */

function Ajanda({ ac, yaziAc }) {
  const [gun, setGun] = useState("45");
  const [l, setL] = useState(null);
  useEffect(() => { setL(null); hukukAjanda(Number(gun)).then((d) => setL(d?.olaylar ?? [])).catch(() => setL([])); }, [gun]);
  const gruplar = useMemo(() => {
    const m = new Map();
    (l ?? []).forEach((x) => { const k = new Date(x.tarih).toDateString(); m.set(k, [...(m.get(k) ?? []), x]); });
    return [...m.entries()];
  }, [l]);
  return (
    <View style={{ flex: 1 }}>
      <Bar baslik="Ajanda" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.ic}>
        <Segment secenekler={[["14", "14 gün"], ["45", "45 gün"], ["90", "90 gün"]]} deger={gun} sec={setGun} />
        {l === null ? <ActivityIndicator color={H.m} style={{ marginTop: 30 }} />
          : gruplar.length === 0 ? <Bos baslik="Kayıt yok" metin="Bu aralıkta duruşma, süre ya da cevap süresi yok." />
          : gruplar.map(([k, isler]) => {
            const g = gunAy(isler[0].tarih);
            const bugun = k === new Date().toDateString();
            return (
              <View key={k} style={{ gap: 8 }}>
                <Text style={[st.ajGun, bugun && { color: H.a2 }]}>{bugun ? "Bugün · " : ""}{g.gun} {g.ay} {g.hafta}</Text>
                {isler.map((x) => <OlaySatiri key={x.kaynak + x.id} x={x} tikla={() => (x.kaynak === "yazi" ? yaziAc(x.id) : x.dosyaId && ac(x.dosyaId))} />)}
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}

/* ============================================================= Yazılar */

function Yazilar({ ben, yaziAc, yaz }) {
  const [klasor, setKlasor] = useState("gelen");
  const [l, setL] = useState(null);
  const [sayilar, setSayilar] = useState({});
  const [yenileniyor, setYenileniyor] = useState(false);
  const yukle = useCallback(() => hukukYazilar(klasor).then((d) => { setL(d?.yazilar ?? []); setSayilar(d?.sayilar ?? {}); }).catch(() => setL([])), [klasor]);
  useEffect(() => { setL(null); yukle(); }, [yukle]);
  return (
    <View style={{ flex: 1 }}>
      <Bar baslik="Resmi yazışma" sag={ben.yetki !== "okuma" ? (
        <TouchableOpacity onPress={() => yaz({})} style={st.barIk}><Simge ad="kalem" renkli={H.m} boyut={18} /></TouchableOpacity>
      ) : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.ic}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={async () => { setYenileniyor(true); await yukle(); setYenileniyor(false); }} />}>
        <Segment deger={klasor} sec={setKlasor} secenekler={[
          ["gelen", `Gelen${sayilar.gelen ? ` · ${sayilar.gelen}` : ""}`], ["bekleyen", `Yanıt bekleyen${sayilar.bekleyen ? ` · ${sayilar.bekleyen}` : ""}`],
          ["gonderilen", "Gönderilen"], ["arsiv", "Arşiv"],
        ]} />
        {l === null ? <ActivityIndicator color={H.m} style={{ marginTop: 30 }} />
          : l.length === 0 ? <Bos baslik="Yazı yok" metin="Bu klasörde yazı bulunmuyor." />
          : <View style={st.kart}>{l.map((y) => <YaziSatiri key={y.id} y={y} tikla={() => yaziAc(y.id)} />)}</View>}
      </ScrollView>
    </View>
  );
}

/* ========================================================= Yazı okuma */

function YaziOku({ id, ben, geri, yanitla, dosyaAc, ac }) {
  const [y, setY] = useState(null);
  const [hata, setHata] = useState("");
  useEffect(() => { setY(null); hukukYazi(id).then(setY).catch((e) => setHata(e.message)); }, [id]);
  if (hata) return <View style={{ flex: 1 }}><Bar baslik="Yazı" geri={geri} /><Bos baslik="Açılamadı" metin={hata} /></View>;
  if (!y) return <View style={{ flex: 1 }}><Bar baslik="Yazı" geri={geri} /><ActivityIndicator color={H.m} style={{ marginTop: 40 }} /></View>;
  const kime = y.alicilar.filter((a) => a.rol === "kime");
  const bilgi = y.alicilar.filter((a) => a.rol === "bilgi");
  const arsiv = async () => {
    try { await hukukArsiv(y.id); geri(); } catch (e) { Alert.alert("Hata", e.message); }
  };
  return (
    <View style={{ flex: 1 }}>
      <Bar baslik="Resmi yazı" geri={geri} sag={
        <TouchableOpacity onPress={arsiv} style={st.barIk}><Text style={{ fontSize: 11.5, fontWeight: "700", color: H.m }}>Arşiv</Text></TouchableOpacity>
      } />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={st.yaziBas}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={st.ref}>{y.kayitNo}</Text>
            <Text style={st.ref}>{tarih(y.tarih)} {saat(y.tarih)}</Text>
          </View>
          <Text style={st.yaziH}>{y.konu}</Text>
          <Alan e="Gönderen" d={`${y.gonderenAd}${y.gonderenKurum ? ` · ${y.gonderenKurum}` : ""}`} />
          <Alan e="Kime" d={kime.map((a) => a.ad).join(", ")} />
          {bilgi.length ? <Alan e="Bilgi" d={bilgi.map((a) => a.ad).join(", ")} /> : null}
          {y.dosya ? <Alan e="Dosya" d={`${y.dosya.dosyaNo} · ${y.dosya.davaciAd}`} tikla={() => dosyaAc(y.dosya.id)} /> : null}
          {y.cevapSuresi ? <Alan e="Cevap" d={`${tarih(y.cevapSuresi)} · ${y.yanitlandi ? "yanıtlandı" : kalan(y.cevapSuresi).metin}`} vurgu={!y.yanitlandi} /> : null}
        </View>

        <View style={st.mektup}>
          <View style={st.mektupUst} />
          <View style={st.antet}>
            <Text style={st.antetB}>BİÇEN</Text>
            <Text style={st.antetS}>{y.gonderenIc ? "İnsan Kaynakları\nHukuk Birimi" : (y.gonderenKurum ?? "Hukuk danışmanı")}</Text>
          </View>
          <Text style={st.mektupP}>{y.metin}</Text>
          <Text style={[st.mektupP, { marginTop: 10, fontWeight: "600" }]}>{y.gonderenAd}</Text>
        </View>

        {y.ekler.length ? (
          <View style={{ marginHorizontal: 14, gap: 8 }}>
            {y.ekler.map((b) => {
              const [z, r] = uzantiRenk(b.uzanti);
              return (
                <Pressable key={b.id} onPress={() => belgeAc(b)} style={st.ek}>
                  <View style={[st.ekI, { backgroundColor: z }]}><Text style={{ color: r, fontSize: 9.5, fontWeight: "800" }}>{b.uzanti || "—"}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontWeight: "700", fontSize: 12.5 }} numberOfLines={1}>{b.ad}</Text><Text style={st.kucuk}>{boyut(b.boyut)}</Text></View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: 14, marginTop: 12 }}>
          {y.alicilar.map((a) => (
            <Etiket key={a.anahtar + a.rol} metin={`${a.okundu ? "✓ " : ""}${a.ad}${a.okundu ? ` · ${tarih(a.okundu)} ${saat(a.okundu)}` : " · okunmadı"}`}
              renkler={a.okundu ? [H.yesA, H.yes] : [H.gri, H.s]} />
          ))}
        </View>

        {y.zincir.length > 1 ? (
          <View style={{ marginHorizontal: 14, marginTop: 16, gap: 8 }}>
            <Text style={st.bas2B}>Yazı zinciri</Text>
            {y.zincir.map((z) => (
              <Pressable key={z.id} onPress={() => !z.bu && ac(z.id)} style={[st.zincir, z.bu && { borderColor: H.a, backgroundColor: H.aA }]}>
                <Av ad={z.gonderenAd} boyut={28} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700" }} numberOfLines={1}>{z.konu}</Text>
                  <Text style={st.kucuk}>{z.gonderenAd} · {tarih(z.tarih)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {ben.yetki !== "okuma" ? (
          <View style={{ flexDirection: "row", gap: 8, marginHorizontal: 14, marginTop: 18 }}>
            <TouchableOpacity style={[st.dug, st.dugM, { flex: 1 }]} onPress={() => yanitla(y)}>
              <Text style={st.dugMT}>Yanıtla</Text>
            </TouchableOpacity>
            {y.dosya ? (
              <TouchableOpacity style={[st.dug, st.dugA, { flex: 1 }]} onPress={() => dosyaAc(y.dosya.id)}>
                <Text style={st.dugAT}>Dosyayı aç</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
function Alan({ e, d, tikla, vurgu }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Text style={{ width: 62, color: H.s, fontSize: 12.5 }}>{e}</Text>
      <Text onPress={tikla} style={{ flex: 1, fontSize: 12.5, color: tikla ? H.a2 : vurgu ? H.kir : H.t, fontWeight: tikla || vurgu ? "700" : "400" }}>{d || "—"}</Text>
    </View>
  );
}

/* ======================================================= Yazı yazma */

function YaziYaz({ ben, taslak, geri, gonderildi }) {
  const klavye = useKlavye();
  const y = taslak?.yanit;
  const [kisiler, setKisiler] = useState([]);
  const [kime, setKime] = useState(() => {
    if (!y) return ben.danisman ? ["ekip"] : [];
    if (y.benGonderdim) return y.alicilar.filter((a) => a.rol === "kime").map((a) => a.anahtar);
    return [y.gonderenIc ? (ben.danisman ? "ekip" : y.gonderen) : y.gonderen];
  });
  const [konu, setKonu] = useState(y ? (y.konu.startsWith("Ynt:") ? y.konu : `Ynt: ${y.konu}`) : "");
  const [metin, setMetin] = useState("");
  const [sure, setSure] = useState(null);
  const [takvim, setTakvim] = useState(false);
  const [ek, setEk] = useState(null);
  const [gidiyor, setGidiyor] = useState(false);
  const dosyaId = y?.dosya?.id ?? taslak?.dosyaId ?? null;

  useEffect(() => { hukukKisiler(dosyaId).then((d) => setKisiler(d?.kisiler ?? [])).catch(() => {}); }, [dosyaId]);

  const gonder = async () => {
    if (!kime.length) return Alert.alert("Eksik", "Muhatap seçiniz.");
    if (!konu.trim()) return Alert.alert("Eksik", "Konuyu yazınız.");
    if (metin.trim().length < 3) return Alert.alert("Eksik", "Yazının metnini yazınız.");
    setGidiyor(true);
    try {
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const r = await hukukYaziGonder({
        konu: konu.trim(), metin: metin.trim(), kime: kime.join(","), dosyaId, yanitId: y?.id, cevapSuresi: sure ? f(sure) : null,
      }, ek);
      Alert.alert("Gönderildi", `Kayıt no: ${r?.kayitNo ?? ""}`);
      gonderildi(r?.id);
    } catch (e) {
      Alert.alert("Gönderilemedi", e.message);
    } finally {
      setGidiyor(false);
    }
  };
  const ekSec = async () => {
    try {
      const r = await dosyaSec({ copyToCacheDirectory: true, multiple: false });
      const a = r?.assets?.[0];
      if (!a || r.canceled) return;
      setEk({ uri: a.uri, ad: a.name, tip: a.mimeType ?? "application/octet-stream", boyut: a.size });
    } catch (e) { Alert.alert("Dosya", e.message); }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Gönder üst çubukta: klavye açıkken de görünür ve yazının üstüne binmez */}
      <Bar baslik={y ? "Yanıt yazısı" : "Yeni resmi yazı"} geri={geri} sag={
        <TouchableOpacity onPress={gonder} disabled={gidiyor} style={[st.dug, st.dugM, { paddingVertical: 8, paddingHorizontal: 14 }]}>
          {gidiyor ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.dugMT}>Gönder</Text>}
        </TouchableOpacity>
      } />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 + klavyePayi(klavye) * 0 }}>
          <View>
            <Text style={st.etk}>Kime</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {kisiler.map((k) => {
                const on = kime.includes(k.anahtar);
                return (
                  <TouchableOpacity key={k.anahtar} disabled={!k.erisim}
                    onPress={() => setKime(on ? kime.filter((x) => x !== k.anahtar) : [...kime, k.anahtar])}
                    style={[st.kisiCip, on && { backgroundColor: H.m, borderColor: H.m }, !k.erisim && { opacity: 0.4 }]}>
                    <Text style={{ fontSize: 12.5, fontWeight: "600", color: on ? "#fff" : H.t }}>{on ? "✓ " : ""}{k.ad}</Text>
                  </TouchableOpacity>
                );
              })}
              {kisiler.length === 0 ? <Text style={st.kucuk}>Yükleniyor…</Text> : null}
            </View>
          </View>
          {dosyaId ? <Text style={st.kucuk}>İlgili dosya: {y?.dosya ? `${y.dosya.dosyaNo} · ${y.dosya.davaciAd}` : taslak?.dosyaAd ?? `#${dosyaId}`}</Text> : null}
          <View>
            <Text style={st.etk}>Konu</Text>
            <TextInput value={konu} onChangeText={setKonu} maxLength={200} style={st.girdi} placeholder="Ör. Tanık listesi hk." placeholderTextColor={H.s2} />
          </View>
          <View>
            <Text style={st.etk}>Metin</Text>
            <TextInput value={metin} onChangeText={setMetin} multiline maxLength={20000} textAlignVertical="top"
              style={[st.girdi, { minHeight: 200, fontFamily: SERIF, fontSize: 15, lineHeight: 23 }]} placeholder={"Sayın …,\n\n"} placeholderTextColor={H.s2} scrollEnabled={false} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={[st.dug, st.dugA, { flex: 1 }]} onPress={() => setTakvim(true)}>
              <Text style={st.dugAT}>{sure ? `Cevap: ${tarih(sure)}` : "Cevap süresi"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.dug, st.dugA, { flex: 1 }]} onPress={ek ? () => setEk(null) : ekSec}>
              <Text style={st.dugAT} numberOfLines={1}>{ek ? `📎 ${ek.ad} ✕` : "📎 Ek ekle"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={st.kucuk}>Kayıt numarası gönderimde verilir. Büyük ve çok sayıda eki panelden gönderebilirsiniz.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={takvim} transparent animationType="fade" onRequestClose={() => setTakvim(false)}>
        <Pressable style={st.perde} onPress={() => setTakvim(false)}>
          <Pressable style={st.pencere}>
            <Text style={[st.bas2B, { marginBottom: 8 }]}>Cevap süresi</Text>
            <Takvim deger={sure ?? undefined} enAz={new Date()} onSec={(d) => { setSure(d); setTakvim(false); }} />
            {sure ? <TouchableOpacity onPress={() => { setSure(null); setTakvim(false); }}><Text style={[st.bas2A, { textAlign: "center", marginTop: 10 }]}>Süreyi kaldır</Text></TouchableOpacity> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ============================================================== Dosya */

function OlayFormu({ dosyaId, olaylar, kapat, kaydedildi, turler }) {
  const klavye = useKlavye();
  const [tur, setTur] = useState("surec");
  const [gun, setGun] = useState(new Date());
  const [saatM, setSaatM] = useState("10:00");
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [takvim, setTakvim] = useState(false);
  const [gidiyor, setGidiyor] = useState(false);
  const saatli = tur === "durusma" || tur === "arabuluculuk";
  const kaydet = async () => {
    const [hh, mm] = saatM.split(":").map((x) => Number(x));
    if (saatli && (!(hh >= 0 && hh < 24) || !(mm >= 0 && mm < 60))) return Alert.alert("Saat", "Saati SS:DD biçiminde yazınız.");
    const d = gun;
    const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${saatli ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : "00:00"}:00`;
    setGidiyor(true);
    try {
      await hukukOlayEkle(dosyaId, { tur, tarih: t, baslik, aciklama, tamam: tur === "surec" });
      kaydedildi();
    } catch (e) { Alert.alert("Kaydedilemedi", e.message); } finally { setGidiyor(false); }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={kapat}>
      <SafeAreaView style={{ flex: 1, backgroundColor: H.k }} edges={["top", "bottom"]}>
        <Bar baslik="Süre / süreç kaydı" geri={kapat} sag={
          <TouchableOpacity onPress={kaydet} disabled={gidiyor} style={[st.dug, st.dugM, { paddingVertical: 8, paddingHorizontal: 14 }]}>
            {gidiyor ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.dugMT}>Kaydet</Text>}
          </TouchableOpacity>
        } />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 30 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {turler.map((t) => (
                <TouchableOpacity key={t.kod} onPress={() => setTur(t.kod)} style={[st.kisiCip, tur === t.kod && { backgroundColor: H.m, borderColor: H.m }]}>
                  <Text style={{ fontSize: 12.5, fontWeight: "600", color: tur === t.kod ? "#fff" : H.t }}>{t.ad}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[st.dug, st.dugA, { flex: 1 }]} onPress={() => setTakvim(true)}><Text style={st.dugAT}>{tarih(gun)}</Text></TouchableOpacity>
              {saatli ? <TextInput value={saatM} onChangeText={setSaatM} style={[st.girdi, { width: 90, textAlign: "center" }]} keyboardType="numbers-and-punctuation" maxLength={5} /> : null}
            </View>
            <View><Text style={st.etk}>Başlık</Text>
              <TextInput value={baslik} onChangeText={setBaslik} style={st.girdi} maxLength={200} placeholder={tur === "surec" ? "Ör. Cevap dilekçesi verildi" : "Boşsa tür adı yazılır"} placeholderTextColor={H.s2} /></View>
            <View><Text style={st.etk}>Açıklama</Text>
              <TextInput value={aciklama} onChangeText={setAciklama} style={[st.girdi, { minHeight: 110 }]} multiline textAlignVertical="top" maxLength={1000} placeholderTextColor={H.s2} /></View>
            <View style={{ height: klavyePayi(klavye) ? 0 : 0 }} />
          </ScrollView>
        </KeyboardAvoidingView>
        <Modal visible={takvim} transparent animationType="fade" onRequestClose={() => setTakvim(false)}>
          <Pressable style={st.perde} onPress={() => setTakvim(false)}>
            <Pressable style={st.pencere}><Takvim deger={gun} onSec={(d) => { setGun(d); setTakvim(false); }} /></Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

function DosyaSayfasi({ id, ben, geri, yaziAc, yaz }) {
  const [v, setV] = useState(null);
  const [hata, setHata] = useState("");
  const [sekme, setSekme] = useState("ozet");
  const [form, setForm] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const yukle = useCallback(() => hukukDosya(id).then(setV).catch((e) => setHata(e.message)), [id]);
  useEffect(() => { yukle(); }, [yukle]);

  if (hata) return <View style={{ flex: 1 }}><Bar baslik="Dosya" geri={geri} /><Bos baslik="Açılamadı" metin={hata} /></View>;
  if (!v) return <View style={{ flex: 1 }}><Bar baslik="Dosya" geri={geri} /><ActivityIndicator color={H.m} style={{ marginTop: 40 }} /></View>;
  const d = v.dosya;
  const yazabilir = v.hak === "tam" || v.hak === "standart";
  const bekleyen = v.olaylar.filter((o) => !o.tamam && o.tur !== "surec");
  const sonraki = bekleyen.find((o) => new Date(o.tarih) >= new Date(new Date().toDateString()));

  const belgeEkle = async () => {
    try {
      const r = await dosyaSec({ copyToCacheDirectory: true, multiple: false });
      const a = r?.assets?.[0];
      if (!a || r.canceled) return;
      setYukleniyor(true);
      await hukukBelgeYukle(id, { uri: a.uri, ad: a.name, tip: a.mimeType ?? "application/octet-stream" });
      await yukle();
    } catch (e) { Alert.alert("Yüklenemedi", e.message); } finally { setYukleniyor(false); }
  };
  const tamamla = async (o) => {
    try { await hukukOlayGuncelle(o.id, { tur: o.tur, tarih: o.tarih, baslik: o.baslik, aciklama: o.aciklama, tamam: !o.tamam }); yukle(); }
    catch (e) { Alert.alert("Hata", e.message); }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={st.dbas}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
          <TouchableOpacity onPress={geri} hitSlop={12}><Text style={{ fontSize: 26, color: "#fff", marginTop: -4 }}>‹</Text></TouchableOpacity>
          <Text style={{ color: "#cdd3e1", fontSize: 13, fontWeight: "600", flex: 1 }}>{d.dosyaNo}</Text>
          {yazabilir ? <TouchableOpacity onPress={() => yaz({ dosyaId: id, dosyaAd: `${d.dosyaNo} · ${d.davaciAd}` })} style={st.barIkK}><Simge ad="kalem" renkli="#fff" boyut={17} /></TouchableOpacity> : null}
        </View>
        <Text style={st.dbasTur}>{d.turAdi}{d.durum === "kapandi" ? " · KAPANDI" : ""}</Text>
        <Text style={st.dbasH} numberOfLines={2}>{d.davaciAd}</Text>
        <Text style={{ color: "#b9c1d4", fontSize: 12.5 }} numberOfLines={1}>{[d.mahkeme, d.esasNo].filter(Boolean).join(" · ") || "—"}</Text>
        <View style={st.s3}>
          <View style={st.s3k}><Text style={st.s3s}>Sıradaki</Text><Text style={st.s3b} numberOfLines={1}>{sonraki ? `${sonraki.turAdi}` : "—"}</Text></View>
          <View style={st.s3k}><Text style={st.s3s}>Tarih</Text><Text style={st.s3b} numberOfLines={1}>{sonraki ? `${tarih(sonraki.tarih)}` : "—"}</Text></View>
          <View style={st.s3k}><Text style={st.s3s}>Aşama</Text><Text style={st.s3b} numberOfLines={1}>{d.asama || "—"}</Text></View>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.dsek} contentContainerStyle={{ paddingHorizontal: 10 }}>
        {[["ozet", "Özet"], ["surec", `Süreç · ${v.olaylar.length}`], ["belge", `Belgeler · ${v.belgeler.length}`], ["yazi", `Yazışma · ${v.yazilar.length}`]].map(([k, a]) => (
          <TouchableOpacity key={k} onPress={() => setSekme(k)} style={[st.dsekB, sekme === k && st.dsekOn]}>
            <Text style={[st.dsekT, sekme === k && { color: H.m }]}>{a}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.ic}>
        {sekme === "ozet" ? (
          <>
            {sonraki && kalan(sonraki.tarih).acil ? (
              <View style={st.uyari}>
                <Text style={{ fontFamily: SERIF, fontSize: 20, color: H.kir }}>!</Text>
                <Text style={{ flex: 1, color: "#7d2f1d", fontSize: 12.5 }}>{sonraki.turAdi}: {sonraki.baslik} · {kalan(sonraki.tarih).metin}</Text>
              </View>
            ) : null}
            <View style={[st.kart, { gap: 10 }]}>
              <Alan e="Görev" d={[d.gorev, d.sube].filter(Boolean).join(" · ")} />
              <Alan e="Vekil" d={d.karsiVekil} />
              <Alan e="Dava" d={tarih(d.davaTarihi)} />
              <Alan e="Tebliğ" d={tarih(d.tebligTarihi)} />
              <View style={{ flexDirection: "row", gap: 6 }}><Text style={{ width: 62, color: H.s, fontSize: 12.5 }}>Risk</Text><Risk d={d.risk} /></View>
              {d.talepTutar != null ? <Alan e="Talep" d={`${Number(d.talepTutar).toLocaleString("tr-TR")} ₺`} /> : null}
              <Alan e="Hakkınız" d={HAK[v.hak] ?? v.hak} />
            </View>
            <Baslik2 metin="Özet" />
            <View style={st.kart}><Text style={{ fontFamily: SERIF, fontSize: 14, lineHeight: 22, color: "#2a3142" }}>{d.ozet || "Özet yazılmamış."}</Text></View>
            {v.erisim?.length ? (
              <>
                <Baslik2 metin="Dosyadaki danışmanlar" />
                <View style={[st.kart, { gap: 10 }]}>
                  {v.erisim.map((e) => (
                    <View key={e.anahtar} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                      <Av ad={e.ad} boyut={32} />
                      <View style={{ flex: 1 }}><Text style={{ fontWeight: "700", fontSize: 13 }}>{e.ad}</Text><Text style={st.kucuk}>{e.kurum ?? ""} · {HAK[e.hak]}</Text></View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {sekme === "surec" ? (
          <>
            {yazabilir ? (
              <TouchableOpacity style={[st.dug, st.dugM]} onPress={() => setForm(true)}><Text style={st.dugMT}>+ Süre / süreç kaydı ekle</Text></TouchableOpacity>
            ) : null}
            <View style={st.kart}>
              {v.olaylar.length === 0 ? <Text style={st.kucuk}>Kayıt yok.</Text> : [...v.olaylar].sort((a, b) => new Date(b.tarih) - new Date(a.tarih)).map((o, i, l) => {
                const nokta = o.tur === "surec" ? [H.kart, "#d9d4c9"] : o.tamam ? [H.m, H.m] : o.tur === "kesin_sure" ? [H.kir, H.kir] : [H.a, H.a];
                return (
                  <View key={o.id} style={st.ce}>
                    <View style={{ alignItems: "center", width: 16 }}>
                      <View style={[st.ceN, { backgroundColor: nokta[0], borderColor: nokta[1] }]} />
                      {i < l.length - 1 ? <View style={st.ceC} /> : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 14 }}>
                      <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <Etiket metin={o.turAdi} tur={o.tur} />
                        {o.tur !== "surec" ? (o.tamam ? <Etiket metin="Tamamlandı" renkler={[H.yesA, H.yes]} /> : <Sayac t={o.tarih} />) : null}
                      </View>
                      <Text style={{ fontWeight: "700", fontSize: 13.5, marginTop: 4 }}>{o.baslik}</Text>
                      <Text style={st.kucuk}>{tarih(o.tarih, true)}{o.ekleyenAd ? ` · ${o.ekleyenAd}` : ""}</Text>
                      {o.aciklama ? <Text style={{ fontSize: 12.5, color: "#3a4152", marginTop: 4 }}>{o.aciklama}</Text> : null}
                      {yazabilir && o.tur !== "surec" ? (
                        <Text onPress={() => tamamla(o)} style={[st.bas2A, { marginTop: 6 }]}>{o.tamam ? "Tamamlanmadı olarak işaretle" : "Tamamlandı olarak işaretle"}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {sekme === "belge" ? (
          <>
            {yazabilir ? (
              <TouchableOpacity style={[st.dug, st.dugM]} onPress={belgeEkle} disabled={yukleniyor}>
                {yukleniyor ? <ActivityIndicator color="#fff" /> : <Text style={st.dugMT}>+ Belge yükle</Text>}
              </TouchableOpacity>
            ) : null}
            {v.belgeler.length === 0 ? <Bos baslik="Belge yok" /> : (
              <View style={st.belgeler}>
                {v.belgeler.map((b) => {
                  const [z, r] = uzantiRenk(b.uzanti);
                  return (
                    <Pressable key={b.id} onPress={() => belgeAc(b)} style={st.bel}>
                      <View style={[st.belOn, { backgroundColor: z }]}><Text style={{ color: r, fontSize: 11, fontWeight: "800" }}>{b.uzanti || "DOSYA"}</Text></View>
                      <Text style={st.belAd} numberOfLines={1}>{b.ad}</Text>
                      <Text style={[st.kucuk, { paddingHorizontal: 7, paddingBottom: 6, fontSize: 10.5 }]} numberOfLines={1}>{tarih(b.tarih)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {sekme === "yazi" ? (
          <>
            {yazabilir ? <TouchableOpacity style={[st.dug, st.dugM]} onPress={() => yaz({ dosyaId: id, dosyaAd: `${d.dosyaNo} · ${d.davaciAd}` })}><Text style={st.dugMT}>Bu dosya için yazı yaz</Text></TouchableOpacity> : null}
            {v.yazilar.length === 0 ? <Bos baslik="Yazı yok" /> : <View style={st.kart}>{v.yazilar.map((y) => <YaziSatiri key={y.id} y={y} tikla={() => yaziAc(y.id)} />)}</View>}
          </>
        ) : null}
      </ScrollView>
      {form ? <OlayFormu dosyaId={id} turler={ben.olayTurleri} kapat={() => setForm(false)} kaydedildi={() => { setForm(false); yukle(); }} /> : null}
    </View>
  );
}

/* =============================================================== Diğer */

function Diger({ ben, cikis, personeleGec }) {
  return (
    <View style={{ flex: 1 }}>
      <Bar baslik="Diğer" />
      <ScrollView contentContainerStyle={st.ic}>
        <View style={[st.kart, { flexDirection: "row", gap: 12, alignItems: "center" }]}>
          <Av ad={ben.ad} boyut={48} koyu />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SERIF, fontSize: 18, color: H.m, fontWeight: "600" }}>{ben.ad}</Text>
            <Text style={st.kucuk}>{ben.kurum ?? ""}</Text>
            <Text style={[st.kucuk, { marginTop: 2 }]}>{ben.danisman ? "Dış hukuk danışmanı" : ben.yetki === "tam" ? "Biçen hukuk ekibi" : "Hukuk masası · okuma"}</Text>
          </View>
        </View>
        {ben.danisman ? (
          <View style={st.kart}>
            <Text style={{ fontSize: 13, color: H.t, lineHeight: 20 }}>
              Yalnız size erişim verilen dosyaları görürsünüz. Duruşma ve süre hatırlatmaları ile yeni yazılar bildirim olarak gelir. Kişisel bilgilerinizdeki değişiklik için Biçen İK hukuk birimine yazınız.
            </Text>
          </View>
        ) : null}
        {personeleGec ? (
          <Pressable style={st.gecis} onPress={personeleGec}>
            <View style={st.gecisI}><Simge ad="kisi" renkli={H.m} boyut={18} /></View>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: "700", fontSize: 13.5 }}>Personel görünümü</Text><Text style={st.kucuk}>Vardiya, izin ve diğer işlemlerim</Text></View>
            <Text style={{ color: H.s2, fontSize: 20 }}>›</Text>
          </Pressable>
        ) : null}
        <Pressable style={st.gecis} onPress={cikis}>
          <View style={[st.gecisI, { backgroundColor: H.kirA }]}><Simge ad="cikis" renkli={H.kir} boyut={18} /></View>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: "700", fontSize: 13.5, color: H.kir }}>Çıkış yap</Text></View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/* ================================================================= Kök */

const MENU = [
  ["masa", "Masa", "ev"], ["dosyalar", "Dosyalar", "belge"], ["ajanda", "Ajanda", "takvim"], ["yazilar", "Yazışma", "mesaj"], ["diger", "Diğer", "diger"],
];

export default function HukukUygulama({ navigation, route }) {
  const alt = useSafeAreaInsets();
  const klavye = useKlavye();
  const [ben, setBen] = useState(null);
  const [hata, setHata] = useState("");
  const [sekme, setSekme] = useState("masa");
  const [yigin, setYigin] = useState([]); // { tip: dosya|yazi|yaz, ... }
  const [okunmamis, setOkunmamis] = useState(0);
  const [surum, setSurum] = useState(0);
  const danismanRef = useRef(false);

  useEffect(() => {
    hukukBen().then((b) => {
      if (!b?.yetkili) { setHata("Hukuk masasına erişiminiz yok."); return; }
      setBen(b);
      danismanRef.current = !!b.danisman;
      /* Danışman personel ekranına hiç girmediği için bildirim kurulumu burada */
      if (b.danisman) bildirimHazirla().catch?.(() => {});
    }).catch((e) => setHata(e.message));
  }, []);

  useEffect(() => {
    hukukMasa().then((m) => setOkunmamis(m?.okunmamis ?? 0)).catch(() => {});
  }, [sekme, surum]);

  /* Bildirimden açıldıysa ilgili yazı */
  useEffect(() => {
    const yazi = route?.params?.params?.yazi ?? route?.params?.yazi;
    if (yazi) setYigin([{ tip: "yazi", id: yazi }]);
  }, [route?.params]);

  /* Danışman oturumunda bildirim dinleyicisi (personel kökü yüklenmiyor) */
  useEffect(() => {
    const d = bildirimDinle((h) => {
      if (h?.kok === "Hukuk") {
        if (h.params?.yazi) setYigin([{ tip: "yazi", id: h.params.yazi }]);
        else { setYigin([]); setSekme("masa"); setSurum((s) => s + 1); }
      }
    });
    return () => d?.remove?.();
  }, []);

  /* Android geri tuşu önce alt ekranı kapatır */
  useEffect(() => {
    const b = BackHandler.addEventListener("hardwareBackPress", () => {
      if (yigin.length) { setYigin((y) => y.slice(0, -1)); return true; }
      if (sekme !== "masa") { setSekme("masa"); return true; }
      return false;
    });
    return () => b.remove();
  }, [yigin, sekme]);

  const ac = (id) => setYigin((y) => [...y, { tip: "dosya", id }]);
  const yaziAc = (id) => setYigin((y) => [...y, { tip: "yazi", id }]);
  const yaz = (taslak) => setYigin((y) => [...y, { tip: "yaz", taslak }]);
  const geri = () => { setYigin((y) => y.slice(0, -1)); setSurum((s) => s + 1); };
  const git = (k) => { setYigin([]); setSekme(k); };

  const cikis = () => Alert.alert("Çıkış", "Oturumunuz kapatılsın mı?", [
    { text: "Vazgeç", style: "cancel" },
    { text: "Çıkış yap", style: "destructive", onPress: async () => { await oturumKapat(); navigation.reset({ index: 0, routes: [{ name: "Giris" }] }); } },
  ]);
  const personeleGec = ben && !ben.danisman ? async () => {
    await gorunumYaz("personel");
    navigation.reset({ index: 0, routes: [{ name: "Uygulama" }] });
  } : null;

  if (hata) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: H.k }}>
        <Bos baslik="Hukuk masası" metin={hata} />
        <TouchableOpacity style={[st.dug, st.dugM, { margin: 20 }]} onPress={async () => {
          if (await hukukMu()) { await oturumKapat(); navigation.reset({ index: 0, routes: [{ name: "Giris" }] }); }
          else navigation.reset({ index: 0, routes: [{ name: "Uygulama" }] });
        }}><Text style={st.dugMT}>Geri dön</Text></TouchableOpacity>
      </SafeAreaView>
    );
  }
  if (!ben) return <View style={{ flex: 1, backgroundColor: H.k, justifyContent: "center" }}><ActivityIndicator color={H.m} size="large" /></View>;

  const ust = yigin[yigin.length - 1];
  const yaziyor = ust?.tip === "yaz";
  /* Alt menü sabit: içerik ScrollView'da kayar, menü yerinde durur.
     Klavye açıkken ya da yazı yazarken gizlenir; düğme ve metnin üstüne binmesin. */
  const menuGorunur = !yaziyor && !klavye.acik;
  const ustKoyu = !ust && sekme === "masa" || ust?.tip === "dosya";

  return (
    <View style={{ flex: 1, backgroundColor: ustKoyu ? H.m : H.k }}>
      <StatusBar style={ustKoyu ? "light" : "dark"} />
      <View style={{ height: alt.top, backgroundColor: ustKoyu ? H.m : H.k }} />
      <View style={{ flex: 1, backgroundColor: H.k }}>
        {ust?.tip === "dosya" ? <DosyaSayfasi key={`d${ust.id}`} id={ust.id} ben={ben} geri={geri} yaziAc={yaziAc} yaz={yaz} />
          : ust?.tip === "yazi" ? <YaziOku key={`y${ust.id}`} id={ust.id} ben={ben} geri={geri} ac={(i) => setYigin((y) => [...y.slice(0, -1), { tip: "yazi", id: i }])}
              dosyaAc={ac} yanitla={(y) => yaz({ yanit: y })} />
          : ust?.tip === "yaz" ? <YaziYaz ben={ben} taslak={ust.taslak} geri={geri}
              gonderildi={(id) => setYigin((y) => [...y.slice(0, -1).filter((x) => x.tip !== "yazi"), ...(id ? [{ tip: "yazi", id }] : [])])} />
          : sekme === "masa" ? <Masa key={surum} ben={ben} ac={ac} yaziAc={yaziAc} git={git} />
          : sekme === "dosyalar" ? <Dosyalar key={surum} ben={ben} ac={ac} />
          : sekme === "ajanda" ? <Ajanda ac={ac} yaziAc={yaziAc} />
          : sekme === "yazilar" ? <Yazilar key={surum} ben={ben} yaziAc={yaziAc} yaz={yaz} />
          : <Diger ben={ben} cikis={cikis} personeleGec={personeleGec} />}
      </View>
      {menuGorunur ? (
        <View style={[st.menu, { paddingBottom: Math.max(alt.bottom, 8) }]}>
          {MENU.map(([k, a, i]) => {
            const on = !ust && sekme === k || (ust?.tip === "dosya" && k === "dosyalar" && !yigin.some((x) => x.tip !== "dosya")) || (ust?.tip === "yazi" && k === "yazilar");
            return (
              <TouchableOpacity key={k} style={st.menuB} onPress={() => git(k)} accessibilityLabel={a}>
                {on ? <View style={st.menuCizgi} /> : null}
                <Simge ad={i} renkli={on ? H.m : H.s2} boyut={21} dolgu={on && i !== "belge" && i !== "takvim"} />
                <Text style={[st.menuT, on && { color: H.m }]}>{a}</Text>
                {k === "yazilar" && okunmamis > 0 ? <Text style={st.menuRozet}>{okunmamis}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : <View style={{ height: yaziyor && !klavye.acik ? alt.bottom : 0, backgroundColor: H.k }} />}
    </View>
  );
}

/* ================================================================ stil */

const st = StyleSheet.create({
  av: { alignItems: "center", justifyContent: "center" },
  etiket: { fontSize: 10.5, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, overflow: "hidden" },
  kucuk: { color: H.s, fontSize: 12 },
  bos: { alignItems: "center", padding: 34, gap: 6 },
  bosB: { fontFamily: SERIF, fontSize: 18, color: H.m, fontWeight: "600" },
  bosM: { color: H.s, fontSize: 13, textAlign: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, backgroundColor: H.k, borderBottomWidth: 1, borderBottomColor: H.cizgi },
  barB: { flex: 1, fontFamily: SERIF, fontSize: 20, fontWeight: "600", color: H.m },
  barIk: { minWidth: 36, height: 36, paddingHorizontal: 8, borderRadius: 11, backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, alignItems: "center", justifyContent: "center" },
  barIkK: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#ffffff1a", alignItems: "center", justifyContent: "center" },
  ic: { padding: 14, gap: 12, paddingBottom: 28 },
  kahraman: { backgroundColor: H.m, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22, overflow: "hidden" },
  halka: { position: "absolute", right: -60, top: -40, width: 220, height: 220, borderRadius: 110, borderWidth: 30, borderColor: "#ffffff08" },
  gunluk: { marginTop: 18, fontFamily: SERIF, fontSize: 21, lineHeight: 27, color: "#fff" },
  k3: { flexDirection: "row", gap: 8, marginTop: 16 },
  k3k: { flex: 1, backgroundColor: "#ffffff10", borderWidth: 1, borderColor: "#ffffff1c", borderRadius: 14, padding: 10 },
  k3b: { color: "#fff", fontSize: 21, fontWeight: "800" },
  k3s: { color: "#c4cbdb", fontSize: 11 },
  uyari: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: H.kirA, borderWidth: 1, borderColor: "#f0cfc4", borderRadius: 14, padding: 11 },
  bas2: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginHorizontal: 2, marginTop: 4 },
  bas2B: { fontFamily: SERIF, fontSize: 16.5, fontWeight: "600", color: H.m },
  bas2A: { fontSize: 12, color: H.a2, fontWeight: "700" },
  kart: { backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 18, padding: 14 },
  olay: { flexDirection: "row", gap: 12, alignItems: "center", padding: 11, backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 16 },
  gun: { width: 52, height: 56, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  gunB: { fontFamily: SERIF, fontSize: 22, fontWeight: "600" },
  gunA: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 1 },
  olayB: { fontSize: 13.5, fontWeight: "700", color: H.t },
  yaziOzet: { flexDirection: "row", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: H.cizgi2 },
  yaziKim: { flex: 1, fontSize: 13, fontWeight: "700", color: H.t },
  yaziKonu: { fontSize: 13, fontWeight: "600", color: H.t, marginTop: 1 },
  zaman: { fontSize: 11, color: H.s2 },
  ara: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 14, paddingHorizontal: 13 },
  araG: { flex: 1, paddingVertical: 11, fontSize: 14, color: H.t },
  seg: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi },
  segOn: { backgroundColor: H.m, borderColor: H.m },
  segT: { fontSize: 12.5, fontWeight: "600", color: H.s },
  dosya: { backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 18, padding: 14, paddingLeft: 16, gap: 8, overflow: "hidden" },
  dosyaCizgi: { position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  dosyaTur: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  dosyaAd: { fontFamily: SERIF, fontSize: 17, fontWeight: "600", color: H.m, marginTop: 2 },
  dosyaAlt: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: H.cizgi, borderStyle: "dashed", paddingTop: 9, gap: 8 },
  ajGun: { fontSize: 12, fontWeight: "800", color: H.s, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 6, marginLeft: 2 },
  yaziBas: { padding: 16, backgroundColor: H.kart, borderBottomWidth: 1, borderBottomColor: H.cizgi, gap: 7 },
  ref: { fontSize: 11, color: H.s, fontWeight: "600", letterSpacing: 0.3 },
  yaziH: { fontFamily: SERIF, fontSize: 19, fontWeight: "600", color: H.m, lineHeight: 25 },
  mektup: { margin: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: H.cizgi, borderRadius: 6, padding: 18, paddingTop: 22, overflow: "hidden" },
  mektupUst: { position: "absolute", left: 0, right: 0, top: 0, height: 4, backgroundColor: H.m },
  antet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: H.cizgi, marginBottom: 12 },
  antetB: { fontFamily: SERIF, fontSize: 14, letterSpacing: 1.5, color: H.m, fontWeight: "700" },
  antetS: { fontSize: 10, color: H.s, textAlign: "right" },
  mektupP: { fontFamily: SERIF, fontSize: 14, lineHeight: 23, color: "#2a3142" },
  ek: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 12, padding: 9 },
  ekI: { width: 34, height: 40, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  zincir: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 12, padding: 9 },
  dug: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  dugM: { backgroundColor: H.m },
  dugMT: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
  dugA: { backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi },
  dugAT: { color: H.m, fontWeight: "700", fontSize: 13.5 },
  etk: { fontSize: 11.5, color: H.s, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 5 },
  girdi: { backgroundColor: "#fff", borderWidth: 1, borderColor: H.cizgi, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: H.t },
  kisiCip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: H.cizgi },
  perde: { flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 20 },
  pencere: { backgroundColor: H.kart, borderRadius: 18, padding: 16 },
  dbas: { backgroundColor: H.m, paddingHorizontal: 18, paddingBottom: 18 },
  dbasTur: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", color: H.altinAcik },
  dbasH: { fontFamily: SERIF, fontWeight: "600", fontSize: 24, color: "#fff", marginTop: 4, marginBottom: 2 },
  s3: { flexDirection: "row", gap: 8, marginTop: 14 },
  s3k: { flex: 1, backgroundColor: "#ffffff10", borderWidth: 1, borderColor: "#ffffff1c", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  s3s: { fontSize: 10.5, color: "#c4cbdb" },
  s3b: { color: "#fff", fontSize: 13, fontWeight: "700", marginTop: 1 },
  dsek: { flexGrow: 0, backgroundColor: H.k, borderBottomWidth: 1, borderBottomColor: H.cizgi },
  dsekB: { paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  dsekOn: { borderBottomColor: H.a },
  dsekT: { fontSize: 12.5, fontWeight: "600", color: H.s },
  ce: { flexDirection: "row", gap: 12 },
  ceN: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, marginTop: 2 },
  ceC: { width: 2, flex: 1, backgroundColor: H.cizgi, marginTop: 2 },
  belgeler: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bel: { width: "31.5%", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: H.cizgi, backgroundColor: H.kart },
  belOn: { height: 64, alignItems: "center", justifyContent: "center" },
  belAd: { paddingHorizontal: 7, paddingTop: 6, fontSize: 10.5, fontWeight: "600" },
  gecis: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: H.kart, borderWidth: 1, borderColor: H.cizgi, borderRadius: 16, padding: 12 },
  gecisI: { width: 36, height: 36, borderRadius: 11, backgroundColor: H.mA, alignItems: "center", justifyContent: "center" },
  menu: { flexDirection: "row", justifyContent: "space-around", backgroundColor: H.kart, borderTopWidth: 1, borderTopColor: H.cizgi, paddingTop: 9 },
  menuB: { alignItems: "center", gap: 2, minWidth: 58, paddingHorizontal: 2 },
  menuT: { fontSize: 10.5, color: H.s2, fontWeight: "600" },
  menuCizgi: { position: "absolute", top: -9, width: 22, height: 3, borderRadius: 2, backgroundColor: H.a },
  menuRozet: { position: "absolute", top: -4, right: 8, backgroundColor: H.kir, color: "#fff", borderRadius: 10, fontSize: 9.5, paddingHorizontal: 5, fontWeight: "800", overflow: "hidden" },
});

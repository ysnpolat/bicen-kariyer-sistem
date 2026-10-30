/**
 * SKT Kontrol (1.9 · 23.10.2026)
 * ---------------------------------------------------------------------------
 * Her ay şubeye bir kategori atanıyor (portal › SKT Takip). Personel o
 * kategorinin ürünlerini okutup raftaki son kullanma tarihlerini parti
 * parti (adetiyle) giriyor ya da "Ürün yok" diyor. Eskiden Excel'e elle
 * yazılıyordu.
 *
 * Akış: Ana sayfa (görev kartı, ilerleme, acil ürünler) → Barkod okut →
 * SKT gir / Ürün yok → "Kaydet, sonraki" yine barkod ekranına döner.
 * Bu ayın kategorisinde olmayan ürün okutulursa uyarı çıkar; istenirse
 * "serbest kontrol" olarak girilebilir.
 *
 * Tarih: gün · ay · yıl kutuları. Etikette yalnız ay/yıl yazıyorsa gün
 * boş bırakılır, ayın son günü alınır.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Keyboard,
  Vibration,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { sktGorevAl, sktUrunAl, sktKaydet, sktSubelerAl, sktSubeSec } from "../api360";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import Simge from "../bilesenler/Simge";
import { useKlavye, altBosluk } from "../klavye";

const GUN = 864e5;
const bugun = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const kalanGun = (t) => Math.round((new Date(t).setHours(0, 0, 0, 0) - bugun()) / GUN);
const durumOf = (k) => (k < 0 ? "gec" : k <= 7 ? "kri" : k <= 30 ? "yak" : "uyg");
const tarihYaz = (t) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};
const kalanMetin = (k) => (k < 0 ? `${-k} gün geçti` : k === 0 ? "bugün doluyor" : `${k} gün kaldı`);

const DURUM = {
  bek: { ad: "Bekliyor", renk: "#1a5fb4", zemin: "#e7f0fc", nokta: "#c9cec3" },
  gec: { ad: "SKT geçmiş", renk: "#cf1322", zemin: "#fff1ec", nokta: "#cf1322" },
  kri: { ad: "0–7 gün", renk: "#c2410c", zemin: "#fff6e5", nokta: "#e8890c" },
  yak: { ad: "8–30 gün", renk: "#8a6d00", zemin: "#fffbe6", nokta: "#e3b505" },
  uyg: { ad: "Uygun", renk: renk.yesilKoyu, zemin: renk.yesilAcik, nokta: renk.yesil },
  yok: { ad: "Ürün yok", renk: "#6b7280", zemin: "#f0f1ee", nokta: "#9aa293" },
};

const Cip = ({ d, metin }) => (
  <Text style={[s.cip, { color: DURUM[d].renk, backgroundColor: DURUM[d].zemin }]}>{metin ?? DURUM[d].ad}</Text>
);

/* Gün/ay/yıl kutularından tarih: gün boşsa ayın son günü */
const tarihCoz = ({ g, a, y }) => {
  const ay = Number(a);
  let yil = Number(y);
  if (!ay || ay < 1 || ay > 12 || !y) return null;
  if (yil < 100) yil += 2000;
  if (yil < 2000 || yil > 2100) return null;
  const sonGun = new Date(yil, ay, 0).getDate();
  const gun = g ? Number(g) : sonGun;
  if (!gun || gun < 1 || gun > sonGun) return null;
  return `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`;
};
const kutulara = (iso) => {
  if (!iso) return { g: "", a: "", y: "" };
  const [y, a, g] = iso.split("-");
  return { g, a, y };
};

/* ========================================================================== */

/** Şube seçimi: listeden dokunarak; arama kutusuyla süzülür */
function SubeSecimi({ secilen, zorunlu, geri, secildi }) {
  const [liste, setListe] = useState(null);
  const [ara, setAra] = useState("");
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(null);

  useEffect(() => {
    sktSubelerAl()
      .then((d) => setListe(d?.subeler ?? []))
      .catch((h) => setHata(h?.message ?? "Şubeler alınamadı."));
  }, []);

  const kucuk = (t) => (t ?? "").toLocaleLowerCase("tr");
  const gorunen = (liste ?? []).filter((x) => !ara || kucuk(x.ad).includes(kucuk(ara)) || kucuk(x.kod).includes(kucuk(ara)));

  const sec = async (x) => {
    setIsleniyor(x.kod);
    try {
      await sktSubeSec(x.kod);
      secildi();
    } catch (h) {
      Alert.alert("Seçilemedi", h?.message ?? "");
    } finally {
      setIsleniyor(null);
    }
  };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Şube seçin" acik geri={zorunlu ? undefined : geri} />
      <ScrollView contentContainerStyle={[s.govde, { paddingBottom: 160 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.alt}>
          Genel merkez kullanıcısı olarak SKT kontrolünü hangi şubede yapacağınızı seçin. Seçim Fiyat Kontrol ile ortaktır.
        </Text>
        <TextInput style={s.subeAra} value={ara} onChangeText={setAra} placeholder="Şube ara" placeholderTextColor="#9aa093" />
        {hata ? <Text style={s.hata}>{hata}</Text> : null}
        {!liste && !hata ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 20 }} /> : null}
        {gorunen.map((x) => {
          const on = kucuk(x.ad) === kucuk(secilen);
          return (
            <TouchableOpacity key={x.kod} style={[s.subeSec, on && s.subeSecOn]} onPress={() => sec(x)} disabled={!!isleniyor}>
              <Text style={[s.subeSecYazi, on && { color: "#3f6212" }]}>{x.ad}</Text>
              {isleniyor === x.kod ? <ActivityIndicator color={renk.yesil} /> : on ? <Text style={{ color: "#3f6212", fontWeight: "800" }}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function Skt({ navigation }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [ekran, setEkran] = useState("ana"); // ana | liste | okut | giris
  const [planId, setPlanId] = useState(null);
  const [secili, setSecili] = useState(null); // { urun, planda, son, serbest }
  const [uyari, setUyari] = useState(null);
  const [sekme, setSekme] = useState("bek");
  const [ara, setAra] = useState("");

  const getir = useCallback(async (g = false) => {
    if (g) setYenileniyor(true);
    try {
      const d = await sktGorevAl();
      setVeri(d);
      setHata("");
      setPlanId((p) => p ?? d?.planlar?.[0]?.id ?? null);
    } catch (h) {
      setHata(h?.message ?? "Görev alınamadı.");
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const plan = veri?.planlar?.find((p) => p.id === planId) ?? veri?.planlar?.[0] ?? null;

  const ac = (u) => {
    setSecili({ urun: { stokKod: u.stokKod, barkod: u.barkod, ad: u.ad, anaGrup: u.anaGrup, kategori: u.kategori }, planda: true, son: u.tur ? { tur: u.tur, not: u.not, partiler: u.partiler } : null, serbest: false });
    setEkran("giris");
  };

  const okundu = async (kod, serbest) => {
    setUyari(null);
    try {
      const d = await sktUrunAl(kod, serbest ? null : plan?.id);
      if (!d?.bulundu) {
        Vibration.vibrate(250);
        setUyari({ tur: "yok", barkod: kod, metin: d?.hata ?? "Bu barkod sistemde bulunamadı." });
        return;
      }
      if (!serbest && plan && !d.planda) {
        Vibration.vibrate([0, 200, 120, 200]);
        setUyari({ tur: "kategori", urun: d.urun, plan: d.planKategori ?? plan.kategori });
        return;
      }
      setSecili({ urun: d.urun, planda: !!d.planda && !serbest, son: d.son, serbest: serbest || !d.planda });
      setEkran("giris");
    } catch (h) {
      Alert.alert("Sorgulanamadı", h?.message ?? "");
    }
  };

  /* Genel merkez kullanıcısı: şube seçimi (ilk açılışta seçim yoksa doğrudan) */
  if (ekran === "sube" || veri?.secimGerekli)
    return (
      <SubeSecimi
        secilen={veri?.sube}
        zorunlu={!!veri?.secimGerekli}
        geri={() => setEkran("ana")}
        secildi={() => {
          setPlanId(null);
          setVeri(null);
          setEkran("ana");
          getir();
        }}
      />
    );

  if (ekran === "okut" || ekran === "serbest")
    return (
      <Okut
        serbest={ekran === "serbest"}
        plan={plan}
        uyari={uyari}
        okundu={(k) => okundu(k, ekran === "serbest")}
        uyariKapat={() => setUyari(null)}
        serbestGir={(u) => {
          setUyari(null);
          setSecili({ urun: u, planda: false, son: null, serbest: true });
          setEkran("giris");
        }}
        geri={() => {
          setUyari(null);
          setEkran("ana");
          getir();
        }}
      />
    );

  if (ekran === "giris" && secili)
    return (
      <Giris
        secili={secili}
        plan={plan}
        geri={() => setEkran(secili.serbest ? "ana" : "liste")}
        kaydedildi={(sonraki) => {
          getir();
          setEkran(sonraki ? (secili.serbest ? "serbest" : "okut") : secili.serbest ? "ana" : "liste");
        }}
      />
    );

  if (ekran === "liste" && plan) return <Liste plan={plan} sekme={sekme} setSekme={setSekme} ara={ara} setAra={setAra} ac={ac} okut={() => setEkran("okut")} geri={() => setEkran("ana")} />;

  /* ------------------------------------------------------------- ana */
  const say = (d) => (plan?.urunler ?? []).filter((u) => u.durum === d).length;
  const oran = plan?.toplam ? plan.yapilan / plan.toplam : 0;
  const kalanGunSay = plan ? Math.max(0, kalanGun(plan.sonGun)) : 0;

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="SKT Kontrol" acik />
      <ScrollView contentContainerStyle={s.govde} refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}>
        {hata ? <Text style={s.hata}>{hata}</Text> : null}
        {!veri && !hata ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 40 }} /> : null}

        {veri?.sube ? (
          <TouchableOpacity
            style={s.subeSatir}
            activeOpacity={veri.kilitli === false ? 0.8 : 1}
            disabled={veri.kilitli !== false}
            onPress={() => setEkran("sube")}
          >
            <Text style={s.subeYazi} numberOfLines={1}>
              📍 {veri.sube}
            </Text>
            {veri.kilitli === false ? <Text style={s.subeDegistir}>Şube değiştir ›</Text> : null}
          </TouchableOpacity>
        ) : null}

        {veri && !plan ? (
          <View style={s.kart}>
            <Text style={s.kartBaslik}>Bu ay şubenize kategori atanmamış</Text>
            <Text style={s.alt}>Plan, merkez tarafından her ay portaldan girilir. Bu arada serbest kontrol yapabilirsiniz.</Text>
          </View>
        ) : null}

        {(veri?.planlar?.length ?? 0) > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {veri.planlar.map((p) => (
              <TouchableOpacity key={p.id} onPress={() => setPlanId(p.id)} style={[s.sekme, plan?.id === p.id && s.sekmeOn]}>
                <Text style={[s.sekmeYazi, plan?.id === p.id && { color: "#fff" }]}>{p.kategori}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {plan ? (
          <View style={s.gorev}>
            <Text style={s.gorevAy}>
              {new Date(plan.ay + "-01").toLocaleDateString("tr-TR", { month: "long", year: "numeric" })} görevi · son gün {tarihYaz(plan.sonGun)}
            </Text>
            <Text style={s.gorevKat}>{plan.kategori}</Text>
            {plan.aciklama ? <Text style={s.gorevAlt}>{plan.aciklama}</Text> : null}
            <View style={s.gorevSatir}>
              <View style={s.halka}>
                <Text style={s.halkaYazi}>%{Math.round(oran * 100)}</Text>
                <View style={s.halkaCubuk}>
                  <View style={[s.halkaDolu, { width: `${oran * 100}%` }]} />
                </View>
              </View>
              <View style={s.gorevSay}>
                <View style={s.gorevKutu}>
                  <Text style={s.gorevSayi}>
                    {plan.yapilan}/{plan.toplam}
                  </Text>
                  <Text style={s.gorevKutuAlt}>kontrol edildi</Text>
                </View>
                <View style={s.gorevKutu}>
                  <Text style={s.gorevSayi}>{kalanGunSay}</Text>
                  <Text style={s.gorevKutuAlt}>gün kaldı</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {plan ? (
          <>
            <TouchableOpacity style={s.anaDugme} activeOpacity={0.85} onPress={() => setEkran("okut")}>
              <Simge ad="barkod" renkli="#fff" boyut={20} />
              <Text style={s.anaDugmeYazi}>Barkod okut</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={s.ikinciDugme} onPress={() => setEkran("liste")}>
                <Text style={s.ikinciYazi}>Ürün listesi</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ikinciDugme} onPress={() => setEkran("serbest")}>
                <Text style={s.ikinciYazi}>＋ Serbest kontrol</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : veri ? (
          <TouchableOpacity style={s.anaDugme} onPress={() => setEkran("serbest")}>
            <Text style={s.anaDugmeYazi}>＋ Serbest kontrol</Text>
          </TouchableOpacity>
        ) : null}

        {plan ? (
          <>
            <Text style={s.bolum}>Bu ay bulunanlar</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {["gec", "kri", "yak"].map((d) => (
                <View key={d} style={s.ozetKutu}>
                  <Text style={[s.ozetSayi, { color: DURUM[d].renk }]}>{say(d)}</Text>
                  <Text style={s.ozetAlt}>{DURUM[d].ad}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {(veri?.sorunlar?.length ?? 0) > 0 ? (
          <View style={s.kart}>
            <Text style={s.kartBaslik}>Acil ilgilenilmesi gerekenler</Text>
            {veri.sorunlar.slice(0, 10).map((x, i) => {
              const d = durumOf(x.kalan);
              return (
                <View key={i} style={s.acilSatir}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.urunAd} numberOfLines={2}>
                      {x.ad}
                    </Text>
                    <Text style={s.alt}>
                      SKT {tarihYaz(x.skt)} · {x.adet} adet
                    </Text>
                  </View>
                  <Cip d={d} metin={kalanMetin(x.kalan)} />
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={{ height: 110 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ========================================================================== */

function Liste({ plan, sekme, setSekme, ara, setAra, ac, okut, geri }) {
  const say = (k) => plan.urunler.filter((u) => (k === "bek" ? u.durum === "bek" : k === "yap" ? u.durum !== "bek" : ["gec", "kri", "yak"].includes(u.durum))).length;
  const q = ara.trim().toLocaleLowerCase("tr");
  const liste = useMemo(
    () =>
      plan.urunler.filter((u) => {
        const ok = sekme === "hepsi" || (sekme === "bek" ? u.durum === "bek" : sekme === "yap" ? u.durum !== "bek" : ["gec", "kri", "yak"].includes(u.durum));
        return ok && (!q || `${u.ad}`.toLocaleLowerCase("tr").includes(q) || `${u.barkod}`.includes(q));
      }),
    [plan, sekme, q]
  );
  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad={plan.kategori} acik geri={geri} />
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={ara} onChangeText={setAra} placeholder="Ürün adı ya da barkod" placeholderTextColor="#9aa093" style={[s.girdi, { flex: 1 }]} />
          <TouchableOpacity style={s.kareDugme} onPress={okut}>
            <Simge ad="barkod" renkli="#fff" boyut={20} />
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[
            ["bek", "Bekleyen"],
            ["yap", "Kontrol edildi"],
            ["sor", "Sorunlu"],
            ["hepsi", "Hepsi"],
          ].map(([k, a]) => (
            <TouchableOpacity key={k} onPress={() => setSekme(k)} style={[s.sekme, sekme === k && s.sekmeOn]}>
              <Text style={[s.sekmeYazi, sekme === k && { color: "#fff" }]}>
                {a}
                {k !== "hepsi" ? ` (${say(k)})` : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, gap: 8, paddingBottom: 120 }}>
        {liste.map((u) => (
          <TouchableOpacity key={u.stokKod} style={s.urun} activeOpacity={0.75} onPress={() => ac(u)}>
            <View style={[s.nokta, { backgroundColor: DURUM[u.durum].nokta }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.urunAd} numberOfLines={2}>
                {u.ad}
              </Text>
              <Text style={s.alt} numberOfLines={1}>
                {u.barkod} · {u.kategori}
              </Text>
            </View>
            <Cip d={u.durum} />
          </TouchableOpacity>
        ))}
        {liste.length === 0 ? <Text style={[s.alt, { textAlign: "center", padding: 30 }]}>Bu sekmede ürün yok</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ========================================================================== */

function Okut({ serbest, plan, uyari, okundu, uyariKapat, serbestGir, geri }) {
  const [izin, izinIste] = useCameraPermissions();
  const [elle, setElle] = useState("");
  const [sorgulaniyor, setSorgulaniyor] = useState(false);
  const son = useRef({ d: "", z: 0 });

  useEffect(() => {
    if (izin && !izin.granted && izin.canAskAgain) izinIste();
  }, [izin, izinIste]);

  const sor = async (kod) => {
    const k = (kod ?? "").trim();
    if (!k || sorgulaniyor) return;
    setSorgulaniyor(true);
    Keyboard.dismiss();
    try {
      await okundu(k);
    } finally {
      setSorgulaniyor(false);
    }
  };

  const tarandi = ({ data }) => {
    const z = Date.now();
    if (uyari || sorgulaniyor) return;
    if (data === son.current.d && z - son.current.z < 2500) return;
    son.current = { d: data, z };
    sor(data);
  };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad={serbest ? "Serbest kontrol" : "Barkod okut"} acik geri={geri} />
      <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
        {!serbest && plan ? (
          <Text style={s.alt}>
            Bu ayın kategorisi: <Text style={{ fontWeight: "800", color: renk.metin }}>{plan.kategori}</Text> · {plan.yapilan}/{plan.toplam}
          </Text>
        ) : (
          <Text style={s.alt}>Serbest kontrol plan dışıdır: şubenizdeki herhangi bir ürünün SKT'sini girebilirsiniz.</Text>
        )}

        {izin?.granted ? (
          <View style={s.kameraKutu}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr", "datamatrix"] }}
              onBarcodeScanned={uyari ? undefined : tarandi}
            />
            <View style={s.kameraKaplama} pointerEvents="none">
              <View style={s.hedef}>
                <View style={[s.kose, s.koseSolUst]} />
                <View style={[s.kose, s.koseSagUst]} />
                <View style={[s.kose, s.koseSolAlt]} />
                <View style={[s.kose, s.koseSagAlt]} />
              </View>
              <Text style={s.kameraYazi}>{sorgulaniyor ? "Sorgulanıyor…" : "Barkodu çerçeveye alın"}</Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.anaDugme} onPress={izinIste}>
            <Text style={s.anaDugmeYazi}>Kamera izni ver</Text>
          </TouchableOpacity>
        )}

        {uyari?.tur === "kategori" ? (
          <View style={s.uyari}>
            <Text style={s.uyariBaslik}>⚠ Bu ürün bu ayın kategorisinde değil</Text>
            <Text style={s.urunAd}>{uyari.urun.ad}</Text>
            <Text style={s.alt}>
              {uyari.urun.barkod} · {uyari.urun.anaGrup}
              {uyari.urun.kategori ? ` › ${uyari.urun.kategori}` : ""}
            </Text>
            <Text style={{ fontSize: 13.5, color: renk.metin }}>
              Bu ay kontrol edeceğiniz kategori: <Text style={{ fontWeight: "800" }}>{uyari.plan}</Text>. Lütfen bu kategorideki bir ürünü okutun.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[s.ikinciDugme, { backgroundColor: "#fff" }]} onPress={uyariKapat}>
                <Text style={s.ikinciYazi}>Tamam, tekrar okut</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ikinciDugme, { backgroundColor: "#fff" }]} onPress={() => serbestGir(uyari.urun)}>
                <Text style={[s.ikinciYazi, { color: renk.pasif }]}>Yine de serbest gir</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : uyari ? (
          <View style={s.uyari}>
            <Text style={s.uyariBaslik}>⚠ {uyari.metin}</Text>
            <Text style={s.alt}>{uyari.barkod}</Text>
            <TouchableOpacity style={[s.ikinciDugme, { backgroundColor: "#fff" }]} onPress={uyariKapat}>
              <Text style={s.ikinciYazi}>Tekrar okut</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={elle}
            onChangeText={setElle}
            placeholder="ya da barkodu elle yazın"
            placeholderTextColor="#9aa093"
            keyboardType="number-pad"
            returnKeyType="search"
            onSubmitEditing={() => sor(elle)}
            style={[s.girdi, { flex: 1 }]}
          />
          <TouchableOpacity style={s.kareDugme} onPress={() => sor(elle)} disabled={sorgulaniyor}>
            {sorgulaniyor ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800" }}>↵</Text>}
          </TouchableOpacity>
        </View>
        <View style={{ height: 110 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ========================================================================== */

function TarihKutusu({ deger, degis }) {
  const ayRef = useRef(null);
  const yilRef = useRef(null);
  const set = (alan, v) => {
    const t = v.replace(/\D/g, "");
    degis({ ...deger, [alan]: t });
    if (alan === "g" && t.length === 2) ayRef.current?.focus();
    if (alan === "a" && t.length === 2) yilRef.current?.focus();
  };
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      <TextInput value={deger.g} onChangeText={(v) => set("g", v)} placeholder="GG" maxLength={2} keyboardType="number-pad" placeholderTextColor="#b0b6aa" style={[s.tarihGirdi, { width: 58 }]} />
      <Text style={s.tarihAyrac}>.</Text>
      <TextInput ref={ayRef} value={deger.a} onChangeText={(v) => set("a", v)} placeholder="AA" maxLength={2} keyboardType="number-pad" placeholderTextColor="#b0b6aa" style={[s.tarihGirdi, { width: 58 }]} />
      <Text style={s.tarihAyrac}>.</Text>
      <TextInput ref={yilRef} value={deger.y} onChangeText={(v) => set("y", v)} placeholder="YYYY" maxLength={4} keyboardType="number-pad" placeholderTextColor="#b0b6aa" style={[s.tarihGirdi, { flex: 1 }]} />
    </View>
  );
}

function Giris({ secili, plan, geri, kaydedildi }) {
  const u = secili.urun;
  const ilk = secili.son?.tur === "skt" && secili.son.partiler?.length
    ? secili.son.partiler.map((p) => ({ t: kutulara(String(p.skt).slice(0, 10)), adet: String(p.adet) }))
    : [{ t: { g: "", a: "", y: "" }, adet: "1" }];
  const [tur, setTur] = useState(secili.son?.tur === "yok" ? "yok" : "skt");
  const [partiler, setPartiler] = useState(ilk);
  const [not, setNot] = useState(secili.son?.not ?? "");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const klavye = useKlavye();

  const coz = partiler.map((p) => ({ iso: tarihCoz(p.t), adet: Number(p.adet) || 0 }));
  const hazir = tur === "yok" || (coz.length > 0 && coz.every((p) => p.iso && p.adet > 0));

  const kaydet = async (sonraki) => {
    setGonderiliyor(true);
    try {
      const c = await sktKaydet({
        planId: secili.serbest ? null : plan?.id ?? null,
        stokKod: u.stokKod,
        barkod: u.barkod,
        urunAd: u.ad,
        anaGrup: u.anaGrup,
        kategori: u.kategori,
        tur,
        partiler: tur === "skt" ? coz.map((p) => ({ skt: p.iso, adet: p.adet })) : [],
        not,
      });
      if (c?.durum === "gec" || c?.durum === "kri") Vibration.vibrate(200);
      kaydedildi(sonraki);
    } catch (h) {
      Alert.alert("Kaydedilemedi", h?.message ?? "");
    } finally {
      setGonderiliyor(false);
    }
  };

  const hizli = (i, ay) => {
    const d = bugun();
    d.setMonth(d.getMonth() + ay);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setPartiler((o) => o.map((x, j) => (j === i ? { ...x, t: kutulara(iso) } : x)));
  };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad={secili.serbest ? "Serbest kontrol" : "SKT girişi"} acik geri={geri} />
      <ScrollView contentContainerStyle={[s.govde, { paddingBottom: 200 }]} keyboardShouldPersistTaps="handled">
        <View style={s.kart}>
          <Text style={[s.urunAd, { fontSize: 16.5 }]}>{u.ad}</Text>
          <Text style={s.alt}>
            {u.barkod} · {u.anaGrup}
            {u.kategori ? ` › ${u.kategori}` : ""}
          </Text>
          {secili.son ? <Text style={[s.alt, { color: renk.yesilKoyu, marginTop: 4 }]}>Bu ay daha önce girilmiş; kaydettiğinizde güncellenir.</Text> : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            ["skt", "📅  SKT gir"],
            ["yok", "∅  Ürün yok"],
          ].map(([k, a]) => (
            <TouchableOpacity key={k} style={[s.secenek, tur === k && s.secenekOn]} onPress={() => setTur(k)}>
              <Text style={[s.secenekYazi, tur === k && { color: renk.yesilKoyu }]}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tur === "yok" ? (
          <Text style={s.alt}>Ürün rafta ve depoda yoksa seçin.</Text>
        ) : (
          partiler.map((p, i) => {
            const c = coz[i];
            const k = c.iso ? kalanGun(c.iso) : null;
            const d = k == null ? null : durumOf(k);
            return (
              <View key={i} style={s.parti}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={s.partiBaslik}>PARTİ {i + 1}</Text>
                  {partiler.length > 1 ? (
                    <TouchableOpacity onPress={() => setPartiler((o) => o.filter((_, j) => j !== i))} hitSlop={8}>
                      <Text style={{ color: renk.kirmizi, fontWeight: "700", fontSize: 13 }}>Kaldır</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={s.etiket}>Son kullanma tarihi (gün boşsa ay sonu)</Text>
                <TarihKutusu deger={p.t} degis={(t) => setPartiler((o) => o.map((x, j) => (j === i ? { ...x, t } : x)))} />
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {[
                    ["+1 ay", 1],
                    ["+3 ay", 3],
                    ["+6 ay", 6],
                    ["+1 yıl", 12],
                  ].map(([a, n]) => (
                    <TouchableOpacity key={a} style={s.hizli} onPress={() => hizli(i, n)}>
                      <Text style={s.hizliYazi}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.etiket}>Raftaki adet</Text>
                <View style={s.adet}>
                  <TouchableOpacity style={s.adetDugme} onPress={() => setPartiler((o) => o.map((x, j) => (j === i ? { ...x, adet: String(Math.max(1, (Number(x.adet) || 1) - 1)) } : x)))}>
                    <Text style={s.adetDugmeYazi}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={p.adet}
                    onChangeText={(v) => setPartiler((o) => o.map((x, j) => (j === i ? { ...x, adet: v.replace(/\D/g, "") } : x)))}
                    keyboardType="number-pad"
                    style={s.adetGirdi}
                  />
                  <TouchableOpacity style={s.adetDugme} onPress={() => setPartiler((o) => o.map((x, j) => (j === i ? { ...x, adet: String((Number(x.adet) || 0) + 1) } : x)))}>
                    <Text style={s.adetDugmeYazi}>+</Text>
                  </TouchableOpacity>
                </View>
                {d ? (
                  <View style={[s.sonuc, { backgroundColor: DURUM[d].zemin }]}>
                    <Text style={[s.sonucYazi, { color: DURUM[d].renk }]}>{DURUM[d].ad}</Text>
                    <Text style={[s.sonucYazi, { color: DURUM[d].renk }]}>
                      {tarihYaz(c.iso)} · {kalanMetin(k)}
                    </Text>
                  </View>
                ) : p.t.a || p.t.y ? (
                  <Text style={[s.alt, { color: renk.kirmizi }]}>Tarih eksik ya da hatalı</Text>
                ) : null}
              </View>
            );
          })
        )}

        {tur === "skt" ? (
          <TouchableOpacity style={s.partiEkle} onPress={() => setPartiler((o) => [...o, { t: { g: "", a: "", y: "" }, adet: "1" }])}>
            <Text style={s.ikinciYazi}>＋ Farklı tarihli parti ekle</Text>
          </TouchableOpacity>
        ) : null}

        <TextInput value={not} onChangeText={setNot} placeholder="Not (isteğe bağlı) — ör. arkada koli var" placeholderTextColor="#9aa093" multiline style={[s.girdi, { minHeight: 64, textAlignVertical: "top" }]} />
      </ScrollView>

      <View style={[s.altCubuk, { bottom: altBosluk(klavye) }]}>
        <TouchableOpacity style={[s.altDugme, { backgroundColor: "#eef0ea" }, (!hazir || gonderiliyor) && { opacity: 0.5 }]} disabled={!hazir || gonderiliyor} onPress={() => kaydet(false)}>
          <Text style={[s.altDugmeYazi, { color: renk.metin }]}>Kaydet</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.altDugme, { flex: 1.6, backgroundColor: renk.yesilKoyu }, (!hazir || gonderiliyor) && { opacity: 0.5 }]} disabled={!hazir || gonderiliyor} onPress={() => kaydet(true)}>
          {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Text style={s.altDugmeYazi}>Kaydet, sonraki ›</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 14, gap: 12 },
  hata: { color: renk.kirmizi },
  kart: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 14, gap: 6 },
  kartBaslik: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  alt: { fontSize: 12.5, color: renk.pasif },
  bolum: { fontSize: 12, fontWeight: "800", color: renk.pasif, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  gorev: { backgroundColor: renk.yesilKoyu, borderRadius: 18, padding: 16, gap: 3 },
  gorevAy: { color: "#e3efcf", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  gorevKat: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 4 },
  gorevAlt: { color: "#e3efcf", fontSize: 12.5 },
  gorevSatir: { flexDirection: "row", gap: 12, marginTop: 12, alignItems: "center" },
  halka: { flex: 1, gap: 6 },
  halkaYazi: { color: "#fff", fontSize: 26, fontWeight: "800" },
  halkaCubuk: { height: 8, borderRadius: 4, backgroundColor: "#ffffff33", overflow: "hidden" },
  halkaDolu: { height: 8, backgroundColor: "#fff", borderRadius: 4 },
  gorevSay: { flexDirection: "row", gap: 8 },
  gorevKutu: { backgroundColor: "#ffffff22", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, minWidth: 70 },
  gorevSayi: { color: "#fff", fontSize: 17, fontWeight: "800" },
  gorevKutuAlt: { color: "#e3efcf", fontSize: 11 },
  anaDugme: { backgroundColor: renk.yesilKoyu, borderRadius: 14, paddingVertical: 15, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10 },
  anaDugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 16 },
  ikinciDugme: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: renk.yesil, paddingVertical: 12, alignItems: "center", backgroundColor: "#fff" },
  ikinciYazi: { color: renk.yesilKoyu, fontWeight: "700", fontSize: 14 },
  ozetKutu: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: renk.cizgi, padding: 10, alignItems: "center" },
  ozetSayi: { fontSize: 22, fontWeight: "800" },
  ozetAlt: { fontSize: 11.5, color: renk.pasif },
  acilSatir: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: renk.cizgi },
  urunAd: { fontSize: 14.5, fontWeight: "700", color: renk.metin },
  cip: { fontSize: 11.5, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  sekme: { borderWidth: 1, borderColor: renk.cizgi, backgroundColor: "#fff", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  sekmeOn: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  sekmeYazi: { fontSize: 13, color: renk.metin, fontWeight: "600" },
  girdi: { backgroundColor: "#fff", borderWidth: 1, borderColor: renk.cizgi, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: renk.metin },
  kareDugme: { width: 48, borderRadius: 12, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  urun: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: renk.cizgi, padding: 12 },
  nokta: { width: 9, height: 9, borderRadius: 5 },
  kameraKutu: { height: 300, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
  kameraKaplama: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  hedef: { width: "78%", height: 110, borderRadius: 12 },
  kose: { position: "absolute", width: 26, height: 26, borderColor: renk.yesil },
  koseSolUst: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  koseSagUst: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  koseSolAlt: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  koseSagAlt: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  kameraYazi: { color: "#fff", fontSize: 13.5, marginTop: 18 },
  uyari: { backgroundColor: "#fff1ec", borderWidth: 1.5, borderColor: "#f3c5c0", borderRadius: 14, padding: 14, gap: 8 },
  uyariBaslik: { color: "#cf1322", fontWeight: "800", fontSize: 15 },
  secenek: { flex: 1, borderWidth: 1.5, borderColor: renk.cizgi, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  secenekOn: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  secenekYazi: { fontWeight: "800", fontSize: 15, color: renk.metin },
  parti: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 12, gap: 8 },
  partiBaslik: { fontSize: 12, fontWeight: "800", color: renk.pasif },
  etiket: { fontSize: 12, color: renk.pasif },
  tarihGirdi: { borderWidth: 1, borderColor: renk.cizgi, borderRadius: 10, paddingVertical: 10, fontSize: 19, fontWeight: "700", textAlign: "center", color: renk.metin, backgroundColor: "#fafbf8" },
  tarihAyrac: { fontSize: 20, color: renk.pasif, fontWeight: "800" },
  hizli: { borderWidth: 1, borderColor: renk.cizgi, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  hizliYazi: { fontSize: 12.5, color: renk.metin },
  adet: { flexDirection: "row", borderWidth: 1, borderColor: renk.cizgi, borderRadius: 10, overflow: "hidden" },
  adetDugme: { width: 50, height: 44, backgroundColor: "#f2f4ef", alignItems: "center", justifyContent: "center" },
  adetDugmeYazi: { fontSize: 22, color: renk.metin },
  adetGirdi: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: renk.metin },
  sonuc: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, flexDirection: "row", justifyContent: "space-between" },
  sonucYazi: { fontSize: 13, fontWeight: "800" },
  partiEkle: { borderRadius: 12, backgroundColor: "#eef0ea", paddingVertical: 12, alignItems: "center" },
  altCubuk: { position: "absolute", left: 14, right: 14, flexDirection: "row", gap: 10 },
  altDugme: { flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  altDugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 15.5 },
  /* Şube (23.10.2026) */
  subeSatir: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e6e9e3", paddingHorizontal: 12, paddingVertical: 10 },
  subeYazi: { flex: 1, fontSize: 14, fontWeight: "700", color: "#1f2933" },
  subeDegistir: { fontSize: 12.5, fontWeight: "800", color: "#5f8c10" },
  subeAra: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e6e9e3", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#1f2933" },
  subeSec: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e6e9e3", paddingHorizontal: 14, paddingVertical: 13 },
  subeSecOn: { borderColor: "#5f8c10", backgroundColor: "#f2f9e8" },
  subeSecYazi: { fontSize: 14.5, fontWeight: "700", color: "#1f2933" },
});

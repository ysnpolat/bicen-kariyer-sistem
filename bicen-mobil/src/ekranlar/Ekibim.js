/**
 * Ekibim
 * ---------------------------------------------------------------------------
 * Ekip arkadaşları: aynı yöneticiye bağlı olanlar ve yöneticinin kendisi.
 * Personel yalnızca ad soyad ve pozisyon görüyor.
 *
 * Yönetici, sorumlu olduğu kişiye dokununca ayrıntı açılıyor: bugün izinli
 * mi, kalan izin günü, planlı izinler, bekleyen talep ve son 30 günde
 * vardiya girişi yapmadığı günler. Başkasının ayrıntısı sunucudan hiç
 * dönmüyor.
 */

import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  BackHandler,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { ekibimAl, gorevBekleyenlerAl } from "../api";
import { OryantasyonFormu, EkipGorevleri, kalanYaz } from "../bilesenler/Gorevler";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import KisiDetay from "../bilesenler/KisiDetay";
import ArkadasVardiyasi from "../bilesenler/ArkadasVardiyasi";

const RENKLER = ["#5f8c10", "#1a4d80", "#e8481c", "#7c5bc4", "#13a8a8", "#d48806"];

/** Baş harflerden sabit renk: aynı kişi her açılışta aynı renkte */
const avatarRengi = (ad) => {
  let t = 0;
  for (const c of ad ?? "") t = (t * 31 + c.charCodeAt(0)) >>> 0;
  return RENKLER[t % RENKLER.length];
};

export default function Ekibim() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [ara, setAra] = useState("");
  const [detay, setDetay] = useState(null);

  /* Bölge müdürü: önce şubeler, şubeye dokununca o şubenin personeli */
  const [sube, setSube] = useState(null);

  /* Yönetici olmayan da ekip arkadaşının vardiyasını görebiliyor;
     izin ve puantaj ayrıntısı yalnızca yöneticide. */
  const [vardiya, setVardiya] = useState(null);

  /* Oryantasyon ve mazeret belgesi etiketleri (yalnızca yöneticide dolu) */
  const [gorev, setGorev] = useState(null);
  const [form, setForm] = useState(null);
  const [ekipGorev, setEkipGorev] = useState(null);

  const gorevGetir = useCallback(() => {
    gorevBekleyenlerAl()
      .then(setGorev)
      .catch(() => {});
  }, []);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      setVeri(await ekibimAl());
      setHata("");
      gorevGetir();
    } catch (h) {
      setHata(h.message);
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, [gorevGetir]);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  /* Şube açıkken geri tuşu şubelere döner */
  useEffect(() => {
    if (!sube) return undefined;

    const abone = BackHandler.addEventListener("hardwareBackPress", () => {
      setSube(null);
      return true;
    });

    return () => abone.remove();
  }, [sube]);

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  const q = ara.trim().toLocaleLowerCase("tr");
  const bolge = !!veri?.bolge;
  const ayniSube = (a, b) => String(a ?? "").trim().toLocaleLowerCase("tr") === String(b ?? "").trim().toLocaleLowerCase("tr");

  /* Bölge görünümünde şube seçilmemişse ve arama yoksa şube kartları */
  const subeKartlari = bolge && !sube && !q;

  const kisiler = (veri?.kisiler ?? []).filter(
    (k) =>
      (!bolge || !sube || ayniSube(k.sube, sube)) &&
      (!q || `${k.adSoyad} ${k.pozisyon}`.toLocaleLowerCase("tr").includes(q))
  );

  /* Yöneticinin sorumlu olduğu kişiler üstte, ayrı başlık altında */
  const sorumlu = kisiler.filter((k) => k.ayrinti);
  const digerleri = kisiler.filter((k) => !k.ayrinti);

  const sicilAnahtari = (x) => String(x ?? "").trim().replace(/^0+/, "");

  const oryantasyonu = new Map((gorev?.ekipOryantasyon ?? []).map((x) => [sicilAnahtari(x.sicil), x]));
  const belgesi = new Map((gorev?.ekipBelge ?? []).map((x) => [sicilAnahtari(x.sicil), x]));

  const Satir = ({ k }) => {
    const r = avatarRengi(k.adSoyad);
    const ory = k.ayrinti ? oryantasyonu.get(sicilAnahtari(k.sicil)) : null;
    const blg = k.ayrinti ? belgesi.get(sicilAnahtari(k.sicil)) : null;

    return (
      <TouchableOpacity
        style={s.kisi}
        activeOpacity={0.85}
        onPress={() => (k.ayrinti ? setDetay(k.sicil) : setVardiya(k))}
      >
        <View style={[s.avatar, { backgroundColor: r + "1f" }]}>
          <Text style={[s.avatarYazi, { color: r }]}>
            {(k.adSoyad ?? "").split(" ").map((x) => x[0]).slice(0, 2).join("")}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.ad} numberOfLines={1}>
            {k.adSoyad}
          </Text>
          <Text style={s.poz} numberOfLines={1}>
            {bolge && sube ? k.gorev ?? k.pozisyon : k.pozisyon}
          </Text>

          {ory ? (
            <TouchableOpacity style={[s.etk, s.etkYesil]} onPress={() => setForm(ory)} hitSlop={6}>
              <Text style={[s.etkYazi, { color: "#3f6507" }]} numberOfLines={1}>
                Oryantasyon doldurulması bekleniyor
              </Text>
            </TouchableOpacity>
          ) : null}

          {blg ? (
            <TouchableOpacity style={[s.etk, s.etkTuruncu]} onPress={() => setEkipGorev("belge")} hitSlop={6}>
              <Text style={[s.etkYazi, { color: "#8f2f0b" }]} numberOfLines={1}>
                {blg.gecikti ? "İzin evrakı yüklenmedi" : `İzin evrakı bekleniyor · ${kalanYaz(blg.kalanSaat)}`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={s.ok}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Ekibim" acik kendi yardim={veri?.yonetici ? "Ekibim.yonetici" : "Ekibim"} />

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        {bolge && sube ? (
          <TouchableOpacity style={s.geri} onPress={() => setSube(null)} hitSlop={6}>
            <Text style={s.geriYazi}>‹ Şubeler</Text>
          </TouchableOpacity>
        ) : null}

        <View style={s.baslikKart}>
          <Text style={s.sayi}>
            {bolge && !sube ? veri?.subeler?.length ?? 0 : bolge ? kisiler.length : veri?.kisiler?.length ?? 0}
          </Text>
          <Text style={s.sayiEt}>
            {bolge && !sube ? "şube" : bolge ? `kişi · ${sube}` : "ekip arkadaşı"}
          </Text>
        </View>

        <TextInput
          style={s.ara}
          value={ara}
          onChangeText={setAra}
          placeholder={bolge && !sube ? "Şube ya da personel ara" : "Ad ya da pozisyon ara"}
          placeholderTextColor="#a3a9a0"
        />

        {subeKartlari ? (
          <>
            <Text style={s.ipucu}>Şubeye dokununca personeli açılır.</Text>
            {(veri?.subeler ?? []).map((x) => (
              <TouchableOpacity key={x.ad} style={s.kisi} activeOpacity={0.85} onPress={() => setSube(x.ad)}>
                <View style={[s.avatar, { backgroundColor: renk.yesilAcik }]}>
                  <Text style={[s.avatarYazi, { color: renk.yesilKoyu }]}>{x.kisi}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.ad} numberOfLines={1}>
                    {x.ad}
                  </Text>
                  <Text style={s.poz} numberOfLines={1}>
                    {x.aciklama ? x.aciklama : x.mudur ? `Mağaza müdürü: ${x.mudur}` : "Mağaza müdürü tanımlı değil"}
                  </Text>
                </View>
                <Text style={s.ok}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        ) : kisiler.length === 0 ? (
          <Text style={s.bos}>
            {q ? "Aramanıza uyan kişi yok." : "Ekibinizde kimse görünmüyor."}
          </Text>
        ) : (
          <>
            {veri?.yonetici && sorumlu.length > 0 && (
              <>
                <Text style={s.bolum}>{bolge ? "PERSONEL" : "SORUMLU OLDUĞUNUZ"} · {sorumlu.length}</Text>
                <Text style={s.ipucu}>Dokununca izin durumu, vardiya planı ve geçmişi açılır.</Text>
                {sorumlu.map((k) => (
                  <Satir key={k.sicil} k={k} />
                ))}
              </>
            )}

            {digerleri.length > 0 && (
              <>
                {veri?.yonetici && sorumlu.length > 0 && <Text style={s.bolum}>DİĞER EKİP ARKADAŞLARI</Text>}
                {digerleri.map((k) => (
                  <Satir key={k.sicil} k={k} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {detay && <KisiDetay sicil={detay} kapat={() => setDetay(null)} />}

      {form ? (
        <OryantasyonFormu
          mod="yonetici"
          kisi={form}
          kapat={() => setForm(null)}
          tamam={() => {
            setForm(null);
            gorevGetir();
          }}
        />
      ) : null}

      {ekipGorev ? (
        <EkipGorevleri mod={ekipGorev} veri={gorev} kapat={() => setEkipGorev(null)} yenile={gorevGetir} />
      ) : null}

      {vardiya && (
        <ArkadasVardiyasi
          sicil={vardiya.sicil}
          adSoyad={vardiya.adSoyad}
          pozisyon={vardiya.pozisyon}
          kapat={() => setVardiya(null)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 120, gap: 8 },

  baslikKart: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  sayi: { fontSize: 30, fontWeight: "800", color: renk.yesilKoyu, letterSpacing: -1 },
  sayiEt: { fontSize: 14, fontWeight: "700", color: renk.pasif },

  ara: {
    backgroundColor: renk.beyaz,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: renk.metin,
  },

  bolum: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.7, marginTop: 12 },
  ipucu: { fontSize: 11.5, color: renk.pasif, marginBottom: 2 },

  kisi: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarYazi: { fontSize: 14, fontWeight: "800" },
  ad: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  poz: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  ok: { fontSize: 22, color: renk.pasif },
  geri: { alignSelf: "flex-start", paddingVertical: 4 },
  geriYazi: { fontSize: 14, fontWeight: "800", color: renk.yesilKoyu },
  etk: { alignSelf: "flex-start", maxWidth: "100%", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginTop: 5 },
  etkYesil: { backgroundColor: renk.yesilAcik },
  etkTuruncu: { backgroundColor: "#fff1ea" },
  etkYazi: { fontSize: 11, fontWeight: "800" },
  bos: { fontSize: 13, color: renk.pasif, textAlign: "center", marginTop: 30 },
});

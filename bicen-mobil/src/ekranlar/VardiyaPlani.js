/**
 * Vardiya Planı
 * ---------------------------------------------------------------------------
 * Yöneticide ekibin haftalık planı, herkeste kendi planı.
 *
 * <p>
 * Vardiya türlerini (Sabahçı, Akşamcı, Aracı…) İnsan Kaynakları tanımlıyor;
 * türlerde saat yok, çünkü her mağazanın açılış kapanış saati farklı. Müdür
 * hangi gün hangi türde çalışılacağını seçiyor.
 * </p>
 *
 * <p>
 * Akış (28.09.2026): müdür planı kurar → gönderir → personele bildirim
 * düşer. Personel onaylamıyor ya da reddetmiyor. Müdür gönderdiği planı
 * düzenleyebilir; yeniden gönderdiğinde "planınız güncellendi" bildirimi
 * gider. "Akşamcı çalışan ertesi gün sabahçı olamaz" kuralı yalnızca
 * uyarı; haftada 1 gün haftalık izin zorunlu. Personel yalnızca yöneticinin
 * verdiği haftalık izin günü için özel durum bildirebilir; yönetici kabul
 * ederse izin günü taşınır.
 * </p>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  BackHandler,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AltSayfa from "../bilesenler/AltSayfa";
import { useFocusEffect } from "@react-navigation/native";

import {
  vardiyaEkipAl,
  vardiyaAta,
  vardiyaGonder,
  vardiyaBenimAl,
  vardiyaGecenHafta,
  vardiyaOzelDurum,
  vardiyaOzelDurumlarAl,
  vardiyaOzelDurumKarar,
  manuelVardiyaBekleyenlerAl,
  manuelVardiyaKarar,
} from "../api";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";

const GUNLER = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/* Sistemdeki izin (yıllık, raporlu, mazeret, saatlik…) hücre renkleri.
   Rapor kırmızımsı: personel o gün kesinlikle gelmiyor. */
const izinRengi = (g) => {
  const k = (g.izinKisa ?? "").toLocaleLowerCase("tr");
  if (k.startsWith("rapor")) return { zemin: "#fdecec", yazi: "#b42318" };
  if (k.startsWith("yıllık")) return { zemin: renk.yesilAcik, yazi: renk.yesilKoyu };
  return { zemin: "#eef2f7", yazi: "#3b5b82" };
};

/** Günün izin bilgisi tek satır: "Saatlik İzin 14:00–16:00 · onay bekliyor" */
const izinSatiri = (g) =>
  g?.izinTuru
    ? `${g.izinTuru}${g.izinAyrinti ? ` ${g.izinAyrinti}` : ""}${g.izinBekliyor ? " · onay bekliyor" : ""}`
    : null;
const GUN_UZUN = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const RENKLER = {
  mavi: { zemin: "#e6f1fb", yazi: "#14507f" },
  mor: { zemin: "#efe9fb", yazi: "#4d3184" },
  sari: { zemin: "#fdf0e2", yazi: "#8a5a12" },
  yesil: { zemin: "#eef7df", yazi: "#3a5709" },
  kirmizi: { zemin: "#fdecec", yazi: "#7a1a1a" },
};

const TIP_ADI = { sabah: "sabahçı", aksam: "akşamcı", araci: "aracı", diger: "" };

const DURUM = {
  taslak: { ad: "Taslak", zemin: renk.zemin, yazi: renk.pasif },
  gonderildi: { ad: "Gönderildi", zemin: renk.yesilAcik, yazi: renk.yesilKoyu },
  degisti: { ad: "Değişti · gönder", zemin: "#fff8e6", yazi: "#b7791f" },
};

/** Hem Date hem "2026-09-21T00:00:00" biçimini okur */
const gunOku = (s) => {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());

  const d = new Date(String(s).slice(0, 10) + "T00:00:00");

  return Number.isNaN(d.getTime()) ? new Date(s) : d;
};

const ayniGun = (a, b) => String(a).slice(0, 10) === String(b).slice(0, 10);

const haftaBasi = (d) => {
  const g = new Date(d);
  g.setDate(g.getDate() - ((g.getDay() + 6) % 7));
  g.setHours(0, 0, 0, 0);
  return g;
};

const haftaYaz = (h) => {
  const s = gunOku(h);
  const b = new Date(s);
  b.setDate(b.getDate() + 6);
  return `${s.getDate()} ${AYLAR[s.getMonth()]} – ${b.getDate()} ${AYLAR[b.getMonth()]}`;
};

const gunYaz = (t) => {
  const d = gunOku(t);
  return `${GUN_UZUN[(d.getDay() + 6) % 7]} ${d.getDate()} ${AYLAR[d.getMonth()]}`;
};

/* Yerel tarihle: toISOString gece yarısından sonraki ilk saatlerde bir
   önceki günü veriyordu. */
const bugunMu = (t) => {
  const d = new Date();
  const yerel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return ayniGun(t, yerel);
};

/* ========================================================================== */

export default function VardiyaPlani() {
  const [hafta, setHafta] = useState(haftaBasi(new Date()));
  const [veri, setVeri] = useState(null);
  const [benim, setBenim] = useState(null);
  const [yayinlandi, setYayinlandi] = useState(false);
  const [ozelDurumlar, setOzelDurumlar] = useState([]);

  /* Manuel giriş-çıkış talepleri: personel okutamadı ya da unuttu,
     yönetici saati yazarak onaylıyor. */
  const [manueller, setManueller] = useState([]);
  const [manuelKarar, setManuelKarar] = useState(null); // {kayit, onay, saat, not}
  const [sekme, setSekme] = useState("ekip");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [ekipHata, setEkipHata] = useState(null);

  const [secili, setSecili] = useState(null); // {sicil, gun, adSoyad, ...}

  /* Bölge müdürü (06.10.2026): önce şubeler, şubeye dokununca o şubenin
     mağaza müdürleri ve planları */
  const [planSube, setPlanSube] = useState(null);

  useEffect(() => {
    if (!planSube) return undefined;

    const abone = BackHandler.addEventListener("hardwareBackPress", () => {
      setPlanSube(null);
      return true;
    });

    return () => abone.remove();
  }, [planSube]);
  const [isleniyor, setIsleniyor] = useState(false);

  /* Özel durum bildirimi (personel) */
  const [ozelAcik, setOzelAcik] = useState(false);
  const [ozelTalepGun, setOzelTalepGun] = useState(null);
  const [ozelAciklama, setOzelAciklama] = useState("");

  /* Özel durum kararı (yönetici) */
  const [karar, setKarar] = useState(null); // {kayit, kabul, yeniGun, not}

  const getir = useCallback(
    async (h = hafta, yenile = false) => {
      if (yenile) setYenileniyor(true);

      try {
        /* Ekip isteği yönetici olmayanlarda da çalışıyor (boş liste);
           hatası yutulmuyor, ekranda gösteriliyor — sessizce "yönetici
           değilsiniz" gibi görünüyordu. */
        let ekipHatasi = null;

        const [e, b, o, m] = await Promise.all([
          vardiyaEkipAl(h).catch((x) => {
            ekipHatasi = x.message;
            return null;
          }),
          vardiyaBenimAl(h),
          vardiyaOzelDurumlarAl().catch(() => ({ kayitlar: [] })),
          manuelVardiyaBekleyenlerAl().catch(() => ({ kayitlar: [] })),
        ]);

        setEkipHata(ekipHatasi);
        setVeri(e);
        setBenim(b?.plan ?? null);
        setYayinlandi(!!b?.yayinlandi);
        setOzelDurumlar(o?.kayitlar ?? []);
        setManueller(m?.kayitlar ?? []);
        setSekme((x) => (e?.yonetici || ekipHatasi ? x : "benim"));
        setHata("");
      } catch (h2) {
        setHata(h2.message);
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [hafta]
  );

  useFocusEffect(
    useCallback(() => {
      getir(hafta);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hafta])
  );

  const haftaDegis = (n) => {
    const y = new Date(hafta);
    y.setDate(y.getDate() + n * 7);
    setHafta(y);
  };

  /* Kancalar erken çıkışların üstünde (Rules of Hooks) */
  const ayniSube = (a, b) =>
    String(a ?? "").trim().toLocaleLowerCase("tr") === String(b ?? "").trim().toLocaleLowerCase("tr");

  /* Ekranda listelenen kişiler: bölge müdüründe yalnızca seçili şube */
  const gorunen = useMemo(() => {
    const k = veri?.kisiler ?? [];

    if (!veri?.bolge) return k;

    return planSube ? k.filter((x) => ayniSube(x.sube, planSube)) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veri, planSube]);

  const ozet = useMemo(() => {
    const k = veri?.bolge && !planSube ? veri?.kisiler ?? [] : gorunen;

    return {
      gonderildi: k.filter((x) => x.durum === "gonderildi").length,
      degisti: k.filter((x) => x.durum === "degisti").length,
      taslak: k.filter((x) => x.durum === "taslak").length,
      uyari: k.reduce((t, x) => t + (x.uyarilar?.length ?? 0), 0),
      izinsiz: k.filter((x) => !x.haftalikIzinVar).length,
    };
  }, [veri, gorunen, planSube]);

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri && !benim) return <Hata metin={hata} />;

  const yonetici = !!veri?.yonetici;
  const sablonlar = veri?.sablonlar ?? [];

  /* ------------------------------------------------------------- atama */

  /* Atamadan sonra ekran yeniden yüklenmiyor, yalnızca o hücre
     güncelleniyor. Her dokunuşta bütün ekibi yeniden çekmek ekranı
     saniyelerce bekletiyordu. */
  const ata = async (govde) => {
    setIsleniyor(true);

    try {
      const c = await vardiyaAta(govde);

      const sablon = sablonlar.find((x) => x.id === govde.sablonId) ?? null;

      setVeri((v) => {
        if (!v) return v;

        return {
          ...v,
          kisiler: v.kisiler.map((k) => {
            if (k.sicil !== govde.sicil) return k;

            const gunler = k.gunler.map((g) =>
              !ayniGun(g.tarih, govde.gun)
                ? g
                : {
                    ...g,
                    tur: govde.tur,
                    sablonId: sablon?.id ?? null,
                    ad: sablon?.ad ?? (govde.tur === "izin" ? "Haftalık izin" : "Boş"),
                    tip: sablon?.tip ?? null,
                    renk: sablon?.renk ?? null,
                  }
            );

            /* Uyarılar sunucudan: akşamcı → sabahçı geçişleri */
            return {
              ...k,
              gunler,
              haftalikIzinVar: gunler.some((g) => g.tur === "izin" || g.tur === "yillik"),
              uyarilar: (c?.uyarilar ?? []).filter((u) => !u.startsWith("Bu hafta")),
              durum: c?.durum ?? k.durum,
            };
          }),
        };
      });

      setSecili(null);

      if (c?.uyarilar?.length)
        Alert.alert(
          "Dikkat",
          c.uyarilar.join("\n\n") + "\n\nKayıt yapıldı; isterseniz günü değiştirebilirsiniz."
        );
    } catch (h2) {
      Alert.alert("Vardiya atanamadı", h2.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const gecenHaftayiUygula = async () => {
    setIsleniyor(true);

    try {
      const c = await vardiyaGecenHafta(hafta, veri?.bolge ? gorunen.map((x) => x.sicil) : undefined);

      Alert.alert(
        c?.gun ? "Kopyalandı" : "Kopyalanacak plan yok",
        c?.gun
          ? `${c.kisi} kişi için ${c.gun} gün kopyalandı.` +
            (c.uyarilar?.length ? `\n\nDinlenme uyarıları:\n${c.uyarilar.join("\n")}` : "")
          : "Geçen hafta için plan bulunamadı."
      );

      await getir(hafta);
    } catch (h2) {
      Alert.alert("Kopyalanamadı", h2.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const gonder = async () => {
    setIsleniyor(true);

    try {
      const c = await vardiyaGonder(hafta, veri?.bolge ? gorunen.map((x) => x.sicil) : undefined);

      Alert.alert(
        c?.gonderilen ? "Gönderildi" : "Gönderilecek plan yok",
        (c?.gonderilen
          ? `${c.gonderilen} kişiye bildirim gitti; planı uygulamadan görebilirler.`
          : "Taslak ya da değişmiş plan bulunamadı.") +
          (c?.eksikIzin?.length
            ? `\n\nHaftalık izin günü verilmediği için gönderilmeyenler:\n${c.eksikIzin.join("\n")}`
            : "")
      );

      await getir(hafta);
    } catch (h2) {
      Alert.alert("Gönderilemedi", h2.message);
    } finally {
      setIsleniyor(false);
    }
  };

  /* ------------------------------------------------------ özel durum */

  const ozelGonder = async () => {
    const izinGunu = (benim?.gunler ?? []).find((g) => g.tur === "izin");

    if (!izinGunu) return;

    if (ozelAciklama.trim().length < 5) {
      Alert.alert("Açıklama gerekli", "Özel durumunuzu kısaca yazınız.");
      return;
    }

    setIsleniyor(true);

    try {
      await vardiyaOzelDurum(izinGunu.tarih, ozelTalepGun, ozelAciklama.trim());
      setOzelAcik(false);
      setOzelAciklama("");
      setOzelTalepGun(null);
      Alert.alert("İletildi", "Özel durumunuz yöneticinize bildirildi. Kabul ederse izin gününüz değişir.");
      await getir(hafta);
    } catch (h2) {
      Alert.alert("Gönderilemedi", h2.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const kararVer = async () => {
    if (!karar) return;

    if (karar.kabul && !karar.yeniGun) {
      Alert.alert("Gün seçiniz", "Yeni haftalık izin gününü seçiniz.");
      return;
    }

    if (!karar.kabul && (karar.not ?? "").trim().length < 3) {
      Alert.alert("Sebep gerekli", "Reddetme sebebini yazınız; personel bunu görür.");
      return;
    }

    setIsleniyor(true);

    try {
      const c = await vardiyaOzelDurumKarar(karar.kayit.id, karar.kabul, karar.yeniGun, karar.not);

      setKarar(null);

      if (c?.uyarilar?.length) Alert.alert("Dikkat", c.uyarilar.join("\n\n"));

      await getir(hafta);
    } catch (h2) {
      Alert.alert("İşlem yapılamadı", h2.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const manuelKararVer = async () => {
    if (!manuelKarar) return;

    if (manuelKarar.onay && !/^\d{1,2}:\d{2}$/.test((manuelKarar.saat ?? "").trim())) {
      Alert.alert("Saat hatalı", "Saati 08:30 biçiminde yazınız.");
      return;
    }

    if (!manuelKarar.onay && (manuelKarar.not ?? "").trim().length < 3) {
      Alert.alert("Sebep gerekli", "Reddetme sebebini yazınız; personel bunu görür.");
      return;
    }

    setIsleniyor(true);

    try {
      await manuelVardiyaKarar(
        manuelKarar.kayit.id,
        manuelKarar.onay,
        manuelKarar.onay ? manuelKarar.saat.trim() : null,
        manuelKarar.not?.trim() || null
      );

      setManuelKarar(null);
      await getir(hafta);
    } catch (h2) {
      Alert.alert("İşlem yapılamadı", h2.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const benimIzinGunu = (benim?.gunler ?? []).find((g) => g.tur === "izin") ?? null;
  const bekleyenSayisi = ozelDurumlar.length + manueller.length;

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik
        ad="Vardiya Planı"
        acik
        kendi
        /* Müdürün ekranı farklı: ekip planı, onaylar. Videosu da ayrı. */
        yardim={yonetici ? "VardiyaPlani.yonetici" : "VardiyaPlani"}
      />

      {/* hafta seçici */}
      <View style={s.haftaBar}>
        <TouchableOpacity onPress={() => haftaDegis(-1)} hitSlop={10} style={s.ok}>
          <Text style={s.okYazi}>‹</Text>
        </TouchableOpacity>
        <Text style={s.haftaYazi}>{haftaYaz(hafta)}</Text>
        <TouchableOpacity onPress={() => haftaDegis(1)} hitSlop={10} style={s.ok}>
          <Text style={s.okYazi}>›</Text>
        </TouchableOpacity>
      </View>

      {(yonetici || ekipHata) && (
        <View style={s.seg}>
          {[
            ["ekip", `Ekibim (${veri?.kisiler?.length ?? 0})`],
            ["benim", "Benim planım"],
          ].map(([k, a]) => (
            <TouchableOpacity key={k} style={[s.segDugme, sekme === k && s.segSecili]} onPress={() => setSekme(k)}>
              <Text style={[s.segYazi, sekme === k && { color: renk.metin }]}>
                {a}
                {k === "ekip" && bekleyenSayisi > 0 ? ` · ${bekleyenSayisi}` : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl refreshing={yenileniyor} onRefresh={() => getir(hafta, true)} tintColor={renk.yesil} />
        }
      >
        {sekme === "ekip" ? (
          <>
            <View style={s.ozet}>
              {[
                ["gonderildi", ozet.gonderildi, renk.yesilKoyu, "gönderildi"],
                ["degisti", ozet.degisti, "#b7791f", "değişti"],
                ["taslak", ozet.taslak, renk.pasif, "taslak"],
                ["uyari", ozet.uyari, renk.turuncu, "uyarı"],
              ].map(([k, d, r, a]) => (
                <View key={k} style={s.ozetKutu}>
                  <Text style={[s.ozetSayi, { color: r }]}>{d}</Text>
                  <Text style={s.ozetAd}>{a}</Text>
                </View>
              ))}
            </View>

            {/* Manuel giriş-çıkış talepleri: yönetici saati yazarak onaylar */}
            {manueller.map((m) => (
              <View key={`m${m.id}`} style={[s.uyari, { backgroundColor: "#eef4fb", borderColor: "#cfe0f3" }]}>
                <Text style={[s.uyariBaslik, { color: "#14507f" }]}>
                  {m.adSoyad} · manuel {m.tur.toLowerCase()} talebi
                </Text>
                <Text style={[s.uyariYazi, { color: "#14507f" }]}>
                  {gunYaz(m.tarih)} · {m.tur} saati {m.saat}
                  {m.okutmalar?.length
                    ? ` · o gün okutulan: ${m.okutmalar.map((o) => `${o.tur} ${o.saat}`).join(", ")}`
                    : " · o gün hiç okutma yok"}
                </Text>
                <Text style={[s.uyariYazi, { color: renk.metin, marginTop: 4 }]}>“{m.sebep}”</Text>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    style={[s.kucukDugme, { borderColor: "#f3c2c2" }]}
                    disabled={isleniyor}
                    onPress={() => setManuelKarar({ kayit: m, onay: false, saat: m.saat, not: "" })}
                  >
                    <Text style={[s.kucukDugmeYazi, { color: renk.kirmizi }]}>Reddet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.kucukDugme, { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu }]}
                    disabled={isleniyor}
                    onPress={() => setManuelKarar({ kayit: m, onay: true, saat: m.saat, not: "" })}
                  >
                    <Text style={[s.kucukDugmeYazi, { color: "#fff" }]}>Saati yaz ve onayla</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Özel durum bildirimleri: yanıt bekleyenler en üstte */}
            {ozelDurumlar.map((o) => (
              <View key={o.id} style={[s.uyari, { backgroundColor: "#fff8e6", borderColor: "#f5e3b3" }]}>
                <Text style={[s.uyariBaslik, { color: "#7a5a00" }]}>
                  {o.adSoyad} · haftalık izin için özel durum
                </Text>
                <Text style={[s.uyariYazi, { color: "#7a5a00" }]}>
                  {gunYaz(o.izinGun)} izin günü
                  {o.talepGun ? ` yerine ${gunYaz(o.talepGun)} istiyor` : " için"}
                  {" · "}
                  {haftaYaz(o.hafta)} haftası
                </Text>
                <Text style={[s.uyariYazi, { color: renk.metin, marginTop: 4 }]}>“{o.aciklama}”</Text>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    style={[s.kucukDugme, { borderColor: "#f3c2c2" }]}
                    disabled={isleniyor}
                    onPress={() => setKarar({ kayit: o, kabul: false, yeniGun: null, not: "" })}
                  >
                    <Text style={[s.kucukDugmeYazi, { color: renk.kirmizi }]}>Reddet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.kucukDugme, { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu }]}
                    disabled={isleniyor}
                    onPress={() => setKarar({ kayit: o, kabul: true, yeniGun: o.talepGun ?? null, not: "" })}
                  >
                    <Text style={[s.kucukDugmeYazi, { color: "#fff" }]}>Kabul et · izin gününü değiştir</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {ozet.izinsiz > 0 && (
              <View style={[s.uyari, { backgroundColor: "#fff8e6", borderColor: "#f5e3b3" }]}>
                <Text style={[s.uyariYazi, { color: "#7a5a00" }]}>
                  {ozet.izinsiz} personele haftalık izin günü verilmedi. Haftada 1 gün izin zorunlu; izin
                  günü olmayan plan gönderilmez.
                </Text>
              </View>
            )}

            {veri?.bolge && !planSube ? (
              <>
                <Text style={s.altBilgi}>Şubeye dokununca mağaza müdürlerinin planı açılır.</Text>
                {(veri?.subeler ?? []).map((ad) => {
                  const kisiler = (veri?.kisiler ?? []).filter((x) => ayniSube(x.sube, ad));
                  const bekleyen = kisiler.filter((x) => x.durum !== "gonderildi").length;

                  return (
                    <TouchableOpacity key={ad} style={s.subeKart} activeOpacity={0.85} onPress={() => setPlanSube(ad)}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.kisiAd} numberOfLines={1}>
                          {ad}
                        </Text>
                        <Text style={s.kisiPoz} numberOfLines={1}>
                          {kisiler.length === 0
                            ? "Mağaza müdürü bulunamadı"
                            : kisiler.map((x) => x.adSoyad).join(", ")}
                        </Text>
                      </View>
                      {kisiler.length > 0 ? (
                        <View
                          style={[
                            s.rozet,
                            { backgroundColor: bekleyen ? DURUM.degisti.zemin : DURUM.gonderildi.zemin },
                          ]}
                        >
                          <Text
                            style={[
                              s.rozetYazi,
                              { color: bekleyen ? DURUM.degisti.yazi : DURUM.gonderildi.yazi },
                            ]}
                          >
                            {bekleyen ? `${bekleyen} gönderilmedi` : "gönderildi"}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={s.subeOk}>›</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : null}

            {veri?.bolge && planSube ? (
              <TouchableOpacity style={s.subeGeri} onPress={() => setPlanSube(null)} hitSlop={6}>
                <Text style={s.subeGeriYazi}>‹ Şubeler</Text>
                <Text style={s.subeGeriAd} numberOfLines={1}>{planSube}</Text>
              </TouchableOpacity>
            ) : null}

            {!veri?.bolge || planSube ? (
            <TouchableOpacity style={s.kopyala} disabled={isleniyor} onPress={gecenHaftayiUygula}>
              <Text style={s.kopyalaYazi}>⟳  Geçen haftanın planını uygula</Text>
            </TouchableOpacity>
            ) : null}

            {ekipHata ? (
              <View style={[s.uyari, { backgroundColor: "#fdecec", borderColor: "#f3c2c2" }]}>
                <Text style={[s.uyariBaslik, { color: "#7a1a1a" }]}>Ekip planı alınamadı</Text>
                <Text style={[s.uyariYazi, { color: "#7a1a1a" }]}>{ekipHata}</Text>
              </View>
            ) : null}

            {(veri?.kisiler ?? []).length === 0 && !ekipHata && !veri?.bolge ? (
              <View style={s.uyari}>
                <Text style={s.uyariYazi}>
                  Sorumlu olduğunuz personel görünmüyor. Kapsam İnsan Kaynakları'nın izin onay
                  tablosundan geliyor; mağaza müdürü kendi mağazasının personelinden sorumludur.
                </Text>
              </View>
            ) : null}

            {gorunen.map((k) => (
              <KisiKarti
                key={k.sicil}
                k={veri?.bolge ? { ...k, pozisyon: k.gorev ?? k.pozisyon } : k}
                onGun={(g) => setSecili({ ...k, gun: g })}
              />
            ))}

            {!veri?.bolge || planSube ? (
            <TouchableOpacity
              style={[s.gonder, (ozet.taslak + ozet.degisti === 0 || isleniyor) && { backgroundColor: "#c5c9c0" }]}
              disabled={ozet.taslak + ozet.degisti === 0 || isleniyor}
              onPress={gonder}
            >
              <Text style={s.gonderYazi}>
                {ozet.taslak + ozet.degisti > 0
                  ? `Planı gönder (${ozet.taslak + ozet.degisti} kişi)`
                  : "Herkese gönderildi"}
              </Text>
            </TouchableOpacity>
            ) : null}

            <Text style={s.altBilgi}>
              Plan personele bildirim olarak gider; onay beklenmez. Gönderdikten sonra değiştirdiğiniz
              planı yeniden gönderdiğinizde personele güncelleme bildirimi düşer. Göndermeyi
              unutursanız, 7 günü dolu plan son değişiklikten yarım saat sonra kendiliğinden gönderilir.
            </Text>
          </>
        ) : (
          <BenimPlanim
            plan={benim}
            yayinlandi={yayinlandi}
            izinGunu={benimIzinGunu}
            onOzelDurum={() => {
              setOzelTalepGun(null);
              setOzelAciklama("");
              setOzelAcik(true);
            }}
          />
        )}
      </ScrollView>

      {/* vardiya seçimi */}
      <Modal visible={!!secili} transparent animationType="slide" onRequestClose={() => setSecili(null)}>
        <TouchableOpacity style={s.perde} activeOpacity={1} onPress={() => setSecili(null)}>
          <TouchableOpacity activeOpacity={1} style={s.sayfa}>
            <View style={s.tut} />

            {secili && (
              <>
                <Text style={s.sayfaBaslik}>
                  {secili.adSoyad} · {gunYaz(secili.gun)}
                </Text>
                <Text style={s.sayfaAlt}>
                  Gönderilmiş bir planı değiştirirseniz "Planı gönder" ile personele güncelleme bildirimi
                  düşer.
                </Text>

                {/* Seçilen günde sistemde izin varsa (saatlik, yarım gün ya da
                    onay bekleyen talep) vardiya ona göre seçilsin */}
                {(() => {
                  const g = secili.gunler?.find((x) => ayniGun(x.tarih, secili.gun));
                  const satir = izinSatiri(g);
                  if (!satir) return null;
                  return (
                    <View style={[s.redNot, { backgroundColor: "#eef4fb", marginTop: 0, marginBottom: 10 }]}>
                      <Text style={[s.redNotYazi, { color: "#14507f" }]}>
                        <Text style={{ fontWeight: "800" }}>Bu gün sistemde: </Text>
                        {satir}
                        {g.kismiIzin && !g.izinBekliyor ? ". Vardiyayı izin saatine göre seçin." : "."}
                      </Text>
                    </View>
                  );
                })()}

                {sablonlar.map((sb) => {
                  const r = RENKLER[sb.renk] ?? RENKLER.mavi;

                  return (
                    <TouchableOpacity
                      key={sb.id}
                      style={s.secenek}
                      disabled={isleniyor}
                      onPress={() => ata({ sicil: secili.sicil, gun: secili.gun, sablonId: sb.id, tur: "vardiya" })}
                    >
                      <View style={[s.secenekIkon, { backgroundColor: r.zemin }]}>
                        <Text style={[s.secenekIkonYazi, { color: r.yazi }]}>{sb.ad.slice(0, 3)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.secenekAd}>{sb.ad}</Text>
                        <Text style={s.secenekSaat}>
                          {TIP_ADI[sb.tip] ? `${TIP_ADI[sb.tip]} · saat mağazaya göre` : "saat mağazaya göre"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {[
                  ["izin", "Haftalık izin", renk.zemin, "haftada 1 gün zorunlu"],
                  ["off", "Boş", "#fafbf8", "çalışma yok"],
                ].map(([tur, ad, zemin, alt]) => (
                  <TouchableOpacity
                    key={tur}
                    style={s.secenek}
                    disabled={isleniyor}
                    onPress={() => ata({ sicil: secili.sicil, gun: secili.gun, sablonId: null, tur })}
                  >
                    <View style={[s.secenekIkon, { backgroundColor: zemin }]}>
                      <Text style={[s.secenekIkonYazi, { color: renk.pasif }]}>{ad.slice(0, 3)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.secenekAd}>{ad}</Text>
                      <Text style={s.secenekSaat}>{alt}</Text>
                    </View>
                  </TouchableOpacity>
                ))}

                {isleniyor && <ActivityIndicator color={renk.yesilKoyu} style={{ marginTop: 8 }} />}
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* özel durum bildirimi (personel) */}
      <AltSayfa gorunur={ozelAcik} kapat={() => setOzelAcik(false)} perdeStil={s.perde} sayfaStil={s.sayfa}>
          <View style={s.tut} />
          <Text style={s.sayfaBaslik}>Haftalık izin · özel durum</Text>
          <Text style={s.sayfaAlt}>
            İzin gününüz {benimIzinGunu ? gunYaz(benimIzinGunu.tarih) : "—"}. Bu gün sizin için uygun
            değilse sebebini yazın; isterseniz hangi günü istediğinizi de seçin. Yöneticiniz kabul
            ederse izin gününüz değişir.
          </Text>

          <Text style={s.etiket}>İstediğim gün (isteğe bağlı)</Text>
          <View style={s.redGunler}>
            <TouchableOpacity
              style={[s.redGun, !ozelTalepGun && s.redGunSecili]}
              onPress={() => setOzelTalepGun(null)}
            >
              <Text style={[s.redGunYazi, !ozelTalepGun && { color: "#fff" }]}>Yönetici belirlesin</Text>
            </TouchableOpacity>

            {(benim?.gunler ?? []).map((g, i) => {
              const secilemez = g.tur === "izin" || g.tur === "yillik" || gunOku(g.tarih) < gunOku(new Date());
              const secildi = ozelTalepGun && ayniGun(ozelTalepGun, g.tarih);

              return (
                <TouchableOpacity
                  key={i}
                  style={[s.redGun, secildi && s.redGunSecili, secilemez && { opacity: 0.35 }]}
                  disabled={secilemez}
                  onPress={() => setOzelTalepGun(g.tarih)}
                >
                  <Text style={[s.redGunYazi, secildi && { color: "#fff" }]}>{GUNLER[i]}</Text>
                  <Text style={[s.redGunAlt, secildi && { color: "rgba(255,255,255,0.85)" }]}>
                    {g.tur === "vardiya" ? g.ad : g.tur === "izin" ? "izin" : "—"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={s.girdi}
            multiline
            value={ozelAciklama}
            onChangeText={setOzelAciklama}
            placeholder="Örnek: Perşembe günü hastane randevum var."
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            placeholderTextColor="#a3a9a0"
          />

          <TouchableOpacity
            style={[s.gonder, isleniyor && { opacity: 0.6 }]}
            disabled={isleniyor}
            onPress={ozelGonder}
          >
            <Text style={s.gonderYazi}>Yöneticime bildir</Text>
          </TouchableOpacity>
      </AltSayfa>

      {/* manuel giriş-çıkış kararı (yönetici) */}
      <AltSayfa gorunur={!!manuelKarar} kapat={() => setManuelKarar(null)} perdeStil={s.perde} sayfaStil={s.sayfa}>
          <View style={s.tut} />

          {manuelKarar && (
            <>
              <Text style={s.sayfaBaslik}>
                {manuelKarar.onay ? "Manuel kaydı onayla" : "Manuel kaydı reddet"} · {manuelKarar.kayit.adSoyad}
              </Text>
              <Text style={s.sayfaAlt}>
                {gunYaz(manuelKarar.kayit.tarih)} · {manuelKarar.kayit.tur}.{" "}
                {manuelKarar.onay
                  ? `Personel ${manuelKarar.kayit.saat} yazdı. Gerçek saati kontrol edip gerekirse düzeltin; kayıt yazdığınız saatle işlenir.`
                  : "Sebebini yazınız; personel bu açıklamayı görür."}
              </Text>

              {manuelKarar.onay && (
                <>
                  <Text style={s.etiket}>{manuelKarar.kayit.tur} saati</Text>
                  <TextInput
                    style={[s.girdi, { minHeight: 48, fontSize: 20, fontWeight: "800", textAlign: "center", marginBottom: 10 }]}
                    value={manuelKarar.saat}
                    onChangeText={(t) => setManuelKarar({ ...manuelKarar, saat: t })}
                    placeholder="08:30"
                    placeholderTextColor="#a3a9a0"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </>
              )}

              <TextInput
                style={s.girdi}
                multiline
                value={manuelKarar.not}
                onChangeText={(t) => setManuelKarar({ ...manuelKarar, not: t })}
                placeholder={manuelKarar.onay ? "Not (isteğe bağlı)" : "Örnek: O gün mağazada değildiniz."}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                placeholderTextColor="#a3a9a0"
              />

              <TouchableOpacity
                style={[manuelKarar.onay ? s.gonder : s.redDugme, isleniyor && { opacity: 0.6 }]}
                disabled={isleniyor}
                onPress={manuelKararVer}
              >
                <Text style={manuelKarar.onay ? s.gonderYazi : s.redYazi}>
                  {manuelKarar.onay ? "Onayla ve kayda işle" : "Reddet ve bildir"}
                </Text>
              </TouchableOpacity>
            </>
          )}
      </AltSayfa>

      {/* özel durum kararı (yönetici) */}
      <AltSayfa gorunur={!!karar} kapat={() => setKarar(null)} perdeStil={s.perde} sayfaStil={s.sayfa}>
          <View style={s.tut} />

          {karar && (
            <>
              <Text style={s.sayfaBaslik}>
                {karar.kabul ? "Özel durumu kabul et" : "Özel durumu reddet"} · {karar.kayit.adSoyad}
              </Text>
              <Text style={s.sayfaAlt}>
                {karar.kabul
                  ? `${gunYaz(karar.kayit.izinGun)} izin günü seçtiğiniz güne taşınır; o günün vardiyası eski izin gününe geçer.`
                  : "Sebebini yazınız; personel bu açıklamayı görür ve izin günü değişmez."}
              </Text>

              {karar.kabul && (
                <KararGunSecici
                  kayit={karar.kayit}
                  kisiler={veri?.kisiler ?? []}
                  secili={karar.yeniGun}
                  onSec={(g) => setKarar({ ...karar, yeniGun: g })}
                />
              )}

              <TextInput
                style={s.girdi}
                multiline
                value={karar.not}
                onChangeText={(t) => setKarar({ ...karar, not: t })}
                placeholder={karar.kabul ? "Not (isteğe bağlı)" : "Örnek: O gün iki kişi izinli; bu hafta değiştiremiyorum."}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                placeholderTextColor="#a3a9a0"
              />

              <TouchableOpacity
                style={[
                  karar.kabul ? s.gonder : s.redDugme,
                  isleniyor && { opacity: 0.6 },
                ]}
                disabled={isleniyor}
                onPress={kararVer}
              >
                <Text style={karar.kabul ? s.gonderYazi : s.redYazi}>
                  {karar.kabul ? "Kabul et ve izin gününü değiştir" : "Reddet ve bildir"}
                </Text>
              </TouchableOpacity>
            </>
          )}
      </AltSayfa>
    </SafeAreaView>
  );
}

/* ========================================================================== */

/** Yöneticinin kabulde seçeceği yeni izin günü: personelin o haftaki planı */
function KararGunSecici({ kayit, kisiler, secili, onSec }) {
  const kisi = kisiler.find((k) => String(k.sicil).trim() === String(kayit.personelKodu).trim());
  const gunler = kisi?.gunler ?? [];

  if (gunler.length === 0)
    return (
      <Text style={[s.uyariYazi, { marginBottom: 10 }]}>
        Personelin bu haftaki planı görüntülenemiyor; seçili hafta {haftaYaz(kayit.hafta)} olmalı.
        {kayit.talepGun ? ` İstenen gün: ${gunYaz(kayit.talepGun)}.` : ""}
      </Text>
    );

  return (
    <View style={s.redGunler}>
      {gunler.map((g, i) => {
        const secilemez = g.tur === "izin" || g.tur === "yillik";
        const secildi = secili && ayniGun(secili, g.tarih);

        return (
          <TouchableOpacity
            key={i}
            style={[s.redGun, secildi && s.redGunSecili, secilemez && { opacity: 0.35 }]}
            disabled={secilemez}
            onPress={() => onSec(g.tarih)}
          >
            <Text style={[s.redGunYazi, secildi && { color: "#fff" }]}>{GUNLER[i]}</Text>
            <Text style={[s.redGunAlt, secildi && { color: "rgba(255,255,255,0.85)" }]}>
              {g.tur === "vardiya"
                ? g.ad
                : g.tur === "izin"
                ? "izin"
                : g.tur === "yillik"
                ? (g.izinKisa ?? "izinli").toLocaleLowerCase("tr")
                : "—"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ========================================================================== */

function KisiKarti({ k, onGun }) {
  const d = DURUM[k.durum] ?? DURUM.taslak;

  return (
    <View style={s.kart}>
      <View style={s.kisiUst}>
        <View style={s.avatar}>
          <Text style={s.avatarYazi}>
            {(k.adSoyad ?? "").split(" ").map((x) => x[0]).slice(0, 2).join("")}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kisiAd} numberOfLines={1}>
            {k.adSoyad}
          </Text>
          <Text style={s.kisiPoz} numberOfLines={1}>
            {k.pozisyon}
          </Text>
        </View>
        <View style={[s.rozet, { backgroundColor: d.zemin }]}>
          <Text style={[s.rozetYazi, { color: d.yazi }]}>
            {d.ad}
            {k.surum > 1 && k.durum === "gonderildi" ? ` · ${k.surum}.` : ""}
          </Text>
        </View>
      </View>

      <View style={s.hafta}>
        {k.gunler.map((g, i) => {
          const yillik = g.tur === "yillik";
          const iz = yillik ? izinRengi(g) : null;
          const r = !yillik && g.renk ? RENKLER[g.renk] ?? RENKLER.mavi : null;

          /* Akşamcı → sabahçı geçişindeki gün turuncu çerçeveyle işaretli */
          const sonraki = k.gunler[i + 1];
          const gecis =
            g.tur === "vardiya" && g.tip === "aksam" && sonraki?.tur === "vardiya" && sonraki?.tip === "sabah";
          const onceki = k.gunler[i - 1];
          const gecisHedef =
            g.tur === "vardiya" && g.tip === "sabah" && onceki?.tur === "vardiya" && onceki?.tip === "aksam";

          return (
            <TouchableOpacity
              key={i}
              style={s.gunSarmal}
              activeOpacity={yillik ? 1 : 0.8}
              disabled={yillik}
              onPress={() => onGun(g.tarih)}
            >
              <Text style={[s.gunAd, bugunMu(g.tarih) && { color: renk.yesilKoyu }]}>{GUNLER[i]}</Text>
              <View
                style={[
                  s.hucre,
                  yillik
                    ? { backgroundColor: iz.zemin }
                    : r
                    ? { backgroundColor: r.zemin }
                    : g.tur === "izin"
                    ? { backgroundColor: renk.zemin }
                    : s.hucreBos,
                ]}
              >
                <Text
                  style={[s.hucreAd, r && { color: r.yazi }, yillik && { color: iz.yazi }]}
                  numberOfLines={1}
                >
                  {g.tur === "off" ? "—" : yillik ? g.izinKisa ?? "İzinli" : g.tur === "izin" ? "İzin" : g.ad}
                </Text>

                {/* Kısmi izin (saatlik, yarım gün) ya da onay bekleyen talep:
                    alt şerit. Vardiya atanabilir, yönetici bilgilensin. */}
                {!yillik && g.izinTuru ? (
                  <View style={[s.izinSerit, g.izinBekliyor && { backgroundColor: "#f5c451" }]}>
                    <Text style={s.izinSeritYazi} numberOfLines={1}>
                      {g.izinBekliyor ? "talep" : g.izinKisa}
                    </Text>
                  </View>
                ) : null}

                {/* 1.9: devamsız / vardiya girişi yok */}
                {g.devamsiz || g.okutmadi ? (
                  <View style={[s.izinSerit, { backgroundColor: g.devamsiz ? "#cf1322" : "#f08c2e" }]}>
                    <Text style={s.izinSeritYazi} numberOfLines={1}>
                      {g.devamsiz ? "devamsız" : "giriş yok"}
                    </Text>
                  </View>
                ) : null}

                {/* İzinli günde okutma varsa uyarı noktası */}
                {g.celiski ? <View style={s.celiskiNokta} /> : null}

                {/* Akşamcı → sabahçı geçişi */}
                {gecis || gecisHedef ? <View style={s.uyariCerceve} /> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {!k.haftalikIzinVar ? (
        <View style={[s.redNot, { backgroundColor: "#fff8e6" }]}>
          <Text style={[s.redNotYazi, { color: "#7a5a00" }]}>
            Haftalık izin günü verilmedi. Haftada 1 gün izin zorunlu; plan bu hâliyle gönderilemez.
          </Text>
        </View>
      ) : null}

      {(k.uyarilar ?? []).map((u, i) => (
        <View key={i} style={[s.redNot, { backgroundColor: "#fff1ea" }]}>
          <Text style={[s.redNotYazi, { color: "#9a3412" }]}>⚠ {u}</Text>
        </View>
      ))}

      {/* Sistemdeki izinler: saatlik / yarım gün ve onay bekleyen talepler */}
      {(k.izinNotlari ?? []).map((u, i) => (
        <View key={`iz${i}`} style={[s.redNot, { backgroundColor: "#eef4fb" }]}>
          <Text style={[s.redNotYazi, { color: "#14507f" }]}>ⓘ {u}</Text>
        </View>
      ))}

      {k.celiskiliGun > 0 ? (
        <View style={[s.redNot, { backgroundColor: "#fff1ea" }]}>
          <Text style={[s.redNotYazi, { color: "#9a3412" }]}>
            İzinli ya da boş görünen {k.celiskiliGun} günde vardiya okutması var. Gün üzerindeki
            nokta bunu gösteriyor.
          </Text>
        </View>
      ) : null}

      {k.ozelDurum?.durum === "bekliyor" ? (
        <View style={[s.redNot, { backgroundColor: "#fff8e6" }]}>
          <Text style={[s.redNotYazi, { color: "#7a5a00" }]}>
            <Text style={{ fontWeight: "800" }}>Özel durum bildirdi: </Text>
            {k.ozelDurum.aciklama}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function BenimPlanim({ plan, yayinlandi, izinGunu, onOzelDurum }) {
  if (!plan || !yayinlandi)
    return (
      <>
        <View style={s.uyari}>
          <Text style={s.uyariYazi}>
            Bu haftanın planı henüz gönderilmedi. Yöneticiniz gönderdiğinde bildirim alırsınız.
          </Text>
        </View>
        <Text style={s.bos}>Plan yok</Text>
      </>
    );

  const calisma = plan.gunler.filter((g) => g.tur === "vardiya").length;
  const izin = plan.gunler.filter((g) => g.tur === "izin").length;
  const ozel = plan.ozelDurum;
  const ozelBekliyor = ozel?.durum === "bekliyor";

  return (
    <>
      {plan.durum === "degisti" ? (
        <View style={[s.uyari, { backgroundColor: "#fff8e6", borderColor: "#f5e3b3" }]}>
          <Text style={[s.uyariBaslik, { color: "#7a5a00" }]}>Plan güncelleniyor</Text>
          <Text style={[s.uyariYazi, { color: "#7a5a00" }]}>
            Yöneticiniz planınız üzerinde değişiklik yapıyor. Son hâli gönderildiğinde bildirim alırsınız.
          </Text>
        </View>
      ) : (
        <View style={[s.uyari, { backgroundColor: renk.yesilAcik, borderColor: "#d7ebbd" }]}>
          <Text style={[s.uyariBaslik, { color: "#3a5709" }]}>Haftalık planınız</Text>
          <Text style={[s.uyariYazi, { color: "#3a5709" }]}>
            {plan.gonderen ? `${plan.gonderen} tarafından gönderildi. ` : ""}
            Değişiklik olursa bildirim alırsınız. Vardiya saatleri mağazanızın çalışma düzenine göredir.
          </Text>
        </View>
      )}

      {ozel ? (
        <View
          style={[
            s.uyari,
            ozelBekliyor
              ? { backgroundColor: "#fff8e6", borderColor: "#f5e3b3" }
              : ozel.durum === "kabul"
              ? { backgroundColor: renk.yesilAcik, borderColor: "#d7ebbd" }
              : { backgroundColor: "#fdecec", borderColor: "#f3c2c2" },
          ]}
        >
          <Text style={[s.uyariBaslik, { color: ozelBekliyor ? "#7a5a00" : ozel.durum === "kabul" ? "#3a5709" : "#7a1a1a" }]}>
            {ozelBekliyor
              ? "Özel durum bildiriminiz yöneticinizde"
              : ozel.durum === "kabul"
              ? "Özel durumunuz kabul edildi"
              : "Özel durumunuz reddedildi"}
          </Text>
          <Text style={[s.uyariYazi, { color: renk.metin }]}>“{ozel.aciklama}”</Text>
          {ozel.kararNotu ? (
            <Text style={[s.uyariYazi, { marginTop: 4 }]}>
              {ozel.kararVeren ? `${ozel.kararVeren}: ` : ""}
              {ozel.kararNotu}
            </Text>
          ) : null}
        </View>
      ) : null}

      {plan.gunler.map((g, i) => {
        const r = g.renk ? RENKLER[g.renk] ?? RENKLER.mavi : null;
        const t = gunOku(g.tarih);
        const izinMi = g.tur === "izin";

        return (
          <View
            key={i}
            style={[
              s.kart,
              { flexDirection: "row", alignItems: "center", gap: 12 },
              bugunMu(g.tarih) && { borderColor: renk.yesil },
            ]}
          >
            <View style={{ width: 46, alignItems: "center" }}>
              <Text style={s.gunAd}>{GUNLER[i]}</Text>
              <Text style={s.gunSayi}>{t.getDate()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.satirAd}>{g.ad}</Text>
              <Text style={s.satirSaat}>
                {g.tur === "vardiya"
                  ? TIP_ADI[g.tip]
                    ? `${TIP_ADI[g.tip]} · saat mağazanıza göre`
                    : "saat mağazanıza göre"
                  : izinMi
                  ? "haftalık izin gününüz"
                  : g.tur === "yillik"
                  ? "izinlisiniz"
                  : "çalışma yok"}
              </Text>
              {g.tur !== "yillik" && izinSatiri(g) ? (
                <Text style={[s.satirSaat, { color: "#14507f" }]}>{izinSatiri(g)}</Text>
              ) : null}
            </View>
            {r ? (
              <View style={[s.kucukRozet, { backgroundColor: r.zemin }]}>
                <Text style={[s.kucukRozetYazi, { color: r.yazi }]}>{g.ad.slice(0, 3)}</Text>
              </View>
            ) : izinMi ? (
              <View style={[s.kucukRozet, { backgroundColor: renk.zemin }]}>
                <Text style={[s.kucukRozetYazi, { color: renk.pasif }]}>İzin</Text>
              </View>
            ) : null}
          </View>
        );
      })}

      <Text style={s.altBilgi}>
        {calisma} çalışma günü · {izin} haftalık izin
      </Text>

      {izinGunu && !ozelBekliyor ? (
        <TouchableOpacity style={s.kopyala} onPress={onOzelDurum}>
          <Text style={s.kopyalaYazi}>İzin günüm için özel durum bildir</Text>
          <Text style={[s.altBilgi, { marginTop: 3 }]}>
            {gunYaz(izinGunu.tarih)} izin günü sizin için uygun değilse yöneticinize iletin
          </Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 14, paddingBottom: 120 },

  haftaBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 14,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingVertical: 7,
  },
  ok: { paddingHorizontal: 14 },
  okYazi: { fontSize: 22, color: renk.metin },
  haftaYazi: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800", color: renk.metin },

  seg: {
    flexDirection: "row",
    backgroundColor: renk.beyaz,
    borderRadius: 13,
    padding: 3,
    borderWidth: 1,
    borderColor: renk.cizgi,
    marginHorizontal: 14,
    marginTop: 10,
  },
  segDugme: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  segSecili: { backgroundColor: renk.zemin },
  segYazi: { fontSize: 12.5, fontWeight: "700", color: renk.pasif },

  ozet: { flexDirection: "row", gap: 6, marginBottom: 10 },
  ozetKutu: {
    flex: 1,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingVertical: 9,
    alignItems: "center",
  },
  ozetSayi: { fontSize: 19, fontWeight: "800" },
  ozetAd: { fontSize: 10, fontWeight: "700", color: renk.pasif },

  uyari: { borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, backgroundColor: renk.beyaz, padding: 12, marginBottom: 10 },
  uyariBaslik: { fontSize: 14, fontWeight: "800", marginBottom: 3 },
  uyariYazi: { fontSize: 12.5, lineHeight: 18, color: renk.pasif },

  kucukDugme: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: "center",
    backgroundColor: renk.beyaz,
  },
  kucukDugmeYazi: { fontSize: 12.5, fontWeight: "800", color: renk.metin, textAlign: "center" },

  kart: { backgroundColor: renk.beyaz, borderRadius: 16, borderWidth: 1, borderColor: renk.cizgi, padding: 12, marginBottom: 10 },
  kisiUst: { flexDirection: "row", alignItems: "center", gap: 9 },
  subeKart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 14,
    marginBottom: 10,
  },
  subeOk: { fontSize: 22, color: renk.pasif },
  subeGeri: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 10 },
  subeGeriYazi: { fontSize: 14, fontWeight: "800", color: renk.yesilKoyu },
  subeGeriAd: { flex: 1, fontSize: 16, fontWeight: "800", color: renk.metin },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: renk.yesilAcik, alignItems: "center", justifyContent: "center" },
  avatarYazi: { fontSize: 12, fontWeight: "800", color: renk.yesilKoyu },
  kisiAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  kisiPoz: { fontSize: 11.5, color: renk.pasif },
  rozet: { borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3 },
  rozetYazi: { fontSize: 10.5, fontWeight: "800" },

  hafta: { flexDirection: "row", gap: 3, marginTop: 10 },
  gunSarmal: { flex: 1 },
  gunAd: { fontSize: 9.5, fontWeight: "800", color: renk.pasif, textAlign: "center", marginBottom: 3 },
  gunSayi: { fontSize: 16, fontWeight: "800", color: renk.metin },
  hucre: { borderRadius: 9, minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  hucreBos: { backgroundColor: "#fafbf8", borderWidth: 1, borderColor: renk.cizgi, borderStyle: "dashed" },
  hucreAd: { fontSize: 9.5, fontWeight: "800", color: renk.pasif },

  redNot: { marginTop: 10, backgroundColor: "#fdecec", borderRadius: 10, padding: 10 },
  uyariCerceve: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: renk.turuncu,
  },
  izinSerit: {
    position: "absolute",
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 5,
    backgroundColor: "#9cc3ea",
    paddingVertical: 1,
  },
  izinSeritYazi: { fontSize: 7.5, fontWeight: "800", color: "#10324f", textAlign: "center" },
  celiskiNokta: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: renk.turuncu,
  },
  kopyala: {
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    marginBottom: 10,
    marginTop: 6,
  },
  kopyalaYazi: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  redNotYazi: { fontSize: 12.5, color: "#7a1a1a", lineHeight: 18 },

  satirAd: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  satirSaat: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },
  kucukRozet: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 },
  kucukRozetYazi: { fontSize: 11.5, fontWeight: "800" },

  gonder: { backgroundColor: renk.yesilKoyu, borderRadius: 16, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  gonderYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },
  redDugme: {
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#f3c2c2",
    marginTop: 6,
  },
  redYazi: { color: renk.kirmizi, fontSize: 15, fontWeight: "800" },

  altBilgi: { fontSize: 12, color: renk.pasif, textAlign: "center", lineHeight: 18, marginTop: 12, paddingHorizontal: 8 },
  bos: { fontSize: 13, color: renk.pasif, textAlign: "center", marginTop: 30 },
  etiket: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, marginBottom: 6 },

  perde: { flex: 1, backgroundColor: "rgba(20,24,18,0.45)", justifyContent: "flex-end" },
  sayfa: { backgroundColor: renk.beyaz, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, paddingBottom: 28 },
  tut: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#d6d9d2", alignSelf: "center", marginBottom: 12 },
  sayfaBaslik: { fontSize: 16.5, fontWeight: "800", color: renk.metin },
  sayfaAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 3, marginBottom: 12, lineHeight: 18 },

  secenek: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  secenekIkon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  secenekIkonYazi: { fontSize: 11, fontWeight: "800" },
  secenekAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  secenekSaat: { fontSize: 12, color: renk.pasif },

  redGunler: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  redGun: {
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: "center",
    minWidth: 52,
  },
  redGunSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  redGunYazi: { fontSize: 12.5, fontWeight: "800", color: renk.metin },
  redGunAlt: { fontSize: 10, color: renk.pasif, marginTop: 1 },

  girdi: {
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
    color: renk.metin,
  },
});

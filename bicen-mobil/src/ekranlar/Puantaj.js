/**
 * Puantaj Çizelgesi
 * ---------------------------------------------------------------------------
 * Yönetici ekibinin, bölge müdürü sorumlu olduğu mağazaların vardiya
 * giriş-çıkışını görüyor.
 *
 *  - Bölge müdürü: her mağaza bir kart — okutma oranı, okutmayan ve izinli
 *    sayısı. Oranı düşük mağaza en üstte. Karta dokununca o mağazanın
 *    personel listesi açılıyor.
 *  - Mağaza müdürü ve diğer yöneticiler: doğrudan ekibinin listesi.
 *
 * Listede önce okutmayanlar: yöneticinin aradığı onlar. Kişiye dokununca
 * izin ve son 30 günün puantajı açılıyor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { puantajKapsamAl, puantajSubelerAl, puantajListeAl } from "../api";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import KisiDetay, { DURUM, GunAyrinti } from "../bilesenler/KisiDetay";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const saat = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const oranRengi = (o) => (o >= 90 ? renk.yesilKoyu : o >= 70 ? "#d48806" : renk.kirmizi);

export default function Puantaj() {
  const bugun = new Date(new Date().toDateString());

  const [kapsam, setKapsam] = useState(null);
  const [tarih, setTarih] = useState(bugun);
  const [kartlar, setKartlar] = useState([]);
  const [sube, setSube] = useState(null);
  const [liste, setListe] = useState(null);
  const [suzgec, setSuzgec] = useState("hepsi");
  const [ara, setAra] = useState("");
  const [detay, setDetay] = useState(null);

  /* Satıra dokununca seçili günün okutmaları; oradan 30 günlük ayrıntıya
     geçilebiliyor. Yönetici önce "bugün kaça okutmuş"u arıyor. */
  const [gunDetay, setGunDetay] = useState(null);

  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  /* Kapsam bir kez alınıyor; bağımlılıkta durunca kapsam gelir gelmez
     liste ikinci kez isteniyordu. */
  const kapsamRef = useRef(null);

  const getir = useCallback(
    async (yenile = false) => {
      if (yenile) setYenileniyor(true);

      try {
        const k = kapsamRef.current ?? (await puantajKapsamAl());
        kapsamRef.current = k;
        setKapsam(k);

        if (k?.tur === "bolge" && !sube) {
          const c = await puantajSubelerAl(iso(tarih));
          setKartlar(c?.kartlar ?? []);
          setListe(null);
        } else if (k?.tur && k.tur !== "kendi") {
          setListe(await puantajListeAl(iso(tarih), sube));
        }

        setHata("");
      } catch (h) {
        setHata(h.message);
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [tarih, sube]
  );

  useEffect(() => {
    getir();
  }, [getir]);

  const gunDegis = (n) => {
    const d = new Date(tarih);
    d.setDate(d.getDate() + n);
    if (d > bugun) return;
    setTarih(d);
  };

  if (yukleniyor) return <Yukleniyor />;

  /* Yönetici olmayan personel: yalnızca kendi çizelgesi, son 30 gün */
  if (kapsam?.tur === "kendi" && kapsam.sicil) {
    return (
      <SafeAreaView style={s.tam} edges={["top"]}>
        <BarBaslik acik kendi ad="Puantaj Çizelgem" />
        <KisiDetay sicil={kapsam.sicil} gomulu />
      </SafeAreaView>
    );
  }

  const bolge = kapsam?.tur === "bolge";
  const satirlar = (liste?.satirlar ?? []).filter(
    (x) =>
      (suzgec === "hepsi" ||
        (suzgec === "okutmadi" && x.durum === "okutmadi") ||
        (suzgec === "okuttu" && x.durum === "okuttu") ||
        (suzgec === "izinli" && ["izinli", "haftalik", "tatil"].includes(x.durum))) &&
      (!ara.trim() || `${x.adSoyad} ${x.pozisyon}`.toLocaleLowerCase("tr").includes(ara.trim().toLocaleLowerCase("tr")))
  );

  const bugunMu = iso(tarih) === iso(bugun);

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik
        acik
        kendi
        ad={sube ? sube : "Puantaj Çizelgesi"}
        geri={
          sube
            ? () => {
                setSube(null);
                setSuzgec("hepsi");
              }
            : undefined
        }
      />

      {/* 1.9: yönetici kendi çizelgesini de görsün */}
      {kapsam?.sicil && !sube ? (
        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: renk.cizgi }}
          activeOpacity={0.8}
          onPress={() => setDetay(kapsam.sicil)}
        >
          <Text style={{ fontSize: 18 }}>🗓️</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: renk.metin, fontSize: 14.5 }}>Benim puantajım</Text>
            <Text style={{ color: renk.pasif, fontSize: 12 }}>Kendi giriş-çıkışlarınız, son 30 gün</Text>
          </View>
          <Text style={{ color: "#b9bfb3", fontSize: 20 }}>›</Text>
        </TouchableOpacity>
      ) : null}

      {/* ------------------------------------------------ tarih seçici */}
      <View style={s.tarihBar}>
        <TouchableOpacity style={s.ok} onPress={() => gunDegis(-1)} hitSlop={8}>
          <Text style={s.okYazi}>‹</Text>
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.tarihYazi}>
            {tarih.getDate()} {AYLAR[tarih.getMonth()]} {tarih.getFullYear()}
          </Text>
          <Text style={s.tarihAlt}>{bugunMu ? "Bugün" : GUNLER[tarih.getDay()]}</Text>
        </View>

        <TouchableOpacity style={[s.ok, bugunMu && { opacity: 0.3 }]} disabled={bugunMu} onPress={() => gunDegis(1)} hitSlop={8}>
          <Text style={s.okYazi}>›</Text>
        </TouchableOpacity>

        {!bugunMu && (
          <TouchableOpacity style={s.bugunDugme} onPress={() => setTarih(bugun)}>
            <Text style={s.bugunDugmeYazi}>Bugün</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        {hata ? <Hata metin={hata} /> : null}

        {!kapsam?.tur ? (
          <Text style={s.bos}>
            Sorumlu olduğunuz personel ya da mağaza görünmüyor. Kapsam İnsan Kaynakları'nın izin onay
            tablosundan geliyor; bölge müdürleri için sorumlu bölgelerin portalda atanmış olması gerekiyor.
          </Text>
        ) : bolge && !sube ? (
          /* ------------------------------------------ mağaza kartları */
          <>
            <BolgeOzet kartlar={kartlar} />

            {/* İK panelinde tanımlı ama personel listesinde bulunamayan
                şubeler: adı Mikro'daki iş grubu adından farklı yazılmış */}
            {(kapsam?.eslesmeyenler ?? []).length > 0 && (
              <View style={s.uyari}>
                <Text style={s.uyariYazi}>
                  <Text style={{ fontWeight: "800" }}>Bulunamayan şubeler: </Text>
                  {kapsam.eslesmeyenler.join(", ")}. İK panelindeki şube adı personel kartındaki şube
                  adıyla uyuşmuyor.
                </Text>
              </View>
            )}

            {kartlar.map((k) => (
              <TouchableOpacity key={k.sube} style={s.subeKart} activeOpacity={0.85} onPress={() => setSube(k.sube)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.subeAd}>{k.sube}</Text>
                  <Text style={s.subeAlt}>
                    {k.okuttu}/{k.toplam - k.izinli} okuttu
                    {k.izinli ? ` · ${k.izinli} izinli` : ""}
                  </Text>

                  <View style={s.cubuk}>
                    <View style={[s.cubukDolu, { width: `${k.oran}%`, backgroundColor: oranRengi(k.oran) }]} />
                  </View>
                </View>

                <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
                  <Text style={[s.oran, { color: oranRengi(k.oran) }]}>%{k.oran}</Text>
                  {k.okutmadi > 0 ? (
                    <View style={s.eksikRozet}>
                      <Text style={s.eksikYazi}>{k.okutmadi} okutmadı</Text>
                    </View>
                  ) : (
                    <Text style={s.tamYazi}>tam</Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </>
        ) : (
          /* ------------------------------------------ personel listesi */
          <>
            {liste?.ozet && (
              <View style={s.ozetKart}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.ozetOran, { color: oranRengi(liste.ozet.oran) }]}>%{liste.ozet.oran}</Text>
                  <Text style={s.ozetEt}>okutma oranı</Text>
                </View>
                {[
                  ["okuttu", liste.ozet.okuttu, DURUM.okuttu.renk],
                  ["okutmadı", liste.ozet.okutmadi, DURUM.okutmadi.renk],
                  ["izinli", liste.ozet.izinli, DURUM.izinli.renk],
                ].map(([a, d, r]) => (
                  <View key={a} style={s.ozetKutu}>
                    <Text style={[s.ozetSayi, { color: r }]}>{d}</Text>
                    <Text style={s.ozetEt}>{a}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={s.suzgecler}>
              {[
                ["hepsi", "Tümü"],
                ["okutmadi", "Okutmayan"],
                ["okuttu", "Okutan"],
                ["izinli", "İzinli"],
              ].map(([k, a]) => (
                <TouchableOpacity key={k} style={[s.cip, suzgec === k && s.cipSecili]} onPress={() => setSuzgec(k)}>
                  <Text style={[s.cipYazi, suzgec === k && { color: "#fff" }]}>{a}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={s.ara}
              value={ara}
              onChangeText={setAra}
              placeholder="Ad ya da pozisyon ara"
              placeholderTextColor="#a3a9a0"
            />

            {satirlar.length === 0 ? (
              <Text style={s.bos}>Bu süzgeçte personel yok.</Text>
            ) : (
              satirlar.map((x) => {
                const d = DURUM[x.durum] ?? DURUM.okutmadi;

                return (
                  <TouchableOpacity
                    key={x.sicil}
                    style={s.kisi}
                    activeOpacity={0.85}
                    onPress={() => setGunDetay({ sicil: x.sicil, durum: x.durum })}
                  >
                    <View style={[s.serit, { backgroundColor: d.renk }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.kisiAd}>{x.adSoyad}</Text>
                      <Text style={s.kisiAlt}>{x.pozisyon}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <View style={[s.durum, { backgroundColor: d.zemin }]}>
                        <Text style={[s.durumYazi, { color: d.renk }]}>
                          {x.izinTuru === "Devamsız" ? "Devamsız" : x.durum === "izinli" && x.izinTuru ? x.izinTuru : d.ad}
                        </Text>
                      </View>
                      {x.giris ? (
                        <Text style={s.saat}>
                          {saat(x.giris)} → {x.cikis ? saat(x.cikis) : "içeride"}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {gunDetay && (
        <GunAyrinti
          sicil={gunDetay.sicil}
          gun={{ tarih: iso(tarih), durum: gunDetay.durum }}
          kapat={() => setGunDetay(null)}
          tumunuAc={() => {
            setDetay(gunDetay.sicil);
            setGunDetay(null);
          }}
        />
      )}

      {detay && <KisiDetay sicil={detay} kapat={() => setDetay(null)} />}
    </SafeAreaView>
  );
}

/** Bölgenin toplamı: bütün mağazaların üstünde tek satır */
function BolgeOzet({ kartlar }) {
  const toplam = kartlar.reduce((a, k) => a + k.toplam - k.izinli, 0);
  const okuttu = kartlar.reduce((a, k) => a + k.okuttu, 0);
  const okutmadi = kartlar.reduce((a, k) => a + k.okutmadi, 0);
  const oran = toplam > 0 ? Math.round((100 * okuttu) / toplam) : 100;

  return (
    <View style={s.ozetKart}>
      <View style={{ flex: 1 }}>
        <Text style={[s.ozetOran, { color: oranRengi(oran) }]}>%{oran}</Text>
        <Text style={s.ozetEt}>bölge okutma oranı</Text>
      </View>
      <View style={s.ozetKutu}>
        <Text style={s.ozetSayi}>{kartlar.length}</Text>
        <Text style={s.ozetEt}>mağaza</Text>
      </View>
      <View style={s.ozetKutu}>
        <Text style={[s.ozetSayi, { color: DURUM.okutmadi.renk }]}>{okutmadi}</Text>
        <Text style={s.ozetEt}>okutmadı</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 120, gap: 10 },

  tarihBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  ok: { paddingHorizontal: 14, paddingVertical: 4 },
  okYazi: { fontSize: 24, color: renk.metin, fontWeight: "600" },
  tarihYazi: { fontSize: 15.5, fontWeight: "800", color: renk.metin },
  tarihAlt: { fontSize: 11.5, color: renk.pasif, fontWeight: "700" },
  bugunDugme: { backgroundColor: renk.yesilAcik, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginRight: 4 },
  bugunDugmeYazi: { fontSize: 12, fontWeight: "800", color: renk.yesilKoyu },

  bos: { fontSize: 13, color: renk.pasif, textAlign: "center", marginTop: 30, lineHeight: 19, paddingHorizontal: 10 },
  uyari: { backgroundColor: "#fff8e6", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#f5e3b3" },
  uyariYazi: { fontSize: 12.5, color: "#7a5a00", lineHeight: 18 },

  ozetKart: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  ozetOran: { fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  ozetKutu: { alignItems: "center", marginLeft: 16 },
  ozetSayi: { fontSize: 20, fontWeight: "800", color: renk.metin },
  ozetEt: { fontSize: 11, color: renk.pasif, fontWeight: "700" },

  subeKart: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  subeAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  subeAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },
  cubuk: { height: 6, borderRadius: 3, backgroundColor: "#eef0ea", marginTop: 8, overflow: "hidden" },
  cubukDolu: { height: 6, borderRadius: 3 },
  oran: { fontSize: 20, fontWeight: "800" },
  eksikRozet: { backgroundColor: "#fdecec", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginTop: 4 },
  eksikYazi: { fontSize: 11, fontWeight: "800", color: renk.kirmizi },
  tamYazi: { fontSize: 11, fontWeight: "800", color: renk.yesilKoyu, marginTop: 4 },

  suzgecler: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  cip: { borderWidth: 1.5, borderColor: renk.cizgi, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: renk.beyaz },
  cipSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  cipYazi: { fontSize: 12.5, fontWeight: "700", color: renk.metin },
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

  kisi: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  serit: { width: 4, height: 36, borderRadius: 2 },
  kisiAd: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  kisiAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  durum: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  durumYazi: { fontSize: 11, fontWeight: "800" },
  saat: { fontSize: 11.5, color: renk.pasif, marginTop: 3, fontWeight: "600" },
});

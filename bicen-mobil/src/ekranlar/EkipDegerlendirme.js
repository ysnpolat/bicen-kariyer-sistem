/**
 * Ekip değerlendirmesi · dönemsel (20.10.2026, 1.8)
 * ---------------------------------------------------------------------------
 * Mağaza müdürü (İK açarsa müdür yardımcısı da) 3 ayda bir şubesindeki
 * personeli değerlendirir. Sorular pozisyona göre sunucudan gelir:
 * 1–5 puanlı ve açık uçlu sorular, en sonda 1–10 genel puan. Kişinin
 * önceki dönemdeki puanı mor "önceki" rozetiyle gösterilir.
 *
 * Görünümler: liste → form → tamam. Gönderilen değerlendirme dönem
 * bitene kadar düzeltilebilir (listeden yeniden açılır).
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { ekipDegerlendirmeAl, ekipDegerlendirmeFormAl, ekipDegerlendirmeKaydet } from "../api";
import { renk, tarihYaz } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import Simge from "../bilesenler/Simge";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import { useKlavye, klavyePayi } from "../klavye";
import { BolgeSubeler, BolgeSube, BolgeKisi } from "./BolgeDegerlendirme";

const MOR = "#7c4dbe";
const MOR_ACIK = "#f3edfb";
const OLCEK_AD = ["", "Hiçbir zaman", "Nadiren", "Bazen", "Çoğunlukla", "Her zaman"];
const AVATAR = [
  ["#e8f4fb", "#1d8cc9"],
  ["#f2f9e8", "#5f8c10"],
  ["#fdeee8", "#e8481c"],
  ["#fff6dc", "#8a6500"],
  ["#f3edfb", "#7c4dbe"],
  ["#e6f6f3", "#0f766e"],
];

const basHarf = (ad) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

const puanRengi = (p) => (p >= 8 ? renk.yesilKoyu : p >= 6.5 ? renk.yesil : p >= 5 ? "#c8930a" : renk.turuncu);

function Fark({ simdi, once }) {
  if (simdi == null || once == null) return null;
  const f = simdi - once;
  const [z, r, t] =
    f > 0 ? [renk.yesilAcik, renk.yesilKoyu, `▲ ${f}`] : f < 0 ? ["#fdeee8", renk.turuncu, `▼ ${-f}`] : ["#f1f3ef", renk.pasif, "="];
  return (
    <View style={[s.fark, { backgroundColor: z }]}>
      <Text style={[s.farkYazi, { color: r }]}>{t}</Text>
    </View>
  );
}

/* ========================================================================== */

export default function EkipDegerlendirme({ route }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [secili, setSecili] = useState(route?.params?.kod ?? null);
  const [sonuc, setSonuc] = useState(null);
  /* Bölge müdürü (26.10.2026): "Şubelerim" sekmesi → şube → kişi */
  const [sekme, setSekme] = useState(null);
  const [bSube, setBSube] = useState(null);
  const [bKisi, setBKisi] = useState(null);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await ekipDegerlendirmeAl());
      setHata("");
    } catch (h) {
      setHata(h.message);
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { getir(); }, [getir]));

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  const kisiler = veri?.kisiler ?? [];
  const sira = kisiler.findIndex((x) => x.kod === secili);
  const sonraki = kisiler.find((x) => x.durum === "bekliyor" && x.kod !== secili);

  const bolgeVar = !!veri?.bolge;
  const ikiSekme = bolgeVar && !!veri?.yetkili;
  const aktifSekme = bolgeVar && (sekme === "bolge" || !veri?.yetkili) ? "bolge" : "ekip";

  const gorunum =
    aktifSekme === "bolge"
      ? bKisi ? "bKisi" : bSube ? "bSube" : "bolge"
      : sonuc ? "tamam" : secili ? "form" : "liste";
  const baslik =
    gorunum === "bKisi" ? bKisi.adSoyad
    : gorunum === "bSube" ? bSube
    : gorunum === "bolge" ? "Şubelerimin değerlendirmesi"
    : gorunum === "form" ? kisiler[sira]?.adSoyad ?? "Değerlendirme"
    : gorunum === "tamam" ? "Gönderildi" : "Ekibini değerlendir";
  const geriVar = !(gorunum === "liste" || gorunum === "bolge");

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <View style={s.bar}>
        <BarBaslik
          ad={baslik}
          geri={
            !geriVar
              ? undefined
              : () => {
                  if (gorunum === "bKisi") return setBKisi(null);
                  if (gorunum === "bSube") return setBSube(null);
                  setSecili(null);
                  setSonuc(null);
                }
          }
        />
      </View>

      {ikiSekme && (gorunum === "liste" || gorunum === "bolge") ? (
        <View style={s.sekmeler}>
          {[
            ["ekip", "Değerlendirmelerim"],
            ["bolge", "Şubelerim"],
          ].map(([k, ad]) => (
            <TouchableOpacity key={k} style={[s.sekme, aktifSekme === k && s.sekmeSecili]} onPress={() => setSekme(k)}>
              <Text style={[s.sekmeYazi, aktifSekme === k && s.sekmeYaziSecili]}>{ad}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {gorunum === "bolge" && <BolgeSubeler sec={setBSube} />}
      {gorunum === "bSube" && <BolgeSube sube={bSube} />}
      {gorunum === "bKisi" && <BolgeKisi kod={bKisi.kod} />}

      {gorunum === "liste" && (
        <Liste veri={veri} yenileniyor={yenileniyor} yenile={() => getir(true)} sec={setSecili} />
      )}
      {gorunum === "form" && (
        <Form
          key={secili}
          kod={secili}
          renkler={AVATAR[Math.max(0, sira) % AVATAR.length]}
          gonderildi={(r) => {
            setSonuc({ ...r, adSoyad: kisiler[sira]?.adSoyad });
            getir();
          }}
        />
      )}
      {gorunum === "tamam" && (
        <Tamam
          sonuc={sonuc}
          sonraki={sonraki}
          devam={() => {
            setSonuc(null);
            setSecili(sonraki?.kod ?? null);
          }}
          listeye={() => {
            setSonuc(null);
            setSecili(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Liste                                                                      */
/* ========================================================================== */

function Liste({ veri, yenileniyor, yenile, sec }) {
  const d = veri?.donem;
  const kisiler = veri?.kisiler ?? [];
  const bekleyen = kisiler.filter((x) => x.durum === "bekliyor");
  const biten = kisiler.filter((x) => x.durum === "tamam");
  const yuzde = kisiler.length ? Math.round((biten.length / kisiler.length) * 100) : 0;

  if (!veri?.yetkili)
    return (
      <View style={s.bos}>
        <Simge ad="kisi" renkli={renk.pasif} boyut={34} />
        <Text style={s.bosYazi}>Dönemsel değerlendirmeyi yöneticiler yapar.</Text>
      </View>
    );

  return (
    <ScrollView
      contentContainerStyle={s.govde}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor={renk.yesil} />}
    >
      {d ? (
        <View style={s.bant}>
          <View style={s.bantUst}>
            <Text style={s.bantEtiket}>{(d.ad ?? "").toLocaleUpperCase("tr")} DÖNEMİ</Text>
            <Text style={s.bantEtiket}>Son gün {tarihYaz(d.bitis)}</Text>
          </View>
          <Text style={s.bantBaslik}>
            {biten.length} / {kisiler.length} değerlendirildi
          </Text>
          <View style={s.ilerleme}>
            <View style={[s.ilerlemeDolu, { width: `${yuzde}%` }]} />
          </View>
          {d.kalanGun <= 3 && bekleyen.length > 0 ? (
            <Text style={s.bantUyari}>{d.kalanGun <= 0 ? "Bugün son gün" : `${d.kalanGun} gün kaldı`}</Text>
          ) : null}
        </View>
      ) : (
        <View style={[s.bant, { backgroundColor: "#5b6655" }]}>
          <Text style={s.bantEtiket}>DÖNEM KAPALI</Text>
          <Text style={s.bantBaslik}>Şu an açık değerlendirme dönemi yok</Text>
          {veri?.sonrakiDonem ? (
            <Text style={s.bantAlt}>Sonraki dönem {tarihYaz(veri.sonrakiDonem)} tarihinde açılır.</Text>
          ) : null}
        </View>
      )}

      {kisiler.length === 0 ? (
        <Text style={s.bosYazi}>Değerlendirilecek personel yok.</Text>
      ) : null}

      {bekleyen.length > 0 && d ? <Text style={s.grup}>Bekleyenler · {bekleyen.length}</Text> : null}
      {d &&
        bekleyen.map((k) => <KisiSatiri key={k.kod} k={k} i={kisiler.indexOf(k)} sec={sec} acik />)}

      {(biten.length > 0 || !d) && <Text style={s.grup}>{d ? `Değerlendirilenler · ${biten.length}` : "Ekibiniz"}</Text>}
      {(d ? biten : kisiler).map((k) => (
        <KisiSatiri key={k.kod} k={k} i={kisiler.indexOf(k)} sec={sec} acik={!!d} />
      ))}

      <Text style={s.dipNot}>Değerlendirmeler personelle paylaşılmaz; İK ve yöneticiler görür.</Text>
    </ScrollView>
  );
}

function KisiSatiri({ k, i, sec, acik }) {
  const [z, r] = AVATAR[i % AVATAR.length];
  return (
    <TouchableOpacity style={s.kisi} activeOpacity={acik ? 0.8 : 1} onPress={() => acik && sec(k.kod)}>
      <View style={[s.avatar, { backgroundColor: z }]}>
        <Text style={[s.avatarYazi, { color: r }]}>{basHarf(k.adSoyad)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.kisiAd} numberOfLines={1}>
          {k.adSoyad}
        </Text>
        <Text style={s.kisiAlt} numberOfLines={1}>
          {k.pozisyon}
          {k.kapsam && k.kapsam !== "sube" && k.sube ? ` · ${k.sube}` : ""}
          {k.onceki ? ` · önceki ${k.onceki.puan}/10` : ""}
        </Text>
      </View>
      {k.durum === "tamam" ? (
        <View style={{ alignItems: "flex-end", gap: 3 }}>
          <Text style={[s.kisiPuan, { color: puanRengi(k.puan) }]}>{k.puan}/10</Text>
          <Fark simdi={k.puan} once={k.onceki?.puan} />
        </View>
      ) : acik ? (
        <View style={s.rozetBekliyor}>
          <Text style={s.rozetBekliyorYazi}>Bekliyor</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/* ========================================================================== */
/* Form                                                                       */
/* ========================================================================== */

function Form({ kod, renkler, gonderildi }) {
  const klavye = useKlavye();
  const [form, setForm] = useState(null);
  const [hata, setHata] = useState("");
  const [puanlar, setPuanlar] = useState({});
  const [yanitlar, setYanitlar] = useState({});
  const [genel, setGenel] = useState(null);
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let iptal = false;
      ekipDegerlendirmeFormAl(kod)
        .then((f) => {
          if (iptal) return;
          setForm(f);
          const p = {}, y = {};
          (f.sorular ?? []).forEach((q) => {
            if (q.puan != null) p[q.id] = q.puan;
            if (q.yanit) y[q.id] = q.yanit;
          });
          setPuanlar(p);
          setYanitlar(y);
          setGenel(f.genelPuan ?? null);
          setAciklama(f.genelAciklama ?? "");
        })
        .catch((h) => !iptal && setHata(h.message));
      return () => {
        iptal = true;
      };
    }, [kod])
  );

  if (!form) return hata ? <Hata metin={hata} /> : <Yukleniyor />;

  const sorular = form.sorular ?? [];
  /* 1–5 etiketleri Yönetim'den (varsayılan: Hiçbir zaman … Her zaman) */
  const etiket = form.olcekEtiketleri?.length === 5 ? ["", ...form.olcekEtiketleri] : OLCEK_AD;
  const zorunlu = sorular.filter((q) => q.zorunlu);
  const dolu =
    zorunlu.filter((q) => (q.tur === "olcek" ? puanlar[q.id] != null : (yanitlar[q.id] ?? "").trim().length >= 3)).length +
    (genel ? 1 : 0) +
    (aciklama.trim().length >= 3 ? 1 : 0);
  const gerekli = zorunlu.length + 2;
  const tamam = dolu === gerekli && !!form.donem;
  const duzeltme = form.genelPuan != null;

  const gonder = async () => {
    setGonderiliyor(true);
    setHata("");
    try {
      const r = await ekipDegerlendirmeKaydet({
        personelKodu: form.kisi.kod,
        genelPuan: genel,
        genelAciklama: aciklama.trim(),
        cevaplar: sorular.map((q) => ({
          soruId: q.id,
          puan: q.tur === "olcek" ? puanlar[q.id] ?? null : null,
          metin: q.tur === "acik" ? (yanitlar[q.id] ?? "").trim() : null,
        })),
      });
      gonderildi(r);
    } catch (h) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const [z, r] = renkler;
  const k = form.kisi;

  return (
    <View style={{ flex: 1, paddingBottom: klavyePayi(klavye) }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.govde, { paddingBottom: klavye.acik ? 24 : 170 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.kart}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <View style={[s.avatar, { width: 50, height: 50, borderRadius: 15, backgroundColor: z }]}>
              <Text style={[s.avatarYazi, { color: r, fontSize: 17 }]}>{basHarf(k.adSoyad)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.kisiAd}>{k.adSoyad}</Text>
              <Text style={s.kisiAlt}>
                {k.pozisyon} · {k.sube}
                {k.girisTarihi ? ` · ${tarihYaz(k.girisTarihi)}'den beri` : ""}
              </Text>
            </View>
          </View>
          <View style={s.cipler}>
            {form.onceki ? (
              <>
                <View style={s.cip}>
                  <Text style={s.cipYazi}>
                    Önceki ({form.onceki.donemAdi}): <Text style={s.cipKalin}>{form.onceki.genelPuan}/10</Text>
                  </Text>
                </View>
                {form.onceki.soruOrt != null ? (
                  <View style={s.cip}>
                    <Text style={s.cipYazi}>
                      Soru ort.: <Text style={s.cipKalin}>{Number(form.onceki.soruOrt).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}/5</Text>
                    </Text>
                  </View>
                ) : null}
              </>
            ) : form.oncekiGizli ? null : (
              <View style={s.cip}>
                <Text style={s.cipYazi}>İlk dönemsel değerlendirmesi</Text>
              </View>
            )}
          </View>
          {duzeltme ? <Text style={s.duzeltme}>Bu dönem değerlendirildi; değiştirip yeniden gönderebilirsiniz.</Text> : null}
          {!form.donem ? <Text style={s.duzeltme}>Dönem kapalı; değerlendirme gönderilemez.</Text> : null}
        </View>

        {sorular.map((q) =>
          q.tur === "olcek" ? (
            <View key={q.id} style={s.kart}>
              <Text style={s.soru}>{q.metin}</Text>
              <View style={s.olcek}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const sec = puanlar[q.id] === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[s.olcekDugme, sec && s.olcekSecili]}
                      activeOpacity={0.8}
                      onPress={() => setPuanlar((p) => ({ ...p, [q.id]: n }))}
                    >
                      <Text style={[s.olcekYazi, sec && { color: "#fff" }]}>{n}</Text>
                      {q.oncekiPuan === n ? (
                        <View style={s.oncekiRozet}>
                          <Text style={s.oncekiRozetYazi}>önceki</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.olcekEtiket}>
                <Text style={s.olcekEtiketYazi}>{etiket[1]}</Text>
                <Text style={[s.secimYazi]}>{puanlar[q.id] ? etiket[puanlar[q.id]] : ""}</Text>
                <Text style={s.olcekEtiketYazi}>{etiket[5]}</Text>
              </View>
            </View>
          ) : (
            <View key={q.id} style={s.kart}>
              <Text style={s.soru}>
                {q.metin}
                {!q.zorunlu ? <Text style={s.istege}> · isteğe bağlı</Text> : null}
              </Text>
              {q.oncekiMetin ? (
                <View style={s.oncekiNot}>
                  <Text style={s.oncekiNotYazi}>
                    <Text style={{ fontWeight: "800" }}>Önceki: </Text>
                    {q.oncekiMetin}
                  </Text>
                </View>
              ) : null}
              <TextInput
                style={s.metinAlani}
                multiline
                value={yanitlar[q.id] ?? ""}
                onChangeText={(t) => setYanitlar((y) => ({ ...y, [q.id]: t.slice(0, 1000) }))}
                placeholder="Kısa yazabilirsiniz"
                placeholderTextColor="#a3a9a0"
                textAlignVertical="top"
              />
            </View>
          )
        )}

        <View style={[s.kart, { borderColor: "#f1dfa7", backgroundColor: "#fffdf6" }]}>
          <Text style={s.soru}>Genel değerlendirme puanı</Text>
          <Text style={s.soruAlt}>1 en düşük · 10 en yüksek</Text>
          <View style={s.onluk}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
              const sec = genel === n;
              return (
                <TouchableOpacity
                  key={n}
                  style={[s.onlukDugme, sec && { backgroundColor: puanRengi(n), borderColor: puanRengi(n) }]}
                  activeOpacity={0.8}
                  onPress={() => setGenel(n)}
                >
                  <Text style={[s.onlukYazi, sec && { color: "#fff" }]}>{n}</Text>
                  {form.onceki?.genelPuan === n ? (
                    <View style={[s.oncekiRozet, { right: -3, top: -8 }]}>
                      <Text style={[s.oncekiRozetYazi, { fontSize: 8 }]}>önceki</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[s.soru, { marginTop: 4 }]}>
            Puanın açıklaması <Text style={{ color: renk.turuncu }}>*</Text>
          </Text>
          {form.onceki?.genelAciklama ? (
            <View style={s.oncekiNot}>
              <Text style={s.oncekiNotYazi}>
                <Text style={{ fontWeight: "800" }}>Önceki: </Text>
                {form.onceki.genelAciklama}
              </Text>
            </View>
          ) : null}
          <TextInput
            style={[s.metinAlani, { backgroundColor: "#fff" }]}
            multiline
            value={aciklama}
            onChangeText={(t) => setAciklama(t.slice(0, 1000))}
            placeholder="Bu puanı neden verdiniz? Kısaca açıklayınız (zorunlu)"
            placeholderTextColor="#a3a9a0"
            textAlignVertical="top"
          />
        </View>

        {hata ? <Text style={s.hata}>{hata}</Text> : null}
      </ScrollView>

      <View style={klavye.acik ? s.altCubukKlavye : [s.altCubuk, { bottom: 88 }]}>
        <TouchableOpacity
          style={[s.anaDugme, { backgroundColor: tamam ? renk.yesil : "#c9cfc4" }]}
          activeOpacity={0.85}
          disabled={!tamam || gonderiliyor}
          onPress={gonder}
        >
          {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Simge ad="onay" renkli="#fff" boyut={18} />}
          <Text style={s.anaDugmeYazi}>
            {duzeltme ? "Güncelle" : "Değerlendirmeyi gönder"} · {dolu}/{gerekli}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ========================================================================== */
/* Tamam                                                                      */
/* ========================================================================== */

function Tamam({ sonuc, sonraki, devam, listeye }) {
  return (
    <ScrollView contentContainerStyle={[s.govde, { alignItems: "center", paddingTop: 40 }]}>
      <View style={s.tamamIkon}>
        <Simge ad="onay" renkli="#fff" boyut={40} />
      </View>
      <Text style={s.tamamBaslik}>{sonuc?.adSoyad} değerlendirildi</Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 }}>
        <Text style={s.tamamMetin}>
          Genel puan <Text style={{ fontWeight: "900", color: renk.metin }}>{sonuc?.genelPuan}/10</Text>
          {sonuc?.onceki ? ` · ${sonuc.onceki.donemAdi}: ${sonuc.onceki.genelPuan}/10` : ""}
        </Text>
        <Fark simdi={sonuc?.genelPuan} once={sonuc?.onceki?.genelPuan} />
      </View>
      {sonuc?.bitis ? <Text style={[s.tamamMetin, { fontSize: 12.5 }]}>{tarihYaz(sonuc.bitis)} tarihine kadar düzeltebilirsiniz.</Text> : null}

      {sonraki ? (
        <TouchableOpacity style={[s.anaDugme, { alignSelf: "stretch", marginTop: 26 }]} onPress={devam}>
          <Text style={s.anaDugmeYazi}>Sıradaki: {sonraki.adSoyad}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[s.kart, { alignSelf: "stretch", marginTop: 26, alignItems: "center" }]}>
          <Text style={[s.soru, { textAlign: "center" }]}>Ekibinizin tamamı değerlendirildi 🎉</Text>
        </View>
      )}
      <TouchableOpacity style={s.ikincilDugme} onPress={listeye}>
        <Text style={s.ikincilDugmeYazi}>Listeye dön</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  sekmeler: { flexDirection: "row", gap: 4, margin: 14, marginBottom: 0, backgroundColor: "#e9ede4", borderRadius: 13, padding: 4 },
  sekme: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  sekmeSecili: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  sekmeYazi: { fontSize: 13.5, fontWeight: "700", color: renk.pasif },
  sekmeYaziSecili: { color: renk.yesilKoyu, fontWeight: "800" },
  bar: { backgroundColor: renk.yesil, paddingHorizontal: 20, paddingVertical: 14 },
  govde: { padding: 14, paddingBottom: 120, gap: 10 },

  bant: { backgroundColor: "#3d5e12", borderRadius: 18, padding: 16, gap: 8, marginBottom: 4 },
  bantUst: { flexDirection: "row", justifyContent: "space-between" },
  bantEtiket: { color: "#d9ecb8", fontSize: 11.5, fontWeight: "800", letterSpacing: 0.6 },
  bantBaslik: { color: "#fff", fontSize: 18, fontWeight: "800" },
  bantAlt: { color: "#e3ead9", fontSize: 13 },
  bantUyari: { color: "#ffd8c7", fontSize: 12.5, fontWeight: "800" },
  ilerleme: { height: 8, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  ilerlemeDolu: { height: "100%", borderRadius: 99, backgroundColor: "#d7f59c" },

  grup: { fontSize: 12, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 6, marginLeft: 2 },

  kisi: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef0ea",
  },
  avatar: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avatarYazi: { fontWeight: "800", fontSize: 14 },
  kisiAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  kisiAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },
  kisiPuan: { fontSize: 16, fontWeight: "900" },
  rozetBekliyor: { backgroundColor: "#fdeee8", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  rozetBekliyorYazi: { color: renk.turuncu, fontSize: 11.5, fontWeight: "800" },
  fark: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  farkYazi: { fontSize: 11.5, fontWeight: "800" },

  kart: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#eef0ea", gap: 10 },
  cipler: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cip: { backgroundColor: renk.zemin, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 },
  cipYazi: { fontSize: 12, color: "#475467" },
  cipKalin: { fontWeight: "800", color: renk.metin },
  duzeltme: { fontSize: 12.5, color: renk.yesilKoyu, fontWeight: "700" },

  soru: { fontSize: 14.5, fontWeight: "800", color: renk.metin, lineHeight: 20 },
  soruAlt: { fontSize: 12, color: renk.pasif, marginTop: -6 },
  istege: { fontSize: 12, fontWeight: "500", color: renk.pasif },
  olcek: { flexDirection: "row", gap: 7 },
  olcekDugme: {
    flex: 1,
    height: 48,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    backgroundColor: "#fafbf8",
    alignItems: "center",
    justifyContent: "center",
  },
  olcekSecili: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  olcekYazi: { fontSize: 17, fontWeight: "800", color: renk.metin },
  olcekEtiket: { flexDirection: "row", justifyContent: "space-between", marginTop: -4 },
  olcekEtiketYazi: { fontSize: 11, color: renk.pasif },
  secimYazi: { fontSize: 12, fontWeight: "800", color: renk.yesilKoyu },
  oncekiRozet: { position: "absolute", top: -8, right: -4, backgroundColor: MOR, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 },
  oncekiRozetYazi: { color: "#fff", fontSize: 9, fontWeight: "800" },
  oncekiNot: { backgroundColor: MOR_ACIK, borderRadius: 10, padding: 9 },
  oncekiNotYazi: { color: MOR, fontSize: 12.5, lineHeight: 18 },
  metinAlani: {
    minHeight: 80,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 11,
    fontSize: 14,
    color: renk.metin,
    backgroundColor: "#fafbf8",
  },
  onluk: { flexDirection: "row", gap: 4 },
  onlukDugme: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    backgroundColor: "#fafbf8",
    alignItems: "center",
    justifyContent: "center",
  },
  onlukYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },
  hata: { color: renk.kirmizi, fontWeight: "700", textAlign: "center", marginTop: 4 },

  altCubuk: { position: "absolute", left: 0, right: 0, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  altCubukKlavye: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: renk.zemin, borderTopWidth: 1, borderTopColor: renk.cizgi },
  anaDugme: {
    height: 52,
    borderRadius: 15,
    backgroundColor: renk.yesil,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  anaDugmeYazi: { color: "#fff", fontSize: 15.5, fontWeight: "800" },
  ikincilDugme: { marginTop: 10, padding: 12 },
  ikincilDugmeYazi: { color: renk.pasif, fontWeight: "700" },

  tamamIkon: { width: 80, height: 80, borderRadius: 40, backgroundColor: renk.yesil, alignItems: "center", justifyContent: "center" },
  tamamBaslik: { fontSize: 19, fontWeight: "900", color: renk.metin, marginTop: 16, textAlign: "center" },
  tamamMetin: { fontSize: 14, color: renk.pasif, textAlign: "center", marginTop: 4 },

  bos: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  bosYazi: { color: renk.pasif, textAlign: "center", fontSize: 14 },
  dipNot: { color: renk.pasif, fontSize: 12, textAlign: "center", marginTop: 10 },
});

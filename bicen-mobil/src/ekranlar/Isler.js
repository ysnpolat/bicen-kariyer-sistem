/**
 * İşlerim
 * ---------------------------------------------------------------------------
 * Personele atanan iş emirleri. Diğer menüsünden açılır.
 *
 * Emir açıldığında "gördüm" olarak işaretlenir; bitirirken açıklama zorunlu,
 * çünkü açıklama işi atayan kişiye bildirim ve e-posta olarak gidiyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import {
  islerimAl,
  isEmriGordum,
  isEmriBitir,
  isEmriDoldur,
  isAtanabileceklerAl,
  isEmriAta,
} from "../api";
import IsIcerik, { ilerlemeHesapla } from "../bilesenler/IsIcerik";
import { renk } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";

/** Gün farkını okunur yazar */
const sonTarihMetni = (tarih) => {
  if (!tarih) return null;

  const gun = Math.ceil(
    (new Date(tarih).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86400000
  );

  if (gun < 0) return { metin: `${-gun} gün gecikti`, gecikti: true };
  if (gun === 0) return { metin: "Bugün son gün", gecikti: true };
  if (gun === 1) return { metin: "Yarın son gün", gecikti: false };

  return { metin: `${gun} gün kaldı`, gecikti: false };
};

export default function Isler({ navigation }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [acilan, setAcilan] = useState(null);
  const [sonuc, setSonuc] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [gecmis, setGecmis] = useState(false);

  /* İş atama: mağaza müdürü ve şefler tezgâhın başındayken iş
     verebilmeli. Paneli açmak için ofise gitmek, işin hiç
     kaydedilmemesine yol açıyordu. */
  const [atamaYetkisi, setAtamaYetkisi] = useState(false);
  const [atamaSebebi, setAtamaSebebi] = useState("");
  const [kisiler, setKisiler] = useState([]);
  const [atamaAcik, setAtamaAcik] = useState(false);

  useFocusEffect(
    useCallback(() => {
      /* Yetki sunucudan: ünvan eşleşmesini istemcide yapmak, ünvan adı
         değiştiğinde sessizce bozuluyordu. */
      isAtanabileceklerAl()
        .then((c) => {
          setAtamaYetkisi(!!c?.yetki);
          setAtamaSebebi(c?.sebep ?? "");
          setKisiler(c?.kisiler ?? []);
        })
        .catch(() => setAtamaYetkisi(false));
    }, [])
  );

  const getir = useCallback(
    async (yenile = false) => {
      if (yenile) setYenileniyor(true);

      try {
        setVeri(await islerimAl(gecmis));
        setHata("");
      } catch (e) {
        setHata(e?.message ?? "İş emirleri alınamadı.");
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [gecmis]
  );

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  /** Emri açar ve görüldü olarak işaretler */
  const ac = async (emir) => {
    setAcilan(acilan === emir.id ? null : emir.id);
    setSonuc("");

    if (!emir.goruldu) {
      try {
        await isEmriGordum(emir.id);
        await getir();
      } catch {
        /* İşaretleme başarısızsa emir yine açılır; kritik değil. */
      }
    }
  };

  /* Açık işin çizelge kaydetme işlevi: bitirmeden önce çağrılıyor. */
  const cizelgeRef = useRef(null);

  const bitir = async (emir) => {
    const metin = sonuc.trim();

    if (metin.length === 0) {
      Alert.alert("Açıklama gerekli", "Yaptığınız işi kısaca yazınız.");
      return;
    }

    setKaydediliyor(true);

    try {
      /* Çizelge önce kaydediliyor: personel maddeleri işaretleyip
         doğrudan "işi bitir" diyordu ve ayrıca kaydetmediği için
         işaretlemeler kayboluyordu. */
      if (cizelgeRef.current) await cizelgeRef.current();

      await isEmriBitir(emir.id, metin);

      setAcilan(null);
      setSonuc("");
      await getir();

      Alert.alert("Tamamlandı", "İşi atayan kişiye bildirim gönderildi.");
    } catch (e) {
      Alert.alert("Bitirilemedi", e?.message ?? "İşlem tamamlanamadı.");
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

  const liste = veri?.liste ?? [];

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
          />
        }
      >
        <View style={s.baslikSatir}>
          <TouchableOpacity
            style={s.geri}
            activeOpacity={0.65}
            onPress={() => navigation.goBack()}
          >
            <Simge ad="ok" renkli={renk.pasif} boyut={18} />
          </TouchableOpacity>

          <Text style={s.baslik}>İşlerim</Text>
        </View>

        {hata ? <Hata metin={hata} /> : null}

        {/* Yetki yoksa sebebi küçük bir notla: "düğme neden yok" sorusu
            bunsuz cevaplanamıyordu ve her seferinde sunucu günlüğüne
            bakmak gerekiyordu. Yalnızca sebep geldiğinde görünüyor;
            sıradan personel için not çıkmıyor. */}
        {!atamaYetkisi && atamaSebebi ? (
          <Text style={s.yetkiNotu}>{atamaSebebi}</Text>
        ) : null}

        {atamaYetkisi ? (
          <TouchableOpacity
            style={s.ataDugme}
            activeOpacity={0.85}
            onPress={() => setAtamaAcik(true)}
          >
            <Simge ad="liste" boyut={16} renkli={renk.beyaz} />
            <Text style={s.ataYazi}>Yeni iş ata</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={s.gecmisDugme}
          activeOpacity={0.7}
          onPress={() => setGecmis((o) => !o)}
        >
          <Text style={s.gecmisYazi}>
            {gecmis ? "Yalnızca açık işler" : "Biten işleri de göster"}
          </Text>
        </TouchableOpacity>

        {liste.length === 0 && !hata ? (
          <Bilgi>
            {gecmis
              ? "Kayıtlı iş emriniz bulunmuyor."
              : "Bekleyen iş emriniz yok."}
          </Bilgi>
        ) : null}

        {liste.map((emir) => {
          const acikMi = acilan === emir.id;
          const bitti = emir.durum === "Bitti";
          const sure = sonTarihMetni(emir.sonTarih);

          return (
            <View key={emir.id} style={s.kart}>
              <TouchableOpacity activeOpacity={0.75} onPress={() => ac(emir)}>
                <View style={s.kartUst}>
                  <Text style={s.isBaslik}>{emir.baslik}</Text>

                  <View style={s.rozetler}>
                    {emir.oncelik === "Acil" && !bitti ? (
                      <Rozet metin="Acil" tur="turuncu" />
                    ) : null}

                    {!emir.goruldu ? <Rozet metin="Yeni" tur="yesil" /> : null}
                  </View>
                </View>

                <Text style={s.altBilgi}>
                  {emir.atayanAd}
                  {emir.kaynakBaslik ? ` · ${emir.kaynakBaslik}` : ""}
                </Text>

                {sure && !bitti ? (
                  <Text style={[s.sure, sure.gecikti && s.sureGecikti]}>
                    {sure.metin}
                  </Text>
                ) : null}

                {bitti ? <Text style={s.bittiYazi}>Tamamlandı</Text> : null}
              </TouchableOpacity>

              {acikMi ? (
                <View style={s.ayrinti}>
                  {emir.aciklama ? (
                    <Text style={s.aciklama}>{emir.aciklama}</Text>
                  ) : null}

                  {/* Panelde kurulan çizelge: kontrol listesi, tablo ve
                      biçimli metin. Kilitli hücreler salt okunur. */}
                  <IcerikBolumu
                    emir={emir}
                    bitti={bitti}
                    tazele={getir}
                    kaydetKaydi={(f) => (cizelgeRef.current = f)}
                  />

                  {bitti ? (
                    emir.sonuc ? (
                      <>
                        <Text style={s.etiket}>Yaptığınız açıklama</Text>
                        <Text style={s.aciklama}>{emir.sonuc}</Text>
                      </>
                    ) : null
                  ) : (
                    <>
                      <Text style={s.etiket}>Yaptığınız işi açıklayınız</Text>

                      <TextInput
                        style={s.giris}
                        value={sonuc}
                        onChangeText={setSonuc}
                        multiline
                        placeholder="Ne yapıldı, sonuç ne oldu"
                        placeholderTextColor="#c8ccc4"
                      />

                      <Text style={s.not}>
                        Bu açıklama işi atayan kişiye iletilir.
                      </Text>

                      <TouchableOpacity
                        style={[s.dugme, kaydediliyor && s.soluk]}
                        activeOpacity={0.8}
                        disabled={kaydediliyor}
                        onPress={() => bitir(emir)}
                      >
                        <Text style={s.dugmeYazi}>
                          {kaydediliyor ? "Gönderiliyor…" : "İşi bitir"}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {atamaAcik ? (
        <AtamaFormu
          kisiler={kisiler}
          kapat={() => setAtamaAcik(false)}
          atandi={() => {
            setAtamaAcik(false);
            getir();
          }}
        />
      ) : null}

    </SafeAreaView>
  );
}

/* ========================================================================== */

/**
 * Mobilden iş atama.
 *
 * Panelde olduğu kadar zengin değil: başlık, kişi, öncelik, açıklama ve
 * isteğe bağlı bir kontrol listesi. Telefonda tablo kurdurmak, tek elle
 * kullanılamayan bir ekran demekti; tablo gerektiren işler panelden
 * atanıyor.
 */
function AtamaFormu({ kisiler, kapat, atandi }) {
  const [baslik, setBaslik] = useState("");

  /* Kişi arama: yüzlerce personeli kaydırarak bulmak mümkün değildi.
     Ad, ünvan ya da şubeye göre süzüyor; seçili kişi süzgeç dışında
     kalsa da listede tutuluyor ki seçim kaybolmasın. */
  const [kisiAra, setKisiAra] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [kod, setKod] = useState("");
  const [oncelik, setOncelik] = useState("Normal");
  const [maddeler, setMaddeler] = useState([]);
  const [yeniMadde, setYeniMadde] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const gonder = async () => {
    if (!baslik.trim()) return Alert.alert("Eksik", "Başlık yazınız.");
    if (!kod) return Alert.alert("Eksik", "Kime atanacağını seçiniz.");

    setGonderiliyor(true);

    try {
      /* Maddeler panelle aynı blok yapısında gönderiliyor: aynı işi iki
         ayrı biçimde saklamak, panelde açıldığında çizelgenin
         görünmemesine yol açardı. */
      const icerik = maddeler.length
        ? JSON.stringify([
            {
              tip: "liste",
              id: `m${Date.now()}`,
              baslik: "Yapılacaklar",
              maddeler: maddeler.map((m, i) => ({ id: `s${i}`, metin: m })),
            },
          ])
        : null;

      await isEmriAta({
        baslik: baslik.trim(),
        aciklama: aciklama.trim() || null,
        oncelik,
        atananKod: kod,
        icerik,
      });

      Alert.alert("İş atandı", "İlgili kişiye bildirim gönderildi.");
      atandi();
    } catch (e) {
      Alert.alert("Atanamadı", e?.message ?? "İşlem tamamlanamadı.");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={kapat}>
      <View style={s.formPerde}>
        <View style={s.formKutu}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.formBaslik}>Yeni iş ata</Text>

            <Text style={s.etiket}>Başlık</Text>
            <TextInput
              style={s.giris}
              value={baslik}
              onChangeText={setBaslik}
              placeholder="Örn. Reyon düzeni ve tarih kontrolü"
              placeholderTextColor="#c8ccc4"
            />

            <Text style={s.etiket}>Kime</Text>

            <TextInput
              style={s.giris}
              value={kisiAra}
              onChangeText={setKisiAra}
              placeholder="Ad, ünvan ya da şube ile ara"
              placeholderTextColor="#c8ccc4"
              autoCorrect={false}
            />

            <View style={s.kisiler}>
              {kisiler
                .filter((x) => {
                  if (x.kod === kod) return true;

                  const a = kisiAra.trim().toLocaleLowerCase("tr");

                  if (!a) return true;

                  return `${x.ad ?? ""} ${x.pozisyon ?? ""} ${x.sube ?? ""}`
                    .toLocaleLowerCase("tr")
                    .includes(a);
                })
                .slice(0, 40)
                .map((x) => (
                <TouchableOpacity
                  key={x.kod}
                  style={[s.kisi, kod === x.kod && s.kisiSecili]}
                  activeOpacity={0.7}
                  onPress={() => setKod(x.kod)}
                >
                  <Text style={[s.kisiAd, kod === x.kod && s.kisiAdSecili]}>
                    {x.ad}
                  </Text>
                  {x.gorev ? <Text style={s.kisiGorev}>{x.gorev}</Text> : null}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.etiket}>Öncelik</Text>
            <View style={s.oncelikler}>
              {["Normal", "Acil"].map((x) => (
                <TouchableOpacity
                  key={x}
                  style={[s.oncelik, oncelik === x && s.oncelikSecili]}
                  activeOpacity={0.7}
                  onPress={() => setOncelik(x)}
                >
                  <Text
                    style={[s.oncelikYazi, oncelik === x && s.oncelikYaziSecili]}
                  >
                    {x}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.etiket}>Açıklama</Text>
            <TextInput
              style={[s.giris, { height: 80, textAlignVertical: "top" }]}
              value={aciklama}
              onChangeText={setAciklama}
              multiline
              placeholder="İşin ayrıntısı"
              placeholderTextColor="#c8ccc4"
            />

            <Text style={s.etiket}>Yapılacaklar (isteğe bağlı)</Text>

            {maddeler.map((m, i) => (
              <View key={i} style={s.maddeSatir}>
                <Text style={s.maddeMetin}>{m}</Text>

                <TouchableOpacity
                  onPress={() =>
                    setMaddeler(maddeler.filter((_, x) => x !== i))
                  }
                >
                  <Text style={s.maddeSil}>Sil</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={s.maddeEkle}>
              <TextInput
                style={[s.giris, { flex: 1 }]}
                value={yeniMadde}
                onChangeText={setYeniMadde}
                placeholder="Madde yazıp ekleyiniz"
                placeholderTextColor="#c8ccc4"
                onSubmitEditing={() => {
                  if (!yeniMadde.trim()) return;
                  setMaddeler([...maddeler, yeniMadde.trim()]);
                  setYeniMadde("");
                }}
              />

              <TouchableOpacity
                style={s.ekleDugme}
                onPress={() => {
                  if (!yeniMadde.trim()) return;
                  setMaddeler([...maddeler, yeniMadde.trim()]);
                  setYeniMadde("");
                }}
              >
                <Text style={s.ekleYazi}>Ekle</Text>
              </TouchableOpacity>
            </View>

            <View style={s.formDugmeler}>
              <TouchableOpacity
                style={[s.formDugme, s.formIkincil]}
                onPress={kapat}
                disabled={gonderiliyor}
              >
                <Text style={s.formIkincilYazi}>Vazgeç</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.formDugme, gonderiliyor && { opacity: 0.6 }]}
                onPress={gonder}
                disabled={gonderiliyor}
              >
                <Text style={s.kaydetYazi}>
                  {gonderiliyor ? "Gönderiliyor…" : "İşi ata"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ========================================================================== */

/**
 * İş içeriğini gösterir ve doldurtur.
 *
 * Doldurulan değerler sunucuya ayrı kaydediliyor; iş bitirme açıklamasıyla
 * karışmamalı — biri çizelgenin durumu, diğeri işin sonucu.
 */
function IcerikBolumu({ emir, bitti, tazele, kaydetKaydi }) {
  const coz = (metin, varsayilan) => {
    try {
      return metin ? JSON.parse(metin) : varsayilan;
    } catch {
      /* Bozuk içerik ekranı kilitlemesin */
      return varsayilan;
    }
  };

  const bloklar = useMemo(() => coz(emir.icerik, []), [emir.icerik]);

  const [doldurma, setDoldurma] = useState(() => coz(emir.doldurma, {}));
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [degisti, setDegisti] = useState(false);

  if (!bloklar.length) return null;

  const ilerleme = ilerlemeHesapla(bloklar, doldurma);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await isEmriDoldur(emir.id, doldurma, ilerleme ?? 0);
      setDegisti(false);
      tazele?.();
    } catch (e) {
      Alert.alert("Kaydedilemedi", e?.message ?? "Tekrar deneyiniz.");
    } finally {
      setKaydediliyor(false);
    }
  };

  /* Bitirme düğmesi çizelgeyi de kaydetsin diye üst bileşene veriliyor.
     Değişiklik yoksa boşuna istek atılmıyor. */
  useEffect(() => {
    kaydetKaydi?.(degisti ? kaydet : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [degisti, doldurma]);

  return (
    <View style={{ marginTop: 12, gap: 12 }}>
      {ilerleme !== null ? (
        <View>
          <View style={s.cubukAlt}>
            <View style={[s.cubukDolu, { width: `${ilerleme}%` }]} />
          </View>

          <Text style={s.cubukYazi}>{ilerleme}% tamamlandı</Text>
        </View>
      ) : null}

      <IsIcerik
        bloklar={bloklar}
        doldurma={doldurma}
        setDoldurma={(d) => {
          setDoldurma(d);
          setDegisti(true);
        }}
        /* Biten iş de düzenlenebiliyor: sonradan fark edilen bir eksik
           için işi yeniden açmak gerekiyordu. Değişiklikler işaretleniyor
           ki kontrol eden ne düzeltildiğini görsün. */
        duzenlenebilir
        bittiktenSonra={bitti}
      />

      {/* Kaydet düğmesi yalnızca değişiklik varken: her açılışta duran bir
          düğme, kaydedilmesi gereken bir şey olduğu izlenimi veriyordu. */}
      {degisti ? (
        <TouchableOpacity
          style={[s.kaydetDugme, kaydediliyor && { opacity: 0.6 }]}
          disabled={kaydediliyor}
          activeOpacity={0.8}
          onPress={kaydet}
        >
          <Text style={s.kaydetYazi}>
            {kaydediliyor ? "Kaydediliyor…" : "Çizelgeyi kaydet"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  yetkiNotu: {
    fontSize: 11.5,
    color: "#a3a9b0",
    textAlign: "center",
    marginBottom: 10,
    paddingHorizontal: 20,
  },

  ataDugme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: renk.yesil,
    paddingVertical: 13,
    borderRadius: 12,
    marginBottom: 12,
  },
  ataYazi: { fontSize: 15, fontWeight: "700", color: renk.beyaz },

  formPerde: {
    flex: 1,
    backgroundColor: "rgba(20, 24, 20, 0.45)",
    justifyContent: "flex-end",
  },
  formKutu: {
    backgroundColor: renk.beyaz,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 30,
    maxHeight: "88%",
  },
  formBaslik: { fontSize: 18, fontWeight: "700", color: renk.metin },
  etiket: {
    fontSize: 12.5,
    fontWeight: "700",
    color: renk.pasif,
    marginTop: 16,
    marginBottom: 7,
  },

  kisiler: { gap: 7 },
  kisi: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    padding: 11,
    backgroundColor: renk.beyaz,
  },
  kisiSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  kisiAd: { fontSize: 14, fontWeight: "600", color: renk.metin },
  kisiAdSecili: { color: renk.yesilKoyu },
  kisiGorev: { fontSize: 12, color: renk.pasif, marginTop: 2 },

  oncelikler: { flexDirection: "row", gap: 8 },
  oncelik: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: renk.cizgi,
    alignItems: "center",
  },
  oncelikSecili: { borderColor: renk.turuncu, backgroundColor: renk.turuncuAcik },
  oncelikYazi: { fontSize: 13.5, color: renk.metin },
  oncelikYaziSecili: { color: renk.turuncuKoyu, fontWeight: "700" },

  maddeSatir: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },
  maddeMetin: { flex: 1, fontSize: 13.5, color: renk.metin },
  maddeSil: { fontSize: 12.5, color: renk.kirmizi, fontWeight: "600" },

  maddeEkle: { flexDirection: "row", gap: 8, marginTop: 8 },
  ekleDugme: {
    paddingHorizontal: 16,
    justifyContent: "center",
    backgroundColor: renk.zemin,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  ekleYazi: { fontSize: 13.5, fontWeight: "600", color: renk.metin },

  formDugmeler: { flexDirection: "row", gap: 9, marginTop: 20 },
  formDugme: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: renk.yesil,
  },
  formIkincil: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  formIkincilYazi: { fontSize: 14.5, fontWeight: "700", color: renk.metin },

  cubukAlt: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "#eef0ec",
    overflow: "hidden",
  },
  cubukDolu: { height: 7, backgroundColor: renk.yesil },
  cubukYazi: { fontSize: 11.5, color: renk.pasif, marginTop: 5 },

  kaydetDugme: {
    backgroundColor: renk.yesil,
    paddingVertical: 12,
    borderRadius: 11,
    alignItems: "center",
  },
  kaydetYazi: { fontSize: 14.5, fontWeight: "700", color: renk.beyaz },

  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 110 },

  baslikSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },

  geri: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "180deg" }],
  },

  baslik: {
    fontSize: 26,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: -0.5,
  },

  gecmisDugme: { alignSelf: "flex-start", marginBottom: 12 },
  gecmisYazi: { fontSize: 12.5, fontWeight: "600", color: renk.yesilKoyu },

  kart: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 15,
    marginBottom: 11,
  },

  kartUst: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },

  isBaslik: { flex: 1, fontSize: 15.5, fontWeight: "700", color: renk.metin },
  rozetler: { flexDirection: "row", gap: 5 },

  altBilgi: { fontSize: 12.5, color: renk.pasif, marginTop: 4 },

  sure: { fontSize: 12, color: renk.pasif, marginTop: 6, fontWeight: "600" },
  sureGecikti: { color: renk.turuncu },

  bittiYazi: {
    fontSize: 12,
    color: renk.yesilKoyu,
    fontWeight: "700",
    marginTop: 6,
  },

  ayrinti: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },

  aciklama: { fontSize: 13.5, color: renk.metin, lineHeight: 20 },

  etiket: {
    fontSize: 11.5,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 6,
  },

  giris: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    minHeight: 88,
    textAlignVertical: "top",
    color: renk.metin,
    backgroundColor: "#fbfcfa",
  },

  not: { fontSize: 11.5, color: renk.pasif, marginTop: 8 },

  dugme: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 11,
    backgroundColor: renk.yesil,
    alignItems: "center",
  },

  dugmeYazi: { fontSize: 14, fontWeight: "700", color: "#fff" },
  soluk: { opacity: 0.6 },
});

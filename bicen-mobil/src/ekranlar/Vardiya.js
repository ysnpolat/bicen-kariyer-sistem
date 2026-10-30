/**
 * Vardiya
 * ---------------------------------------------------------------------------
 * Mağaza girişindeki karekod okutularak giriş çıkış kaydı düşer.
 *
 * Personel kendi telefonundan bir kod GÖSTERMEZ, şubedeki kodu OKUTUR.
 * Bunun sebebi: kişinin telefonundaki kod başkasına gönderilebilir ve
 * gelmeden giriş yapılmış görünür. Şubedeki kodu okutmak için orada
 * bulunmak gerekir; konum doğrulaması da bunu pekiştirir.
 */

import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran } from "../bilesenler/ModalAlani";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";

import { itirazlarimAl, itirazOlustur, vardiyaAl, vardiyaOkut } from "../api";
import Pencere from "../bilesenler/Pencere";
import { renk, saatYaz, tarihYaz } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Kart, Satir, Rozet, Bilgi, Yukleniyor } from "../bilesenler/Ortak";
import Takvim from "../bilesenler/Takvim";

/* Manuel giriş-çıkış sebebi (09.10.2026): sunucudaki kuralla aynı (en az iki
   kelime, 12 karakter, anlamlı harf). "." ile gönderiliyordu. */
const HAZIR_SEBEPLER = [
  "Telefonumun şarjı bitti",
  "İnternet bağlantım yoktu",
  "Karekod okunmadı",
  "Uygulama açılmadı",
  "Okutmayı unuttum",
  "Telefonum yanımda değildi",
];

const HARF = /[a-zA-ZçğıöşüÇĞİÖŞÜâîûÂÎÛ]/g;

const sebepYeterli = (v) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  const harfler = (t.match(HARF) ?? []).map((h) => h.toLocaleLowerCase("tr"));
  const kelime = t.split(" ").filter((k) => (k.match(HARF) ?? []).length >= 2).length;
  return t.length >= 12 && harfler.length >= 8 && kelime >= 2 && new Set(harfler).size >= 5;
};

export default function Vardiya() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kameraAcik, setKameraAcik] = useState(false);
  const [okutuluyor, setOkutuluyor] = useState(false);

  /* Vardiya düzeltme talebi */
  const [itirazlar, setItirazlar] = useState([]);
  const [itirazAcik, setItirazAcik] = useState(false);
  const [itirazTur, setItirazTur] = useState("Giriş");
  const [itirazTarih, setItirazTarih] = useState(new Date());
  const [itirazSaat, setItirazSaat] = useState("08:30");
  const [itirazSebep, setItirazSebep] = useState("");
  const [itirazGonderiliyor, setItirazGonderiliyor] = useState(false);
  const [takvimAcik, setTakvimAcik] = useState(false);

  const itirazGonder = async () => {
    if (!sebepYeterli(itirazSebep)) {
      Alert.alert("Açıklama gerekli", "Neden okutamadığınızı birkaç kelimeyle yazınız ya da hazır sebeplerden birini seçiniz.");
      return;
    }

    if (!/^\d{1,2}:\d{2}$/.test(itirazSaat)) {
      Alert.alert("Saat hatalı", "Saati 08:30 biçiminde giriniz.");
      return;
    }

    setItirazGonderiliyor(true);

    try {
      await itirazOlustur({
        /* Yerel tarih: toISOString UTC'ye çeviriyor ve takvimden seçilen
           gün (yerel gece yarısı) Türkiye saatinde bir önceki güne
           kayıyordu. */
        tarih: `${itirazTarih.getFullYear()}-${String(itirazTarih.getMonth() + 1).padStart(2, "0")}-${String(itirazTarih.getDate()).padStart(2, "0")}`,
        tur: itirazTur,
        saat: itirazSaat,
        sebep: itirazSebep.trim(),
      });

      Alert.alert(
        "Talebiniz yöneticinize iletildi",
        "Yöneticiniz saati kontrol edip onayladığında kaydınıza işlenecek."
      );

      setItirazAcik(false);
      setItirazSebep("");
      getir();
    } catch (h) {
      Alert.alert("Gönderilemedi", h.message);
    } finally {
      setItirazGonderiliyor(false);
    }
  };

  /* Konum ön ısıtma.

     Karekod okunduktan sonra konum istemek, bina içinde GPS'in ilk
     sabitlenmesini beklemek demekti ve personel on beş saniye ekrana
     bakıyordu. Ekran açılır açılmaz konum arka planda alınmaya başlıyor;
     okutma anında hazır oluyor.

     Sonuç ref'te tutuluyor: durum değişkeni olsaydı her güncellemede
     kamera yeniden çiziliyordu. */
  const konumRef = useRef(null);
  const konumZamaniRef = useRef(0);

  const konumIste = useCallback(async () => {
    try {
      const izin = await Location.requestForegroundPermissionsAsync();

      if (!izin.granted) return;

      /* Bilinen son konum anında geliyor; tazeyse yeterli. */
      const son = await Location.getLastKnownPositionAsync({ maxAge: 45000 });

      if (son) {
        konumRef.current = son;
        konumZamaniRef.current = Date.now();
      }

      /* Ardından taze ölçüm: kullanıcı okutana kadar tamamlanıyor. */
      const taze = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      konumRef.current = taze;
      konumZamaniRef.current = Date.now();
    } catch {
      /* Sessiz: okutma anında yeniden denenecek */
    }
  }, []);

  /* Kamera art arda tetiklendiği için kilit ref'te tutulur */
  const okumaKilidi = useRef(false);

  const [izin, izinIste] = useCameraPermissions();

  const getir = useCallback(async () => {
    try {
      const [v, it] = await Promise.all([
        vardiyaAl(),
        itirazlarimAl().catch(() => ({ kayitlar: [] })),
      ]);

      setVeri(v);
      setItirazlar(it.kayitlar ?? []);
    } catch (h) {
      Alert.alert("Hata", h.message);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  /* Vardiya ekranına gelinince karekod okuyucu kendiliğinden açılır:
     personel buraya zaten okutmak için giriyor, araya bir dokunuş
     koymanın faydası yok.

     Yalnızca ekrana ilk gelişte açılır. Okutma bitip kamera kapandıktan
     sonra tekrar açılmaz; kullanıcı kapattıysa kapalı kalır. */
  const ilkGirisRef = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (ilkGirisRef.current) {
        ilkGirisRef.current = false;
        kamerayiAc();
      }

      /* Ekrana her gelişte konum tazeleniyor */
      konumIste();

      /* Ekrandan çıkılınca kamera kapanır: arka planda açık kalması hem
         pil harcar hem gizlilik açısından doğru değil. */
      return () => setKameraAcik(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const kamerayiAc = async () => {
    if (!izin?.granted) {
      const sonuc = await izinIste();

      if (!sonuc.granted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Karekod okutmak için kamera iznine ihtiyaç var. Ayarlardan verebilirsiniz."
        );
        return;
      }
    }

    okumaKilidi.current = false;
    setKameraAcik(true);
  };

  /* Okutma sonucu uygulamanın kendi penceresinde gösteriliyor: personelin
     gördüğü tek onay bu ve hangi şubede, saat kaçta kaydedildiği tek
     bakışta okunmalı. */
  const [pencere, setPencere] = useState(null);

  const kodOkundu = async ({ data }) => {
    /* Durum değişkeni değil ref kullanılır: kamera saniyede birçok kez
       tetikleniyor ve setOkutuluyor(true) bir sonraki çizime kadar
       görünmüyor. Bu arada aynı kod üç dört kez gönderiliyordu. */
    if (okumaKilidi.current) return;

    okumaKilidi.current = true;

    setOkutuluyor(true);
    setKameraAcik(false);

    try {
      /* Konum zorunlu: karekod sabit olduğu için fotoğraflanıp
         paylaşılabiliyor ve konum denetimi olmadan uzaktan okutma
         mümkün oluyor. */
      let konum = null;

      try {
        const konumIzni = await Location.requestForegroundPermissionsAsync();

        if (!konumIzni.granted) {
          Alert.alert(
            "Konum izni gerekli",
            "Vardiya kaydının doğru şubede yapıldığını doğrulamak için konum izni gerekiyor. Telefon ayarlarından verebilirsiniz."
          );
          return;
        }

        /* Ekran açılırken alınan konum tazeyse doğrudan kullanılıyor;
           beklemenin sebebi buydu. */
        if (konumRef.current && Date.now() - konumZamaniRef.current < 60000) {
          konum = konumRef.current;
        } else {
          /* Taze değilse önce bilinen son konum deneniyor: anında
             geliyor ve çoğu durumda yeterli. */
          konum = await Location.getLastKnownPositionAsync({ maxAge: 60000 });

          if (!konum) {
            /* Yüksek doğruluk: dengeli kip binada 100 metreye kadar
               sapabiliyor ve sınıra yakın okutmalar reddediliyordu.

               Süre sınırı var: GPS sabitlenemezse okutma sonsuza kadar
               beklemek yerine hata veriyor. */
            konum = await Promise.race([
              Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              }),
              new Promise((_, reddet) =>
                setTimeout(() => reddet(new Error("konum zaman aşımı")), 12000)
              ),
            ]);
          }
        }
      } catch {
        Alert.alert(
          "Konum alınamadı",
          "Konum servisiniz kapalı olabilir. Açıp tekrar deneyiniz."
        );
        return;
      }

      const sonuc = await vardiyaOkut(data, konum);

      setPencere({
        tur: "basari",
        baslik: sonuc.tur === "Giriş" ? "Girişiniz kaydedildi" : "Çıkışınız kaydedildi",
        metin: "Kayıt vardiya listenize işlendi.",
        satirlar: [
          `Şube: ${sonuc.subeAdi}`,
          `Saat: ${saatYaz(sonuc.zaman)}`,
          `İşlem: ${sonuc.tur}`,
        ],
      });

      getir();
    } catch (h) {
      setPencere({
        tur: "hata",
        baslik: "Okutma başarısız",
        metin: h.message,
      });
    } finally {
      setOkutuluyor(false);

      /* Kilit kısa bir gecikmeyle açılır: kamera kapanırken son
         kareler hâlâ tetiklenebiliyor. */
      setTimeout(() => {
        okumaKilidi.current = false;
      }, 1500);
    }
  };

  /* Kamera tam ekran Modal içinde açılır. Sekme çubuğu ekranın üstünde
     durduğu ve akış içindeki görünüm tam yükseklik alamadığı için
     checklist ekranındaki desenin aynısı kullanılıyor. */
  const kameraPenceresi = (
    <Modal
      visible={kameraAcik}
      animationType="slide"
      onRequestClose={() => setKameraAcik(false)}
    >
      <View style={s.kameraTam}>
        {/* Kaplama kameranın ÇOCUĞU: kardeş olarak konduğunda mutlak
            konum kameranın gerçek yüksekliğine göre değil kapsayıcıya
            göre hesaplanıyor ve çerçeve aşağı kayıyordu. */}
        <CameraView
          style={s.kamera}
          facing="back"
          active={kameraAcik}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={kameraAcik ? kodOkundu : undefined}
        />

        {/* Kaplama kardeş olarak, açıkça mutlak konumda. Yeni mimaride
            kameranın çocukları çizilmiyor; kardeş olarak da spread ile
            verilen mutlak konum uygulanmayıp akışta yer kaplıyordu. */}
        <View style={s.kameraKaplama} pointerEvents="box-none">
          <View style={s.hedef} />
          <Text style={s.kameraYazi}>
            Mağaza girişindeki karekodu çerçeveye alınız
          </Text>

          <TouchableOpacity
            style={s.iptal}
            onPress={() => setKameraAcik(false)}
          >
            <Text style={s.iptalYazi}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );


  if (yukleniyor) return <Yukleniyor />;

  const b = veri?.bugun ?? {};

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <Pencere veri={pencere} kapat={() => setPencere(null)} />

      {kameraPenceresi}

      <View style={s.bar}>
        <BarBaslik ad="Vardiya" />
        <Text style={s.barSag}>{veri?.subeAdi ?? ""}</Text>
      </View>

      <ScrollView contentContainerStyle={s.govde}>
        {/* ------------------------------------------ okutma alanı */}
        <TouchableOpacity
          style={s.okutAlan}
          onPress={kamerayiAc}
          disabled={okutuluyor}
          activeOpacity={0.85}
        >
          {okutuluyor ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <>
              <View style={s.kareIkon}>
                <View style={[s.kose, s.solUst]} />
                <View style={[s.kose, s.sagUst]} />
                <View style={[s.kose, s.solAlt]} />
                <View style={[s.kose, s.sagAlt]} />
              </View>

              <Text style={s.okutBaslik}>
                {b.icerideMi ? "Çıkış için okutunuz" : "Giriş için okutunuz"}
              </Text>

              <Text style={s.okutAlt}>
                Mağaza girişindeki karekodu telefonunuza okutun.
                Kayıt yalnızca şubede bulunduğunuzda düşer.
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Bilgi>
          Karekod her şubede farklıdır. Okutma yalnızca şubenin 150 metre
          yakınından yapılabilir; uzaktan okutma kabul edilmez.
        </Bilgi>

        {/* -------------------------------------------------- bugün */}
        <Kart baslik="Bugün">
          <Satir
            ad="Giriş"
            alt={
              b.girisSaati
                ? `${veri?.subeAdi ?? ""}${b.konumDogrulandi ? " · konum doğrulandı" : ""}`
                : "bekleniyor"
            }
            sag={
              b.girisSaati ? (
                saatYaz(b.girisSaati)
              ) : (
                <Rozet metin="—" tur="gri" />
              )
            }
          />

          <Satir
            ad="Çıkış"
            alt={b.cikisSaati ? veri?.subeAdi ?? "" : "bekleniyor"}
            sag={
              b.cikisSaati ? saatYaz(b.cikisSaati) : <Rozet metin="—" tur="gri" />
            }
            sonMu
          />
        </Kart>

        {/* -------------------------------------------- bu hafta */}
        <Kart
          baslik="Bu hafta"
          stil={{ marginBottom: 11 }}
        >
          {(veri?.hafta ?? []).length === 0 ? (
            <Text style={s.bos}>Kayıt yok.</Text>
          ) : (
            veri.hafta.map((g, i, dizi) => (
              <Satir
                key={i}
                ad={g.gunAdi}
                alt={
                  g.izinli
                    ? "izinli"
                    : g.giris
                    ? `${saatYaz(g.giris)} → ${
                        g.cikis ? saatYaz(g.cikis) : "—"
                      }`
                    : "kayıt yok"
                }
                sag={
                  g.izinli ? (
                    <Rozet metin="izin" tur="turuncu" />
                  ) : (
                    g.sureMetni ?? "—"
                  )
                }
                sonMu={i === dizi.length - 1}
              />
            ))
          )}
        </Kart>
        {/* ------------------------------------------- itirazlarım */}
        {(itirazlar ?? []).length > 0 && (
          <Kart baslik="Manuel giriş-çıkış talepleriniz">
            {itirazlar.map((t, i, dizi) => (
              <Satir
                key={t.id}
                ad={`${tarihYaz(t.tarih)} · ${t.tur} ${t.saat}`}
                alt={
                  t.durum === "Reddedildi" && t.kararNotu
                    ? t.kararNotu
                    : t.sebep
                }
                sag={
                  <Rozet
                    metin={t.durum}
                    tur={
                      t.durum === "Onaylandı" ? "yesil"
                      : t.durum === "Reddedildi" ? "turuncu"
                      : "mavi"
                    }
                  />
                }
                sonMu={i === dizi.length - 1}
              />
            ))}
          </Kart>
        )}

        <TouchableOpacity
          style={s.itirazDugme}
          onPress={() => setItirazAcik(true)}
        >
          <Text style={s.itirazYazi}>Manuel giriş / çıkış</Text>
        </TouchableOpacity>

        <Bilgi>
          Karekodu okutamadıysanız (uygulamada sorun oldu) ya da okutmayı
          unuttuysanız giriş ya da çıkışınızı elle bildirebilirsiniz. Talep
          yöneticinize düşer; saati kontrol edip onayladığında kaydınıza
          işlenir. Yalnızca bugün ve dün için bildirilebilir.
        </Bilgi>
      </ScrollView>

      {/* ---------------------------------------- itiraz penceresi */}
      <Modal
        {...modalTamEkran}
        visible={itirazAcik}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setItirazAcik(false)}
      >
        <ModalAlani style={s.tam} edges={["top"]}>
          <View style={s.bar}>
            <Text style={s.barBaslik}>Manuel Giriş / Çıkış</Text>
            <TouchableOpacity onPress={() => setItirazAcik(false)}>
              <Text style={s.kapat}>Kapat</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.govde}>
            <Kart baslik="Hangi kayıt">
              <View style={s.turSatir}>
                {["Giriş", "Çıkış"].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[s.turDugme, itirazTur === t && s.turAktif]}
                    onPress={() => setItirazTur(t)}
                  >
                    <Text
                      style={[s.turYazi, itirazTur === t && s.turYaziAktif]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Kart>

            <Kart baslik="Tarih ve saat">
              <TouchableOpacity
                style={s.satirAlan}
                onPress={() => setTakvimAcik(true)}
              >
                <Text style={s.alanEtiket}>Tarih</Text>
                <Text style={s.alanDeger}>
                  {itirazTarih.toLocaleDateString("tr-TR")}
                </Text>
              </TouchableOpacity>

              <View style={[s.satirAlan, { borderBottomWidth: 0 }]}>
                <Text style={s.alanEtiket}>Saat</Text>
                <TextInput
                  style={s.saatAlan}
                  value={itirazSaat}
                  onChangeText={setItirazSaat}
                  placeholder="08:30"
                  maxLength={5}
                />
              </View>
            </Kart>

            <Kart baslik="Sebep">
              {/* Hazır sebep ya da en az iki kelimelik açıklama */}
              <View style={s.sebepCipler}>
                {HAZIR_SEBEPLER.map((x) => (
                  <TouchableOpacity
                    key={x}
                    style={[s.sebepCip, itirazSebep.startsWith(x) && s.sebepCipSecili]}
                    onPress={() => setItirazSebep(`${x}. `)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.sebepCipYazi, itirazSebep.startsWith(x) && { color: renk.beyaz }]}>{x}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={s.sebepAlan}
                multiline
                placeholder="Örn. Telefonumun şarjı bitti, karekodu okutamadım."
                placeholderTextColor="#9aa0a6"
                value={itirazSebep}
                onChangeText={setItirazSebep}
                maxLength={480}
              />
              <Text style={[s.sebepIpucu, sebepYeterli(itirazSebep) && { color: renk.yesilKoyu }]}>
                {sebepYeterli(itirazSebep)
                  ? "✓ Açıklama yeterli. İsterseniz ayrıntı ekleyin."
                  : "Hazır bir sebep seçin ya da en az iki kelimeyle açıklayın. Yöneticiniz bu açıklamaya göre onaylar."}
              </Text>
            </Kart>

            <TouchableOpacity
              style={[s.itirazDugme, (itirazGonderiliyor || !sebepYeterli(itirazSebep)) && { opacity: 0.5 }]}
              onPress={itirazGonder}
              disabled={itirazGonderiliyor}
            >
              <Text style={s.itirazYazi}>
                {itirazGonderiliyor ? "Gönderiliyor…" : "Talebi gönder"}
              </Text>
            </TouchableOpacity>
          </ScrollView>

          {takvimAcik && (
            <View style={s.seciciKaplama}>
              <View style={s.seciciKutu}>
                <Text style={s.seciciBaslik}>Tarih</Text>

                <Takvim
                  deger={itirazTarih}
                  /* Yalnızca bugün ve dün; sunucu da denetliyor */
                  enAz={(() => {
                    const d = new Date();
                    d.setHours(0, 0, 0, 0);
                    d.setDate(d.getDate() - 1);
                    return d;
                  })()}
                  enCok={new Date()}
                  onSec={(t) => {
                    setItirazTarih(t);
                    setTakvimAcik(false);
                  }}
                />

                <TouchableOpacity
                  style={s.seciciTamam}
                  onPress={() => setTakvimAcik(false)}
                >
                  <Text style={s.seciciTamamYazi}>Kapat</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ModalAlani>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },

  bar: {
    backgroundColor: renk.siyah,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  barBaslik: { fontSize: 17, fontWeight: "700", color: "#fff" },
  barSag: { fontSize: 13, color: "rgba(255,255,255,.8)" },

  /* Alt boşluk: yüzen menü içeriğin üstüne binmesin */
  govde: { padding: 14, paddingBottom: 110 },

  okutAlan: {
    backgroundColor: renk.siyah,
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
    marginBottom: 12,
  },

  kareIkon: {
    width: 108,
    height: 108,
    marginBottom: 18,
    position: "relative",
  },

  kose: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: renk.yesil,
  },

  solUst: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  sagUst: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  solAlt: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  sagAlt: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },

  okutBaslik: { fontSize: 16, fontWeight: "700", color: "#fff" },

  okutAlt: {
    fontSize: 12.5,
    color: "rgba(255,255,255,.72)",
    textAlign: "center",
    lineHeight: 19,
    marginTop: 7,
  },

  bos: { fontSize: 13, color: renk.pasif },

  itirazDugme: {
    backgroundColor: renk.yesil,
    borderRadius: 11,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 11,
  },

  itirazYazi: { color: "#fff", fontSize: 15, fontWeight: "700" },

  kapat: { color: "#fff", fontSize: 13.5, fontWeight: "600" },

  turSatir: { flexDirection: "row", gap: 7 },

  turDugme: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: renk.cizgi,
    alignItems: "center",
  },

  turAktif: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  turYazi: { fontSize: 14, color: renk.metin },
  turYaziAktif: { color: renk.yesilKoyu, fontWeight: "700" },

  satirAlan: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },

  alanEtiket: { fontSize: 13.5, color: renk.metin },
  alanDeger: { fontSize: 14, fontWeight: "700", color: renk.metin },

  saatAlan: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 14,
    fontWeight: "700",
    color: renk.metin,
    minWidth: 82,
    textAlign: "center",
  },

  sebepCipler: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  sebepCip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: renk.cizgi, backgroundColor: renk.beyaz },
  sebepCipSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  sebepCipYazi: { fontSize: 12.5, fontWeight: "700", color: renk.metin },
  sebepIpucu: { fontSize: 12, color: renk.pasif, marginTop: 6, lineHeight: 16 },

  sebepAlan: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 9,
    padding: 11,
    fontSize: 14,
    color: renk.metin,
    minHeight: 90,
    textAlignVertical: "top",
  },

  seciciKaplama: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 26,
  },

  seciciKutu: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
  },

  seciciBaslik: {
    fontSize: 12.5,
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 14,
    textAlign: "center",
  },

  seciciTamam: {
    marginTop: 14,
    backgroundColor: renk.yesil,
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
  },

  seciciTamamYazi: { color: "#fff", fontSize: 15, fontWeight: "700" },

  /* Kamera */
  /* Kamera ekranı sekme çubuğunun da üstünü kaplar: akış içinde
     kaldığında görüntü yarım yükseklikte kalıp kaplama aşağı kayıyordu. */
  kameraTam: { flex: 1, backgroundColor: "#000" },
  /* Yeni mimaride mutlak konumlu kamera görünümü ölçü alamayıp siyah
     kalıyor; akışın içinde flex ile yer kaplaması gerekiyor. Kaplama
     zaten mutlak konumlu, üstte duruyor. */
  kamera: { flex: 1, width: "100%" },

  kameraKaplama: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    elevation: 5,
    alignItems: "center",
    justifyContent: "center",
  },

  hedef: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: renk.yesil,
    borderRadius: 18,
  },

  kameraYazi: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    marginTop: 22,
    paddingHorizontal: 40,
    lineHeight: 21,
  },

  iptal: {
    marginTop: 30,
    paddingHorizontal: 26,
    paddingVertical: 11,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.5)",
  },

  iptalYazi: { color: "#fff", fontSize: 14, fontWeight: "600" },
});

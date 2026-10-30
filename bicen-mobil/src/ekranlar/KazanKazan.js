/**
 * Kazan-Kazan (20.10.2026)
 * ---------------------------------------------------------------------------
 * Çalışanların fikirleriyle ödül kazandığı aktiviteler. İlk aktivite
 * "Yeni Ürün Önerisi": marketlerde bulunmayan ürünü öneren çalışana,
 * ürün 3 aylık denemeden sonra 4. ayın satışlarında ilk 100 / 500 /
 * 1000 / 2000 ürün içine girerse tam / yarım / çeyrek / gram altın.
 *
 * Ekran içi görünümler: ana (aktiviteler ve önerilerim), bilgi (yeni
 * ürün projesi metni), form, sonuç. Ad soyad ve şube oturumdan gelir;
 * barkod sunucuda denetlenir: Mikro'da ürün varsa ya da son 1 ay içinde
 * önerilmişse öneri yapılamaz.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { kazanKazanAl, kazanKazanBarkod, kazanKazanOneri } from "../api";
import { renk, tarihYaz } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import Simge from "../bilesenler/Simge";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import { galeridenSec, kameradanCek } from "../dosyaSecici";
import { useKlavye, klavyePayi } from "../klavye";

/* -------------------------------------------------------------------------- */
/* Uçlar                                                                      */
/* -------------------------------------------------------------------------- */

const ozetAl = kazanKazanAl;
const barkodDenetle = kazanKazanBarkod;

const ALTIN = "#c8930a";
const ALTIN_ACIK = "#fff6dc";

const ODULLER = [
  { sira: "İlk 100", odul: "Tam Altın", renk: "#b8860b" },
  { sira: "101 – 500", odul: "Yarım Altın", renk: "#c8930a" },
  { sira: "501 – 1000", odul: "Çeyrek Altın", renk: "#d6a531" },
  { sira: "1001 – 2000", odul: "Gram Altın", renk: "#e0b84f" },
];

const DURUM = {
  degerlendiriliyor: { ad: "Değerlendiriliyor", renk: renk.mavi, zemin: renk.maviAcik },
  onaylandi: { ad: "Onaylandı · ürün açılıyor", renk: renk.yesilKoyu, zemin: renk.yesilAcik },
  denemede: { ad: "Satışta · deneme", renk: renk.yesilKoyu, zemin: renk.yesilAcik },
  olcumde: { ad: "4. ay ölçülüyor", renk: renk.turuncuKoyu, zemin: renk.turuncuAcik },
  odullendi: { ad: "Ödül kazandı", renk: ALTIN, zemin: ALTIN_ACIK },
  odulYok: { ad: "Ödül çıkmadı", renk: renk.pasif, zemin: "#f1f3ef" },
  uygunDegil: { ad: "Uygun bulunmadı", renk: renk.pasif, zemin: "#f1f3ef" },
};

/* ========================================================================== */

export default function KazanKazan({ route }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  /* Bildirimden ya da ana sayfadan doğrudan bilgi/form açılabilsin */
  const [gorunum, setGorunum] = useState(route?.params?.gorunum ?? "ana");
  const [sonuc, setSonuc] = useState(null);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await ozetAl());
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

  const geri =
    gorunum === "ana"
      ? undefined
      : () => setGorunum(gorunum === "form" ? "bilgi" : "ana");

  const baslik =
    gorunum === "bilgi" ? "Yeni Ürün Projesi" : gorunum === "form" ? "Ürün Öner" : gorunum === "sonuc" ? "Öneri alındı" : "Kazan-Kazan";

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <View style={s.bar}>
        <BarBaslik ad={baslik} geri={geri} />
      </View>

      {gorunum === "ana" && (
        <AnaGorunum
          veri={veri}
          yenileniyor={yenileniyor}
          yenile={() => getir(true)}
          ac={() => setGorunum("bilgi")}
        />
      )}
      {gorunum === "bilgi" && <BilgiGorunum veri={veri} devam={() => setGorunum("form")} />}
      {gorunum === "form" && (
        <FormGorunum
          kisi={veri?.kisi}
          gonderildi={(s) => {
            setSonuc(s);
            setGorunum("sonuc");
            getir();
          }}
        />
      )}
      {gorunum === "sonuc" && <SonucGorunum sonuc={sonuc} bitti={() => setGorunum("ana")} />}
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Ana: aktiviteler ve önerilerim                                             */
/* ========================================================================== */

function AnaGorunum({ veri, yenileniyor, yenile, ac }) {
  const oneriler = veri?.onerilerim ?? [];

  return (
    <ScrollView
      contentContainerStyle={s.govde}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor={renk.yesil} />}
    >
      <View style={s.hero}>
        <View style={s.heroIkon}>
          <Simge ad="kupa" renkli="#fff" boyut={26} />
        </View>
        <Text style={s.heroBaslik}>Fikrin değerli, ödülü de öyle</Text>
        <Text style={s.heroMetin}>
          Kazan-Kazan aktivitelerine katıl, önerilerin hayata geçtiğinde ödül kazan.
        </Text>
        <View style={s.heroSayilar}>
          <View style={s.heroSayi}>
            <Text style={s.heroSayiDeger}>{oneriler.length}</Text>
            <Text style={s.heroSayiAd}>önerim</Text>
          </View>
          <View style={s.heroAyrac} />
          <View style={s.heroSayi}>
            <Text style={s.heroSayiDeger}>{oneriler.filter((o) => o.durum === "denemede" || o.durum === "olcumde").length}</Text>
            <Text style={s.heroSayiAd}>satışta</Text>
          </View>
          <View style={s.heroAyrac} />
          <View style={s.heroSayi}>
            <Text style={s.heroSayiDeger}>{oneriler.filter((o) => o.durum === "odullendi").length}</Text>
            <Text style={s.heroSayiAd}>ödül</Text>
          </View>
        </View>
      </View>

      <Text style={s.bolum}>AKTİVİTELER</Text>

      {(veri?.aktiviteler ?? []).map((a) => (
        <TouchableOpacity
          key={a.kod}
          style={[s.aktivite, !a.acik && { opacity: 0.6 }]}
          activeOpacity={0.85}
          disabled={!a.acik}
          onPress={a.kod === "yeniurun" ? ac : undefined}
        >
          <View style={[s.aktiviteIkon, { backgroundColor: a.acik ? ALTIN_ACIK : "#f1f3ef" }]}>
            <Simge ad={a.kod === "yeniurun" ? "ampul" : "kupa"} renkli={a.acik ? ALTIN : renk.pasif} boyut={24} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={s.aktiviteAd}>{a.ad}</Text>
              {a.yeni && (
                <View style={s.yeniRozet}>
                  <Text style={s.yeniRozetYazi}>YENİ</Text>
                </View>
              )}
            </View>
            <Text style={s.aktiviteAlt} numberOfLines={2}>
              {a.aciklama}
            </Text>
            {a.acik && <Text style={s.aktiviteOdul}>{a.odul}</Text>}
          </View>
          {a.acik ? <Text style={s.ok}>›</Text> : <Text style={s.yakinda}>Yakında</Text>}
        </TouchableOpacity>
      ))}

      <Text style={[s.bolum, { marginTop: 18 }]}>ÖNERİLERİM</Text>

      {oneriler.length === 0 ? (
        <View style={s.bosKutu}>
          <Simge ad="ampul" renkli={renk.pasif} boyut={28} />
          <Text style={s.bosYazi}>Henüz öneriniz yok. Raflarımızda görmek istediğiniz ürünü önerin.</Text>
        </View>
      ) : (
        oneriler.map((o) => {
          const d = DURUM[o.durum] ?? DURUM.degerlendiriliyor;
          return (
            <View key={o.id} style={s.oneri}>
              {o.gorsel ? (
                <Image source={{ uri: o.gorsel }} style={s.oneriGorsel} />
              ) : (
                <View style={[s.oneriGorsel, { alignItems: "center", justifyContent: "center" }]}>
                  <Simge ad="foto" renkli={renk.pasif} boyut={22} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.oneriAd} numberOfLines={1}>
                  {o.urunAdi}
                </Text>
                <Text style={s.oneriAlt}>
                  {o.barkod} · {tarihYaz(o.tarih)}
                </Text>
                {o.not ? <Text style={s.oneriNot}>{o.not}</Text> : null}
              </View>
              <View style={[s.durum, { backgroundColor: d.zemin }]}>
                <Text style={[s.durumYazi, { color: d.renk }]}>{o.odul ?? d.ad}</Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

/* ========================================================================== */
/* Bilgilendirme                                                              */
/* ========================================================================== */

function Madde({ no, children }) {
  return (
    <View style={s.madde}>
      <View style={s.maddeNo}>
        <Text style={s.maddeNoYazi}>{no}</Text>
      </View>
      <Text style={s.maddeYazi}>{children}</Text>
    </View>
  );
}

function BilgiGorunum({ devam, veri }) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.govde, { paddingBottom: 170 }]}>
        <View style={[s.hero, { backgroundColor: "#3f2f04" }]}>
          <View style={[s.heroIkon, { backgroundColor: "rgba(255,214,102,.18)" }]}>
            <Simge ad="ampul" renkli="#ffd666" boyut={26} />
          </View>
          <Text style={s.heroUst}>KAZAN-KAZAN · YENİ ÜRÜN PROJESİ</Text>
          <Text style={s.heroBaslik}>Değerli Çalışma Arkadaşlarımız,</Text>
          <Text style={s.heroMetin}>
            Şirketimiz, sizlerin fikirlerine ve katkılarına her zaman değer veriyor. Bu yüzden “Kazan-Kazan” ödül
            sistemimize yepyeni bir modül ekliyoruz! Artık marketlerimizde bulunmayan ya da satış potansiyeli yüksek
            olduğunu düşündüğünüz ürünleri önererek ödüller kazanabileceksiniz.
          </Text>
        </View>

        <View style={s.kart}>
          <Text style={s.kartBaslik}>Nasıl mı?</Text>
          <Madde no="1">Ürün adını, barkodunu ve ürünün neden satılması gerektiğine dair düşüncelerinizi buradan girin.</Madde>
          <Madde no="2">Önerdiğiniz ürünler değerlendirilerek satışa sunulur, 3 ay boyunca performansı takip edilir.</Madde>
          <Madde no="3">4. ayın sonunda satış sonuçlarına göre ödüller verilir.</Madde>
        </View>

        <View style={s.kart}>
          <Text style={s.kartBaslik}>Ödüller</Text>
          <Text style={s.kartAlt}>Önerdiğiniz ürün 4. aya ait satışlarda ilk kaç ürün içine girerse:</Text>
          <View style={s.oduller}>
            {(veri?.kademeler?.length
              ? veri.kademeler.map((k, i) => ({ ...k, renk: ODULLER[Math.min(i, ODULLER.length - 1)].renk }))
              : ODULLER
            ).map((o) => (
              <View key={o.odul} style={s.odul}>
                <View style={[s.madalya, { backgroundColor: o.renk }]}>
                  <Simge ad="kupa" renkli="#fff" boyut={17} />
                </View>
                <Text style={s.odulAd}>{o.odul}</Text>
                <Text style={s.odulSira}>{o.sira}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.kart}>
          <Text style={s.kartBaslik}>Proje detayları</Text>
          {[
            "Önerilen ürünler sisteme girilir ve değerlendirilir.",
            "Uygun bulunan ürünler üç aylık deneme sürecine alınır.",
            "Deneme süresince ürünler kampanyasız, normal fiyatla satılır.",
            "Dördüncü ayda ürünlerin satış performansı analiz edilir ve ödüller verilir.",
            "Mağazalarımızda zaten bulunan ya da son 1 ay içinde önerilmiş bir ürün tekrar önerilemez.",
          ].map((m, i) => (
            <View key={i} style={s.nokta}>
              <View style={s.noktaIsaret} />
              <Text style={s.maddeYazi}>{m}</Text>
            </View>
          ))}
        </View>

        <Text style={s.kapanis}>
          Bu sistemle hem fikirlerinizi paylaşacak hem de başarılı ürünlerle ödüllendirileceksiniz! Katılımınızı
          bekliyoruz.
        </Text>
      </ScrollView>

      <View style={[s.altCubuk, { bottom: 88 }]}>
        <TouchableOpacity style={[s.anaDugme, { backgroundColor: ALTIN }]} activeOpacity={0.85} onPress={devam}>
          <Simge ad="ampul" renkli="#fff" boyut={19} />
          <Text style={s.anaDugmeYazi}>Ürün öner</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ========================================================================== */
/* Form                                                                       */
/* ========================================================================== */

function Alan({ etiket, zorunlu = true, children, ipucu }) {
  return (
    <View style={s.alan}>
      <Text style={s.alanEtiket}>
        {etiket}
        {zorunlu ? <Text style={{ color: renk.kirmizi }}> *</Text> : null}
      </Text>
      {children}
      {ipucu ? <Text style={s.ipucu}>{ipucu}</Text> : null}
    </View>
  );
}

function FormGorunum({ kisi, gonderildi }) {
  const [urunAdi, setUrunAdi] = useState("");
  const [barkod, setBarkod] = useState("");
  const [neden, setNeden] = useState("");
  const [gorsel, setGorsel] = useState(null);
  const [denetim, setDenetim] = useState(null);
  const [denetleniyor, setDenetleniyor] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState("");
  const zaman = useRef();
  const klavye = useKlavye();
  const [kameraAcik, setKameraAcik] = useState(false);
  const [izin, izinIste] = useCameraPermissions();
  const okundu = useRef(false);

  const kameraAc = async () => {
    if (!izin?.granted) {
      const c = await izinIste();
      if (!c.granted) {
        Alert.alert("Kamera izni gerekiyor", "Barkod okutmak için kamera izni veriniz.");
        return;
      }
    }
    okundu.current = false;
    setKameraAcik(true);
  };

  const barkodOkundu = ({ data }) => {
    if (okundu.current) return;
    const b = String(data ?? "").replace(/\D/g, "");
    if (b.length < 8) return;
    okundu.current = true;
    setBarkod(b.slice(0, 14));
    setKameraAcik(false);
  };

  /* Barkod yazıldıkça (8+ hane) sunucuda denetim */
  useEffect(() => {
    clearTimeout(zaman.current);
    setDenetim(null);
    const b = barkod.replace(/\D/g, "");
    if (b.length < 8) return;
    zaman.current = setTimeout(async () => {
      setDenetleniyor(true);
      try {
        setDenetim(await barkodDenetle(b));
      } catch (h) {
        setDenetim({ durum: "hata", mesaj: h.message });
      } finally {
        setDenetleniyor(false);
      }
    }, 450);
    return () => clearTimeout(zaman.current);
  }, [barkod]);

  const uygun = denetim?.durum === "uygun";
  const tamam = urunAdi.trim().length >= 2 && uygun && neden.trim().length >= 10 && !!gorsel;

  const gorselSec = async (kamera) => {
    try {
      const r = kamera ? await kameradanCek({ quality: 0.6 }) : await galeridenSec({ quality: 0.6 });
      /* Seçici sonucu { canceled, assets: [{ uri }] } biçiminde; eskiden
         r.uri okunuyordu ve seçilen görsel hiç kaydedilmiyordu (30.10.2026) */
      if (r?.canceled) return;
      const uri = r?.assets?.[0]?.uri ?? r?.uri;
      if (uri) setGorsel(uri);
      else setHata("Görsel alınamadı, tekrar deneyin.");
    } catch (h) {
      setHata(h.message);
    }
  };

  const gonder = async () => {
    setGonderiliyor(true);
    setHata("");
    try {
      const s = await kazanKazanOneri(
        { urunAdi: urunAdi.trim(), barkod: barkod.replace(/\D/g, ""), neden: neden.trim() },
        gorsel
      );
      gonderildi(s);
    } catch (h) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  /* Klavye açıkken düğme çubuğu akışa giriyor: kaydırma alanı düğmenin
     üstünde bitiyor, yazılan alan düğmenin ya da klavyenin altında
     kalmıyor. Kapalıyken yüzen menünün üstünde sabit duruyor. */
  return (
    <View style={{ flex: 1, paddingBottom: klavyePayi(klavye) }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.govde, { paddingBottom: klavye.acik ? 24 : 170 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Kimlik: oturumdan, değiştirilemez */}
        <View style={s.kimlik}>
          <View style={s.kimlikIkon}>
            <Simge ad="kisi" renkli={renk.yesilKoyu} boyut={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.kimlikAd}>{kisi?.adSoyad}</Text>
            <Text style={s.kimlikAlt}>{kisi?.sube}</Text>
          </View>
          <Text style={s.kimlikNot}>otomatik</Text>
        </View>

        <View style={s.kart}>
          <Alan etiket="Ürün barkodu" ipucu="Barkodu okutun ya da elle yazın. Mağazalarımızda olmayan ürünler önerilebilir.">
            <View style={s.barkodSatir}>
              <TextInput
                style={[s.girdi, { flex: 1, fontVariant: ["tabular-nums"], letterSpacing: 1 }]}
                value={barkod}
                onChangeText={(t) => setBarkod(t.replace(/\D/g, "").slice(0, 14))}
                keyboardType="number-pad"
                placeholder="Ör. 8690504035219"
                placeholderTextColor="#a3a9a0"
              />
              <TouchableOpacity style={s.okutDugme} activeOpacity={0.85} onPress={kameraAc}>
                <Simge ad="barkod" renkli="#fff" boyut={20} />
              </TouchableOpacity>
            </View>

            {kameraAcik && izin?.granted ? (
              <View style={s.kameraKutu}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"] }}
                  onBarcodeScanned={barkodOkundu}
                />
                {/* Kaplama kameranın kardeşi: yeni mimaride kameranın içi çizilmiyor */}
                <View style={s.kameraKaplama} pointerEvents="box-none">
                  <View style={s.kameraHedef} />
                  <TouchableOpacity style={s.kameraKapat} onPress={() => setKameraAcik(false)}>
                    <Text style={s.kameraKapatYazi}>Kapat</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {denetleniyor && (
              <View style={[s.denetim, { backgroundColor: "#f1f3ef" }]}>
                <ActivityIndicator size="small" color={renk.pasif} />
                <Text style={[s.denetimYazi, { color: renk.pasif }]}>Barkod kontrol ediliyor…</Text>
              </View>
            )}
            {!denetleniyor && denetim && (
              <View
                style={[
                  s.denetim,
                  { backgroundColor: uygun ? renk.yesilAcik : denetim.durum === "onerilmis" ? renk.turuncuAcik : "#fdecec" },
                ]}
              >
                <Simge
                  ad={uygun ? "onay" : "uyari"}
                  renkli={uygun ? renk.yesilKoyu : denetim.durum === "onerilmis" ? renk.turuncuKoyu : renk.kirmizi}
                  boyut={18}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      s.denetimYazi,
                      { color: uygun ? renk.yesilKoyu : denetim.durum === "onerilmis" ? renk.turuncuKoyu : renk.kirmizi },
                    ]}
                  >
                    {uygun
                      ? denetim.mesaj || "Bu ürün mağazalarımızda yok, önerebilirsiniz."
                      : denetim.durum === "mevcut"
                        ? "Bu ürün zaten mağazalarımızda satılıyor."
                        : denetim.durum === "onerilmis"
                          ? `Bu ürün ${tarihYaz(denetim.tarih)} tarihinde önerildi.`
                          : denetim.mesaj || "Barkod kontrol edilemedi."}
                  </Text>
                  {denetim.urunAdi && (denetim.durum === "mevcut" || denetim.eskiUrun) ? (
                    <Text style={s.denetimAlt}>{denetim.urunAdi}</Text>
                  ) : denetim.durum === "onerilmis" ? (
                    <Text style={s.denetimAlt}>Son 1 ay içinde önerilen ürün tekrar önerilemez; {tarihYaz(denetim.tekrarTarihi)} sonrası önerilebilir.</Text>
                  ) : null}
                </View>
              </View>
            )}
          </Alan>

          <Alan etiket="Ürün adı">
            <TextInput
              style={s.girdi}
              value={urunAdi}
              onChangeText={setUrunAdi}
              placeholder="Marka, ürün ve gramaj"
              placeholderTextColor="#a3a9a0"
              maxLength={150}
            />
          </Alan>

          <Alan etiket="Neden raflarımızda bu ürün bulunmalı?">
            <TextInput
              style={[s.girdi, { minHeight: 96, textAlignVertical: "top", paddingTop: 11 }]}
              value={neden}
              onChangeText={setNeden}
              placeholder="Kısaca açıklayınız"
              placeholderTextColor="#a3a9a0"
              multiline
              maxLength={1000}
            />
          </Alan>

          <Alan etiket="Ürünün görseli">
            {gorsel ? (
              <View style={s.gorselKutu}>
                <Image source={{ uri: gorsel }} style={s.gorselOnizleme} />
                <View style={{ flex: 1 }}>
                  <Text style={s.gorselAd}>urun-fotografi.jpg</Text>
                  <Text style={s.kimlikAlt}>Fotoğraf eklendi</Text>
                </View>
                <TouchableOpacity onPress={() => setGorsel(null)}>
                  <Text style={{ color: renk.kirmizi, fontWeight: "700" }}>Kaldır</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity style={s.gorselDugme} activeOpacity={0.85} onPress={() => gorselSec(true)}>
                  <Simge ad="foto" renkli={renk.yesilKoyu} boyut={20} />
                  <Text style={s.gorselDugmeYazi}>Fotoğraf çek</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.gorselDugme} activeOpacity={0.85} onPress={() => gorselSec(false)}>
                  <Simge ad="izgara" renkli={renk.yesilKoyu} boyut={20} />
                  <Text style={s.gorselDugmeYazi}>Galeriden seç</Text>
                </TouchableOpacity>
              </View>
            )}
          </Alan>
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
          {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Simge ad="gonder" renkli="#fff" boyut={18} />}
          <Text style={s.anaDugmeYazi}>Öneriyi gönder</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ========================================================================== */
/* Sonuç                                                                      */
/* ========================================================================== */

function SonucGorunum({ sonuc, bitti }) {
  return (
    <ScrollView contentContainerStyle={[s.govde, { alignItems: "center", paddingTop: 40 }]}>
      <View style={s.sonucIkon}>
        <Simge ad="onay" renkli="#fff" boyut={40} />
      </View>
      <Text style={s.sonucBaslik}>Öneriniz alındı!</Text>
      <Text style={s.sonucMetin}>
        {sonuc?.urunAdi ?? "Ürün"} önerinizi aldık. Değerlendirme sonucunu bu ekrandaki “Önerilerim” bölümünden takip
        edebilirsiniz.
      </Text>
      <View style={[s.kart, { alignSelf: "stretch", marginTop: 20 }]}>
        <Text style={s.kartBaslik}>Sonraki adımlar</Text>
        <Madde no="1">Satınalma ekibi önerinizi değerlendirir.</Madde>
        <Madde no="2">Uygun bulunursa ürün 3 ay boyunca normal fiyatla satışa sunulur.</Madde>
        <Madde no="3">4. ayın satışlarına göre ödülünüz belirlenir.</Madde>
      </View>
      <TouchableOpacity style={[s.anaDugme, { alignSelf: "stretch", marginTop: 8 }]} onPress={bitti}>
        <Text style={s.anaDugmeYazi}>Kazan-Kazan'a dön</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  bar: { backgroundColor: renk.yesil, paddingHorizontal: 20, paddingVertical: 14 },
  govde: { padding: 14, paddingBottom: 120 },

  hero: { backgroundColor: "#2d4a0c", borderRadius: 20, padding: 18, marginBottom: 16, overflow: "hidden" },
  heroIkon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,.16)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  heroUst: { color: "#ffd666", fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 4 },
  heroBaslik: { color: "#fff", fontSize: 20, fontWeight: "800" },
  heroMetin: { color: "rgba(255,255,255,.82)", fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  heroSayilar: {
    flexDirection: "row",
    marginTop: 16,
    backgroundColor: "rgba(255,255,255,.1)",
    borderRadius: 14,
    paddingVertical: 10,
  },
  heroSayi: { flex: 1, alignItems: "center" },
  heroSayiDeger: { color: "#fff", fontSize: 20, fontWeight: "800" },
  heroSayiAd: { color: "rgba(255,255,255,.7)", fontSize: 11.5, fontWeight: "600" },
  heroAyrac: { width: 1, backgroundColor: "rgba(255,255,255,.18)" },

  bolum: { fontSize: 12, fontWeight: "800", color: renk.pasif, letterSpacing: 0.8, marginBottom: 8, marginLeft: 2 },

  aktivite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  aktiviteIkon: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  aktiviteAd: { fontSize: 15.5, fontWeight: "800", color: renk.metin },
  aktiviteAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2, lineHeight: 17 },
  aktiviteOdul: { fontSize: 12, color: ALTIN, fontWeight: "800", marginTop: 5 },
  yeniRozet: { backgroundColor: renk.turuncu, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  yeniRozetYazi: { color: "#fff", fontSize: 10, fontWeight: "800" },
  ok: { fontSize: 26, color: "#b4bab0", marginLeft: 4 },
  yakinda: { fontSize: 11.5, color: renk.pasif, fontWeight: "700" },

  bosKutu: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#d3dccb",
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  bosYazi: { fontSize: 13, color: renk.pasif, textAlign: "center", lineHeight: 19 },

  oneri: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  oneriGorsel: { width: 46, height: 46, borderRadius: 11, backgroundColor: "#f1f3ef" },
  oneriAd: { fontSize: 14, fontWeight: "700", color: renk.metin },
  oneriAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  oneriNot: { fontSize: 11.5, color: renk.yesilKoyu, marginTop: 3, fontWeight: "600" },
  durum: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, maxWidth: 120 },
  durumYazi: { fontSize: 11, fontWeight: "800", textAlign: "center" },

  kart: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: renk.cizgi },
  kartBaslik: { fontSize: 15.5, fontWeight: "800", color: renk.metin, marginBottom: 10 },
  kartAlt: { fontSize: 12.5, color: renk.pasif, marginTop: -6, marginBottom: 12 },

  madde: { flexDirection: "row", gap: 10, marginBottom: 10, alignItems: "flex-start" },
  maddeNo: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  maddeNoYazi: { color: renk.yesilKoyu, fontWeight: "800", fontSize: 12.5 },
  maddeYazi: { flex: 1, fontSize: 13.5, color: renk.metin, lineHeight: 20 },
  nokta: { flexDirection: "row", gap: 10, marginBottom: 8 },
  noktaIsaret: { width: 6, height: 6, borderRadius: 3, backgroundColor: renk.yesil, marginTop: 8 },

  oduller: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  odul: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: ALTIN_ACIK,
    borderRadius: 14,
    padding: 12,
    alignItems: "flex-start",
  },
  madalya: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  odulAd: { fontSize: 15, fontWeight: "800", color: "#5c4300" },
  odulSira: { fontSize: 12, color: "#8a6a10", fontWeight: "600", marginTop: 1 },

  kapanis: { fontSize: 13.5, color: renk.pasif, lineHeight: 20, textAlign: "center", marginTop: 4, paddingHorizontal: 10 },

  altCubuk: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  altCubukKlavye: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: renk.zemin,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },
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
  anaDugmeYazi: { color: "#fff", fontSize: 16, fontWeight: "800" },

  kimlik: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: renk.yesilAcik,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#dcebc6",
  },
  kimlikIkon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  kimlikAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  kimlikAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },
  kimlikNot: { fontSize: 11, color: renk.yesilKoyu, fontWeight: "700" },

  alan: { marginBottom: 16 },
  alanEtiket: { fontSize: 13.5, fontWeight: "700", color: renk.metin, marginBottom: 7 },
  ipucu: { fontSize: 11.5, color: renk.pasif, marginTop: 6, lineHeight: 16 },
  girdi: {
    borderWidth: 1,
    borderColor: "#dde2d8",
    borderRadius: 12,
    paddingHorizontal: 13,
    height: 48,
    fontSize: 15,
    color: renk.metin,
    backgroundColor: "#fbfcfa",
  },
  barkodSatir: { flexDirection: "row", gap: 8 },
  kameraKutu: { height: 190, borderRadius: 14, overflow: "hidden", marginTop: 10, backgroundColor: "#000" },
  kameraKaplama: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  kameraHedef: { width: "78%", height: 80, borderWidth: 2, borderColor: "#fff", borderRadius: 10, opacity: 0.9 },
  kameraKapat: {
    position: "absolute",
    right: 10,
    top: 10,
    backgroundColor: "rgba(0,0,0,.55)",
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kameraKapatYazi: { color: "#fff", fontWeight: "700", fontSize: 12.5 },
  okutDugme: { width: 48, height: 48, borderRadius: 12, backgroundColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  denetim: { flexDirection: "row", gap: 9, alignItems: "flex-start", borderRadius: 12, padding: 11, marginTop: 9 },
  denetimYazi: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  denetimAlt: { fontSize: 12, color: renk.pasif, marginTop: 2, lineHeight: 17 },

  gorselDugme: {
    flex: 1,
    height: 74,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#bcd59a",
    backgroundColor: "#f7fbf0",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  gorselDugmeYazi: { fontSize: 13, fontWeight: "700", color: renk.yesilKoyu },
  gorselKutu: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 10,
  },
  gorselOnizleme: { width: 54, height: 54, borderRadius: 12, backgroundColor: renk.yesilAcik, alignItems: "center", justifyContent: "center" },
  gorselAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },

  hata: { color: renk.kirmizi, fontSize: 13, textAlign: "center", marginTop: 4 },

  sonucIkon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: renk.yesil,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  sonucBaslik: { fontSize: 22, fontWeight: "800", color: renk.metin },
  sonucMetin: { fontSize: 14, color: renk.pasif, textAlign: "center", lineHeight: 21, marginTop: 6, paddingHorizontal: 16 },
});

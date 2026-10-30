/**
 * Biçen Kartım
 * ---------------------------------------------------------------------------
 * Personele her ay yüklenen puanın bakiyesi, kasada ödeme için karekod ile
 * dört haneli kod, puan hareketleri ve kart ayarları.
 *
 * <p>
 * Kart yüzü gerçek bir plastik kart gibi çiziliyor: eğimli renk geçişi,
 * çip, temassız simgesi ve kabartma numara. Düz turuncu dikdörtgen ekranda
 * bir kart gibi durmuyordu, kasada telefonu uzatan personel "kartım nerede"
 * diye arıyordu.
 * </p>
 *
 * <p>
 * Ödeme kodu sunucuda saklanmıyor: yazarkasa aynı algoritmayı kendi
 * tarafında çalıştırıp karşılaştırıyor. Bu yüzden kod gün boyunca sabit ve
 * "yeniden üret" diye bir işlem yok — kasadaki hesap değişmeyeceği için yeni
 * bir kod üretmek eşleşmeyi bozardı. Ekrandaki geri sayım kodu değil
 * gösterimi sınırlıyor: kod açık kaldığında omuz üstünden okunuyordu.
 * </p>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Image,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran } from "../bilesenler/ModalAlani";
import { useFocusEffect } from "@react-navigation/native";
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from "react-native-svg";

import { api } from "../api";
import { renk } from "../tema";
import Simge from "../bilesenler/Simge";
import Barkod from "../bilesenler/Barkod";
import KartZemin, { TURUNCU } from "../bilesenler/KartZemin";
import { Yukleniyor, Hata, Kart } from "../bilesenler/Ortak";

/* Kart üzerindeki logo.

   assets/kart-logo.png değiştirilerek kurumsal logo konabilir: saydam
   zeminli, beyaz çizimli ve geniş bir görsel olmalı — kart koyu renkli ve
   logo sol üstte küçük duruyor. Görsel yoksa paketleme hata verdiği için
   dosya her zaman bulunmalı. */
import KART_LOGO from "../../assets/kart-logo.png";

/* Karekod kitaplığı isteğe bağlı: kurulu değilse ekran yalnızca kodu
   gösteriyor, ödeme yine yapılabiliyor. */
let QRCode = null;

try {
  QRCode = require("react-native-qrcode-svg").default;
} catch {
  QRCode = null;
}

/* -------------------------------------------------------------------------- */

/** Ödeme kodunun ekranda kalma süresi (saniye). */
const KOD_SURESI = 120;

const paraYaz = (d) =>
  (d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

/** 1992022538562698 → 1992 0225 3856 2698 */
const numaraYaz = (d) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();

const tarihYaz = (d) => (d ? new Date(d).toLocaleDateString("tr-TR") : "");

const saatYaz = (d) =>
  d
    ? new Date(d).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** 119 → "1:59" */
const sureYaz = (saniye) => {
  const d = Math.max(0, saniye);
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
};

/* ========================================================================== */
/* Kart yüzü                                                                  */
/* ========================================================================== */

/**
 * Çip.
 *
 * Kendi çizimi: küçük bir görsel için dosya taşımak paket boyutunu
 * büyütüyor ve ölçeklendiğinde bulanıklaşıyordu.
 */
function Cip() {
  return (
    <Svg width={38} height={29} viewBox="0 0 38 29">
      <Defs>
        <LinearGradient id="cip" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#fdf1c8" />
          <Stop offset="0.45" stopColor="#dcb866" />
          <Stop offset="1" stopColor="#a87e2c" />
        </LinearGradient>
      </Defs>

      <Rect
        x="0.6"
        y="0.6"
        width="36.8"
        height="27.8"
        rx="5"
        fill="url(#cip)"
        stroke="rgba(120,84,20,.75)"
        strokeWidth="0.9"
      />

      {/* Kontak çizgileri: çipi çip yapan ayrıntı. */}
      <Path
        d="M13 0.6 V28.4 M25 0.6 V28.4 M0.6 10 H13 M25 10 H37.4 M0.6 19 H13 M25 19 H37.4"
        stroke="rgba(120,84,20,.75)"
        strokeWidth="0.9"
      />

      <Rect
        x="13"
        y="10"
        width="12"
        height="9"
        fill="none"
        stroke="rgba(120,84,20,.75)"
        strokeWidth="0.9"
      />
    </Svg>
  );
}

/** Temassız ödeme simgesi. */
function Temassiz() {
  return (
    <Svg width={21} height={26} viewBox="0 0 21 26">
      <Path
        d="M3 8.5 A 8 8 0 0 1 3 17.5"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.95"
      />
      <Path
        d="M8 5 A 13 13 0 0 1 8 21"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      <Path
        d="M13 1.5 A 18 18 0 0 1 13 24.5"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.45"
      />
    </Svg>
  );
}

/**
 * Kart yüzü.
 *
 * Arka plan SVG ile çiziliyor ve ölçüsü yerleşimden alınıyor: eğriler
 * kartın gerçek en-boyuna göre hesaplanmazsa geniş ekranda eziliyordu.
 */
function KartYuzu({ veri, barkodEni }) {
  return (
    <KartZemin renkler={TURUNCU} yuvarlak={22} stil={s.kart}>
      <View style={s.kartUst}>
        {/* Logo görsel olarak: yazıyla çizilen marka adı, gerçek logonun
            oranlarını ve harf biçimini tutturamıyordu. */}
        <Image source={KART_LOGO} style={s.logo} resizeMode="contain" />

        <View style={s.kartSag}>
          <View
            style={[
              s.kip,
              !veri.mobilKart && { backgroundColor: "rgba(0,0,0,.18)" },
            ]}
          >
            <Text style={s.kipYazi}>{veri.mobilKart ? "MOBİL" : "FİZİKİ"}</Text>
          </View>

          <Cip />
        </View>
      </View>

      {/* Kabartma numara: gerçek kartta basılı değil kabartmadır, gölge o
          izlenimi veriyor. */}
      <Text style={s.kartNo}>{numaraYaz(veri.kartNo)}</Text>

      <View style={s.kartOrta}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kartEtiket}>BAKİYE</Text>

          <Text style={s.bakiye}>
            {veri.bakiyeOkunabildi ? paraYaz(veri.bakiye) : "—"}
          </Text>
        </View>

        <Temassiz />
      </View>

      {!veri.bakiyeOkunabildi ? (
        <Text style={s.bakiyeNot}>
          Bakiye şu anda okunamıyor. Kasadan öğrenebilirsiniz.
        </Text>
      ) : null}

      {/* Barkod kartın üzerinde: kasadaki el okuyucusu karekod yerine
          barkod okuyorsa bu kullanılıyor, aynı kart numarası. */}
      <View style={s.barkodSerit}>
        <Barkod deger={veri.kartNo} genislik={barkodEni} yukseklik={52} />
      </View>
    </KartZemin>
  );
}

/* ========================================================================== */
/* Ekran                                                                      */
/* ========================================================================== */

export default function GiftKart() {
  const { width } = useWindowDimensions();

  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [tazeleniyor, setTazeleniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [kodAcik, setKodAcik] = useState(false);
  const [guncelleAcik, setGuncelleAcik] = useState(false);

  const [sifreAcik, setSifreAcik] = useState(false);
  const [yeniSifre, setYeniSifre] = useState("");
  const [sifreHatasi, setSifreHatasi] = useState("");
  const [sifreKaydediliyor, setSifreKaydediliyor] = useState(false);

  const getir = async (tazele = false) => {
    tazele ? setTazeleniyor(true) : setYukleniyor(true);

    try {
      setVeri(await api.al("/api/Mobil/GiftKart"));
      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Kart bilgileri alınamadı.");
    } finally {
      setYukleniyor(false);
      setTazeleniyor(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      getir();
      setKodAcik(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const sifreKaydet = async () => {
    setSifreKaydediliyor(true);
    setSifreHatasi("");

    try {
      await api.gonder("/api/Mobil/GiftKartSifre", { sifre: yeniSifre });

      setSifreAcik(false);
      setYeniSifre("");
      Alert.alert("Kaydedildi", "Kart şifreniz güncellendi.");
      getir(true);
    } catch (e) {
      setSifreHatasi(e?.message ?? "Şifre kaydedilemedi.");
    } finally {
      setSifreKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

  const kartVar = !!veri?.kartVar;

  /* Barkod kart genişliğine göre: sabit genişlik dar ekranda taşıyordu.
     14 sayfa boşluğu, 18 kart içi boşluk, 10 şerit içi boşluk. */
  const barkodEni = Math.max(180, width - 2 * 14 - 2 * 18 - 2 * 10);

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl refreshing={tazeleniyor} onRefresh={() => getir(true)} />
        }
      >
        {hata ? <Hata metin={hata} /> : null}

        {veri && !kartVar ? (
          <Kart>
            <Text style={s.bilgiBaslik}>Kart bulunamadı</Text>
            <Text style={s.bilgiYazi}>{veri.bilgi}</Text>
          </Kart>
        ) : null}

        {kartVar ? <KartYuzu veri={veri} barkodEni={barkodEni} /> : null}

        {kartVar ? (
          <View style={s.satir}>
            {/* Şifre yoksa uyarı, varsa onay: satırın durumu simgeden de
                okunsun, yazıya bakmadan. */}
            {/* Şifre fiziki kartta gerekli; mobil kartta kasa ödeme kodunu
                soruyor (05.10.2026), şifresiz mobil kart uyarı değil. */}
            <Simge
              ad={veri.sifreVar || veri.mobilKart ? "onay" : "uyari"}
              boyut={19}
              renkli={veri.sifreVar || veri.mobilKart ? renk.yesilKoyu : renk.turuncu}
              dolgu
            />

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.satirEtiket}>Kart Şifresi</Text>

              {/* 09.10.2026: mobil kartta (608) şifre tutulmuyor; kasada
                  ödeme kodu soruluyor. Şifre fiziki karta geçerken belirleniyor. */}
              <Text style={s.satirDeger}>
                {veri.mobilKart
                  ? "Yok · mobilde kasada ödeme kodu sorulur"
                  : `${veri.sifreVar ? "Belirlenmiş" : "Belirlenmemiş"} · kasada sorulur`}
              </Text>
            </View>

            {!veri.mobilKart ? (
              <TouchableOpacity
                style={s.satirDugme}
                onPress={() => setSifreAcik(true)}
                activeOpacity={0.8}
              >
                <Text style={s.satirDugmeYazi}>
                  {veri.sifreVar ? "DEĞİŞTİR" : "BELİRLE"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Ödeme kodu yalnızca mobil kipte: fiziki kart seçildiğinde kasa
            plastik kartı okutuyor ve kod karşılığı aramıyor. */}
        {kartVar ? (
          <TouchableOpacity
            style={[s.odeDugme, !veri.mobilKart && s.odeDugmePasif]}
            onPress={() => setKodAcik(true)}
            disabled={!veri.mobilKart}
            activeOpacity={0.85}
          >
            <Simge ad="kare" boyut={19} renkli={renk.beyaz} dolgu />
            <Text style={s.odeYazi}>ÖDEME KODU OLUŞTUR</Text>
          </TouchableOpacity>
        ) : null}

        {kartVar && !veri.mobilKart ? (
          <Text style={s.odeNot}>
            Alışveriş tercihiniz fiziki kart. Uygulamadan ödeme kodu
            oluşturmak için tercihinizi mobil uygulamaya çeviriniz.
          </Text>
        ) : null}

        {/* Kart yoksa tercih düğmesi de yok: değiştirilecek bir kart
            bulunmuyor ve düğme yalnızca hata veriyordu. */}
        <TouchableOpacity
          style={[s.guncelleDugme, !kartVar && { display: "none" }]}
          onPress={() => setGuncelleAcik(true)}
          activeOpacity={0.85}
        >
          <Simge ad="belge" boyut={18} renkli={renk.turuncu} />
          <Text style={s.guncelleYazi}>ALIŞVERİŞ TERCİHİMİ DEĞİŞTİR</Text>
        </TouchableOpacity>

        {kartVar && (veri.hareketler ?? []).length > 0 ? (
          <>
            <Text style={s.bolum}>Puan Hareketlerim</Text>

            <Kart>
              {veri.hareketler.map((h, i) => (
                <View key={i} style={[s.hareket, i > 0 && s.hareketCizgi]}>
                  <View
                    style={[
                      s.hareketSimge,
                      (h.tutar ?? 0) < 0 && { backgroundColor: renk.turuncuAcik },
                    ]}
                  >
                    <Text
                      style={[
                        s.hareketIsaret,
                        {
                          color:
                            (h.tutar ?? 0) < 0 ? renk.turuncu : renk.yesilKoyu,
                        },
                      ]}
                    >
                      {(h.tutar ?? 0) < 0 ? "−" : "+"}
                    </Text>
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.hareketAd} numberOfLines={1}>
                      {h.aciklama || "İşlem"}
                    </Text>

                    <Text style={s.hareketTarih} numberOfLines={1}>
                      {[
                        [tarihYaz(h.tarih), saatYaz(h.tarih)]
                          .filter(Boolean)
                          .join(" "),
                        h.subeAdi,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>

                  <Text
                    style={[
                      s.hareketTutar,
                      {
                        color:
                          (h.tutar ?? 0) < 0 ? renk.turuncu : renk.yesilKoyu,
                      },
                    ]}
                  >
                    {(h.tutar ?? 0) < 0 ? "" : "+"}
                    {paraYaz(h.tutar)}
                  </Text>
                </View>
              ))}
            </Kart>
          </>
        ) : null}
      </ScrollView>

      <OdemeKodu
        acik={kodAcik}
        veri={veri}
        kapat={() => setKodAcik(false)}
        tazele={() => getir(true)}
      />

      <KartGuncelle
        acik={guncelleAcik}
        veri={veri}
        kapat={() => setGuncelleAcik(false)}
        bitti={() => {
          setGuncelleAcik(false);
          getir(true);
        }}
      />

      {/* Kart şifresi.

          Dört hane, kasada ödeme onayında soruluyor. Aynı ya da sıralı
          rakamlar sunucuda reddediliyor; kart kaybolduğunda ilk
          denenecek şifreler bunlar. */}
      <Modal visible={sifreAcik} transparent animationType="fade">
        <View style={s.zemin}>
          <View style={s.sifreKutu}>
            <Text style={s.sifreBaslik}>
              {veri?.sifreVar ? "Kart şifresini değiştir" : "Kart şifresi belirle"}
            </Text>

            <Text style={s.sifreNot}>
              Fiziki kartla alışverişte kasada bu şifre sorulur; mobil kartla
              ödemede şifre değil, uygulamadaki ödeme kodu istenir. Dört haneli
              bir sayı belirleyiniz.
            </Text>

            <TextInput
              style={s.sifreGirdi}
              value={yeniSifre}
              onChangeText={(d) => setYeniSifre(d.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              placeholder="••••"
              placeholderTextColor="#b9c0b5"
              textAlign="center"
            />

            {sifreHatasi ? <Text style={s.sifreHata}>{sifreHatasi}</Text> : null}

            <View style={s.sifreDugmeler}>
              <TouchableOpacity
                style={[s.sifreDugme, s.sifreVazgec]}
                onPress={() => {
                  setSifreAcik(false);
                  setYeniSifre("");
                  setSifreHatasi("");
                }}
              >
                <Text style={s.sifreVazgecYazi}>Vazgeç</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  s.sifreDugme,
                  s.sifreKaydet,
                  (yeniSifre.length !== 4 || sifreKaydediliyor) && { opacity: 0.5 },
                ]}
                disabled={yeniSifre.length !== 4 || sifreKaydediliyor}
                onPress={sifreKaydet}
              >
                <Text style={s.sifreKaydetYazi}>
                  {sifreKaydediliyor ? "Kaydediliyor" : "Kaydet"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Dijital ödeme kodu                                                         */
/* ========================================================================== */

/**
 * Ödeme kodu penceresi.
 *
 * Geri sayım kodu değil gösterimi sınırlıyor: süre dolunca kod ekrandan
 * kalkıyor, personel isterse yeniden gösteriyor. Kod aynı kalıyor —
 * kasa tarafı aynı hesabı yapıyor ve başka bir değer eşleşmezdi.
 */
function OdemeKodu({ acik, veri, kapat, tazele }) {
  const [kalan, setKalan] = useState(KOD_SURESI);

  const sayacRef = useRef(null);

  useEffect(() => {
    clearInterval(sayacRef.current);

    if (!acik) return undefined;

    setKalan(KOD_SURESI);

    sayacRef.current = setInterval(() => {
      setKalan((d) => (d <= 1 ? 0 : d - 1));
    }, 1000);

    return () => clearInterval(sayacRef.current);
  }, [acik]);

  if (!veri?.kartVar) return null;

  const doldu = kalan <= 0;

  return (
    <Modal {...modalTamEkran} visible={acik} animationType="slide" onRequestClose={kapat}>
      <ModalAlani style={s.kodSayfa} edges={["top", "bottom"]}>
        <View style={s.kodBaslikSerit}>
          <TouchableOpacity style={s.kodKapat} onPress={kapat} hitSlop={10}>
            <Text style={s.kodKapatYazi}>✕</Text>
          </TouchableOpacity>

          <Text style={s.kodBaslik}>Dijital Ödeme Kodu</Text>

          <View style={s.kodKapat} />
        </View>

        <View style={s.kodGovde}>
          <Text style={s.kodUstYazi}>Kasa ödemelerinde bu kodu gösteriniz</Text>

          {doldu ? (
            <View style={s.doldu}>
              <Text style={s.dolduBaslik}>Süre doldu</Text>

              <Text style={s.dolduYazi}>
                Kod güvenlik için ekrandan kaldırıldı. Kasada sıra size
                geldiğinde yeniden gösteriniz.
              </Text>

              <TouchableOpacity
                style={s.dolduDugme}
                onPress={() => {
                  /* Sunucudan tazeleniyor: gece yarısını geçen ekranda
                     eski günün kodu kalıyordu. */
                  tazele?.();
                  setKalan(KOD_SURESI);
                }}
                activeOpacity={0.85}
              >
                <Text style={s.dolduDugmeYazi}>Kodu Yeniden Göster</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={s.kodKutu}>
                <Text style={s.kodRakam}>{veri.kod}</Text>
              </View>

              <View style={s.qrKutu}>
                {QRCode ? (
                  /* Karekod yalnızca kart numarasını taşıyor: fiziki kart
                     da barkodunda bunu taşıyor ve kasa okuttuktan sonra
                     kodu ayrıca soruyor. Kod eklenmiş bir dize,
                     okuyucunun tanımadığı bir değer üretirdi. */
                  <QRCode
                    value={veri.kartNo}
                    size={196}
                    backgroundColor="#fff"
                    color={renk.siyah}
                  />
                ) : (
                  <Barkod deger={veri.kartNo} genislik={196} yukseklik={70} />
                )}

                <Text style={s.qrKod}>KOD: {veri.kod}</Text>
              </View>

              <View style={s.sayacSatir}>
                <Simge ad="takvim" boyut={17} renkli={renk.pasif} />
                <Text style={s.sayacYazi}>Kalan Süre: {sureYaz(kalan)}</Text>
              </View>

              <View style={s.sayacYol}>
                <View
                  style={[
                    s.sayacDolu,
                    { width: `${(kalan / KOD_SURESI) * 100}%` },
                  ]}
                />
              </View>

              {!veri.sifreVar ? (
                <Text style={s.kodNot}>
                  Kart şifreniz belirlenmemiş. Kasa ödeme onayında şifre
                  isterse kartınız kullanılamaz.
                </Text>
              ) : null}
            </>
          )}
        </View>
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */
/* Kart bilgilerini güncelle                                                  */
/* ========================================================================== */

/**
 * Alışveriş tercihi penceresi.
 *
 * <p>
 * Kart numarası buradan girilmiyor: kart personele cep telefonuyla
 * eşleştiriliyor ve eşleştirmeyi İnsan Kaynakları yapıyor. Personelin
 * kendi kartını tanımlaması, yanlış numarayla başkasının kartına
 * bağlanmaya açıktı.
 * </p>
 *
 * <p>
 * Tercih doğrudan kartın grup numarasına yazılıyor: mobil uygulama
 * seçilirse 608, fiziki kart seçilirse boş. Kasa kartı bu numaraya
 * bakarak ayırıyor.
 * </p>
 */
function KartGuncelle({ acik, veri, kapat, bitti }) {
  const [mobil, setMobil] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [sifre, setSifre] = useState("");
  const [sifreTekrar, setSifreTekrar] = useState("");
  const [hata, setHata] = useState("");

  /* Pencere her açılışta kartın o anki durumuyla doluyor: önceki
     denemeden kalan seçim yanlış tercihi göndermeye açıktı. */
  useEffect(() => {
    if (!acik) return;

    setMobil(veri?.kartVar ? !!veri.mobilKart : true);
    setSifre("");
    setSifreTekrar("");
    setHata("");
  }, [acik, veri]);

  /* 09.10.2026: fiziki karta geçerken yeni şifre zorunlu; zaten fiziki ve
     şifreli kartta şifre değiştirmek isteğe bağlı. Mobile geçince
     kartın şifresi sunucuda silinir. */
  const fizikiyeGecis = !mobil && (!!veri?.mobilKart || !veri?.sifreVar);
  const sifreGerekli = !mobil && fizikiyeGecis;
  const sifreYazildi = sifre.length > 0 || sifreTekrar.length > 0;
  const sifreUygun = sifre.length === 4 && sifre === sifreTekrar;
  const kaydedilebilir = mobil || (sifreGerekli ? sifreUygun : !sifreYazildi || sifreUygun);

  const kaydet = async () => {
    setKaydediliyor(true);
    setHata("");

    try {
      await api.gonder("/api/Mobil/GiftKartGuncelle", {
        mobil,
        sifre: !mobil && sifreUygun ? sifre : undefined,
      });

      Alert.alert(
        "Kaydedildi",
        mobil
          ? "Kartınız mobil uygulama ile kullanılacak. Kasada ödeme kodu sorulur; kart şifreniz silindi."
          : "Kartınız fiziki kart olarak kullanılacak. Kasada yeni kart şifreniz sorulur."
      );

      bitti?.();
    } catch (e) {
      setHata(e?.message ?? "Tekrar deneyiniz.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      {/* Şifre alanları klavyenin altında kalmasın */}
      <KeyboardAvoidingView style={s.serit} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={kapat} />

        <View style={s.seritKutu}>
          <View style={s.seritUst}>
            <Text style={s.seritBaslik}>Alışveriş Tercihi</Text>

            <TouchableOpacity onPress={kapat} hitSlop={10}>
              <Text style={s.seritKapat}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.adimNot}>
            Kartınızı kasada nasıl kullanacağınızı seçiniz. Seçim bakiyenizi
            ve puan geçmişinizi etkilemez.
          </Text>

          <View style={s.tercihSerit}>
            {[
              { deger: true, ad: "Mobil Uygulama", simge: "kare" },
              { deger: false, ad: "Fiziki Kart", simge: "kutu" },
            ].map((x) => (
              <TouchableOpacity
                key={String(x.deger)}
                style={[s.tercih, mobil === x.deger && s.tercihSecili]}
                activeOpacity={0.85}
                onPress={() => setMobil(x.deger)}
              >
                {/* Simgeler her zaman dolgulu: çizgili sürümü olmayan
                    adlar seçili değilken boş daireye düşüyordu. */}
                <Simge
                  ad={x.simge}
                  boyut={21}
                  renkli={mobil === x.deger ? renk.beyaz : renk.pasif}
                  dolgu
                />

                <Text
                  style={[s.tercihYazi, mobil === x.deger && s.tercihYaziSecili]}
                >
                  {x.ad}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.tercihNot}>
            {mobil
              ? "Kasada uygulamadaki karekod ya da dört haneli kod okutulur."
              : "Kasada plastik kartınız okutulur; uygulamadan ödeme kodu üretilmez."}
          </Text>

          {mobil && veri?.sifreVar ? (
            <Text style={s.tercihUyari}>
              Mobil kullanımda kart şifresi tutulmaz; kaydettiğinizde şifreniz silinir.
            </Text>
          ) : null}

          {!mobil ? (
            <View style={s.tercihSifre}>
              <Text style={s.tercihSifreBaslik}>
                {sifreGerekli ? "Yeni kart şifresi belirleyin" : "Şifreyi değiştirmek isterseniz"}
              </Text>
              <Text style={s.tercihSifreNot}>
                Kasada plastik kartla ödemede bu dört haneli şifre sorulur. Aynı ya da sıralı
                rakamlar (1111, 1234) kabul edilmez.
              </Text>

              <View style={s.tercihSifreSatir}>
                <TextInput
                  style={s.tercihSifreGirdi}
                  value={sifre}
                  onChangeText={(d) => setSifre(d.replace(/\D/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  placeholder="Yeni şifre"
                  placeholderTextColor="#b9c0b5"
                  textAlign="center"
                />
                <TextInput
                  style={s.tercihSifreGirdi}
                  value={sifreTekrar}
                  onChangeText={(d) => setSifreTekrar(d.replace(/\D/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  placeholder="Tekrar"
                  placeholderTextColor="#b9c0b5"
                  textAlign="center"
                />
              </View>

              {sifreTekrar.length === 4 && sifre !== sifreTekrar ? (
                <Text style={s.sifreHata}>Şifreler aynı değil.</Text>
              ) : null}
            </View>
          ) : null}

          {hata ? <Text style={s.sifreHata}>{hata}</Text> : null}

          <TouchableOpacity
            style={[s.kaydet, (kaydediliyor || !kaydedilebilir) && { opacity: 0.5 }]}
            disabled={kaydediliyor || !kaydedilebilir}
            onPress={kaydet}
            activeOpacity={0.85}
          >
            <Text style={s.kaydetYazi}>
              {kaydediliyor ? "KAYDEDİLİYOR" : "KAYDET"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },

  /* Tercih penceresinde şifre (09.10.2026) */
  tercihUyari: {
    marginTop: 10,
    fontSize: 12.5,
    lineHeight: 18,
    color: "#a15c07",
    backgroundColor: "#fff6e6",
    borderRadius: 10,
    padding: 10,
  },
  tercihSifre: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#f6f8f4",
    borderWidth: 1,
    borderColor: "#e3e8de",
  },
  tercihSifreBaslik: { fontSize: 14, fontWeight: "800", color: renk.siyah },
  tercihSifreNot: { fontSize: 12, lineHeight: 17, color: renk.pasif, marginTop: 4 },
  tercihSifreSatir: { flexDirection: "row", gap: 10, marginTop: 10 },
  tercihSifreGirdi: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8ded3",
    backgroundColor: "#fff",
    fontSize: 18,
    letterSpacing: 3,
    color: renk.siyah,
  },
  govde: { padding: 14, paddingBottom: 34 },

  /* ------------------------------------------------------------------ kart */

  kart: {
    borderRadius: 22,
    overflow: "hidden",
    padding: 18,
    backgroundColor: "#f15a22",
    shadowColor: "#8f2d08",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },
  kartUst: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  /* Logo yüksekliğe göre ölçekleniyor; genişlik oranı görselden geliyor.
     Sabit genişlik vermek, farklı oranlı bir logo konduğunda görseli
     eziyordu. */
  logo: { height: 30, width: 104 },
  kartSag: { flexDirection: "row", alignItems: "center", gap: 10 },
  kip: {
    backgroundColor: "rgba(255,255,255,.22)",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  kipYazi: {
    fontSize: 9.5,
    fontWeight: "800",
    color: renk.beyaz,
    letterSpacing: 0.8,
  },

  kartNo: {
    fontSize: 19,
    fontWeight: "700",
    color: "#fff3ea",
    letterSpacing: 2.4,
    marginTop: 18,

    /* Kabartma izlenimi: koyu gölge biraz aşağıda. */
    textShadowColor: "rgba(102,30,0,.55)",
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 1.5,
  },

  kartOrta: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  kartEtiket: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,.75)",
    letterSpacing: 0.9,
  },
  bakiye: {
    fontSize: 28,
    fontWeight: "800",
    color: renk.beyaz,
    letterSpacing: -0.8,
    marginTop: 2,
    textShadowColor: "rgba(102,30,0,.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  bakiyeNot: { fontSize: 11.5, color: "rgba(255,255,255,.85)", marginTop: 5 },

  barkodSerit: {
    backgroundColor: renk.beyaz,
    borderRadius: 11,
    padding: 10,
    alignItems: "center",
    marginTop: 16,
  },

  /* ----------------------------------------------------------- şifre satırı */

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  satirEtiket: { fontSize: 11.5, color: renk.pasif, fontWeight: "600" },
  satirDeger: { fontSize: 15, fontWeight: "800", color: renk.metin, marginTop: 1 },
  satirDugme: {
    backgroundColor: renk.turuncuAcik,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  satirDugmeYazi: {
    fontSize: 12,
    fontWeight: "800",
    color: renk.turuncu,
    letterSpacing: 0.4,
  },

  /* ---------------------------------------------------------------- düğmeler */

  odeDugme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: renk.turuncu,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 12,
  },
  odeDugmePasif: { backgroundColor: "#b6bab4" },
  odeYazi: {
    fontSize: 14.5,
    fontWeight: "800",
    color: renk.beyaz,
    letterSpacing: 0.5,
  },
  odeNot: {
    fontSize: 11.5,
    color: renk.pasif,
    lineHeight: 17,
    marginTop: 7,
    paddingHorizontal: 4,
  },

  guncelleDugme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderWidth: 1.5,
    borderColor: renk.turuncu,
    backgroundColor: renk.beyaz,
    borderRadius: 16,
    paddingVertical: 15,
    marginTop: 12,
  },
  guncelleYazi: {
    fontSize: 13,
    fontWeight: "800",
    color: renk.turuncu,
    letterSpacing: 0.3,
  },

  /* --------------------------------------------------------------- hareket */

  bolum: {
    fontSize: 15,
    fontWeight: "800",
    color: renk.metin,
    marginTop: 22,
    marginBottom: 9,
  },
  hareket: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  hareketCizgi: { borderTopWidth: 1, borderTopColor: renk.cizgi },
  hareketSimge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: renk.yesilAcik,
  },
  hareketIsaret: { fontSize: 17, fontWeight: "800", lineHeight: 20 },
  hareketAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  hareketTarih: { fontSize: 11, color: renk.pasif, marginTop: 2 },
  hareketTutar: { fontSize: 14, fontWeight: "800" },

  bilgiBaslik: { fontSize: 15, fontWeight: "700", color: renk.metin },
  bilgiYazi: { fontSize: 13, color: renk.pasif, marginTop: 7, lineHeight: 19 },

  /* ------------------------------------------------------------ ödeme kodu */

  kodSayfa: { flex: 1, backgroundColor: renk.beyaz },
  kodBaslikSerit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  kodKapat: { width: 34, alignItems: "flex-start" },
  kodKapatYazi: { fontSize: 22, color: renk.metin, fontWeight: "600" },
  kodBaslik: { fontSize: 17.5, fontWeight: "800", color: renk.metin },

  kodGovde: { flex: 1, alignItems: "center", paddingHorizontal: 26, paddingTop: 26 },
  kodUstYazi: { fontSize: 14.5, color: renk.pasif, textAlign: "center" },

  kodKutu: {
    borderWidth: 2,
    borderColor: renk.turuncu,
    backgroundColor: renk.turuncuAcik,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 34,
    marginTop: 26,
  },
  kodRakam: {
    fontSize: 46,
    fontWeight: "800",
    color: renk.turuncu,
    letterSpacing: 9,
  },

  qrKutu: {
    alignItems: "center",
    backgroundColor: renk.beyaz,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    shadowColor: "#1d2126",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  qrKod: {
    fontSize: 13,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: 3,
    marginTop: 14,
  },

  sayacSatir: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 26 },
  sayacYazi: { fontSize: 16, color: renk.pasif, fontWeight: "600" },
  sayacYol: {
    width: "100%",
    height: 7,
    borderRadius: 4,
    backgroundColor: renk.cizgi,
    marginTop: 14,
    overflow: "hidden",
  },
  sayacDolu: { height: 7, borderRadius: 4, backgroundColor: renk.yesil },

  kodNot: {
    fontSize: 12,
    color: renk.turuncu,
    textAlign: "center",
    marginTop: 18,
    lineHeight: 17,
  },

  doldu: { alignItems: "center", marginTop: 50 },
  dolduBaslik: { fontSize: 19, fontWeight: "800", color: renk.metin },
  dolduYazi: {
    fontSize: 13.5,
    color: renk.pasif,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 9,
  },
  dolduDugme: {
    backgroundColor: renk.turuncu,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 22,
  },
  dolduDugmeYazi: { fontSize: 14, fontWeight: "800", color: renk.beyaz },

  /* ----------------------------------------------------------------- şerit */

  serit: { flex: 1, backgroundColor: "rgba(20,24,18,.5)" },
  seritKutu: {
    backgroundColor: renk.beyaz,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 20,
    paddingBottom: 30,
  },
  seritUst: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  seritBaslik: { fontSize: 17.5, fontWeight: "800", color: renk.metin },
  seritKapat: { fontSize: 21, color: renk.pasif, fontWeight: "600" },

  adimNot: {
    fontSize: 12.5,
    color: renk.pasif,
    lineHeight: 18,
    marginBottom: 14,
  },
  tercihNot: {
    fontSize: 12,
    color: renk.pasif,
    lineHeight: 17,
    marginTop: 12,
  },

  tercihSerit: { flexDirection: "row", gap: 10 },
  tercih: {
    flex: 1,
    alignItems: "center",
    gap: 7,
    backgroundColor: "#f2f3f0",
    borderRadius: 14,
    paddingVertical: 15,
  },
  tercihSecili: { backgroundColor: renk.turuncu },
  tercihYazi: { fontSize: 13.5, fontWeight: "700", color: renk.pasif },
  tercihYaziSecili: { color: renk.beyaz },

  kaydet: {
    backgroundColor: renk.turuncu,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  kaydetYazi: {
    fontSize: 14.5,
    fontWeight: "800",
    color: renk.beyaz,
    letterSpacing: 0.5,
  },

  /* ----------------------------------------------------------------- şifre */

  zemin: {
    flex: 1,
    backgroundColor: "rgba(20,24,18,.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  sifreKutu: {
    backgroundColor: renk.beyaz,
    borderRadius: 20,
    padding: 22,
    width: "100%",
    maxWidth: 330,
  },
  sifreBaslik: { fontSize: 16, fontWeight: "800", color: renk.metin },
  sifreNot: { fontSize: 12.5, color: renk.pasif, marginTop: 7, lineHeight: 18 },
  sifreGirdi: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    paddingVertical: 14,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 14,
    color: renk.metin,
    backgroundColor: renk.zemin,
  },
  sifreHata: { fontSize: 12.5, color: renk.turuncu, marginTop: 9 },
  sifreDugmeler: { flexDirection: "row", gap: 9, marginTop: 18 },
  sifreDugme: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  sifreVazgec: { backgroundColor: renk.zemin },
  sifreVazgecYazi: { fontSize: 14, fontWeight: "700", color: renk.metin },
  sifreKaydet: { backgroundColor: renk.turuncu },
  sifreKaydetYazi: { fontSize: 14, fontWeight: "800", color: renk.beyaz },
});

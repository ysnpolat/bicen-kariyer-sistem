/**
 * Rakip Fiyat (11.10.2026, uygulama 1.7)
 * ---------------------------------------------------------------------------
 * Üç adım:
 *   1. Rakip seçimi: arama, son kullanılanlar, bütün rakipler. Rakip çok
 *      olduğunda eski ekranda düğmeler sayfayı dolduruyordu. Seçilen rakip
 *      telefonda hatırlanıyor; ekran açılınca doğrudan okutmaya geçiliyor.
 *   2. Barkod okutma: Fiyat Kontrol'deki kamera şablonuyla aynı. Altında
 *      bu kişinin o rakipte bugün okuttukları.
 *   3. Fiyat: bizim BiCard ve raf fiyatımız yan yana; rakibin indirimli
 *      (zorunlu) ve indirimsiz (üstü çizili, isteğe bağlı) fiyatı. İki
 *      karşılaştırma canlı: BiCard ↔ indirimli, raf ↔ indirimsiz.
 *
 * Klavye: yeni Android'de pencere klavyeye göre küçülmüyor; Kaydet'in
 * bulunduğu alt şerit klavye yüksekliği kadar yukarı alınıyor.
 *
 * 12.10.2026: rakip logoları (portaldan eklenen), okutulan ürünün görseli
 * (Fiyat Kontrol'deki kapak görseli) ve aynı gün düzeltme: yanlış rakip
 * seçildiyse ya da fiyat yanlış yazıldıysa bugünkü okutma düzeltilebiliyor
 * ya da silinebiliyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Keyboard,
  Platform,
  Image,
  FlatList,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";

import {
  rakipFormAl,
  rakipBarkodSorgula,
  rakipFiyatKaydet,
  rakipSonAl,
  rakipBugunAl,
  rakipGecmisAl,
  rakipFiyatDuzelt,
  rakipFiyatSil,
  rakipLogoAdresi,
  fiyatGorselAdresi,
} from "../api360";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import Simge from "../bilesenler/Simge";
import AltSayfa from "../bilesenler/AltSayfa";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";

const FIRMA_ANAHTARI = "rakipFiyatFirma";

/* -------------------------------------------------------------- yardımcılar */

const para = (v) =>
  v === null || v === undefined
    ? "—"
    : `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

/** "1.299,95" / "189,95" / "189.95" → sayı */
const sayiYap = (t) => {
  let m = String(t ?? "").replace(/[^\d.,]/g, "");
  if (!m) return null;
  if (m.includes(",")) m = m.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}$/.test(m)) m = m.replace(/\./g, "");
  const v = parseFloat(m);
  return Number.isFinite(v) ? v : null;
};

/** Sayıyı girdi kutusuna: 189.95 → "189,95" */
const girdiYaz = (v) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

const saatYaz = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const yuzdeYaz = (v) =>
  `%${Math.abs(v).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;

/** Karşılaştırma: bizim − rakip */
const kiyasla = (biz, rakip) => {
  if (biz == null || rakip == null || rakip <= 0) return null;
  const fark = biz - rakip;
  const yuzde = (fark / rakip) * 100;
  if (Math.abs(fark) < 0.005) return { tur: "esit", fark, yuzde, kisa: "eşit" };
  return {
    tur: fark > 0 ? "pahali" : "ucuz",
    fark,
    yuzde,
    kisa: `${yuzdeYaz(yuzde)} ${fark > 0 ? "pahalı" : "ucuz"}`,
    uzun: `${para(Math.abs(fark))} ${fark > 0 ? "pahalı" : "ucuz"} · ${yuzdeYaz(yuzde)}`,
  };
};

const HAP = {
  pahali: { renk: "#a8071a", zemin: "#fff1f0" },
  ucuz: { renk: "#3f6212", zemin: "#f2f9e8" },
  esit: { renk: "#4b5563", zemin: "#f1f3ef" },
};

const ROZET_RENK = ["#e8481c", "#e07b00", "#1a4d80", "#cf1322", "#ad4e00", "#3f6212", "#722ed1", "#1d2126", "#5f8c10"];
const rozetRengi = (id) => ROZET_RENK[Math.abs(Number(id) || 0) % ROZET_RENK.length];
const basHarf = (ad) => (ad || "?").trim().charAt(0).toLocaleUpperCase("tr-TR");

const sonYaz = (f) => {
  if (f.bugun > 0) return `bugün ${f.bugun} okutma`;
  if (!f.son) return "hiç okutmadınız";
  const gun = Math.floor((Date.now() - new Date(f.son).getTime()) / 86400000);
  if (gun <= 1) return "dün";
  if (gun < 7) return `${gun} gün önce`;
  if (gun < 30) return `${Math.floor(gun / 7)} hafta önce`;
  return `${Math.floor(gun / 30)} ay önce`;
};

/* ========================================================================== */

export default function RakipFiyat() {
  const [form, setForm] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState(null);

  const [adim, setAdim] = useState("firma"); // firma | okut | fiyat
  const [firmaId, setFirmaId] = useState(null);
  const [ara, setAra] = useState("");

  const [kameraAcik, setKameraAcik] = useState(false);
  const [izin, izinIste] = useCameraPermissions();
  const sonOkutma = useRef({ deger: "", zaman: 0 });

  const [barkod, setBarkod] = useState("");
  const [urun, setUrun] = useState(null);
  const [sorgulaniyor, setSorgulaniyor] = useState(false);

  const [indirimli, setIndirimli] = useState("");
  const [indirimsiz, setIndirimsiz] = useState("");
  const [not, setNot] = useState("");
  const [notAcik, setNotAcik] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const [son, setSon] = useState({ bugun: 0, kayitlar: [] });
  const [bildirim, setBildirim] = useState(null);

  /* Aynı gün düzeltme (1.7): düzeltilen kayıt ve bugünkü bütün okutmalar */
  const [duzelt, setDuzelt] = useState(null);
  const [bugunAcik, setBugunAcik] = useState(false);
  const [bugunListe, setBugunListe] = useState(null);
  const [gecmisAcik, setGecmisAcik] = useState(false);
  const [gecmisSurum, setGecmisSurum] = useState(0);

  const indirimliKutu = useRef(null);
  const indirimsizKutu = useRef(null);

  /* Klavye yüksekliği: alt şerit (Kaydet) bu kadar yukarı alınıyor */
  const [klavye, setKlavye] = useState(0);
  useEffect(() => {
    const ac = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setKlavye(e?.endCoordinates?.height ?? 0)
    );
    const kapa = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKlavye(0));
    return () => {
      ac.remove();
      kapa.remove();
    };
  }, []);

  /* ---------------------------------------------------------- veri */
  useFocusEffect(
    useCallback(() => {
      let iptal = false;

      (async () => {
        try {
          const f = await rakipFormAl();
          if (iptal) return;
          setForm(f);

          /* Hatırlanan rakip hâlâ listede ise doğrudan okutmaya geçilir */
          let kayitli = null;
          try {
            kayitli = await SecureStore.getItemAsync(FIRMA_ANAHTARI);
          } catch {
            kayitli = null;
          }
          const id = Number(kayitli);
          if (id && (f?.firmalar ?? []).some((x) => x.id === id)) {
            setFirmaId((o) => o ?? id);
            setAdim((o) => (o === "firma" ? "okut" : o));
          }
        } catch (h) {
          if (!iptal) setHata(h.message);
        } finally {
          if (!iptal) setYukleniyor(false);
        }
      })();

      return () => {
        iptal = true;
      };
    }, [])
  );

  const firmalar = form?.firmalar ?? [];
  const firma = firmalar.find((x) => x.id === firmaId) ?? null;

  const sonuGetir = useCallback(async (id) => {
    if (!id) return;
    try {
      setSon(await rakipSonAl(id));
    } catch {
      /* liste ikinci planda; okutmayı engellemesin */
    }
  }, []);

  const bugunuGetir = useCallback(async () => {
    try {
      const d = await rakipBugunAl();
      setBugunListe(d?.kayitlar ?? []);
    } catch (h) {
      setBugunListe([]);
      Alert.alert("Okutmalar alınamadı", h.message);
    }
  }, []);

  /* Düzeltme ya da silmeden sonra: liste, bugünkü sayılar */
  const duzeltildi = useCallback(async () => {
    setDuzelt(null);
    sonuGetir(firmaId);
    if (bugunAcik) bugunuGetir();
    if (gecmisAcik) setGecmisSurum((x) => x + 1);
    try {
      setForm(await rakipFormAl());
    } catch {
      /* sayılar bir sonraki açılışta */
    }
  }, [firmaId, bugunAcik, gecmisAcik, sonuGetir, bugunuGetir]);

  const bugunuAc = () => {
    setKameraAcik(false);
    setBugunListe(null);
    setBugunAcik(true);
    bugunuGetir();
  };

  useEffect(() => {
    if (firmaId && adim === "okut") sonuGetir(firmaId);
  }, [firmaId, adim, sonuGetir]);

  /* ---------------------------------------------------------- adımlar */
  const firmaSec = async (id) => {
    setFirmaId(id);
    setAra("");
    setAdim("okut");
    setBildirim(null);
    try {
      await SecureStore.setItemAsync(FIRMA_ANAHTARI, String(id));
    } catch {
      /* hatırlanamazsa bir dahaki açılışta yeniden seçilir */
    }
  };

  const kameraAc = async () => {
    if (!izin?.granted) {
      const c = await izinIste();
      if (!c.granted) {
        Alert.alert("Kamera izni gerekiyor", "Barkod ve karekod okutmak için kamera izni veriniz.");
        return;
      }
    }
    sonOkutma.current = { deger: "", zaman: 0 };
    setKameraAcik(true);
  };

  const sorgula = async (deger) => {
    const kod = (deger ?? "").trim();
    if (!kod) return;

    setKameraAcik(false);
    setSorgulaniyor(true);
    Keyboard.dismiss();

    try {
      const d = await rakipBarkodSorgula(kod);
      /* Karekodda sunucu içinden çıkan barkodu döndürüyor (13.10.2026) */
      const cozulen = d?.barkod || kod;
      setUrun({ ...d, barkod: cozulen });
      setBarkod(cozulen);
      setIndirimli("");
      setIndirimsiz("");
      setNot("");
      setNotAcik(false);
      setBildirim(null);
      setAdim("fiyat");
      setTimeout(() => indirimsizKutu.current?.focus(), 300);
    } catch (h) {
      Alert.alert("Sorgulanamadı", h.message);
    } finally {
      setSorgulaniyor(false);
    }
  };

  const okundu = ({ data }) => {
    const simdi = Date.now();
    if (data === sonOkutma.current.deger && simdi - sonOkutma.current.zaman < 2500) return;
    sonOkutma.current = { deger: data, zaman: simdi };
    sorgula(data);
  };

  /* ---------------------------------------------------------- hesaplar */
  /* 23.10.2026: rakibin normal (indirimsiz) fiyatı birinci ve zorunlu
     kutu; indirim varsa ikinci kutuya indirimli fiyat. Müşterinin ödediği
     (rakipFiyat) indirimli varsa o, yoksa indirimsiz. */
  const indGirilen = sayiYap(indirimli);
  const indsiz = sayiYap(indirimsiz);
  const ind = indGirilen ?? indsiz;
  const rakipListe = indsiz ?? ind;

  const bicard = urun?.bicardFiyat > 0 ? urun.bicardFiyat : null;
  const raf = urun?.rafFiyat ?? null;
  const satis = bicard ?? raf ?? urun?.bizimFiyat ?? null;

  const k1 = kiyasla(satis, ind);
  const k2 = kiyasla(raf, rakipListe);

  const kaydet = async () => {
    if (!firmaId) return Alert.alert("Eksik", "Rakip seçiniz.");
    if (!barkod) return Alert.alert("Eksik", "Barkod okutunuz.");
    if (!ind || ind <= 0) return Alert.alert("Eksik", "Rakibin raftaki fiyatını yazınız.");
    if (indsiz != null && indsiz > 0 && indGirilen != null && indsiz < indGirilen)
      return Alert.alert("Kontrol edin", "İndirimli fiyat, normal fiyattan büyük olamaz.");

    setGonderiliyor(true);
    Keyboard.dismiss();

    try {
      const d = await rakipFiyatKaydet({
        firmaId,
        barkod,
        rakipFiyat: ind,
        rakipListeFiyat: indGirilen != null && indsiz != null && indsiz > indGirilen ? indsiz : null,
        not: not.trim() || null,
      });

      const kd = kiyasla(d?.bizimFiyat, ind);
      setBildirim({
        urunAdi: d?.urunAdi ?? urun?.urunAdi ?? barkod,
        metin: kd
          ? `${d?.fiyatTuru === "bicard" ? "BiCard ile " : ""}${kd.tur === "esit" ? "rakiple eşitiz" : kd.uzun}`
          : "Fiyatımız bulunamadığı için fark hesaplanmadı.",
      });

      setUrun(null);
      setBarkod("");
      setIndirimli("");
      setIndirimsiz("");
      setNot("");
      setAdim("okut");
      sonuGetir(firmaId);
      kameraAc();
    } catch (h) {
      Alert.alert("Kaydedilemedi", h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  /* ---------------------------------------------------------- ekran */
  if (yukleniyor) return <Yukleniyor />;

  const geri = gecmisAcik
    ? () => setGecmisAcik(false)
    : bugunAcik
    ? () => setBugunAcik(false)
    : adim === "fiyat"
    ? () => setAdim("okut")
    : adim === "okut"
    ? () => {
        setKameraAcik(false);
        setAdim("firma");
      }
    : undefined;

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <BarBaslik
        ad={gecmisAcik ? "Okuttuğum fiyatlar" : bugunAcik ? "Bugünkü okutmalarım" : "Rakip Fiyat"}
        acik
        kendi
        geri={geri}
      />

      {gecmisAcik && <GecmisListesi surum={gecmisSurum} sec={setDuzelt} />}

      {!gecmisAcik && !bugunAcik && <AdimSeridi adim={adim} firma={firma} />}

      {!gecmisAcik && bugunAcik && (
        <BugunListesi liste={bugunListe} firmalar={firmalar} sec={setDuzelt} yenile={bugunuGetir} />
      )}

      {!gecmisAcik && !bugunAcik && adim === "firma" && (
        <FirmaSecimi
          firmalar={firmalar}
          seciliId={firmaId}
          ara={ara}
          setAra={setAra}
          sec={firmaSec}
          hata={hata}
          bugunSayi={firmalar.reduce((a, f) => a + (f.bugun ?? 0), 0)}
          bugunuAc={bugunuAc}
          gecmisiAc={() => {
            setKameraAcik(false);
            setGecmisAcik(true);
          }}
        />
      )}

      {!gecmisAcik && !bugunAcik && adim === "okut" && (
        <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
          <FirmaSeridi firma={firma} degistir={() => { setKameraAcik(false); setAdim("firma"); }} />

          {bildirim && (
            <View style={s.bildirim}>
              <View style={s.bildirimSimge}>
                <Simge ad="onay" boyut={16} renkli={renk.beyaz} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.bildirimBaslik}>Kaydedildi</Text>
                <Text style={s.bildirimMetin} numberOfLines={2}>
                  {bildirim.urunAdi} · {bildirim.metin}
                </Text>
              </View>
            </View>
          )}

          {kameraAcik && izin?.granted ? (
            <View style={[s.kameraKutu, bildirim && { height: 240 }]}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr", "datamatrix"] }}
                onBarcodeScanned={okundu}
              />
              {/* Kaplama kameranın kardeşi: yeni mimaride kameranın içi çizilmiyor */}
              <View style={s.kameraKaplama} pointerEvents="box-none">
                <View style={s.hedef}>
                  <View style={[s.kose, s.koseSolUst]} />
                  <View style={[s.kose, s.koseSagUst]} />
                  <View style={[s.kose, s.koseSolAlt]} />
                  <View style={[s.kose, s.koseSagAlt]} />
                </View>
                <Text style={s.kameraYazi}>
                  {bildirim ? "Sonraki ürünün barkodunu ya da karekodunu okutun" : "Barkodu ya da karekodu çerçeveye alınız"}
                </Text>
                <TouchableOpacity style={s.kameraKapat} onPress={() => setKameraAcik(false)}>
                  <Text style={s.kameraKapatYazi}>Kamerayı kapat</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.okutDugme} activeOpacity={0.85} onPress={kameraAc}>
              <Simge ad="kare" boyut={18} renkli={renk.beyaz} />
              <Text style={s.okutYazi}>Barkod okut</Text>
            </TouchableOpacity>
          )}

          <View style={s.elleSatir}>
            <TextInput
              style={s.girdi}
              value={barkod}
              onChangeText={setBarkod}
              keyboardType="number-pad"
              placeholder="ya da barkodu elle yazınız"
              placeholderTextColor="#8a9184"
              returnKeyType="search"
              onSubmitEditing={() => sorgula(barkod)}
            />
            <TouchableOpacity style={s.sorguDugme} onPress={() => sorgula(barkod)} disabled={sorgulaniyor}>
              {sorgulaniyor ? <ActivityIndicator /> : <Text style={s.sorguYazi}>Sorgula</Text>}
            </TouchableOpacity>
          </View>

          <SonOkutmalar firma={firma} son={son} duzelt={setDuzelt} bugunuAc={bugunuAc} />
        </ScrollView>
      )}

      {!bugunAcik && adim === "fiyat" && (
        <View style={{ flex: 1, paddingBottom: klavye }}>
          <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
            <View style={[s.urunKart, urun?.gorselId && { flexDirection: "column", alignItems: "stretch" }]}>
              {/* Ürün görseli (1.7): Fiyat Kontrol'deki gibi büyük; rakip
                  rafındaki ürünle karşılaştırmak kolaylaşıyor */}
              {urun?.gorselId ? <BuyukGorsel id={urun.gorselId} /> : <UrunGorseli id={null} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.urunAd}>{urun?.urunAdi ?? "Stok kartlarımızda bulunamadı"}</Text>
                <Text style={s.urunAlt}>
                  {barkod}
                  {urun?.stokKodu ? ` · stok ${urun.stokKodu}` : ""}
                </Text>
              </View>
            </View>

            {urun?.bulundu === false ? (
              <Text style={s.ipucu}>
                Bu barkod bizde yok; rakibin fiyatını yine de kaydedebilirsiniz, karşılaştırma yapılmaz.
              </Text>
            ) : (
              <>
                <Text style={s.bolumBaslik}>Bizim fiyatımız</Text>
                <View style={s.ikili}>
                  <View style={[s.fiyatKutu, bicard != null ? s.fiyatKutuBicard : null]}>
                    <Text style={[s.fiyatEtiket, bicard != null && { color: "#3f6212" }]}>BiCARD FİYATI</Text>
                    <Text style={[s.fiyatDeger, bicard != null && { color: "#3f6212" }]}>
                      {bicard != null ? para(bicard) : "yok"}
                    </Text>
                    <Text style={[s.fiyatAlt, bicard != null && { color: "#3f6212" }]}>
                      {bicard != null ? "müşteriye uygulanan" : "raf fiyatı geçerli"}
                    </Text>
                  </View>
                  <View style={[s.fiyatKutu, bicard == null && raf != null ? s.fiyatKutuBicard : null]}>
                    <Text style={s.fiyatEtiket}>RAF FİYATI</Text>
                    <Text style={s.fiyatDeger}>{para(raf)}</Text>
                    <Text style={s.fiyatAlt}>1. fiyat</Text>
                  </View>
                </View>
              </>
            )}

            <Text style={s.bolumBaslik}>{firma?.ad ?? "Rakip"} raftaki fiyatı</Text>
            <View style={s.ikili}>
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => indirimsizKutu.current?.focus()}
                style={[s.girisKutu, { borderColor: renk.turuncu, borderWidth: 1.5 }]}
              >
                <Text style={[s.girisEtiket, { color: renk.turuncuKoyu }]}>Normal fiyat *</Text>
                <View style={s.girisSatir}>
                  <TextInput
                    ref={indirimsizKutu}
                    style={s.girisDeger}
                    value={indirimsiz}
                    onChangeText={setIndirimsiz}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                    placeholderTextColor="#b9bfb3"
                    returnKeyType="next"
                    onSubmitEditing={() => indirimliKutu.current?.focus()}
                  />
                  <Text style={s.girisTl}>₺</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={1} onPress={() => indirimliKutu.current?.focus()} style={s.girisKutu}>
                <Text style={s.girisEtiket}>İndirimli (varsa)</Text>
                <View style={s.girisSatir}>
                  <TextInput
                    ref={indirimliKutu}
                    style={s.girisDeger}
                    value={indirimli}
                    onChangeText={setIndirimli}
                    keyboardType="decimal-pad"
                    placeholder="yoksa boş"
                    placeholderTextColor="#b9bfb3"
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                  <Text style={s.girisTl}>₺</Text>
                </View>
              </TouchableOpacity>
            </View>
            <Text style={s.ipucu}>
              Rakipte indirim yoksa yalnızca normal fiyatı yazın. İndirim varsa üstü çizili fiyatı birinci, indirimli fiyatı ikinci kutuya yazın.
            </Text>

            {urun?.bulundu !== false && (
              <View style={s.kiyasKart}>
                <KiyasSatiri
                  baslik={bicard != null ? "BiCard ↔ rakibin satış fiyatı" : "Raf ↔ rakibin satış fiyatı"}
                  alt={ind != null ? `${para(satis)} ↔ ${para(ind)}${indGirilen == null ? " (indirim yok)" : ""}` : "fiyatı yazınız"}
                  kiyas={k1}
                  cizgi
                />
                <KiyasSatiri
                  baslik="Raf ↔ rakibin normal fiyatı"
                  alt={
                    rakipListe != null
                      ? `${para(raf)} ↔ ${para(rakipListe)}${rakipListe === ind ? " (rakipte indirim yok)" : ""}`
                      : "—"
                  }
                  kiyas={k2}
                />
              </View>
            )}

            {notAcik ? (
              <TextInput
                style={[s.girdi, { minHeight: 70, textAlignVertical: "top", marginTop: 12, flex: 0 }]}
                value={not}
                onChangeText={setNot}
                placeholder="Not (ör. kampanya, 2 al 1 öde)"
                placeholderTextColor="#8a9184"
                multiline
              />
            ) : (
              <TouchableOpacity style={s.notDugme} onPress={() => setNotAcik(true)}>
                <Text style={s.notYazi}>+ Not ekle (isteğe bağlı)</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <View style={[s.altSerit, klavye > 0 && s.altSeritKlavye]}>
            <TouchableOpacity
              style={[s.kaydetDugme, (gonderiliyor || !ind) && { opacity: 0.55 }]}
              disabled={gonderiliyor}
              onPress={kaydet}
              activeOpacity={0.85}
            >
              {gonderiliyor ? (
                <ActivityIndicator color={renk.beyaz} />
              ) : (
                <>
                  <Simge ad="onay" boyut={18} renkli={renk.beyaz} />
                  <Text style={s.kaydetYazi}>Kaydet ve sonraki ürün</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <DuzeltSayfasi kayit={duzelt} firmalar={firmalar} kapat={() => setDuzelt(null)} bitti={duzeltildi} />
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Parçalar                                                                   */
/* ========================================================================== */

function AdimSeridi({ adim, firma }) {
  const sira = { firma: 1, okut: 2, fiyat: 3 }[adim];
  const ad = { firma: "Rakip mağaza", okut: "Ürün", fiyat: `Fiyat${firma ? ` · ${firma.ad}` : ""}` }[adim];
  return (
    <View style={s.adimSerit}>
      <Text style={s.adimYazi}>
        Adım {sira} / 3 · {ad}
      </Text>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={{
              width: n === sira ? 22 : 8,
              height: 6,
              borderRadius: 3,
              backgroundColor: n <= sira ? renk.yesil : "#d6dbd1",
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** Rakip rozeti: portaldan logo eklendiyse logo, yoksa (ya da açılmazsa) baş harf */
function Rozet({ firma, boyut = 40 }) {
  const [logoHatasi, setLogoHatasi] = useState(false);
  const logo = firma?.logo && !logoHatasi ? rakipLogoAdresi(firma.logo) : "";

  useEffect(() => setLogoHatasi(false), [firma?.logo]);

  if (logo)
    return (
      <View
        style={{
          width: boyut,
          height: boyut,
          borderRadius: Math.round(boyut / 3),
          backgroundColor: "#fff",
          borderWidth: 1,
          borderColor: renk.cizgi,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Image
          source={{ uri: logo }}
          style={{ width: boyut - 6, height: boyut - 6 }}
          resizeMode="contain"
          onError={() => setLogoHatasi(true)}
        />
      </View>
    );

  return (
    <View
      style={{
        width: boyut,
        height: boyut,
        borderRadius: Math.round(boyut / 3),
        backgroundColor: rozetRengi(firma?.id),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: Math.round(boyut * 0.42) }}>{basHarf(firma?.ad)}</Text>
    </View>
  );
}

/** Büyük ürün görseli (fiyat adımı); açılamazsa hiç yer kaplamıyor */
function BuyukGorsel({ id }) {
  const [hatali, setHatali] = useState(false);
  useEffect(() => setHatali(false), [id]);
  if (!id || hatali) return null;

  return (
    <Image
      source={{ uri: fiyatGorselAdresi(id) }}
      style={s.buyukGorsel}
      resizeMode="contain"
      onError={() => setHatali(true)}
    />
  );
}

/** Ürün görseli (Fiyat Kontrol'deki kapak görseli); yoksa kutu simgesi */
function UrunGorseli({ id, boyut = 56 }) {
  const [hatali, setHatali] = useState(false);
  useEffect(() => setHatali(false), [id]);

  return (
    <View style={[s.urunGorsel, { width: boyut, height: boyut }, id && !hatali && { backgroundColor: "#fff", borderWidth: 1, borderColor: renk.cizgi }]}>
      {id && !hatali ? (
        <Image
          source={{ uri: fiyatGorselAdresi(id) }}
          style={{ width: boyut - 4, height: boyut - 4, borderRadius: 10 }}
          resizeMode="contain"
          onError={() => setHatali(true)}
        />
      ) : (
        <Simge ad="kutu" boyut={Math.round(boyut * 0.43)} renkli="#a3aa9e" dolgu />
      )}
    </View>
  );
}

function FirmaSecimi({ firmalar, seciliId, ara, setAra, sec, hata, bugunSayi = 0, bugunuAc, gecmisiAc }) {
  const kucuk = (t) => (t || "").toLocaleLowerCase("tr-TR");

  const sonlar = useMemo(
    () =>
      firmalar
        .filter((f) => f.son)
        .sort((a, b) => new Date(b.son) - new Date(a.son))
        .slice(0, 3),
    [firmalar]
  );

  const liste = firmalar.filter((f) => !ara || kucuk(f.ad).includes(kucuk(ara)));

  return (
    <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
      {hata && <Hata metin={hata} />}

      <Text style={s.buyukBaslik}>Hangi rakip mağazadasınız?</Text>
      <Text style={s.aciklama}>Seçtiğiniz rakip, siz değiştirene kadar bütün okutmalarda kalır.</Text>

      {/* Aynı gün düzeltme: yanlış rakipte okutulan ürün buradan bulunur */}
      {bugunSayi > 0 ? (
        <TouchableOpacity style={s.bugunDugme} onPress={bugunuAc} activeOpacity={0.85}>
          <Simge ad="kalem" boyut={16} renkli={renk.yesilKoyu} />
          <View style={{ flex: 1 }}>
            <Text style={s.bugunDugmeAd}>Bugünkü okutmalarım · {bugunSayi}</Text>
            <Text style={s.bugunDugmeAlt}>Yanlış rakip ya da fiyatla kaydettiyseniz düzeltin</Text>
          </View>
          <Text style={s.ok}>›</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={s.gecmisDugme} onPress={gecmisiAc} activeOpacity={0.85}>
        <Simge ad="liste" boyut={16} renkli="#33415c" />
        <View style={{ flex: 1 }}>
          <Text style={s.gecmisDugmeAd}>Okuttuğum fiyatlar</Text>
          <Text style={s.gecmisDugmeAlt}>Bütün okutmalarınız · rakip, tarih ve ürüne göre</Text>
        </View>
        <Text style={s.ok}>›</Text>
      </TouchableOpacity>

      <View style={s.araKutu}>
        <Simge ad="liste" boyut={16} renkli="#5d6470" />
        <TextInput
          style={s.araGirdi}
          value={ara}
          onChangeText={setAra}
          placeholder="Rakip ara…"
          placeholderTextColor="#8a9184"
          autoCorrect={false}
        />
      </View>

      {firmalar.length === 0 && (
        <Text style={s.aciklama}>Tanımlı rakip yok. Portalın Yönetim sayfasından eklenmesi gerekiyor.</Text>
      )}

      {!ara && sonlar.length > 0 && (
        <>
          <Text style={s.bolumBaslik}>Son kullandıklarınız</Text>
          <View style={s.sonlar}>
            {sonlar.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[s.sonKutu, f.id === seciliId && s.sonKutuSecili]}
                onPress={() => sec(f.id)}
                activeOpacity={0.8}
              >
                <Rozet firma={f} boyut={44} />
                <Text style={s.sonAd} numberOfLines={1}>
                  {f.ad}
                </Text>
                <Text style={s.sonAlt} numberOfLines={1}>
                  {sonYaz(f)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={s.bolumBaslik}>{ara ? `Arama sonucu (${liste.length})` : `Tüm rakipler (${firmalar.length})`}</Text>
      <View style={s.listeKart}>
        {liste.map((f, i) => (
          <TouchableOpacity
            key={f.id}
            style={[s.firmaSatir, i === liste.length - 1 && { borderBottomWidth: 0 }, f.id === seciliId && { backgroundColor: renk.yesilAcik }]}
            onPress={() => sec(f.id)}
            activeOpacity={0.75}
          >
            <Rozet firma={f} />
            <View style={{ flex: 1 }}>
              <Text style={s.firmaAd}>{f.ad}</Text>
              <Text style={s.firmaAlt}>{sonYaz(f)}</Text>
            </View>
            {f.id === seciliId ? (
              <View style={s.secimIsaret}>
                <Simge ad="onay" boyut={14} renkli={renk.beyaz} />
              </View>
            ) : (
              <Text style={s.ok}>›</Text>
            )}
          </TouchableOpacity>
        ))}
        {liste.length === 0 && ara ? <Text style={s.bosYazi}>“{ara}” ile eşleşen rakip yok.</Text> : null}
      </View>
    </ScrollView>
  );
}

function FirmaSeridi({ firma, degistir }) {
  if (!firma) return null;
  return (
    <TouchableOpacity style={s.firmaSerit} onPress={degistir} activeOpacity={0.8}>
      <Rozet firma={firma} boyut={36} />
      <View style={{ flex: 1 }}>
        <Text style={s.firmaSeritEtiket}>RAKİP</Text>
        <Text style={s.firmaSeritAd}>{firma.ad}</Text>
      </View>
      <Text style={s.degistir}>Değiştir</Text>
    </TouchableOpacity>
  );
}

function Hap({ kiyas, onek = "" }) {
  if (!kiyas) return null;
  const r = HAP[kiyas.tur];
  return (
    <View style={[s.hap, { backgroundColor: r.zemin }]}>
      <Text style={[s.hapYazi, { color: r.renk }]}>
        {onek}
        {kiyas.kisa}
      </Text>
    </View>
  );
}

function KiyasSatiri({ baslik, alt, kiyas, cizgi }) {
  const r = kiyas ? HAP[kiyas.tur] : HAP.esit;
  return (
    <View style={[s.kiyasSatir, cizgi && { borderBottomWidth: 1, borderBottomColor: "#f0f2ee" }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.kiyasBaslik}>{baslik}</Text>
        <Text style={s.kiyasAlt}>{alt}</Text>
      </View>
      <View style={[s.kiyasHap, { backgroundColor: r.zemin }]}>
        <Text style={[s.kiyasHapYazi, { color: r.renk }]}>
          {kiyas ? (kiyas.tur === "esit" ? "eşit" : kiyas.uzun) : "—"}
        </Text>
      </View>
    </View>
  );
}

function SonOkutmalar({ firma, son, duzelt, bugunuAc }) {
  const kayitlar = son?.kayitlar ?? [];
  if (!firma) return null;

  return (
    <View style={{ marginTop: 6 }}>
      <View style={s.sonBaslikSatir}>
        <Text style={[s.bolumBaslik, { flex: 1 }]}>
          {firma.ad} · bugün {son?.bugun ?? 0} okutma
        </Text>
        <TouchableOpacity onPress={bugunuAc} hitSlop={8}>
          <Text style={s.tumuLink}>Tüm rakipler ›</Text>
        </TouchableOpacity>
      </View>
      {kayitlar.length === 0 ? (
        <Text style={s.aciklama}>Bugün bu rakipte henüz okutma yapmadınız.</Text>
      ) : (
        kayitlar.map((k) => {
          const k1 = kiyasla(k.bizimFiyat, k.rakipFiyat);
          const k2 = kiyasla(k.rafFiyat, k.rakipListeFiyat);
          const bicardli = k.fiyatTuru === "bicard";
          const ayni = !bicardli && k.rakipListeFiyat === k.rakipFiyat;
          return (
            <View key={k.id} style={s.okutmaKart}>
              <View style={s.okutmaUst}>
                {k.gorselId ? <UrunGorseli id={k.gorselId} boyut={38} /> : null}
                <Text style={[s.okutmaAd, { flex: 1 }]} numberOfLines={2}>
                  {k.urunAdi ?? k.barkod}
                </Text>
                <TouchableOpacity
                  style={s.duzeltDugme}
                  onPress={() => duzelt?.({ ...k, firmaId: k.firmaId ?? firma.id, firmaAd: firma.ad })}
                  hitSlop={6}
                >
                  <Simge ad="kalem" boyut={13} renkli={renk.yesilKoyu} />
                  <Text style={s.duzeltYazi}>Düzelt</Text>
                </TouchableOpacity>
              </View>
              {k.duzeltme ? <Text style={s.duzeltildiYazi}>düzeltildi · {saatYaz(k.duzeltme)}</Text> : null}
              <View style={s.ikili}>
                <View style={{ flex: 1 }}>
                  <Text style={s.okutmaEtiket}>{firma.ad}</Text>
                  <Text style={s.okutmaDeger}>
                    <Text style={{ fontWeight: "800" }}>{para(k.rakipFiyat)}</Text>
                    {k.rakipListeFiyat > k.rakipFiyat ? (
                      <Text style={s.cizili}>  {para(k.rakipListeFiyat)}</Text>
                    ) : (
                      <Text style={{ color: renk.pasif }}>  indirim yok</Text>
                    )}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.okutmaEtiket}>Biz</Text>
                  <Text style={s.okutmaDeger}>
                    <Text style={{ fontWeight: "800", color: bicardli ? "#3f6212" : renk.metin }}>{para(k.bizimFiyat)}</Text>
                    <Text style={{ color: renk.pasif }}>
                      {bicardli ? `  BiCard · raf ${para(k.rafFiyat)}` : "  raf"}
                    </Text>
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {ayni ? (
                  <Hap kiyas={k1} />
                ) : (
                  <>
                    <Hap kiyas={k1} onek={bicardli ? "BiCard: " : "Raf: "} />
                    <Hap kiyas={k2} onek="Raf ↔ indirimsiz: " />
                  </>
                )}
                {!k1 && <Text style={s.aciklama}>karşılaştırılamadı</Text>}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

/* ========================================================================== */
/* Aynı gün düzeltme (12.10.2026)                                             */
/* ========================================================================== */

/* ========================================================================== */
/* Okutma geçmişi (23.10.2026)                                                */
/* ========================================================================== */

const DONEMLER = [
  { gun: 1, ad: "Bugün" },
  { gun: 7, ad: "7 gün" },
  { gun: 30, ad: "30 gün" },
  { gun: 0, ad: "Tümü" },
];

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
function gunBaslik(t) {
  const d = new Date(t);
  const bugun = new Date();
  const dun = new Date();
  dun.setDate(dun.getDate() - 1);
  const ayni = (a, b) => a.toDateString() === b.toDateString();
  if (ayni(d, bugun)) return "Bugün";
  if (ayni(d, dun)) return "Dün";
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear() !== bugun.getFullYear() ? d.getFullYear() : ""}`.trim();
}

/** Kişinin bütün okutmaları: id ile 40'ar sayfalanır, liste sanallaştırılmış */
function GecmisListesi({ surum, sec }) {
  const [gun, setGun] = useState(30);
  const [firmaId, setFirmaId] = useState(null);
  const [ara, setAra] = useState("");
  const [arama, setArama] = useState("");
  const [kayitlar, setKayitlar] = useState(null);
  const [ozet, setOzet] = useState(null);
  const [devami, setDevami] = useState(false);
  const [ekYukleniyor, setEkYukleniyor] = useState(false);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState(null);
  const istek = useRef(0);

  /* Yazarken her harfte sorgu atmasın */
  useEffect(() => {
    const t = setTimeout(() => setArama(ara.trim()), 350);
    return () => clearTimeout(t);
  }, [ara]);

  const getir = useCallback(
    async (yenile = false) => {
      const no = ++istek.current;
      if (yenile) setYenileniyor(true);
      setHata(null);
      try {
        const c = await rakipGecmisAl({ gun, firmaId, q: arama });
        if (no !== istek.current) return; // eski süzgecin cevabı
        setKayitlar(c.kayitlar ?? []);
        setDevami(!!c.devami);
        if (c.ozet) setOzet(c.ozet);
      } catch (h) {
        if (no === istek.current) setHata(h.message);
      } finally {
        if (no === istek.current) setYenileniyor(false);
      }
    },
    [gun, firmaId, arama]
  );

  useEffect(() => {
    getir();
  }, [getir, surum]);

  const dahaFazla = async () => {
    if (!devami || ekYukleniyor || !kayitlar?.length) return;
    const no = istek.current;
    setEkYukleniyor(true);
    try {
      const c = await rakipGecmisAl({ gun, firmaId, q: arama, sonId: kayitlar[kayitlar.length - 1].id });
      if (no !== istek.current) return;
      setKayitlar((l) => [...l, ...(c.kayitlar ?? [])]);
      setDevami(!!c.devami);
    } catch {
      /* kaydırınca yeniden denenir */
    } finally {
      setEkYukleniyor(false);
    }
  };

  /* Gün başlıklarını satırların arasına koy */
  const satirlar = useMemo(() => {
    const l = [];
    let onceki = null;
    for (const k of kayitlar ?? []) {
      const g = new Date(k.olusturma).toDateString();
      if (g !== onceki) {
        l.push({ tur: "gun", id: "g" + g, ad: gunBaslik(k.olusturma) });
        onceki = g;
      }
      l.push({ tur: "kayit", id: k.id, k });
    }
    return l;
  }, [kayitlar]);

  const ust = (
    <View>
      {ozet && (
        <View style={s.gecmisOzet}>
          {[
            ["Bugün", ozet.bugun],
            ["Bu ay", ozet.buAy],
            [gun ? "Dönem" : "Toplam", ozet.toplam],
            ["Ürün", ozet.urun],
          ].map(([a, d]) => (
            <View key={a} style={s.gecmisOzetHucre}>
              <Text style={s.gecmisOzetDeger}>{d ?? 0}</Text>
              <Text style={s.gecmisOzetAd}>{a}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={[s.araKutu, { marginTop: 12 }]}>
        <Simge ad="liste" boyut={16} renkli="#5d6470" />
        <TextInput
          style={s.araGirdi}
          value={ara}
          onChangeText={setAra}
          placeholder="Ürün adı ya da barkod…"
          placeholderTextColor="#8a9184"
          autoCorrect={false}
          returnKeyType="search"
        />
        {ara ? (
          <TouchableOpacity onPress={() => setAra("")} hitSlop={8}>
            <Text style={{ color: renk.pasif, fontWeight: "800" }}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={s.cipSatir}>
        {DONEMLER.map((d) => (
          <TouchableOpacity
            key={d.gun}
            style={[s.cip, gun === d.gun && s.cipSecili]}
            onPress={() => setGun(d.gun)}
          >
            <Text style={[s.cipYazi, gun === d.gun && s.cipYaziSecili]}>{d.ad}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {ozet?.firmalar?.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cipSatir}>
          <TouchableOpacity style={[s.cip, firmaId == null && s.cipSecili]} onPress={() => setFirmaId(null)}>
            <Text style={[s.cipYazi, firmaId == null && s.cipYaziSecili]}>Tüm rakipler</Text>
          </TouchableOpacity>
          {ozet.firmalar.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[s.cip, firmaId === f.id && s.cipSecili]}
              onPress={() => setFirmaId(firmaId === f.id ? null : f.id)}
            >
              <Text style={[s.cipYazi, firmaId === f.id && s.cipYaziSecili]}>
                {f.ad} · {f.adet}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {hata && <Hata metin={hata} />}
    </View>
  );

  const satirCiz = ({ item }) => {
    if (item.tur === "gun") return <Text style={s.gecmisGun}>{item.ad}</Text>;
    const k = item.k;
    const k1 = kiyasla(k.bizimFiyat, k.rakipFiyat);
    const icerik = (
      <>
        <Rozet firma={{ id: k.firmaId, ad: k.firmaAd, logo: k.logo }} boyut={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bugunAd} numberOfLines={1}>
            {k.urunAdi ?? k.barkod}
          </Text>
          <Text style={s.bugunAlt} numberOfLines={1}>
            {k.firmaAd} · {saatYaz(k.olusturma)}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
            <Hap kiyas={k1} onek={k.fiyatTuru === "bicard" ? "BiCard: " : ""} />
            {k.duzeltme ? <Text style={s.duzeltildiYazi}>düzeltildi</Text> : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.gecmisFiyat}>{para(k.rakipFiyat)}</Text>
          {k.rakipListeFiyat > k.rakipFiyat ? <Text style={[s.cizili, { fontSize: 11.5 }]}>{para(k.rakipListeFiyat)}</Text> : null}
          {k.bizimFiyat != null ? <Text style={s.gecmisBiz}>biz {para(k.bizimFiyat)}</Text> : null}
        </View>
      </>
    );
    return k.bugun ? (
      <TouchableOpacity style={s.bugunSatir} activeOpacity={0.8} onPress={() => sec(k)}>
        {icerik}
      </TouchableOpacity>
    ) : (
      <View style={s.bugunSatir}>{icerik}</View>
    );
  };

  if (kayitlar === null && !hata) return <Yukleniyor />;

  return (
    <FlatList
      data={satirlar}
      keyExtractor={(x) => String(x.id)}
      renderItem={satirCiz}
      ListHeaderComponent={ust}
      contentContainerStyle={s.govde}
      keyboardShouldPersistTaps="handled"
      onEndReached={dahaFazla}
      onEndReachedThreshold={0.5}
      initialNumToRender={14}
      windowSize={9}
      removeClippedSubviews={Platform.OS === "android"}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} />}
      ListEmptyComponent={
        kayitlar ? (
          <Text style={[s.aciklama, { marginTop: 20, textAlign: "center" }]}>
            {arama || firmaId ? "Süzgece uyan okutma yok." : "Bu dönemde okutma yok."}
          </Text>
        ) : null
      }
      ListFooterComponent={
        ekYukleniyor ? (
          <ActivityIndicator style={{ marginVertical: 16 }} color={renk.yesilKoyu} />
        ) : kayitlar?.length && !devami ? (
          <Text style={[s.aciklama, { textAlign: "center", marginVertical: 14 }]}>
            Bugünkü kayıtlara dokunup düzeltebilirsiniz.
          </Text>
        ) : null
      }
    />
  );
}

/** Bugünkü bütün okutmalar, rakip ayrımı olmadan */
function BugunListesi({ liste, sec, yenile }) {
  if (liste === null) return <Yukleniyor />;

  return (
    <ScrollView contentContainerStyle={s.govde}>
      <Text style={s.aciklama}>
        Bugün okuttuğunuz ürünler. Yanlış rakip seçtiyseniz ya da fiyatı yanlış yazdıysanız dokunup düzeltin; ürün yanlış
        okutulduysa silebilirsiniz. Ertesi gün düzeltme yapılamaz.
      </Text>

      {liste.length === 0 ? (
        <Text style={[s.aciklama, { marginTop: 20, textAlign: "center" }]}>Bugün okutma yapmadınız.</Text>
      ) : (
        liste.map((k) => {
          const k1 = kiyasla(k.bizimFiyat, k.rakipFiyat);
          return (
            <TouchableOpacity key={k.id} style={s.bugunSatir} activeOpacity={0.8} onPress={() => sec(k)}>
              <Rozet firma={{ id: k.firmaId, ad: k.firmaAd, logo: k.logo }} boyut={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.bugunAd} numberOfLines={1}>
                  {k.urunAdi ?? k.barkod}
                </Text>
                <Text style={s.bugunAlt} numberOfLines={1}>
                  {k.firmaAd} · {saatYaz(k.olusturma)} ·{" "}
                  <Text style={{ fontWeight: "800", color: renk.metin }}>{para(k.rakipFiyat)}</Text>
                  {k.rakipListeFiyat > k.rakipFiyat ? <Text style={s.cizili}>  {para(k.rakipListeFiyat)}</Text> : null}
                </Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center" }}>
                  <Hap kiyas={k1} onek={k.fiyatTuru === "bicard" ? "BiCard: " : ""} />
                  {k.duzeltme ? <Text style={s.duzeltildiYazi}>düzeltildi</Text> : null}
                </View>
              </View>
              <Simge ad="kalem" boyut={16} renkli={renk.yesilKoyu} />
            </TouchableOpacity>
          );
        })
      )}

      <TouchableOpacity style={[s.notDugme, { marginTop: 16 }]} onPress={yenile}>
        <Text style={s.notYazi}>Listeyi yenile</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/** Düzeltme penceresi: rakip, indirimli/indirimsiz fiyat, not; sil */
function DuzeltSayfasi({ kayit, firmalar, kapat, bitti }) {
  const [firmaId, setFirmaId] = useState(null);
  const [indirimli, setIndirimli] = useState("");
  const [indirimsiz, setIndirimsiz] = useState("");
  const [not, setNot] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [silOnay, setSilOnay] = useState(false);

  useEffect(() => {
    if (!kayit) return;
    setFirmaId(kayit.firmaId ?? null);
    const indirimVar = kayit.rakipListeFiyat > kayit.rakipFiyat;
    setIndirimsiz(girdiYaz(indirimVar ? kayit.rakipListeFiyat : kayit.rakipFiyat));
    setIndirimli(indirimVar ? girdiYaz(kayit.rakipFiyat) : "");
    setNot(kayit.notMetni ?? "");
    setSilOnay(false);
  }, [kayit]);

  const indGirilen = sayiYap(indirimli);
  const indsiz = sayiYap(indirimsiz);
  const ind = indGirilen ?? indsiz;
  const k1 = kiyasla(kayit?.bizimFiyat, ind);

  /* Seçili rakip önde; ardından alfabetik değil sunucunun sırası */
  const secenekler = useMemo(() => {
    const l = [...(firmalar ?? [])];
    const i = l.findIndex((f) => f.id === kayit?.firmaId);
    if (i > 0) l.unshift(l.splice(i, 1)[0]);
    return l;
  }, [firmalar, kayit?.firmaId]);

  const kaydet = async () => {
    if (!firmaId) return Alert.alert("Eksik", "Rakip seçiniz.");
    if (!ind || ind <= 0) return Alert.alert("Eksik", "Rakibin raftaki fiyatını yazınız.");
    if (indsiz != null && indsiz > 0 && indGirilen != null && indsiz < indGirilen)
      return Alert.alert("Kontrol edin", "İndirimli fiyat, normal fiyattan büyük olamaz.");

    setGonderiliyor(true);
    Keyboard.dismiss();
    try {
      await rakipFiyatDuzelt(kayit.id, {
        firmaId,
        barkod: kayit.barkod,
        rakipFiyat: ind,
        rakipListeFiyat: indGirilen != null && indsiz != null && indsiz > indGirilen ? indsiz : null,
        not: not.trim() || null,
      });
      bitti?.();
    } catch (h) {
      Alert.alert("Düzeltilemedi", h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const sil = async () => {
    setGonderiliyor(true);
    try {
      await rakipFiyatSil(kayit.id);
      bitti?.();
    } catch (h) {
      Alert.alert("Silinemedi", h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <AltSayfa gorunur={!!kayit} kapat={kapat} perdeStil={s.perde} sayfaStil={s.sayfaAlt}>
      {kayit ? (
        <View style={{ gap: 12 }}>
          <View style={s.duzeltUst}>
            <UrunGorseli id={kayit.gorselId} boyut={46} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.duzeltBaslik} numberOfLines={2}>
                {kayit.urunAdi ?? kayit.barkod}
              </Text>
              <Text style={s.urunAlt}>
                {kayit.barkod} · {saatYaz(kayit.olusturma)} okutuldu
              </Text>
            </View>
            <TouchableOpacity onPress={kapat} hitSlop={10}>
              <Text style={s.kapatX}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={[s.bolumBaslik, { marginTop: 0, marginBottom: 0 }]}>Rakip</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            {secenekler.map((f) => {
              const sec = f.id === firmaId;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[s.firmaCip, sec && s.firmaCipSecili]}
                  onPress={() => setFirmaId(f.id)}
                  activeOpacity={0.8}
                >
                  <Rozet firma={f} boyut={26} />
                  <Text style={[s.firmaCipYazi, sec && { color: renk.yesilKoyu }]} numberOfLines={1}>
                    {f.ad}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {firmaId !== kayit.firmaId ? (
            <Text style={s.ipucu}>
              Kayıt {kayit.firmaAd ?? "önceki rakip"} yerine {secenekler.find((f) => f.id === firmaId)?.ad} olarak düzeltilecek.
            </Text>
          ) : null}

          <View style={s.ikili}>
            <View style={[s.girisKutu, { borderColor: renk.turuncu, borderWidth: 1.5 }]}>
              <Text style={[s.girisEtiket, { color: renk.turuncuKoyu }]}>Normal fiyat *</Text>
              <View style={s.girisSatir}>
                <TextInput
                  style={s.girisDeger}
                  value={indirimsiz}
                  onChangeText={setIndirimsiz}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor="#b9bfb3"
                />
                <Text style={s.girisTl}>₺</Text>
              </View>
            </View>
            <View style={s.girisKutu}>
              <Text style={s.girisEtiket}>İndirimli (varsa)</Text>
              <View style={s.girisSatir}>
                <TextInput
                  style={s.girisDeger}
                  value={indirimli}
                  onChangeText={setIndirimli}
                  keyboardType="decimal-pad"
                  placeholder="yoksa boş"
                  placeholderTextColor="#b9bfb3"
                />
                <Text style={s.girisTl}>₺</Text>
              </View>
            </View>
          </View>

          {kayit.bizimFiyat != null ? (
            <View style={s.kiyasKart}>
              <KiyasSatiri
                baslik={kayit.fiyatTuru === "bicard" ? "BiCard ↔ rakibin satış fiyatı" : "Raf ↔ rakibin satış fiyatı"}
                alt={ind != null ? `${para(kayit.bizimFiyat)} ↔ ${para(ind)}` : "fiyatı yazınız"}
                kiyas={k1}
              />
            </View>
          ) : null}

          <TextInput
            style={[s.girdi, { minHeight: 56, textAlignVertical: "top", flex: 0 }]}
            value={not}
            onChangeText={setNot}
            placeholder="Not (isteğe bağlı)"
            placeholderTextColor="#8a9184"
            multiline
          />

          <TouchableOpacity
            style={[s.kaydetDugme, gonderiliyor && { opacity: 0.55 }]}
            disabled={gonderiliyor}
            onPress={kaydet}
            activeOpacity={0.85}
          >
            {gonderiliyor ? (
              <ActivityIndicator color={renk.beyaz} />
            ) : (
              <>
                <Simge ad="onay" boyut={18} renkli={renk.beyaz} />
                <Text style={s.kaydetYazi}>Düzeltmeyi kaydet</Text>
              </>
            )}
          </TouchableOpacity>

          {silOnay ? (
            <View style={s.silKutu}>
              <Text style={s.silYazi}>Bu okutma silinsin mi? Geri alınamaz.</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity style={[s.silDugme, { backgroundColor: renk.beyaz }]} onPress={() => setSilOnay(false)}>
                  <Text style={[s.silDugmeYazi, { color: renk.metin }]}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.silDugme} onPress={sil} disabled={gonderiliyor}>
                  <Text style={s.silDugmeYazi}>Sil</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.silLink} onPress={() => setSilOnay(true)}>
              <Text style={s.silLinkYazi}>Yanlış ürün okuttum, sil</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </AltSayfa>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 40 },

  adimSerit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  adimYazi: { fontSize: 12.5, fontWeight: "700", color: "#5d6470" },

  buyukBaslik: { fontSize: 21, fontWeight: "800", color: renk.metin },
  aciklama: { fontSize: 13, color: "#5d6470", lineHeight: 19, marginTop: 5 },
  bolumBaslik: {
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#5d6470",
    marginTop: 16,
    marginBottom: 8,
  },

  araKutu: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    marginTop: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1.5,
    borderColor: "#d6dbd1",
    borderRadius: 14,
  },
  araGirdi: { flex: 1, fontSize: 15, color: renk.metin, paddingVertical: 0 },

  sonlar: { flexDirection: "row", gap: 9 },
  sonKutu: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  sonKutuSecili: { backgroundColor: renk.yesilAcik, borderWidth: 2, borderColor: renk.yesil },
  sonAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  sonAlt: { fontSize: 11, color: "#5d6470" },

  listeKart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 16,
    overflow: "hidden",
  },
  firmaSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f2ee",
  },
  firmaAd: { fontSize: 15, fontWeight: "700", color: renk.metin },
  firmaAlt: { fontSize: 12, color: "#5d6470", marginTop: 2 },
  secimIsaret: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: renk.yesil,
    alignItems: "center",
    justifyContent: "center",
  },
  ok: { fontSize: 22, color: "#b9bfb3", paddingHorizontal: 4 },
  bosYazi: { padding: 20, textAlign: "center", color: "#5d6470", fontSize: 13.5 },

  firmaSerit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 10,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
  },
  firmaSeritEtiket: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6, color: "#5d6470" },
  firmaSeritAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  degistir: { fontSize: 13, fontWeight: "700", color: renk.yesilKoyu, paddingHorizontal: 4 },

  bildirim: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: renk.yesilAcik,
    borderWidth: 1,
    borderColor: "#b7dc7a",
  },
  bildirimSimge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: renk.yesilKoyu,
    alignItems: "center",
    justifyContent: "center",
  },
  bildirimBaslik: { fontSize: 14, fontWeight: "800", color: "#2f4a0c" },
  bildirimMetin: { fontSize: 12.5, color: "#3f6212", marginTop: 1 },

  /* Fiyat Kontrol'deki kamera şablonu */
  kameraKutu: { height: 320, borderRadius: 16, overflow: "hidden", marginTop: 12, backgroundColor: "#000" },
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
  hedef: { width: "78%", height: 110, borderRadius: 12 },
  kose: { position: "absolute", width: 26, height: 26, borderColor: renk.yesil },
  koseSolUst: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  koseSagUst: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  koseSolAlt: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  koseSagAlt: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  kameraYazi: { color: "#fff", fontSize: 13.5, textAlign: "center", marginTop: 18, paddingHorizontal: 30 },
  kameraKapat: {
    marginTop: 18,
    backgroundColor: "rgba(0,0,0,.6)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  kameraKapatYazi: { color: renk.beyaz, fontSize: 13, fontWeight: "600" },

  okutDugme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: renk.yesil,
    paddingVertical: 15,
    borderRadius: 12,
    marginTop: 12,
  },
  okutYazi: { fontSize: 15.5, fontWeight: "700", color: renk.beyaz },

  elleSatir: { flexDirection: "row", gap: 8, marginTop: 10 },
  girdi: {
    flex: 1,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: "#d6dbd1",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 14.5,
    color: renk.metin,
  },
  sorguDugme: {
    minWidth: 92,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: "#d6dbd1",
    borderRadius: 12,
  },
  sorguYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },

  urunKart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 16,
  },
  urunGorsel: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#f1f3ef",
    alignItems: "center",
    justifyContent: "center",
  },
  urunAd: { fontSize: 15.5, fontWeight: "800", color: renk.metin, lineHeight: 20 },
  buyukGorsel: { width: "100%", height: 150, borderRadius: 12, backgroundColor: "#fff" },
  altSeritKlavye: { paddingBottom: 12 },
  urunAlt: { fontSize: 12, color: "#5d6470", marginTop: 3 },

  ikili: { flexDirection: "row", gap: 9 },
  fiyatKutu: {
    flex: 1,
    padding: 11,
    borderRadius: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  fiyatKutuBicard: { backgroundColor: renk.yesilAcik, borderWidth: 1.5, borderColor: renk.yesil },
  fiyatEtiket: { fontSize: 11.5, fontWeight: "800", color: "#5d6470", letterSpacing: 0.4 },
  fiyatDeger: { fontSize: 22, fontWeight: "800", color: renk.metin, marginTop: 3 },
  fiyatAlt: { fontSize: 11, color: "#5d6470", marginTop: 2 },

  girisKutu: {
    flex: 1,
    padding: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: "#d6dbd1",
  },
  girisEtiket: { fontSize: 12, fontWeight: "800", color: "#5d6470" },
  girisSatir: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  girisDeger: { flex: 1, fontSize: 21, fontWeight: "800", color: renk.metin, paddingVertical: 2, minWidth: 0 },
  girisTl: { fontSize: 16, fontWeight: "800", color: "#5d6470" },
  ipucu: { fontSize: 12, color: "#5d6470", lineHeight: 17, marginTop: 7 },

  kiyasKart: {
    marginTop: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 16,
    overflow: "hidden",
  },
  kiyasSatir: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  kiyasBaslik: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  kiyasAlt: { fontSize: 12, color: "#5d6470", marginTop: 2 },
  kiyasHap: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, maxWidth: "48%" },
  kiyasHapYazi: { fontSize: 12.5, fontWeight: "800", textAlign: "right" },

  notDugme: {
    marginTop: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#c3cabb",
  },
  notYazi: { fontSize: 13.5, fontWeight: "700", color: "#5d6470" },

  altSerit: {
    paddingHorizontal: 16,
    paddingTop: 12,
    /* Yüzen alt menü (yaklaşık 90) Kaydet'in üstüne binmesin; klavye
       açıkken menü klavyenin arkasında kalıyor (altSeritKlavye) */
    paddingBottom: 104,
    backgroundColor: renk.beyaz,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },
  kaydetDugme: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: renk.yesilKoyu,
  },
  kaydetYazi: { color: renk.beyaz, fontSize: 16, fontWeight: "800" },

  okutmaKart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    marginBottom: 8,
  },
  okutmaAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  okutmaEtiket: { fontSize: 11.5, fontWeight: "700", color: "#5d6470" },
  okutmaDeger: { fontSize: 12.5, color: renk.metin, marginTop: 2 },
  cizili: { color: "#6b7280", textDecorationLine: "line-through" },

  hap: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  hapYazi: { fontSize: 11.5, fontWeight: "800" },

  /* Aynı gün düzeltme (12.10.2026) */
  bugunDugme: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: renk.yesilAcik,
    borderWidth: 1,
    borderColor: "#cfe6a6",
  },
  bugunDugmeAd: { fontSize: 14, fontWeight: "800", color: "#2f4a0c" },
  bugunDugmeAlt: { fontSize: 12, color: "#3f6212", marginTop: 1 },
  sonBaslikSatir: { flexDirection: "row", alignItems: "center", gap: 8 },
  tumuLink: { fontSize: 12.5, fontWeight: "800", color: renk.yesilKoyu, marginTop: 8 },
  okutmaUst: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  duzeltDugme: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: renk.yesilAcik,
  },
  duzeltYazi: { fontSize: 12, fontWeight: "800", color: renk.yesilKoyu },
  duzeltildiYazi: { fontSize: 11, fontWeight: "700", color: "#ad6800" },
  bugunSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    marginTop: 8,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
  },
  bugunAd: { fontSize: 14, fontWeight: "800", color: renk.metin },

  /* Okutma geçmişi (23.10.2026) */
  gecmisDugme: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#eef2f8",
    borderWidth: 1,
    borderColor: "#d5ddea",
  },
  gecmisDugmeAd: { fontSize: 14, fontWeight: "800", color: "#1f2a44" },
  gecmisDugmeAlt: { fontSize: 12, color: "#4a5672", marginTop: 1 },
  gecmisOzet: {
    flexDirection: "row",
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    paddingVertical: 10,
  },
  gecmisOzetHucre: { flex: 1, alignItems: "center" },
  gecmisOzetDeger: { fontSize: 18, fontWeight: "900", color: renk.metin, fontVariant: ["tabular-nums"] },
  gecmisOzetAd: { fontSize: 11, color: "#5d6470", marginTop: 1, fontWeight: "700" },
  cipSatir: { flexDirection: "row", gap: 6, marginTop: 10, paddingRight: 8 },
  cip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  cipSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  cipYazi: { fontSize: 12.5, fontWeight: "700", color: "#3b4252" },
  cipYaziSecili: { color: renk.beyaz },
  gecmisGun: { fontSize: 12, fontWeight: "800", color: "#5d6470", marginTop: 16, letterSpacing: 0.3 },
  gecmisFiyat: { fontSize: 15, fontWeight: "900", color: renk.metin, fontVariant: ["tabular-nums"] },
  gecmisBiz: { fontSize: 11.5, color: renk.yesilKoyu, fontWeight: "700", marginTop: 1 },
  bugunAlt: { fontSize: 12, color: "#5d6470", marginTop: 2 },

  perde: { flex: 1, backgroundColor: "rgba(20,24,18,.5)" },
  sayfaAlt: {
    backgroundColor: renk.beyaz,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 22,
  },
  duzeltUst: { flexDirection: "row", alignItems: "center", gap: 11 },
  duzeltBaslik: { fontSize: 15.5, fontWeight: "800", color: renk.metin },
  kapatX: { fontSize: 20, color: renk.pasif, fontWeight: "600", paddingHorizontal: 4 },
  firmaCip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
    maxWidth: 190,
  },
  firmaCipSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  firmaCipYazi: { fontSize: 13, fontWeight: "800", color: renk.metin, flexShrink: 1 },
  silLink: { alignItems: "center", paddingVertical: 6 },
  silLinkYazi: { fontSize: 13, fontWeight: "700", color: renk.kirmizi },
  silKutu: { backgroundColor: "#fff1f0", borderRadius: 12, padding: 12, gap: 10 },
  silYazi: { fontSize: 13, fontWeight: "700", color: "#a8071a" },
  silDugme: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 11,
    backgroundColor: renk.kirmizi,
    borderWidth: 1,
    borderColor: "#f3c2c2",
  },
  silDugmeYazi: { fontSize: 14, fontWeight: "800", color: renk.beyaz },
});

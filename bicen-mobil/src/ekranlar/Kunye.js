/**
 * ---------------------------------------------------------------------------
 * Künye Analizi
 * ---------------------------------------------------------------------------
 * Rakip marketteki meyve-sebze künyesinin karekodu okutulur. Karekod
 * doğrudan künye numarasını taşır. Sunucu HKS'den künyeyi bulur; rakibin
 * bildirdiği alış fiyatı ile bizim aynı cinste son alış fiyatımızı yan
 * yana getirir. Personel sonucu görüp kaydeder; panelde rapor olur.
 *
 * Kamera, vardiya ekranındaki çalışan desenle açılır: tam ekran Modal,
 * kaplama kardeş ve açıkça mutlak konumlu.
 * ---------------------------------------------------------------------------
 */

import { useRef, useState } from "react";
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
import { CameraView, useCameraPermissions } from "expo-camera";

import { kunyeOku, kunyeKaydet } from "../api";
import { Uyari } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";

const para = (v) =>
  v === null || v === undefined
    ? "—"
    : `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

export default function Kunye() {
  const [kameraAcik, setKameraAcik] = useState(false);
  const [izin, izinIste] = useCameraPermissions();
  const okumaKilidi = useRef(false);

  const [elle, setElle] = useState("");
  const [sorgulaniyor, setSorgulaniyor] = useState(false);
  const [sonuc, setSonuc] = useState(null);
  const [hata, setHata] = useState("");
  const [not, setNot] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [kaydedildi, setKaydedildi] = useState(false);


  const kamerayiAc = async () => {
    if (!izin?.granted) {
      const s = await izinIste();

      if (!s.granted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Künye okutmak için kamera iznine ihtiyaç var."
        );
        return;
      }
    }

    okumaKilidi.current = false;
    setKameraAcik(true);
  };

  const sorgula = async (ham) => {
    const no = String(ham ?? "").replace(/\D/g, "");

    if (no.length < 6) {
      setHata("Künye numarası okunamadı.");
      return;
    }

    setSorgulaniyor(true);
    setHata("");
    setSonuc(null);
    setKaydedildi(false);

    try {
      const d = await kunyeOku(no);
      setSonuc(d);

      /* Okutma kendiliğinden kaydedilir: personelin ayrıca düğmeye
         basması gerekmiyor, kayıt raporda görünür. Not eklemek isterse
         aşağıdaki kutudan sonradan ekleyebilir. */
      otomatikKaydet(d);
    } catch (h) {
      setHata(h.message || "Künye sorgulanamadı.");
    } finally {
      setSorgulaniyor(false);
    }
  };

  const kodOkundu = ({ data }) => {
    if (okumaKilidi.current) return;
    okumaKilidi.current = true;

    setKameraAcik(false);
    sorgula(String(data ?? ""));
  };

  /** Okuma sonrası sessiz kayıt */
  const otomatikKaydet = async (d) => {
    try {
      await kunyeKaydet(kayitGovdesi(d, ""));
      setKaydedildi(true);
    } catch {
      /* Kayıt başarısızsa ekranda düğme kalır, personel elle dener */
    }
  };

  /** Kayıt gövdesi; iki yerden de aynı biçimde kurulur */
  const kayitGovdesi = (d, notMetni) => ({
    kunyeNo: d.kunyeNo,
    urunAdi: d.urunAdi,
    uretici: d.rakip?.uretici,
    uretimYeri: d.rakip?.uretimYeri,
    rakipIsletme: d.rakip?.isletme,
    rakipFiyat: d.rakip?.alisFiyati,
    bizimFiyat: d.bizim?.alisFiyati,
    bizimKunye: d.bizim?.kunyeNo,
    bizimTarih: d.bizim?.tarih,
    fark: d.fark,
    farkYuzde: d.farkYuzde,
    subeAdi: d.bizim?.subeAdi ?? null,
    notMetni: notMetni?.trim() || null,
  });

  const kaydet = async () => {
    if (!sonuc) return;

    setKaydediliyor(true);

    try {
      await kunyeKaydet(kayitGovdesi(sonuc, not));

      setKaydedildi(true);
    } catch (h) {
      Alert.alert("Kaydedilemedi", h.message || "Bir sorun oluştu.");
    } finally {
      setKaydediliyor(false);
    }
  };

  /* ---------------------------------------------------------- kamera */
  const kameraPenceresi = (
    <Modal
      visible={kameraAcik}
      animationType="slide"
      onRequestClose={() => setKameraAcik(false)}
    >
      <View style={s.kameraTam}>
        <CameraView
          style={s.kamera}
          facing="back"
          active={kameraAcik}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "datamatrix"] }}
          onBarcodeScanned={kameraAcik ? kodOkundu : undefined}
        />

        <View style={s.kameraKaplama} pointerEvents="box-none">
          <View style={s.hedef} />
          <Text style={s.kameraYazi}>
            Künyedeki karekodu çerçeveye alınız
          </Text>

          <TouchableOpacity style={s.iptal} onPress={() => setKameraAcik(false)}>
            <Text style={s.iptalYazi}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const durum = sonuc?.durum;
  const hukum =
    durum === "biz_pahali"
      ? { renk: renk.turuncu, zemin: "#fdeee8", simge: "uyari",
          baslik: `Biz ${para(Math.abs(sonuc.fark))} daha pahalı alıyoruz`, alt: `%${Math.abs(sonuc.farkYuzde)} fark` }
      : durum === "biz_ucuz"
      ? { renk: renk.yesilKoyu, zemin: renk.yesilAcik, simge: "onay",
          baslik: `Biz ${para(Math.abs(sonuc.fark))} daha ucuz alıyoruz`, alt: `%${Math.abs(sonuc.farkYuzde)} fark` }
      : durum === "esit"
      ? { renk: renk.mavi, zemin: renk.maviAcik, simge: "onay", baslik: "Aynı fiyata alıyoruz", alt: "Fark yok" }
      : { renk: renk.pasif, zemin: "#f1f3ef", simge: "bilgi", baslik: "Karşılaştırılamadı",
          alt: sonuc?.bizim ? "Rakip alış fiyatı künyede yok" : "Bu cinste son 90 günde alışımız yok" };

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      {kameraPenceresi}

      <View style={s.bar}>
        <BarBaslik ad="Künye Analizi" />
      </View>

      <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
        {/* --------------------------------------------- okutma kartı */}
        <View style={s.hero}>
          <View style={s.heroUst}>
            <View style={s.heroIkon}>
              <Simge ad="kare" boyut={24} renkli="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroBaslik}>Rakip künyesini okut</Text>
              <Text style={s.heroAlt}>
                Meyve-sebze künyesindeki karekodu okutun; rakibin alış fiyatı ile bizim son alışımız karşılaştırılır.
              </Text>
            </View>
          </View>

          <TouchableOpacity style={s.okutDugme} onPress={kamerayiAc} activeOpacity={0.85}>
            <Simge ad="kare" boyut={20} renkli={renk.yesilKoyu} />
            <Text style={s.okutYazi}>Karekod okut</Text>
          </TouchableOpacity>

          <View style={s.elleSatir}>
            <TextInput
              style={s.elleGiris}
              placeholder="ya da künye numarasını yazın"
              placeholderTextColor="rgba(255,255,255,.6)"
              keyboardType="number-pad"
              value={elle}
              onChangeText={setElle}
              onSubmitEditing={() => elle.trim() && sorgula(elle)}
            />
            <TouchableOpacity style={s.elleDugme} onPress={() => elle.trim() && sorgula(elle)} activeOpacity={0.85}>
              <Text style={s.elleDugmeYazi}>Sorgula</Text>
            </TouchableOpacity>
          </View>
        </View>

        {sorgulaniyor ? (
          <View style={s.bekle}>
            <ActivityIndicator color={renk.yesil} />
            <Text style={s.bekleYazi}>HKS sorgulanıyor…</Text>
          </View>
        ) : null}

        {hata ? <Uyari>{hata}</Uyari> : null}
        {sonuc?.uyari ? <Uyari>{sonuc.uyari}</Uyari> : null}

        {sonuc ? (
          <>
            {/* -------------------------------------------- hüküm */}
            <View style={[s.hukum, { backgroundColor: hukum.zemin, borderColor: hukum.renk }]}>
              <View style={[s.hukumIkon, { backgroundColor: hukum.renk }]}>
                <Simge ad={hukum.simge} boyut={20} renkli="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.hukumBaslik, { color: hukum.renk }]}>{hukum.baslik}</Text>
                <Text style={s.hukumAlt}>
                  {sonuc.urunAdi || (sonuc.cinsKod ? `Cins kodu ${sonuc.cinsKod}` : "Ürün")} · {hukum.alt}
                </Text>
              </View>
            </View>

            {/* -------------------------------------------- fiyatlar */}
            <View style={s.fiyatlar}>
              <View style={[s.fiyat, durum === "biz_ucuz" && s.fiyatVurgu]}>
                <Text style={s.fiyatEtiket}>RAKİP ALIŞ</Text>
                <Text style={s.fiyatDeger}>{para(sonuc.rakip?.alisFiyati)}</Text>
                <Text style={s.fiyatAlt} numberOfLines={3}>
                  {sonuc.rakip?.isletme || "Malın sahibi bilinmiyor"}
                  {sonuc.rakip?.satici ? `\n${sonuc.rakip.saticiSifat ?? "Satıcı"}: ${sonuc.rakip.satici}` : ""}
                </Text>
              </View>
              <View style={[s.fiyat, s.fiyatBiz, durum === "biz_pahali" && { borderColor: renk.turuncu }]}>
                <Text style={[s.fiyatEtiket, { color: renk.yesilKoyu }]}>BİZİM ALIŞ</Text>
                <Text style={s.fiyatDeger}>{para(sonuc.bizim?.alisFiyati)}</Text>
                <Text style={s.fiyatAlt} numberOfLines={2}>
                  {sonuc.bizim
                    ? `${sonuc.bizim.subeAdi ?? ""}${sonuc.bizim.tarih ? ` · ${new Date(sonuc.bizim.tarih).toLocaleDateString("tr-TR")}` : ""}`
                    : "Son 90 günde alış yok"}
                </Text>
              </View>
            </View>

            {/* ------------------------------------------------ künye */}
            <Text style={s.bolum}>KÜNYE {sonuc.kunyeNo}</Text>
            <View style={s.kart}>
              {[
                ["Ürün", sonuc.urunAdi || (sonuc.cinsKod ? `Cins kodu ${sonuc.cinsKod}` : "—")],
                ["Üretici", sonuc.rakip?.uretici],
                ["Üretim yeri", sonuc.rakip?.uretimYeri],
                ["Üretim şekli", sonuc.rakip?.uretimSekli],
                ["Üretim tarihi", sonuc.rakip?.uretimTarihi],
                ["Gidecek yer", sonuc.rakip?.gidecekYer],
                ["Şube", sonuc.rakip?.subeAdi],
              ].map(([ad, deger], i, dizi) => (
                <View key={ad} style={[s.satir, i === dizi.length - 1 && s.sonSatir]}>
                  <Text style={s.satirAd}>{ad}</Text>
                  <Text style={s.satirDeger}>{deger || "—"}</Text>
                </View>
              ))}
            </View>

            {/* -------------------------------------- geçmiş bildirimler */}
            {(sonuc.gecmis ?? []).length > 0 ? (
              <>
                <Text style={s.bolum}>KÜNYE GEÇMİŞİ</Text>
                <View style={s.kart}>
                  {sonuc.gecmis.map((g, i, dizi) => (
                    <View key={i} style={[s.satir, i === dizi.length - 1 && s.sonSatir]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.satirDeger, { textAlign: "left" }]} numberOfLines={2}>
                          {g.adSoyad || "—"}
                        </Text>
                        <Text style={s.satirAd}>{g.sifat}</Text>
                      </View>
                      <Text style={[s.satirDeger, { flex: 0, flexShrink: 0 }]} numberOfLines={1}>{g.fiyat != null ? para(g.fiyat) : "—"}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* ------------------------------------------------ kayıt */}
            <Text style={s.bolum}>NOT VE KAYIT</Text>
            <View style={s.kart}>
              {kaydedildi ? (
                <View style={s.kayitli}>
                  <Simge ad="onay" boyut={16} renkli={renk.yesilKoyu} />
                  <Text style={s.kayitliYazi}>Kaydedildi · raporda görünecek</Text>
                </View>
              ) : null}
              <TextInput
                style={s.notGiris}
                placeholder="Not (isteğe bağlı): market adı, raf fiyatı, gözlem…"
                placeholderTextColor="#a3a9a0"
                multiline
                value={not}
                onChangeText={setNot}
              />
              {!kaydedildi || not.trim().length > 0 ? (
                <TouchableOpacity style={s.kaydetDugme} onPress={kaydet} disabled={kaydediliyor} activeOpacity={0.85}>
                  {kaydediliyor ? <ActivityIndicator color="#fff" /> : <Simge ad="onay" boyut={17} renkli="#fff" />}
                  <Text style={s.kaydetYazi}>{kaydedildi ? "Notu da kaydet" : "Analizi kaydet"}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  bar: { backgroundColor: renk.yesil, paddingHorizontal: 20, paddingVertical: 14 },
  govde: { padding: 14, paddingBottom: 130, gap: 12 },

  hero: { backgroundColor: "#2d4a0c", borderRadius: 20, padding: 16, gap: 12 },
  heroUst: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  heroIkon: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(255,255,255,.14)",
    alignItems: "center", justifyContent: "center",
  },
  heroBaslik: { color: "#fff", fontSize: 17, fontWeight: "800" },
  heroAlt: { color: "rgba(255,255,255,.78)", fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  okutDugme: {
    height: 52, borderRadius: 15, backgroundColor: "#fff", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  okutYazi: { color: renk.yesilKoyu, fontSize: 16, fontWeight: "800" },
  elleSatir: { flexDirection: "row", gap: 8 },
  elleGiris: {
    flex: 1, height: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff",
    backgroundColor: "rgba(255,255,255,.12)", borderWidth: 1, borderColor: "rgba(255,255,255,.2)",
  },
  elleDugme: { height: 44, borderRadius: 12, paddingHorizontal: 16, backgroundColor: renk.yesil, justifyContent: "center" },
  elleDugmeYazi: { color: "#fff", fontWeight: "800" },

  bekle: { padding: 26, alignItems: "center" },
  bekleYazi: { marginTop: 10, color: renk.pasif },

  hukum: { flexDirection: "row", gap: 12, alignItems: "center", borderRadius: 16, borderWidth: 1.5, padding: 14 },
  hukumIkon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hukumBaslik: { fontSize: 15.5, fontWeight: "800" },
  hukumAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },

  fiyatlar: { flexDirection: "row", gap: 10 },
  fiyat: { flex: 1, backgroundColor: "#fff", borderRadius: 16, padding: 13, borderWidth: 1, borderColor: "#eef0ea" },
  fiyatBiz: { borderColor: "#cfe3b2", backgroundColor: "#fbfdf7" },
  fiyatVurgu: { borderColor: renk.yesil },
  fiyatEtiket: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6, color: renk.pasif },
  fiyatDeger: { fontSize: 22, fontWeight: "900", color: renk.metin, marginTop: 4 },
  fiyatAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 4, lineHeight: 16 },

  bolum: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, color: renk.pasif, marginTop: 6, marginLeft: 2 },
  kart: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#eef0ea", paddingHorizontal: 14, paddingVertical: 6 },
  satir: {
    flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#f0f2ee",
  },
  sonSatir: { borderBottomWidth: 0 },
  satirAd: { fontSize: 13, color: renk.pasif },
  satirDeger: { fontSize: 13.5, fontWeight: "700", color: renk.metin, flex: 1, textAlign: "right" },

  kayitli: {
    flexDirection: "row", gap: 7, alignItems: "center", backgroundColor: renk.yesilAcik,
    borderRadius: 10, padding: 9, marginTop: 8,
  },
  kayitliYazi: { color: renk.yesilKoyu, fontWeight: "700", fontSize: 13 },
  notGiris: {
    minHeight: 76, textAlignVertical: "top", borderWidth: 1.5, borderColor: renk.cizgi, borderRadius: 12,
    padding: 11, fontSize: 14, color: renk.metin, backgroundColor: "#fafbf8", marginVertical: 8,
  },
  kaydetDugme: {
    height: 48, borderRadius: 14, backgroundColor: renk.yesil, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8,
  },
  kaydetYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },

  /* Kamera: vardiya ekranındaki çalışan desen */
  kameraTam: { flex: 1, backgroundColor: "#000" },
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
  hedef: { width: 240, height: 240, borderWidth: 3, borderColor: renk.yesil, borderRadius: 18 },
  kameraYazi: { color: "#fff", fontSize: 15, marginTop: 24, textAlign: "center" },
  iptal: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 24,
    paddingHorizontal: 26,
    paddingVertical: 11,
  },
  iptalYazi: { color: "#fff", fontSize: 16, fontWeight: "700" },
});

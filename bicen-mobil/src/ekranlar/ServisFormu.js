/**
 * Teknik Servis Formu (mobil)
 * ---------------------------------------------------------------------------
 * Arıza çözüldü ya da kapatıldı yapılırken doldurulur; durum form
 * kaydedilmeden değişmiyor. "Çözüldü" yazan ama ne yapıldığı belli
 * olmayan kayıt, aynı arıza tekrarladığında hiçbir şey anlatmıyordu ve
 * maliyet hiçbir yerde toplanmıyordu.
 *
 * Panel formuyla aynı uca yazıyor; sahadaki teknisyen telefondan
 * dolduruyor, ofisteki ekip panelden. İkisi aynı kaydı görüyor.
 */

import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { api360 } from "../api360";
import { renk, olcu } from "../tema";

const paraYaz = (d) =>
  Number(d || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

const MUDAHALELER = [
  { kod: "uzaktan", ad: "Uzaktan" },
  { kod: "yerinde", ad: "Yerinde" },
  { kod: "merkezde", ad: "Merkezde" },
];

/* ========================================================================== */

export default function ServisFormu({ arizaId, envanterId, yeniDurum, kapat, kaydedildi }) {
  const [mudahale, setMudahale] = useState("yerinde");
  const [tespit, setTespit] = useState("");
  const [yapilanIslem, setYapilanIslem] = useState("");
  const [cihazDegisti, setCihazDegisti] = useState(false);
  const [yeniCihaz, setYeniCihaz] = useState("");
  const [iscilik, setIscilik] = useState("");
  const [teknisyen, setTeknisyen] = useState("");
  const [parcalar, setParcalar] = useState([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Daha önce açılmış form varsa dolduruluyor */
  useEffect(() => {
    api360
      .al(`/api/ServisFormu/Ariza/${arizaId}`)
      .then((c) => {
        if (!c?.form) return;

        const f = c.form;

        setMudahale(f.mudahale ?? "yerinde");
        setTespit(f.tespit ?? "");
        setYapilanIslem(f.yapilanIslem ?? "");
        setCihazDegisti(!!f.cihazDegisti);
        setYeniCihaz(f.yeniCihaz ?? "");
        setIscilik(f.iscilik ? String(f.iscilik) : "");
        setTeknisyen(f.teknisyen ?? "");
        setParcalar(
          (c.parcalar ?? []).map((p) => ({
            ad: p.ad ?? "",
            adet: String(p.adet ?? 1),
            birimFiyat: String(p.birimFiyat ?? 0),
          }))
        );
      })
      .catch(() => undefined);
  }, [arizaId]);

  const sayi = (s) => Number(String(s).replace(",", ".")) || 0;

  const parcaTutari = parcalar.reduce(
    (t, p) => t + sayi(p.adet) * sayi(p.birimFiyat),
    0
  );

  const toplam = parcaTutari + sayi(iscilik);

  const parcaGuncelle = (sira, alan, deger) =>
    setParcalar((o) => o.map((p, i) => (i === sira ? { ...p, [alan]: deger } : p)));

  const kaydet = async () => {
    if (!yapilanIslem.trim()) {
      Alert.alert("Eksik", "Yapılan işlemi yazınız.");
      return;
    }

    setKaydediliyor(true);

    try {
      await api360.gonder("/api/ServisFormu", {
        arizaId,
        envanterId: envanterId ?? null,
        mudahale,
        tespit: tespit.trim() || null,
        yapilanIslem: yapilanIslem.trim(),
        cihazDegisti,
        yeniCihaz: cihazDegisti ? yeniCihaz.trim() || null : null,
        iscilik: sayi(iscilik),
        teknisyen: teknisyen.trim() || null,
        parcalar: parcalar
          .filter((p) => p.ad.trim())
          .map((p) => ({
            ad: p.ad.trim(),
            adet: sayi(p.adet) || 1,
            birimFiyat: sayi(p.birimFiyat),
          })),
      });

      kaydedildi();
    } catch (e) {
      Alert.alert("Kaydedilemedi", e?.message ?? "Form kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={kapat}>
      <SafeAreaProvider>
          <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.ust}>
            <TouchableOpacity onPress={kapat} hitSlop={12}>
              <Text style={s.vazgec}>Vazgeç</Text>
            </TouchableOpacity>

            <Text style={s.baslik}>Servis formu</Text>

            <Text style={s.durumEtiketi}>
              {yeniDurum === "cozuldu" ? "Çözüldü" : "Kapatıldı"}
            </Text>
          </View>

          <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
            <Text style={s.etiket}>MÜDAHALE</Text>
            <View style={s.secenekler}>
              {MUDAHALELER.map((m) => (
                <TouchableOpacity
                  key={m.kod}
                  style={[s.secenek, mudahale === m.kod && s.secenekSecili]}
                  onPress={() => setMudahale(m.kod)}
                >
                  <Text style={[s.secenekYazi, mudahale === m.kod && s.secenekYaziSecili]}>
                    {m.ad}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.etiket}>TESPİT</Text>
            <TextInput
              style={[s.girdi, s.cokSatir]}
              multiline
              value={tespit}
              onChangeText={setTespit}
              placeholder="Sorunun sebebi neydi"
              placeholderTextColor="#c8ccc4"
            />

            <Text style={s.etiket}>YAPILAN İŞLEM *</Text>
            <TextInput
              style={[s.girdi, s.cokSatir]}
              multiline
              value={yapilanIslem}
              onChangeText={setYapilanIslem}
              placeholder="Ne yapıldı, nasıl çözüldü"
              placeholderTextColor="#c8ccc4"
            />

            <Text style={s.etiket}>TEKNİSYEN</Text>
            <TextInput
              style={s.girdi}
              value={teknisyen}
              onChangeText={setTeknisyen}
              placeholder="Müdahale eden kişi"
              placeholderTextColor="#c8ccc4"
            />

            <TouchableOpacity
              style={s.onaySatir}
              onPress={() => setCihazDegisti((o) => !o)}
              activeOpacity={0.7}
            >
              <View style={[s.onayKutu, cihazDegisti && s.onayKutuSecili]}>
                {cihazDegisti ? <Text style={s.onayIsaret}>✓</Text> : null}
              </View>
              <Text style={s.onayYazi}>Cihaz değiştirildi</Text>
            </TouchableOpacity>

            {cihazDegisti ? (
              <TextInput
                style={s.girdi}
                value={yeniCihaz}
                onChangeText={setYeniCihaz}
                placeholder="Yeni cihaz (marka, model, seri no)"
                placeholderTextColor="#c8ccc4"
              />
            ) : null}

            <Text style={s.etiket}>PARÇALAR</Text>

            {parcalar.map((p, sira) => (
              <View key={sira} style={s.parcaSatir}>
                <TextInput
                  style={[s.girdi, { flex: 1, marginBottom: 0 }]}
                  value={p.ad}
                  onChangeText={(d) => parcaGuncelle(sira, "ad", d)}
                  placeholder="Parça adı"
                  placeholderTextColor="#c8ccc4"
                />

                <TextInput
                  style={[s.girdi, s.kucukGirdi]}
                  value={p.adet}
                  onChangeText={(d) => parcaGuncelle(sira, "adet", d)}
                  keyboardType="decimal-pad"
                  placeholder="Adet"
                  placeholderTextColor="#c8ccc4"
                />

                <TextInput
                  style={[s.girdi, s.kucukGirdi, { width: 84 }]}
                  value={p.birimFiyat}
                  onChangeText={(d) => parcaGuncelle(sira, "birimFiyat", d)}
                  keyboardType="decimal-pad"
                  placeholder="₺"
                  placeholderTextColor="#c8ccc4"
                />

                <TouchableOpacity
                  onPress={() => setParcalar((o) => o.filter((_, i) => i !== sira))}
                  hitSlop={10}
                >
                  <Text style={s.sil}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity
              style={s.ekleDugme}
              onPress={() => setParcalar((o) => [...o, { ad: "", adet: "1", birimFiyat: "" }])}
            >
              <Text style={s.ekleYazi}>+ Parça ekle</Text>
            </TouchableOpacity>

            <Text style={s.etiket}>İŞÇİLİK / SERVİS ÜCRETİ</Text>
            <TextInput
              style={s.girdi}
              value={iscilik}
              onChangeText={setIscilik}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#c8ccc4"
            />

            <View style={s.toplamKutu}>
              <View style={s.toplamSatir}>
                <Text style={s.toplamAd}>Parça</Text>
                <Text style={s.toplamDeger}>{paraYaz(parcaTutari)}</Text>
              </View>

              <View style={s.toplamSatir}>
                <Text style={s.toplamAd}>İşçilik</Text>
                <Text style={s.toplamDeger}>{paraYaz(sayi(iscilik))}</Text>
              </View>

              <View style={[s.toplamSatir, s.genelToplam]}>
                <Text style={s.genelAd}>Toplam</Text>
                <Text style={s.genelDeger}>{paraYaz(toplam)}</Text>
              </View>
            </View>
          </ScrollView>

          <View style={s.alt}>
            <TouchableOpacity
              style={[s.kaydetDugme, kaydediliyor && { opacity: 0.6 }]}
              onPress={kaydet}
              disabled={kaydediliyor}
              activeOpacity={0.85}
            >
              <Text style={s.kaydetYazi}>
                {kaydediliyor ? "Kaydediliyor…" : "Kaydet ve durumu değiştir"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
      </Modal>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },

  ust: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  vazgec: { fontSize: 14.5, color: renk.pasif },
  baslik: { fontSize: 16, fontWeight: "700", color: renk.metin },
  durumEtiketi: {
    fontSize: 12,
    fontWeight: "700",
    color: renk.yesilKoyu,
    backgroundColor: renk.yesilAcik,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },

  govde: { padding: 16, paddingBottom: 30 },

  etiket: {
    fontSize: 11,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 7,
  },

  secenekler: { flexDirection: "row", gap: 8 },
  secenek: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
    alignItems: "center",
  },
  secenekSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  secenekYazi: { fontSize: 13.5, color: renk.metin },
  secenekYaziSecili: { color: renk.yesilKoyu, fontWeight: "700" },

  girdi: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: renk.metin,
    marginBottom: 8,
  },
  cokSatir: { minHeight: 76, textAlignVertical: "top" },
  kucukGirdi: { width: 64, marginBottom: 0, paddingHorizontal: 8 },

  onaySatir: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 8 },
  onayKutu: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: renk.cizgi,
    alignItems: "center",
    justifyContent: "center",
  },
  onayKutuSecili: { borderColor: renk.yesil, backgroundColor: renk.yesil },
  onayIsaret: { color: renk.beyaz, fontWeight: "800", fontSize: 13 },
  onayYazi: { fontSize: 14, color: renk.metin },

  parcaSatir: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  sil: { fontSize: 16, color: renk.kirmizi, paddingHorizontal: 4 },

  ekleDugme: {
    alignSelf: "flex-start",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: renk.yesil,
  },
  ekleYazi: { fontSize: 13, color: renk.yesilKoyu, fontWeight: "600" },

  toplamKutu: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.yuvarlak,
    padding: 14,
    marginTop: 16,
  },
  toplamSatir: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  toplamAd: { fontSize: 13.5, color: renk.pasif },
  toplamDeger: { fontSize: 13.5, color: renk.metin, fontWeight: "600" },
  genelToplam: {
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
    marginTop: 6,
    paddingTop: 10,
  },
  genelAd: { fontSize: 15, fontWeight: "700", color: renk.metin },
  genelDeger: { fontSize: 20, fontWeight: "800", color: renk.yesilKoyu },

  alt: {
    padding: 16,
    backgroundColor: renk.beyaz,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },
  kaydetDugme: {
    backgroundColor: renk.yesil,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  kaydetYazi: { fontSize: 15, fontWeight: "700", color: renk.beyaz },
});

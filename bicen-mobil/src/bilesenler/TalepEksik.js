/**
 * Talep eksik bildirimi (07.10.2026, 1.6)
 * ---------------------------------------------------------------------------
 * İK Personel Talepleri'nden talepteki eksiği bildirdiğinde ana sayfada
 * turuncu kart çıkar; kart bu pencereyi açar: eksik maddeler, İK notu,
 * son gün. İzinde "Evrakı yükle" mevcut evrak penceresini açar (yükleyince
 * kayıt kendiliğinden "tamamlandı"ya geçer); her türde "Tamamladım, İK'ya
 * bildir" vardır. 1.5'te kart yok: aynı metin kişiye özel duyuru olarak
 * gidiyor.
 *
 * 26.10.2026 (2.0): eksiği yönetici de bildirebiliyor (İzin Onayları ›
 * "Eksik bildir"). Sunucu "yonetici" ve "bildiren" alanlarını gönderiyor;
 * o zaman kart "İK" değil yöneticinin adıyla konuşuyor ve tamamlayınca
 * haber yöneticiye gidiyor (talep onun onayında bekliyor).
 */

import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { renk } from "../tema";
import ModalAlani, { modalTamEkran } from "./ModalAlani";
import { eksikTamamladim } from "../api";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const gunAy = (t) => {
  const d = new Date(t);
  return `${d.getDate()} ${AYLAR[d.getMonth()]}`;
};

/** Ana sayfadaki kartın alt satırı */
export const eksikAlt = (k) =>
  k.durum === "tamamlandi"
    ? k.yonetici
      ? "Yöneticinize bildirildi · onayında"
      : "İK'ya bildirildi · kontrol ediliyor"
    : [k.ozet, k.sonTarih ? (k.gecikti ? "son gün geçti" : `son gün ${gunAy(k.sonTarih)}`) : null].filter(Boolean).join(" · ");

export default function EksikPenceresi({ kart, kapat, evrakAc, tamam }) {
  const k = kart.kayit;
  /* Bildiren: İK ya da yönetici (2.0) */
  const kime = k.yonetici ? k.bildiren ?? "Yöneticiniz" : "İnsan Kaynakları";
  const [not, setNot] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [bitti, setBitti] = useState(k.durum === "tamamlandi");

  const bildir = async () => {
    setGonderiliyor(true);
    try {
      await eksikTamamladim(k.id, not.trim());
      setBitti(true);
    } catch (h) {
      Alert.alert("Gönderilemedi", h?.message ?? "İşlem yapılamadı.");
    } finally {
      setGonderiliyor(false);
    }
  };

  const kapatYenile = () => (bitti && k.durum !== "tamamlandi" ? tamam?.() : kapat());

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapatYenile}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.beyaz }]} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={s.tam} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.ust}>
            <Text style={[s.ustBaslik, { flex: 1 }]}>{k.turAdi} · eksik</Text>
            <TouchableOpacity onPress={kapatYenile} hitSlop={12}>
              <Text style={s.ustKapat}>Kapat</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
            <View style={[s.bilgi, bitti && s.bilgiTamam, !bitti && k.gecikti && s.bilgiGecikti]}>
              <Text style={[s.bilgiBaslik, bitti && { color: renk.yesilKoyu }]}>
                {bitti ? `${kime}'${k.yonetici ? "a" : "na"} bildirildi` : k.baslik}
              </Text>
              <Text style={s.bilgiAlt}>{k.ozet}</Text>
              {!bitti && k.sonTarih ? (
                <Text style={[s.bilgiSure, k.gecikti && { color: renk.kirmizi }]}>
                  {k.gecikti ? `Son gün geçti (${gunAy(k.sonTarih)})` : `Son gün ${gunAy(k.sonTarih)}`}
                </Text>
              ) : null}
              {bitti ? (
                <Text style={s.bilgiAlt}>
                  {k.yonetici
                    ? "Yöneticiniz karar verince bu kart ana sayfanızdan kalkar; talebiniz aynı adımdan devam ediyor."
                    : "İK kontrol edip kapatınca bu kart ana sayfanızdan kalkar."}
                </Text>
              ) : null}
            </View>

            {k.maddeler?.length ? (
              <>
                <Text style={s.etiket}>EKSİK OLAN</Text>
                <View style={{ gap: 8 }}>
                  {k.maddeler.map((m) => (
                    <View key={m} style={s.madde}>
                      <View style={s.nokta} />
                      <Text style={s.maddeYazi}>{m}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {k.aciklama ? (
              <>
                <Text style={s.etiket}>{k.yonetici ? "YÖNETİCİ NOTU" : "İK NOTU"}</Text>
                <View style={s.not}>
                  <Text style={s.notYazi}>{k.aciklama}</Text>
                  <Text style={s.notKim}>{k.gonderen ?? "İnsan Kaynakları"} · {gunAy(k.tarih)}</Text>
                </View>
              </>
            ) : null}

            {!bitti ? (
              <>
                {kart.belge ? (
                  <TouchableOpacity style={s.birincil} activeOpacity={0.85} onPress={() => evrakAc(kart.belge)}>
                    <Text style={s.birincilYazi}>Evrakı yükle</Text>
                  </TouchableOpacity>
                ) : null}

                <Text style={s.etiket}>TAMAMLADIYSANIZ</Text>
                <TextInput
                  style={s.girdi}
                  value={not}
                  onChangeText={setNot}
                  placeholder={k.yonetici ? "Yöneticinize not (isteğe bağlı) · örn. raporu yeniden yükledim" : "İK'ya not (isteğe bağlı) · örn. aslını bugün şube çantasıyla gönderdim"}
                  placeholderTextColor="#9aa3ad"
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[kart.belge ? s.ikincil : s.birincil, gonderiliyor && { opacity: 0.6 }]}
                  activeOpacity={0.85}
                  disabled={gonderiliyor}
                  onPress={bildir}
                >
                  {gonderiliyor ? (
                    <ActivityIndicator color={kart.belge ? renk.yesilKoyu : renk.beyaz} />
                  ) : (
                    <Text style={kart.belge ? s.ikincilYazi : s.birincilYazi}>{k.yonetici ? "Tamamladım, yöneticime bildir" : "Tamamladım, İK'ya bildir"}</Text>
                  )}
                </TouchableOpacity>
                {kart.belge ? (
                  <Text style={s.ipucu}>{k.yonetici ? "Evrakı yüklediğinizde yöneticinize kendiliğinden bildirilir." : "Evrakı yüklediğinizde İK'ya kendiliğinden bildirilir."}</Text>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </ModalAlani>
    </Modal>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1 },
  ust: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  ustBaslik: { fontSize: 18, fontWeight: "800", color: renk.metin },
  ustKapat: { fontSize: 14, fontWeight: "700", color: renk.pasif },
  govde: { padding: 18, paddingBottom: 40 },

  bilgi: { backgroundColor: "#fff1ea", borderRadius: 16, padding: 14, gap: 3 },
  bilgiTamam: { backgroundColor: renk.yesilAcik },
  bilgiGecikti: { borderWidth: 1.5, borderColor: renk.turuncu },
  bilgiBaslik: { fontSize: 16, fontWeight: "800", color: "#8f2f0b" },
  bilgiAlt: { fontSize: 13, color: renk.metin, lineHeight: 19 },
  bilgiSure: { fontSize: 13, fontWeight: "800", color: "#8f2f0b", marginTop: 6 },

  etiket: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },

  madde: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  nokta: { width: 8, height: 8, borderRadius: 4, backgroundColor: renk.turuncu, marginTop: 6 },
  maddeYazi: { flex: 1, fontSize: 14.5, color: renk.metin, lineHeight: 20 },

  not: { backgroundColor: "#f7f8f5", borderRadius: 12, padding: 12, gap: 6 },
  notYazi: { fontSize: 14, color: renk.metin, lineHeight: 20 },
  notKim: { fontSize: 12, color: renk.pasif },

  girdi: {
    borderWidth: 1.5,
    borderColor: "#d5dbcf",
    borderRadius: 12,
    minHeight: 70,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: renk.metin,
    textAlignVertical: "top",
  },

  birincil: {
    marginTop: 18,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
  },
  birincilYazi: { color: renk.beyaz, fontSize: 15.5, fontWeight: "800" },
  ikincil: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#b8c2ad",
    alignItems: "center",
    justifyContent: "center",
  },
  ikincilYazi: { color: renk.yesilKoyu, fontSize: 15, fontWeight: "800" },
  ipucu: { fontSize: 12, color: renk.pasif, marginTop: 8, textAlign: "center" },
});

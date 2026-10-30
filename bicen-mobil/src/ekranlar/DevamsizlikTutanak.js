/**
 * Devamsızlık tutanağı (26.10.2026)
 * ---------------------------------------------------------------------------
 * Bir devamsızlık girişinin tutanağı: devamsız personel, günler, açıklama,
 * giren yönetici ve iki şahit.
 *
 *  - Şahit: tutanağı okur, "Onaylıyorum" ya da "Onaylamıyorum" (+ sebep) der.
 *  - Giren yönetici: tutanağı açıp yazdırır, imzalı tutanağın fotoğrafını
 *    ya da PDF'ini yükler.
 *
 * Ana sayfadaki "İmzalı tutanağı yükleyin" ve "Şahitlik onayı bekleyen
 * tutanak" kartlarından ve "devamsizliktutanak|id" bildiriminden açılır.
 */

import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import BarBaslik from "../bilesenler/BarBaslik";
import { oturumluAdres, tutanakAl, tutanakSahitKarar, tutanakImzaliYukle } from "../api";
import { renk } from "../tema";
import { galeridenSec, kameradanCek } from "../dosyaSecici";
import { useKlavye, altBosluk } from "../klavye";

const DURUM = {
  belge: { ad: "İmzalı tutanak bekleniyor", renk: "#d97706", zemin: "#fff6e5" },
  sahit: { ad: "Şahit onayı bekleniyor", renk: "#1a5fb4", zemin: "#e7f0fc" },
  itiraz: { ad: "Şahit onaylamadı", renk: "#cf1322", zemin: "#fff1f0" },
  tamam: { ad: "Tamamlandı", renk: renk.yesilKoyu, zemin: renk.yesilAcik },
};

const SAHIT = {
  bekliyor: { ad: "Onay bekleniyor", renk: "#d97706" },
  onayladi: { ad: "Onayladı", renk: renk.yesilKoyu },
  reddetti: { ad: "Onaylamadı", renk: "#cf1322" },
};

const tarihSaat = (t) => {
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d)) return String(t);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function DevamsizlikTutanak({ route }) {
  const id = route?.params?.id;
  const t = route?.params?.t;
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [not, setNot] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const klavye = useKlavye();

  const getir = useCallback(async () => {
    if (!id) {
      setHata("Tutanak seçilmedi.");
      return;
    }
    try {
      setVeri(await tutanakAl(id));
      setHata("");
    } catch (h) {
      setHata(h?.message ?? "Tutanak alınamadı.");
    }
  }, [id]);

  useEffect(() => {
    setVeri(null);
    setNot("");
    getir();
  }, [getir, t]);

  const tut = veri?.tutanak;
  const d = tut ? DURUM[tut.durum] ?? DURUM.belge : null;

  const formuAc = () =>
    Linking.openURL(oturumluAdres(`/api/Devamsizlik/Tutanak/${id}/Form`)).catch(() =>
      Alert.alert("Açılamadı", "Tutanak açılamadı; bağlantınızı kontrol edin.")
    );

  const imzaliAc = () =>
    Linking.openURL(oturumluAdres(`/api/Devamsizlik/Tutanak/${id}/ImzaliForm`)).catch(() => {});

  const karar = (onay) => {
    const n = not.trim();
    if (!onay && n.length < 3) return Alert.alert("Sebep gerekli", "Onaylamıyorsanız kısa bir açıklama yazın.");
    Alert.alert(
      onay ? "Tutanağı onaylıyor musunuz?" : "Tutanağı onaylamıyor musunuz?",
      onay
        ? "Tutanaktaki bilgilerin doğru olduğuna şahitlik etmiş olacaksınız."
        : "İtirazınız devamsızlığı giren yöneticiye ve İK'ya iletilecek.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: onay ? "Onaylıyorum" : "Onaylamıyorum",
          style: onay ? "default" : "destructive",
          onPress: async () => {
            setIsleniyor(true);
            try {
              await tutanakSahitKarar(id, onay, n);
              Alert.alert("Kaydedildi", onay ? "Şahitlik onayınız kaydedildi." : "İtirazınız kaydedildi.");
              setNot("");
              await getir();
            } catch (h) {
              Alert.alert("Kaydedilemedi", h?.message ?? "");
            } finally {
              setIsleniyor(false);
            }
          },
        },
      ]
    );
  };

  const yukle = async (kaynak) => {
    try {
      const r = kaynak === "kamera" ? await kameradanCek({ quality: 0.6 }) : await galeridenSec({ quality: 0.6 }, { pdfDahil: true });
      const a = r?.assets?.[0];
      if (r?.canceled || !a) return;
      setIsleniyor(true);
      await tutanakImzaliYukle(id, { uri: a.uri, ad: a.fileName ?? `tutanak_${id}.jpg`, tip: a.mimeType ?? "image/jpeg" });
      Alert.alert("Yüklendi", "İmzalı tutanak kaydedildi; İK panelinde görünecek.");
      await getir();
    } catch (h) {
      Alert.alert("Yüklenemedi", h?.message ?? "");
    } finally {
      setIsleniyor(false);
    }
  };

  const yuklemeSor = () =>
    Alert.alert("İmzalı tutanağı yükle", "Yazdırılıp imzalanmış tutanağın fotoğrafını çekin ya da galeriden / PDF olarak seçin.", [
      { text: "Vazgeç", style: "cancel" },
      { text: "Fotoğraf çek", onPress: () => yukle("kamera") },
      { text: "Galeri / PDF", onPress: () => yukle("galeri") },
    ]);

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Devamsızlık Tutanağı" acik />
      <ScrollView contentContainerStyle={[s.govde, { paddingBottom: 160 }]} keyboardShouldPersistTaps="handled">
        {hata ? <Text style={s.hata}>{hata}</Text> : null}
        {!veri && !hata ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 30 }} /> : null}

        {tut ? (
          <>
            <View style={s.kart}>
              <View style={[s.hap, { backgroundColor: d.zemin }]}>
                <Text style={[s.hapYazi, { color: d.renk }]}>{d.ad}</Text>
              </View>
              <Text style={s.baslik}>{tut.adSoyad}</Text>
              <Text style={s.alt}>{[tut.pozisyon, tut.sube].filter(Boolean).join(" · ")}</Text>
              <Text style={s.no}>{tut.no} · {tarihSaat(tut.olusturma)}</Text>
            </View>

            <View style={s.kart}>
              <Satir a="Devamsız gün(ler)" b={tut.tarihler} kalin />
              <Satir a="Açıklama" b={tut.aciklama} />
              <Satir a="Giren yönetici" b={[tut.girenAd, tut.girenPozisyon].filter(Boolean).join(" · ")} />
              <Satir
                a="Tutanak maili"
                b={tut.formGonderim ? `Gönderildi · ${tut.formEposta ?? ""}` : tut.formHata ? `Gönderilemedi: ${tut.formHata}` : "Gönderilmedi"}
              />
            </View>

            <Text style={s.bolum}>{"Şahitler".toLocaleUpperCase("tr")}</Text>
            {(tut.sahitler ?? []).map((sh) => {
              const sd = SAHIT[sh.durum] ?? SAHIT.bekliyor;
              const benim = veri.sahitSira === sh.sira;
              return (
                <View key={sh.sira} style={[s.kart, benim && { borderColor: renk.yesil }]}>
                  <Text style={s.etiket}>{sh.sira}. ŞAHİT{benim ? " · SİZ" : ""}</Text>
                  <Text style={s.ad}>{sh.adSoyad}</Text>
                  <Text style={s.alt}>{sh.pozisyon}</Text>
                  <Text style={[s.sahitDurum, { color: sd.renk }]}>
                    {sd.ad}{sh.tarih ? ` · ${tarihSaat(sh.tarih)}` : ""}
                  </Text>
                  {sh.not ? <Text style={s.alt}>"{sh.not}"</Text> : null}
                </View>
              );
            })}

            <Text style={s.bolum}>Belgeler</Text>
            <TouchableOpacity style={s.satirDugme} onPress={formuAc} activeOpacity={0.7}>
              <Text style={s.satirDugmeYazi}>Tutanağı aç / yazdır (PDF)</Text>
              <Text style={{ color: renk.pasif }}>›</Text>
            </TouchableOpacity>
            {tut.belgeVar ? (
              <TouchableOpacity style={s.satirDugme} onPress={imzaliAc} activeOpacity={0.7}>
                <Text style={s.satirDugmeYazi}>İmzalı tutanak · {tarihSaat(tut.belgeTarihi)}</Text>
                <Text style={{ color: renk.pasif }}>›</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.bilgiKutu}>
                <Text style={s.bilgiYazi}>
                  İmzalı tutanak henüz yüklenmedi. Tutanak mail olarak gitti; yazdırılıp giren yönetici ve iki şahit tarafından
                  imzalandıktan sonra {veri.benGiren ? "aşağıdaki düğmeyle" : "devamsızlığı giren yönetici tarafından"} yüklenir.
                </Text>
              </View>
            )}

            {veri.sahitKararBekliyor ? (
              <>
                <Text style={s.bolum}>{"Şahitlik kararınız".toLocaleUpperCase("tr")}</Text>
                <View style={s.bilgiKutu}>
                  <Text style={s.bilgiYazi}>
                    {tut.girenAd} sizi bu tutanakta şahit olarak seçti. Bilgiler doğruysa onaylayın; değilse sebebini yazıp
                    "Onaylamıyorum" deyin.
                  </Text>
                </View>
                <TextInput
                  value={not}
                  onChangeText={setNot}
                  placeholder="Not (onaylamıyorsanız zorunlu)"
                  placeholderTextColor="#9aa093"
                  multiline
                  maxLength={500}
                  style={s.aciklama}
                />
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {tut && veri.sahitKararBekliyor ? (
        <View style={[s.altCubuk, { bottom: altBosluk(klavye) }]}>
          <TouchableOpacity style={[s.dugme, s.dugmeRed, isleniyor && { opacity: 0.45 }]} disabled={isleniyor} onPress={() => karar(false)}>
            <Text style={[s.dugmeYazi, { color: renk.kirmizi }]}>Onaylamıyorum</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.dugme, isleniyor && { opacity: 0.45 }]} disabled={isleniyor} onPress={() => karar(true)}>
            {isleniyor ? <ActivityIndicator color="#fff" /> : <Text style={s.dugmeYazi}>Onaylıyorum</Text>}
          </TouchableOpacity>
        </View>
      ) : tut && veri.benGiren && !tut.iptal ? (
        <View style={[s.altCubuk, { bottom: altBosluk(klavye) }]}>
          <TouchableOpacity style={[s.dugme, isleniyor && { opacity: 0.45 }]} disabled={isleniyor} onPress={yuklemeSor}>
            {isleniyor ? <ActivityIndicator color="#fff" /> : <Text style={s.dugmeYazi}>{tut.belgeVar ? "İmzalı tutanağı yeniden yükle" : "İmzalı tutanağı yükle"}</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const Satir = ({ a, b, kalin }) => (
  <View style={{ marginBottom: 8 }}>
    <Text style={s.etiket}>{a.toLocaleUpperCase("tr")}</Text>
    <Text style={[s.deger, kalin && { fontWeight: "800" }]}>{b || "—"}</Text>
  </View>
);

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 14, gap: 10 },
  hata: { color: renk.kirmizi, padding: 10 },
  kart: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 14 },
  hap: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 8 },
  hapYazi: { fontSize: 12, fontWeight: "800" },
  baslik: { fontSize: 18, fontWeight: "800", color: renk.metin },
  ad: { fontSize: 15.5, fontWeight: "700", color: renk.metin },
  alt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },
  no: { fontSize: 12, color: renk.pasif, marginTop: 6 },
  etiket: { fontSize: 11, fontWeight: "800", color: renk.pasif, letterSpacing: 0.5, marginBottom: 2 },
  deger: { fontSize: 14.5, color: renk.metin, lineHeight: 20 },
  bolum: { fontSize: 12, fontWeight: "700", color: renk.pasif, textTransform: "uppercase", marginTop: 6, letterSpacing: 0.4 },
  sahitDurum: { fontSize: 13, fontWeight: "700", marginTop: 6 },
  satirDugme: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: renk.cizgi, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  satirDugmeYazi: { fontSize: 14.5, fontWeight: "700", color: "#1a5fb4" },
  bilgiKutu: { backgroundColor: "#fff6e5", borderRadius: 12, padding: 12 },
  bilgiYazi: { fontSize: 13, color: "#8a5a00", lineHeight: 18 },
  aciklama: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: renk.cizgi, padding: 12, minHeight: 70, fontSize: 15, textAlignVertical: "top", color: renk.metin },
  altCubuk: { position: "absolute", left: 14, right: 14, flexDirection: "row", gap: 10 },
  dugme: { flex: 1, backgroundColor: renk.yesil, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  dugmeRed: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: renk.kirmizi },
  dugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 15.5 },
});

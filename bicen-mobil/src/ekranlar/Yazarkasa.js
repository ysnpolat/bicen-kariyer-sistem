/**
 * Yazarkasa
 * ---------------------------------------------------------------------------
 * Personelin kendi yazarkasa kullanıcı kodu ve şifresi.
 *
 * Diğer ekranındaki künye kartına basılınca açılır. Kayıt, oturumdaki
 * kişinin kimlik numarasıyla eşleştirilir; ekran hiçbir yere sicil ya da
 * kimlik göndermez, sunucu kimin sorduğunu jetondan bilir.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { yazarkasaAl, yazarkasaSifreYaz } from "../api";
import { renk } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";

export default function Yazarkasa({ navigation }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [gorunsun, setGorunsun] = useState(false);
  const [degistir, setDegistir] = useState(false);
  const [yeni, setYeni] = useState("");
  const [tekrar, setTekrar] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      setVeri(await yazarkasaAl());
      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Bilgiler alınamadı.");
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  /* Şifre her açılışta gizli başlar: ekran açıkken telefonun başkasının
     eline geçmesi ihtimaline karşı. */
  useFocusEffect(
    useCallback(() => {
      return () => {
        setGorunsun(false);
        setDegistir(false);
        setYeni("");
        setTekrar("");
      };
    }, [])
  );

  const kaydet = async () => {
    if (yeni.length !== 4 || !/^\d{4}$/.test(yeni)) {
      Alert.alert("Geçersiz şifre", "Şifre dört haneli olmalı ve yalnızca rakam içermelidir.");
      return;
    }

    if (yeni !== tekrar) {
      Alert.alert("Şifreler uyuşmuyor", "İki alana da aynı şifreyi yazınız.");
      return;
    }

    setKaydediliyor(true);

    try {
      await yazarkasaSifreYaz(yeni);

      setDegistir(false);
      setYeni("");
      setTekrar("");

      await getir();

      Alert.alert(
        "Şifreniz değişti",
        "Yeni şifreniz yazarkasada hemen geçerlidir."
      );
    } catch (e) {
      Alert.alert("Değiştirilemedi", e?.message ?? "İşlem tamamlanamadı.");
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

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
        {/* ------------------------------------------------- başlık */}
        <View style={s.baslikSatir}>
          <TouchableOpacity
            style={s.geri}
            activeOpacity={0.65}
            onPress={() => navigation.goBack()}
          >
            <Simge ad="ok" renkli={renk.pasif} boyut={18} />
          </TouchableOpacity>

          <Text style={s.baslik}>Yazarkasa</Text>
        </View>

        {hata ? <Hata metin={hata} /> : null}

        {!hata && veri && !veri.kayitVar ? (
          <Bilgi>
            {veri.sebep ?? "Yazarkasa kaydınız bulunamadı."} Şubenizin
            sorumlusuyla ya da İnsan Kaynakları ile görüşünüz.
          </Bilgi>
        ) : null}

        {veri?.kayitVar ? (
          <>
            {/* --------------------------------------- kullanıcı kodu */}
            <View style={s.kart}>
              <Text style={s.etiket}>Kullanıcı kodu</Text>
              <Text style={s.kod}>{veri.kullaniciKodu || "—"}</Text>

              <View style={s.rozetler}>
                <Rozet
                  metin={veri.yetkiAdi}
                  tur={veri.no === 5 ? "mor" : "yesil"}
                />

                {!veri.aktif ? <Rozet metin="Pasif" tur="turuncu" /> : null}
              </View>

              {veri.gorev ? (
                <Text style={s.gorev}>{veri.gorev}</Text>
              ) : null}
            </View>

            {/* --------------------------------------------- şifre */}
            <View style={s.kart}>
              <Text style={s.etiket}>Şifre</Text>

              <View style={s.sifreSatir}>
                <Text style={s.sifre}>
                  {gorunsun ? veri.sifre || "—" : "••••"}
                </Text>

                <TouchableOpacity
                  style={s.kucukDugme}
                  activeOpacity={0.7}
                  onPress={() => setGorunsun((o) => !o)}
                >
                  <Text style={s.kucukDugmeYazi}>
                    {gorunsun ? "Gizle" : "Göster"}
                  </Text>
                </TouchableOpacity>
              </View>

              {!degistir ? (
                <TouchableOpacity
                  style={s.dugme}
                  activeOpacity={0.75}
                  onPress={() => setDegistir(true)}
                >
                  <Text style={s.dugmeYazi}>Şifremi değiştir</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.form}>
                  <Text style={s.formEtiket}>Yeni şifre</Text>
                  <TextInput
                    style={s.giris}
                    value={yeni}
                    onChangeText={(t) => setYeni(t.replace(/\D/g, "").slice(0, 4))}
                    keyboardType="number-pad"
                    maxLength={4}
                    secureTextEntry
                    placeholder="••••"
                    placeholderTextColor="#c8ccc4"
                  />

                  <Text style={s.formEtiket}>Yeni şifre (tekrar)</Text>
                  <TextInput
                    style={s.giris}
                    value={tekrar}
                    onChangeText={(t) => setTekrar(t.replace(/\D/g, "").slice(0, 4))}
                    keyboardType="number-pad"
                    maxLength={4}
                    secureTextEntry
                    placeholder="••••"
                    placeholderTextColor="#c8ccc4"
                  />

                  <Text style={s.kural}>
                    Dört haneli ve yalnızca rakam olmalıdır.
                  </Text>

                  <View style={s.dugmeSatir}>
                    <TouchableOpacity
                      style={[s.dugme, s.ikincil, { flex: 1 }]}
                      activeOpacity={0.75}
                      disabled={kaydediliyor}
                      onPress={() => {
                        setDegistir(false);
                        setYeni("");
                        setTekrar("");
                      }}
                    >
                      <Text style={[s.dugmeYazi, s.ikincilYazi]}>Vazgeç</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[s.dugme, { flex: 1 }, kaydediliyor && s.soluk]}
                      activeOpacity={0.75}
                      disabled={kaydediliyor}
                      onPress={kaydet}
                    >
                      <Text style={s.dugmeYazi}>
                        {kaydediliyor ? "Kaydediliyor…" : "Kaydet"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {veri.onayYetkisi ? (
              <Bilgi>
                Yönetici yetkiniz var: yazarkasada onay gerektiren işlemleri
                onaylayabilirsiniz.
              </Bilgi>
            ) : null}

            <Text style={s.dipnot}>
              Şifrenizi kimseyle paylaşmayınız. Yaptığınız her işlem bu
              kullanıcı koduyla kaydedilir.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 110 },

  baslikSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },

  /* Ok simgesi sağa bakıyor; geri için çevriliyor */
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

  kart: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 16,
    marginBottom: 14,
  },

  etiket: {
    fontSize: 11.5,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  kod: {
    fontSize: 30,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: 1,
  },

  rozetler: { flexDirection: "row", gap: 6, marginTop: 10 },

  gorev: { fontSize: 12.5, color: renk.pasif, marginTop: 8 },

  sifreSatir: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sifre: {
    fontSize: 30,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: 6,
  },

  kucukDugme: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: renk.yesilAcik,
  },

  kucukDugmeYazi: { fontSize: 12.5, fontWeight: "700", color: renk.yesilKoyu },

  dugme: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 11,
    backgroundColor: renk.yesil,
    alignItems: "center",
  },

  dugmeYazi: { fontSize: 14, fontWeight: "700", color: "#fff" },

  ikincil: { backgroundColor: "#f2f4f0" },
  ikincilYazi: { color: renk.metin },

  soluk: { opacity: 0.6 },

  dugmeSatir: { flexDirection: "row", gap: 10 },

  form: { marginTop: 14 },

  formEtiket: {
    fontSize: 12.5,
    fontWeight: "600",
    color: renk.metin,
    marginBottom: 6,
    marginTop: 8,
  },

  giris: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 20,
    letterSpacing: 6,
    color: renk.metin,
    backgroundColor: "#fbfcfa",
  },

  kural: { fontSize: 11.5, color: renk.pasif, marginTop: 10 },

  dipnot: {
    fontSize: 11.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 17,
  },
});

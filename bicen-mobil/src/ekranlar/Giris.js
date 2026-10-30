/**
 * Giriş
 * ---------------------------------------------------------------------------
 * Kimlik numarası ve telefonla giriş; ardından SMS doğrulama.
 *
 * Parola yok. Personelin parola hatırlaması gereken bir uygulama kullanılmaz
 * hale gelir; telefon zaten yanında ve numarası personel kaydında var.
 * Telefonun kayıtla eşleşmesi, başkasının kimlik numarasıyla giriş
 * denemesini de engelliyor.
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";

import { api, kodIste, oturumKapanmaNedeniAl } from "../api";
import { renk } from "../tema";

export default function Giris({ navigation }) {
  const [kimlik, setKimlik] = useState("");
  const [telefon, setTelefon] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  /* Sunucu oturumu kapattıysa sebebi burada gösterilir: çıkış tarihi gelen
     personel "neden atıldım" diye kalmasın (26.10.2026) */
  const [hata, setHata] = useState(() => oturumKapanmaNedeniAl());
  const [logoHatasi, setLogoHatasi] = useState(false);

  const gonder = async () => {
    const k = kimlik.replace(/\D/g, "");
    const t = telefon.replace(/\D/g, "");

    if (k.length !== 11) {
      setHata("Kimlik numarası 11 haneli olmalıdır.");
      return;
    }

    /* Telefon boş bırakılabiliyor.

       Mağaza inceleme hesabı yalnızca kimlik numarası ve sabit kodla
       çalışıyor; uygulama mağazasının inceleyicisine telefon numarası
       verilmiyor ve zorunlu alan yüzünden giriş denemesi başarısız
       oluyordu. Boş geçilirse sunucu karar veriyor: normal personelde
       "telefon gerekli" hatası dönüyor, inceleme hesabında dönmüyor.

       Dolu yazılmışsa biçim yine denetleniyor. */
    if (t.length > 0 && t.length !== 10) {
      setHata("Telefon numarasını başında sıfır olmadan giriniz.");
      return;
    }

    setHata("");
    setYukleniyor(true);

    try {
      const c = await kodIste(k, t);

      /* Mağaza inceleme hesabında kod yanıtta geliyor ve kutu
         kendiliğinden doluyor: inceleyiciye kullanıcı adı ve şifre
         veriliyor, SMS kodu diye bir kavram yok ve bu adımda
         takılıyorlardı. Gerçek personelde bu alan hiç dönmüyor. */
      navigation.navigate("Kod", {
        kimlik: k,
        telefon: t,
        hazirKod: c?.inceleme ? c.kod : undefined,
      });
    } catch (h) {
      setHata(h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.tam}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={s.govde}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo API'den gelir; panelle aynı dosya kullanılır.

            Sunucuya ulaşılamadığında marka adı yazıyla gösterilir:
            boş bir alan yerine bir şey görünmesi daha iyi. */}
        {logoHatasi ? (
          <Text style={s.markaYazi}>biçen</Text>
        ) : (
          <Image
            source={{ uri: api.logoAdresi() }}
            style={s.logo}
            resizeMode="contain"
            onError={() => setLogoHatasi(true)}
          />
        )}

        <Text style={s.altYazi}>Personel Uygulaması</Text>

        <Text style={s.aciklama}>
          Kimlik numaranız ve sistemde kayıtlı telefonunuzla giriş yapın.
        </Text>

        <Text style={s.etiket}>T.C. Kimlik Numarası</Text>
        <TextInput
          style={s.girdi}
          value={kimlik}
          onChangeText={(v) => setKimlik(v.replace(/\D/g, ""))}
          keyboardType="number-pad"
          maxLength={11}
          placeholder="11 haneli numaranız"
          placeholderTextColor="#9aa0a6"
        />

        <Text style={s.etiket}>Cep Telefonu</Text>
        <TextInput
          style={s.girdi}
          value={telefon}
          onChangeText={(v) => setTelefon(v.replace(/\D/g, ""))}
          keyboardType="number-pad"
          maxLength={10}
          placeholder="5xxxxxxxxx"
          placeholderTextColor="#9aa0a6"
        />

        {hata ? <Text style={s.hata}>{hata}</Text> : null}

        <TouchableOpacity
          style={[s.dugme, yukleniyor && { opacity: 0.6 }]}
          onPress={gonder}
          disabled={yukleniyor}
        >
          {yukleniyor ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.dugmeYazi}>Doğrulama kodu gönder</Text>
          )}
        </TouchableOpacity>

        <Text style={s.dipnot}>
          Telefon numaranız personel kaydınızdakiyle aynı olmalıdır.
          Farklıysa İnsan Kaynakları ile görüşünüz.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.beyaz },

  govde: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 26,
    paddingVertical: 50,
  },

  logo: { width: 150, height: 54, alignSelf: "center" },

  markaYazi: {
    fontSize: 34,
    fontWeight: "800",
    color: renk.yesilKoyu,
    textAlign: "center",
    letterSpacing: -0.8,
  },

  altYazi: {
    fontSize: 12.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 4,
  },

  aciklama: {
    fontSize: 13.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 26,
    lineHeight: 21,
  },

  etiket: {
    fontSize: 12.5,
    fontWeight: "600",
    color: renk.metin,
    marginTop: 16,
    marginBottom: 5,
  },

  girdi: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15,
    color: renk.metin,
  },

  hata: {
    fontSize: 12.5,
    color: renk.kirmizi,
    marginTop: 12,
    lineHeight: 19,
  },

  dugme: {
    backgroundColor: renk.yesil,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 18,
  },

  dugmeYazi: { color: "#fff", fontSize: 15.5, fontWeight: "700" },

  dipnot: {
    fontSize: 11.5,
    color: renk.pasif,
    marginTop: 18,
    lineHeight: 18,
    textAlign: "center",
  },
});

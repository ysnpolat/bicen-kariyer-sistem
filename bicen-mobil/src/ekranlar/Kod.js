/**
 * Doğrulama
 * ---------------------------------------------------------------------------
 * SMS ile gelen altı haneli kod. Kutular ayrı ayrı; yapıştırma yapıldığında
 * kod otomatik dağıtılır ve son haneye yazılınca kendiliğinden doğrulanır —
 * personelin ayrıca düğmeye basması gerekmez.
 */

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import { api, kodDogrula, kodIste } from "../api";
import { hukukYaz } from "../gorunum";
import { renk } from "../tema";

const SURE = 120;

export default function Kod({ route, navigation }) {
  const { kimlik, telefon, hazirKod } = route.params ?? {};

  /* Mağaza inceleme hesabında kod hazır geliyor: inceleyiciye kullanıcı
     adı ve şifre veriliyor, SMS kodu diye bir kavram yok ve bu adımda
     takılıyorlardı. Gerçek personelde hazirKod hiç gelmiyor. */
  const [haneler, setHaneler] = useState(
    hazirKod && String(hazirKod).length === 6
      ? String(hazirKod).split("")
      : ["", "", "", "", "", ""]
  );
  const [kalan, setKalan] = useState(SURE);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [logoHatasi, setLogoHatasi] = useState(false);

  const kutular = useRef([]);

  /* Geri sayım */
  useEffect(() => {
    if (kalan <= 0) return;

    const s = setTimeout(() => setKalan(kalan - 1), 1000);
    return () => clearTimeout(s);
  }, [kalan]);

  const yaz = (i, deger) => {
    const temiz = deger.replace(/\D/g, "");

    /* Yapıştırma: tek kutuya birden çok hane gelirse dağıtılır */
    if (temiz.length > 1) {
      const yeni = [...haneler];

      temiz.split("").forEach((h, j) => {
        if (i + j < 6) yeni[i + j] = h;
      });

      setHaneler(yeni);

      const son = Math.min(i + temiz.length, 5);
      kutular.current[son]?.focus();

      if (yeni.every((x) => x)) dogrula(yeni.join(""));
      return;
    }

    const yeni = [...haneler];
    yeni[i] = temiz;
    setHaneler(yeni);

    if (temiz && i < 5) kutular.current[i + 1]?.focus();

    if (yeni.every((x) => x)) dogrula(yeni.join(""));
  };

  /* Boş kutuda geri tuşu bir öncekine atlar */
  const tusaBas = (i, olay) => {
    if (olay.nativeEvent.key === "Backspace" && !haneler[i] && i > 0)
      kutular.current[i - 1]?.focus();
  };

  /** Altı hanenin tamamı yazılmış mı */
  const dolu = haneler.every((x) => x);

  const dogrula = async (kod) => {
    /* Klavye kapatılıyor: doğrulama sırasında ekranı kaplıyor ve hata
       çıkarsa kullanıcı mesajı göremiyordu. */
    Keyboard.dismiss();

    setHata("");
    setYukleniyor(true);

    try {
      const d = await kodDogrula(kimlik, telefon, kod);

      /* Dış hukuk danışmanı (24.10.2026): yalnız hukuk masası açılır */
      await hukukYaz(!!d?.hukuk);

      /* Giriş ekranlarına geri dönülemesin */
      navigation.reset({ index: 0, routes: [{ name: d?.hukuk ? "Hukuk" : "Uygulama" }] });
    } catch (h) {
      setHata(h.message);
      setHaneler(["", "", "", "", "", ""]);
      kutular.current[0]?.focus();
    } finally {
      setYukleniyor(false);
    }
  };

  const tekrarGonder = async () => {
    setHata("");

    try {
      await kodIste(kimlik, telefon);
      setKalan(SURE);
    } catch (h) {
      setHata(h.message);
    }
  };

  const dk = Math.floor(kalan / 60);
  const sn = String(kalan % 60).padStart(2, "0");

  /* Numaranın tamamı yazılmaz: omuz üstünden bakan biri görmesin */
  const maskeli = telefon ? `${telefon.slice(0, 3)}•••${telefon.slice(-2)}` : "";

  return (
    /* Boşluğa dokununca klavye kapanıyor: kod kutuları küçük ve klavye
       ekranın yarısını kaplayınca altındaki düğmelere ulaşılamıyordu. */
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={s.tam}>
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

      <Text style={s.altYazi}>Doğrulama</Text>

      <Text style={s.aciklama}>
        <Text style={{ fontWeight: "700" }}>{maskeli}</Text> numarasına
        gönderilen altı haneli kodu giriniz.
      </Text>

      <View style={s.kutular}>
        {haneler.map((h, i) => (
          <TextInput
            key={i}
            ref={(r) => (kutular.current[i] = r)}
            style={[s.kutu, h && s.kutuDolu]}
            value={h}
            onChangeText={(v) => yaz(i, v)}
            onKeyPress={(e) => tusaBas(i, e)}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus={i === 0}
            selectTextOnFocus
          />
        ))}
      </View>

      {yukleniyor ? (
        <ActivityIndicator color={renk.yesil} style={{ marginTop: 10 }} />
      ) : hata ? (
        <Text style={s.hata}>{hata}</Text>
      ) : null}

      {/* Elle giriş düğmesi.

          Kod otomatik doğrulanıyor ama her durumda tetiklenmiyor: kutular
          hazır dolu geldiğinde yazma olayı hiç oluşmuyor ve kullanıcı
          basacak bir şey bulamıyordu. Düğme altı hane doluyken görünür. */}
      {dolu && !yukleniyor ? (
        <TouchableOpacity
          style={s.girisDugme}
          onPress={() => dogrula(haneler.join(""))}
          activeOpacity={0.85}
        >
          <Text style={s.girisYazi}>Giriş yap</Text>
        </TouchableOpacity>
      ) : null}

      {kalan > 0 ? (
        <Text style={s.sure}>
          Kalan süre{" "}
          <Text style={{ fontWeight: "700", color: renk.metin }}>
            {dk}:{sn}
          </Text>
        </Text>
      ) : (
        <TouchableOpacity onPress={tekrarGonder}>
          <Text style={s.tekrar}>Kodu yeniden gönder</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={s.geri} onPress={() => navigation.goBack()}>
        <Text style={s.geriYazi}>Geri</Text>
      </TouchableOpacity>
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  tam: {
    flex: 1,
    backgroundColor: renk.beyaz,
    paddingHorizontal: 26,
    paddingTop: 70,
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
    color: renk.metin,
    textAlign: "center",
    marginTop: 26,
    lineHeight: 21,
  },

  kutular: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 9,
    marginTop: 22,
  },

  kutu: {
    width: 46,
    height: 56,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 10,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "700",
    color: renk.metin,
  },

  kutuDolu: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },

  hata: {
    fontSize: 12.5,
    color: renk.kirmizi,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 19,
  },

  sure: {
    fontSize: 12.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 14,
  },

  girisDugme: {
    marginTop: 18,
    backgroundColor: renk.yesilKoyu,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 44,
    alignItems: "center",
  },
  girisYazi: { fontSize: 15, fontWeight: "800", color: renk.beyaz },

  tekrar: {
    fontSize: 13.5,
    color: renk.yesilKoyu,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 14,
  },

  geri: { marginTop: 26, alignItems: "center" },
  geriYazi: { fontSize: 13.5, color: renk.pasif },
});

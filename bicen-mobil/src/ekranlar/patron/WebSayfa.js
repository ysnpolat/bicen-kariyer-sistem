/**
 * Patron · Sunucu tanımlı sayfa
 * ---------------------------------------------------------------------------
 * Çıkış mülakatları, duyuru gönder, bildirim ayarları gibi sayfalar
 * uygulamaya gömülü değil: sunucudaki `patron-sayfa/{kod}` HTML'i burada
 * WebView içinde açılıyor. Yeni sayfa ya da sayfadaki bir değişiklik için
 * uygulama güncellemesi gerekmiyor; Özet'teki `sayfalar` listesi hangi
 * sayfanın nerede görüneceğini söylüyor.
 *
 * Başlık çubuğu yerel (geri + başlık + yenile): sayfa yüklenemese bile
 * kişi geri dönebilmeli.
 *
 * Kimlik: sayfa yüklenmeden önce `window.BICEN = { jeton, adres, surum, aralik }`
 * yazılıyor; sayfa API'yi bu jetonla çağırıyor. `aralik` (1.6): patron
 * sayfalarında seçili tarih aralığı ({ bas, bit, ad } ya da "Bugün"de
 * null); sayfa kendi tarih süzgecini bununla başlatabiliyor. Yalnızca bizim sunucumuzun
 * sayfasına yazılıyor (kaynak denetimi), dış bağlantılar telefonun kendi
 * uygulamasında açılıyor — jeton başka bir siteye geçmiyor.
 *
 * Sayfa → uygulama mesajları (`window.ReactNativeWebView.postMessage`):
 *   { tur: "tost", metin }            yerel bildirim
 *   { tur: "geri" }                   ekranı kapat
 *   { tur: "git", ekran, p }          yerel ekrana git (dikkat `hedef` değerleri)
 *   { tur: "baslik", metin }          başlığı değiştir
 */

import { Component, useCallback, useMemo, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Linking, BackHandler, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";

import { patronRenk as P } from "../../tema";
import { api, jetonOku } from "../../api";
import { usePatron, sayfaAdresi, bizimAdresMi, KOK_KAYNAK } from "../../patronApi";
import { usePatron360, hedefeGit } from "../../bilesenler/patron/Baglam";
import { useTarihAraligi } from "../../bilesenler/patron/aralik";
import { AcikUst, UstDugme, HataKutu } from "../../bilesenler/patron/Parcalar";
import Ikon from "../../bilesenler/patron/Ikon";

/* Paket koşullu yükleniyor (expo-file-system, qrcode ile aynı desen).
   Paket ya da yerel modülü yoksa (eski bir derlemeye gelen güncelleme)
   require hata veriyor; uygulama beyaz ekrana düşmesin, bu ekran bir
   açıklama göstersin. */
let WebView = null;

try {
  const m = require("react-native-webview");
  WebView = m?.WebView ?? m?.default ?? null;
} catch {
  WebView = null;
}

/* Sayfaya bildirilen sürüm: sayfa eski uygulamada olmayan bir mesajı
   kullanmadan önce buna bakabiliyor. */
const SURUM = String(Constants.expoConfig?.version ?? "1.5");

/* Yüzen alt menünün kapladığı yükseklik (AltMenu: 8 + kapsül + yazı + 8).
   Sayfanın son satırı menünün altında kalmasın. */
const MENU_YUKSEKLIGI = 66;

/** Sunucu hata kodu → açıklama */
const httpHatasi = (kod) =>
  kod === 404
    ? "Sayfa bulunamadı. Sunucuda henüz yayınlanmamış olabilir."
    : kod === 401 || kod === 403
    ? "Bu sayfayı görme yetkiniz yok ya da oturumunuz sona erdi."
    : `Sayfa açılamadı (sunucu ${kod}).`;

export default function WebSayfa({ navigation, route }) {
  const { tost } = usePatron360();
  const kenar = useSafeAreaInsets();

  const kod = route.params?.kod ? String(route.params.kod) : null;
  const t = route.params?.t ?? 0;
  const aralik = useTarihAraligi();

  /* Başlık ve alt yazı Özet'teki tanımdan (bildirimden ya da "git" ile
     açıldığında parametrede başlık yok) */
  const ozet = usePatron("Ozet", { pasif: true });
  const tanim = (Array.isArray(ozet.veri?.sayfalar) ? ozet.veri.sayfalar : []).find((x) => x?.kod === kod);

  /* Sayfanın kendi koyduğu başlık ("baslik" mesajı) ve HTML <title>;
     sayfa değişince sıfırlanıyor. <title> son çare: Özet hiç yüklenmeden
     bildirimle açılınca tanım bilinmiyor. */
  const [sayfaBaslik, setSayfaBaslik] = useState({ anahtar: null, metin: null });
  const [belgeBaslik, setBelgeBaslik] = useState({ anahtar: null, metin: null });

  const [durum, setDurum] = useState({ anahtar: null, ad: "yukleniyor", hata: "" });
  const [ilerleme, setIlerleme] = useState(0);
  const [deneme, setDeneme] = useState(0);

  const ref = useRef(null);
  const geriVar = useRef(false);

  /* Her açılış (yeni t) ve "Tekrar dene" WebView'i baştan kuruyor */
  const anahtar = `${kod}-${t}-${deneme}`;

  const durumAd = durum.anahtar === anahtar ? durum.ad : "yukleniyor";
  const hataMetni = durum.anahtar === anahtar ? durum.hata : "";

  const baslik =
    (sayfaBaslik.anahtar === anahtar && sayfaBaslik.metin) ||
    route.params?.baslik ||
    tanim?.baslik ||
    (belgeBaslik.anahtar === anahtar && belgeBaslik.metin) ||
    "Sayfa";

  const kaynak = useMemo(() => {
    if (!kod) return null;

    const jeton = jetonOku();

    /* Jeton başlıkta da gidiyor (sunucu sayfayı korumaya alırsa diye);
       HTML önbellekten gelmesin: sayfanın son hâli görünmeli. */
    return {
      uri: sayfaAdresi(kod),
      headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), "Cache-Control": "no-cache" },
    };
  }, [kod, anahtar]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sayfa yüklenmeden önce çalışan betik. Kaynak denetimi: yönlendirmeyle
     başka bir alana geçilse bile jeton oraya yazılmıyor. */
  const enjekte = useMemo(() => {
    const veri = JSON.stringify({
      jeton: jetonOku() ?? "",
      adres: api.adres,
      surum: SURUM,
      aralik: aralik.canli ? null : { bas: aralik.bas, bit: aralik.bit, ad: aralik.ad, anahtar: aralik.anahtar },
    });

    return `(function(){try{if(String(location.origin).toLowerCase()===${JSON.stringify(KOK_KAYNAK)}){window.BICEN=${veri};}}catch(e){}})();true;`;
  }, [anahtar]); // eslint-disable-line react-hooks/exhaustive-deps

  const kapat = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Ozet");
  }, [navigation]);

  const yenile = useCallback(() => {
    if (durumAd === "hazir" && ref.current?.reload) {
      setIlerleme(0);
      ref.current.reload();
    } else {
      setDeneme((d) => d + 1);
    }
  }, [durumAd]);

  const disaAc = useCallback(
    (url) => {
      Linking.openURL(url).catch(() => tost("Bağlantı açılamadı", "hata"));
    },
    [tost]
  );

  /* Android geri tuşu: sayfa kendi içinde ilerlediyse önce orada geri */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;

      const dinleyici = BackHandler.addEventListener("hardwareBackPress", () => {
        if (geriVar.current && ref.current?.goBack) {
          ref.current.goBack();
          return true;
        }

        return false;
      });

      return () => dinleyici?.remove?.();
    }, [])
  );

  /* Bizim sunucumuz WebView'de, gerisi (başka site, tel:, sms:, mailto:)
     telefonun kendi uygulamasında. Sayfa içi çerçeveler (harita gibi)
     yerinde kalıyor. */
  const yuklensinMi = useCallback(
    (istek) => {
      const url = String(istek?.url ?? "");

      if (!url || /^(about:|data:|blob:|javascript:)/i.test(url)) return true;
      if (bizimAdresMi(url)) return true;
      if (/^https?:/i.test(url) && istek?.isTopFrame === false) return true;

      disaAc(url);
      return false;
    },
    [disaAc]
  );

  /* target="_blank" ve window.open: kendi sayfamızsa aynı görünümde */
  const yeniPencere = useCallback(
    (olay) => {
      const url = String(olay?.nativeEvent?.targetUrl ?? "");
      if (!url) return;

      if (bizimAdresMi(url)) ref.current?.injectJavaScript?.(`window.location.href=${JSON.stringify(url)};true;`);
      else disaAc(url);
    },
    [disaAc]
  );

  const mesaj = useCallback(
    (olay) => {
      const { data, url } = olay?.nativeEvent ?? {};

      /* Yalnızca kendi sayfamızdan gelen mesajlar */
      if (url && !bizimAdresMi(url)) return;

      let m = null;

      try {
        m = typeof data === "string" ? JSON.parse(data) : data;
      } catch {
        return;
      }

      switch (m?.tur) {
        case "tost":
          if (m.metin) tost(String(m.metin).slice(0, 200));
          return;
        case "geri":
          kapat();
          return;
        case "git":
          hedefeGit(navigation, { ekran: m.ekran, p: m.p ?? null });
          return;
        case "baslik":
          setSayfaBaslik({ anahtar, metin: String(m.metin ?? "").trim().slice(0, 80) || null });
          return;
        default:
          /* Bilinmeyen tür: yeni sayfa eski uygulamada sessizce çalışsın */
          return;
      }
    },
    [tost, kapat, navigation, anahtar]
  );

  const altBosluk = MENU_YUKSEKLIGI + Math.max(kenar.bottom, 12);

  return (
    <View style={s.sayfa}>
      <AcikUst
        geri
        baslik={baslik}
        alt={tanim?.alt ?? null}
        sag={WebView && kod ? <UstDugme ikon="yenile" etiket="Yenile" bas={yenile} /> : null}
      />

      <View style={[s.govde, { marginBottom: altBosluk }]}>
        {!kod ? (
          <HataKutu metin="Açılacak sayfa belirtilmemiş." />
        ) : !WebView ? (
          <Eksik />
        ) : (
          <Kalkan key={anahtar}>
            <WebView
              ref={ref}
              source={kaynak}
              style={s.web}
              containerStyle={s.web}
              originWhitelist={["*"]}
              injectedJavaScriptBeforeContentLoaded={enjekte}
              onMessage={mesaj}
              onShouldStartLoadWithRequest={yuklensinMi}
              onOpenWindow={yeniPencere}
              setSupportMultipleWindows
              javaScriptEnabled
              domStorageEnabled
              /* Aşağı çekip yenileme iOS'ta yerleşik; Android'de başlıktaki
                 yenile düğmesi var (WebView'i kaydırma alanına sarmak sayfa
                 içi kaydırmayı bozuyordu). */
              pullToRefreshEnabled
              applicationNameForUserAgent={`Bicen360/${SURUM}`}
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
              onLoadStart={() => setIlerleme((x) => (x >= 1 ? 0 : x))}
              onLoadProgress={(e) => setIlerleme(Number(e?.nativeEvent?.progress) || 0)}
              onLoadEnd={() => {
                setIlerleme(1);
                setDurum((d) => (d.anahtar === anahtar && d.ad === "hata" ? d : { anahtar, ad: "hazir", hata: "" }));
              }}
              onError={(e) =>
                setDurum({
                  anahtar,
                  ad: "hata",
                  hata: e?.nativeEvent?.description ? `Sayfa açılamadı: ${e.nativeEvent.description}` : "Sayfa açılamadı.",
                })
              }
              onHttpError={(e) => setDurum({ anahtar, ad: "hata", hata: httpHatasi(e?.nativeEvent?.statusCode) })}
              onNavigationStateChange={(n) => {
                geriVar.current = !!n?.canGoBack;

                /* Yüklenirken başlık adresin kendisi olabiliyor */
                const b = String(n?.title ?? "").trim();
                if (b && !/^(https?:|about:)/i.test(b)) setBelgeBaslik({ anahtar, metin: b.slice(0, 80) });
              }}
            />
          </Kalkan>
        )}

        {/* İnce ilerleme çubuğu (yenilemede de) */}
        {WebView && kod && durumAd !== "hata" && ilerleme < 1 ? (
          <View style={s.ilerlemeZemin} pointerEvents="none">
            <View style={[s.ilerleme, { width: `${Math.max(8, Math.round(ilerleme * 100))}%` }]} />
          </View>
        ) : null}

        {WebView && kod && durumAd === "yukleniyor" ? (
          <View style={s.ortu} pointerEvents="none">
            <ActivityIndicator color={P.yesil} size="large" />
          </View>
        ) : null}

        {WebView && kod && durumAd === "hata" ? (
          <View style={[s.ortu, s.ortuDolu]}>
            <HataKutu metin={hataMetni || "Sayfa açılamadı."} yenile={() => setDeneme((d) => d + 1)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Sayfa görüntüleyici bu derlemede yok */
function Eksik() {
  return (
    <View style={s.eksik}>
      <Ikon ad="uyari" boyut={30} renkli={P.turuncu} />
      <Text style={s.eksikBaslik}>Bu sayfa bu sürümde açılamıyor</Text>
      <Text style={s.eksikYazi}>
        Sayfa görüntüleyici uygulamanın bu derlemesinde yüklü değil. Uygulamayı mağazadan güncelledikten sonra
        tekrar deneyin.
      </Text>
    </View>
  );
}

/**
 * WebView çizilirken çıkan hata (yerel bileşen bulunamadı gibi) bütün
 * patron görünümünü düşürmesin; yalnızca bu alan açıklama göstersin.
 */
class Kalkan extends Component {
  constructor(p) {
    super(p);
    this.state = { hata: null };
  }

  static getDerivedStateFromError(hata) {
    return { hata };
  }

  componentDidCatch(hata) {
    console.warn("WebSayfa:", hata?.message ?? hata);
  }

  render() {
    return this.state.hata ? <Eksik /> : this.props.children;
  }
}

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: P.zemin },
  govde: { flex: 1, overflow: "hidden", backgroundColor: P.zemin },
  web: { flex: 1, backgroundColor: P.zemin },

  ilerlemeZemin: { position: "absolute", left: 0, right: 0, top: 0, height: 2.5, backgroundColor: "transparent" },
  ilerleme: { height: "100%", backgroundColor: P.yesil, borderTopRightRadius: 2, borderBottomRightRadius: 2 },

  ortu: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  ortuDolu: { backgroundColor: P.zemin },

  eksik: { alignItems: "center", gap: 10, paddingVertical: 60, paddingHorizontal: 28 },
  eksikBaslik: { fontSize: 15, fontWeight: "700", color: P.metin, textAlign: "center" },
  eksikYazi: { fontSize: 13, color: P.ikincil, textAlign: "center", lineHeight: 19 },
});

/**
 * Patron görünümü parçaları
 * ---------------------------------------------------------------------------
 * Onaylanan tasarımdaki kart, KPI kutusu, çip, segment, satır ve başlık
 * desenlerinin karşılığı. Ekranlar bunları birleştirerek kuruluyor;
 * aynı stili her ekranda yeniden yazmak, tasarımdan küçük sapmaların
 * birikmesine yol açıyordu.
 */

import { Children, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Animated,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { patronRenk as P } from "../../tema";
import { fotoKaynagi } from "../../patronApi";
import Ikon from "./Ikon";
import { ton, oranDolgu, oranTon, ilkAd, durumBilgi, basHarf, saatDk } from "./bicim";

const golge = Platform.select({
  ios: {
    shadowColor: "#14200a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
  },
  android: { elevation: 2 },
  default: {},
});

/* ========================================================================== */
/* Sayfa iskeleti                                                             */
/* ========================================================================== */

/**
 * Açık başlıklı sayfa: başlık sabit, içerik kayar ve aşağı çekince
 * tazelenir.
 *
 * Başlık kaydırma alanının dışında: tasarımda başlık "yapışkan" ve
 * uzun listelerde (başvurular, şubeler) geri düğmesine ulaşmak için en
 * başa kaydırmak gerekmemeli.
 */
export function Sayfa({ ust, yenile, yenileniyor, children, kaydirmaRef }) {
  return (
    <View style={s.sayfa}>
      {ust}
      <ScrollView
        ref={kaydirmaRef}
        contentContainerStyle={s.govde}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          yenile ? (
            <RefreshControl
              refreshing={!!yenileniyor}
              onRefresh={() => yenile(true)}
              tintColor={P.yesil}
              colors={[P.yesil]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * Açık başlık. Geri düğmesi gezinme geçmişine döner; geçmiş yoksa
 * (bildirimden doğrudan açılan ekran) Özet'e.
 *
 * @param aralik Seçili tarih aralığının yazısı ("Bu ay · 1–6 Eki 2026"):
 *               başlık sabit kaldığından liste kayınca da hangi aralığa
 *               bakıldığı görünüyor (1.6)
 */
export function AcikUst({ baslik, alt, geri = false, sag, guncel, aralik }) {
  const kenar = useSafeAreaInsets();
  const navigation = useNavigation();

  const geriGit = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Ozet");
  };

  return (
    <View style={[s.acikUst, { paddingTop: Math.max(kenar.top, 12) + 8 }]}>
      {geri ? (
        <TouchableOpacity
          style={s.geri}
          onPress={geriGit}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Geri"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ikon ad="geri" boyut={20} renkli={P.metin} />
        </TouchableOpacity>
      ) : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.ustBaslik} numberOfLines={1}>
          {baslik}
        </Text>
        {alt ? (
          <Text style={s.ustAlt} numberOfLines={1}>
            {alt}
          </Text>
        ) : null}
        {aralik ? (
          <View style={s.ustAralik}>
            <Ikon ad="takvim" boyut={12} renkli={P.yesilKoyu} kalinlik={2.2} />
            <Text style={s.ustAralikYazi} numberOfLines={1}>
              {aralik}
            </Text>
          </View>
        ) : null}
        {guncel}
      </View>

      {sag}
    </View>
  );
}

/** Başlığın sağındaki kare düğme (ara, yenile) */
export function UstDugme({ ikon, bas, etiket }) {
  return (
    <TouchableOpacity style={s.geri} onPress={bas} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={etiket}>
      <Ikon ad={ikon} boyut={19} renkli={P.metin} />
    </TouchableOpacity>
  );
}

/**
 * "Güncelleniyor…" / "Son güncelleme 14:31" satırı.
 *
 * Önbellekten gösterilen verinin ne kadar eski olduğu görünmeli: patron
 * okutma sayısına bakıp karar veriyor, sabahki rakamı şimdiki sanmamalı.
 * Tam ekran gösterge yerine bu satır yanıp sönüyor.
 */
export function GuncelBilgi({ zaman, guncelleniyor, hata, yenile, koyu = false }) {
  const nabiz = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!guncelleniyor) {
      nabiz.setValue(1);
      return undefined;
    }

    const d = Animated.loop(
      Animated.sequence([
        Animated.timing(nabiz, { toValue: 0.35, duration: 600, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(nabiz, { toValue: 1, duration: 600, useNativeDriver: Platform.OS !== "web" }),
      ])
    );

    d.start();
    return () => d.stop();
  }, [guncelleniyor, nabiz]);

  if (!zaman && !guncelleniyor && !hata) return null;

  const renkli = koyu ? "rgba(255,255,255,0.66)" : P.soluk;

  /* Tazeleme başarısızsa eski veri ekranda kalıyor; bunu söylemek ve
     yeniden denemeyi tek dokunuşa indirmek gerekiyor. */
  if (hata && !guncelleniyor)
    return (
      <TouchableOpacity onPress={() => yenile?.(true)} activeOpacity={0.7} style={s.guncel}>
        <View style={[s.guncelNokta, { backgroundColor: P.turuncu }]} />
        <Text style={[s.guncelYazi, { color: koyu ? "#ffd2c2" : P.turuncuYazi }]} numberOfLines={1}>
          {zaman ? `Güncellenemedi · ${saatDk(zaman)} verisi · dokunun` : "Güncellenemedi · dokunun"}
        </Text>
      </TouchableOpacity>
    );

  return (
    <View style={s.guncel}>
      <Animated.View
        style={[s.guncelNokta, { backgroundColor: guncelleniyor ? P.yesil : renkli, opacity: nabiz }]}
      />
      <Text style={[s.guncelYazi, { color: renkli }]} numberOfLines={1}>
        {guncelleniyor ? "Güncelleniyor…" : `Son güncelleme ${saatDk(zaman)}`}
      </Text>
    </View>
  );
}

/** Önbellekte hiç veri yokken: ilk açılış */
export function IlkYukleme() {
  return (
    <View style={s.ilk}>
      <ActivityIndicator color={P.yesil} size="large" />
    </View>
  );
}

/** Veri hiç alınamadıysa (önbellek de boş) */
export function HataKutu({ metin, yenile }) {
  return (
    <View style={s.hataKutu}>
      <Ikon ad="uyari" boyut={30} renkli={P.turuncu} />
      <Text style={s.hataYazi}>{metin || "Veri alınamadı."}</Text>
      {yenile ? <Dugme yazi="Tekrar dene" ikon="yenile" tur="ikincil" bas={() => yenile(true)} stil={{ flex: 0, paddingHorizontal: 18 }} /> : null}
    </View>
  );
}

/* ========================================================================== */
/* Kart ve kutular                                                            */
/* ========================================================================== */

export function Kart({ children, stil }) {
  return <View style={[s.kart, stil]}>{children}</View>;
}

/** Kart başlığı; sağda isteğe bağlı bağlantı ("Tümü ›") */
export function KartBas({ baslik, bag, bagBas, sag }) {
  return (
    <View style={s.kartBas}>
      <Text style={s.kartBaslik}>{baslik}</Text>
      {bag ? (
        <TouchableOpacity onPress={bagBas} style={s.bag} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.bagYazi}>{bag}</Text>
          <Ikon ad="ok" boyut={14} renkli={P.yesilKoyu} />
        </TouchableOpacity>
      ) : null}
      {sag}
    </View>
  );
}

export function BolumBaslik({ children }) {
  return <Text style={s.bolumBaslik}>{children}</Text>;
}

/**
 * Izgara: çocukları `sutun` sayısında satırlara böler.
 *
 * flexWrap + yüzde genişlik, aradaki boşlukla birlikte taşıyordu; satır
 * satır dizip her hücreye flex:1 vermek her genişlikte aynı sonucu
 * veriyor. Son satır eksikse boş hücreyle tamamlanıyor, kutular
 * genişlemesin.
 */
export function Izgara({ sutun = 2, children }) {
  const l = Children.toArray(children).filter(Boolean);
  const satirlar = [];

  for (let i = 0; i < l.length; i += sutun) satirlar.push(l.slice(i, i + sutun));

  return (
    <View style={s.izgara}>
      {satirlar.map((satir, i) => (
        <View key={i} style={s.izgaraSatir}>
          {satir.map((c, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0 }}>
              {c}
            </View>
          ))}
          {Array.from({ length: sutun - satir.length }, (_, j) => (
            <View key={`b${j}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * KPI kutusu.
 * @param kucuk  Üçlü ızgara için simgesiz, alçak sürüm
 */
export function Kpi({ ikon, tonAd = "gri", baslik, deger, degerRenk, degerEk, alt, spark, bas, kucuk = false }) {
  const [zemin, yaziRengi] = ton(tonAd);

  const icerik = (
    <>
      {ikon && !kucuk ? (
        <View style={[s.kpiSimge, { backgroundColor: zemin }]}>
          <Ikon ad={ikon} boyut={17} renkli={yaziRengi} />
        </View>
      ) : null}
      {spark && !kucuk ? <View style={s.kpiSpark}>{spark}</View> : null}

      <Text style={s.kpiBaslik} numberOfLines={1}>
        {baslik}
      </Text>
      <Text style={[s.kpiDeger, kucuk && s.kpiDegerKucuk, degerRenk && { color: degerRenk }]} numberOfLines={1}>
        {deger}
        {degerEk ? <Text style={s.kpiDegerEk}>{` ${degerEk}`}</Text> : null}
      </Text>
      {alt ? (
        typeof alt === "string" ? (
          <Text style={s.kpiAlt} numberOfLines={2}>
            {alt}
          </Text>
        ) : (
          alt
        )
      ) : null}
    </>
  );

  const stil = [s.kpi, kucuk ? s.kpiKucuk : null];

  if (!bas) return <View style={stil}>{icerik}</View>;

  return (
    <TouchableOpacity style={stil} onPress={bas} activeOpacity={0.75} accessibilityRole="button">
      {icerik}
    </TouchableOpacity>
  );
}

/** KPI alt satırında renkli parça: <AltYazi parcalar={[["3 eksik","asagi"], " · 972 norm"]} /> */
export function AltYazi({ parcalar }) {
  return (
    <Text style={s.kpiAlt} numberOfLines={2}>
      {(parcalar ?? []).map((p, i) =>
        Array.isArray(p) ? (
          <Text key={i} style={p[1] === "yukari" ? s.yukari : p[1] === "asagi" ? s.asagi : null}>
            {p[0]}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        )
      )}
    </Text>
  );
}

/** Kare simge kutusu (satır başı, KPI) */
export function SimgeKutu({ ikon, metin, tonAd = "gri", boyut = 38, yuvarlak = 12, ikonBoyut }) {
  const [zemin, yaziRengi] = ton(tonAd);

  return (
    <View style={[s.simgeKutu, { width: boyut, height: boyut, borderRadius: yuvarlak, backgroundColor: zemin }]}>
      {ikon ? (
        <Ikon ad={ikon} boyut={ikonBoyut ?? Math.round(boyut * 0.47)} renkli={yaziRengi} />
      ) : (
        <Text style={[s.simgeKutuYazi, { color: yaziRengi, fontSize: boyut > 50 ? 19 : 12.5 }]}>{metin}</Text>
      )}
    </View>
  );
}

/* ========================================================================== */
/* Fotoğraf                                                                   */
/* ========================================================================== */

/* Yüklenemeyen fotoğraf adresleri (404, ağ hatası). Listeler kaydırıldıkça
   satırlar yeniden çiziliyor; aynı bozuk adres her seferinde yeniden
   istenmesin, baş harfler titremeden kalsın. */
const bozukFotolar = new Set();

/**
 * Kişi görseli: sunucunun `fotoUrl`'i varsa fotoğraf, yoksa ya da
 * yüklenemezse baş harfler.
 *
 * Baş harf kutusu her zaman altta çiziliyor, fotoğraf üstüne biniyor:
 * fotoğraf gelene kadar boş kare görünmüyor ve satırın düzeni fotoğraf
 * olsa da olmasa da aynı kalıyor.
 *
 * @param yedek  Fotoğraf yokken gösterilecek öğe (verilmezse baş harfler)
 * @param rozet  Sağ alt köşedeki küçük simge (onay türü, giriş/çıkış);
 *               yalnızca fotoğraf görünürken çiziliyor — yedek kutu zaten
 *               simgeyi taşıyorsa ikinci kez gösterilmesin diye
 *               `rozetHep` ile her zaman çizilebiliyor.
 */
export function Avatar({ fotoUrl, ad, tonAd = "gri", boyut = 38, yuvarlak = 12, yedek, rozet, rozetHep = false, stil }) {
  /* Kaynak nesnesi her çizimde yeniden kurulmasın: yeni nesne, bazı
     platformlarda görselin yeniden istenmesi demek. */
  const kaynak = useMemo(() => fotoKaynagi(fotoUrl), [fotoUrl]);
  const uri = kaynak?.uri ?? null;

  const [hatali, setHatali] = useState(() => !uri || bozukFotolar.has(uri));

  useEffect(() => {
    setHatali(!uri || bozukFotolar.has(uri));
  }, [uri]);

  const fotoVar = !!uri && !hatali;

  return (
    <View style={[{ width: boyut, height: boyut }, stil]}>
      {yedek ?? <SimgeKutu metin={basHarf(ad) || "?"} tonAd={tonAd} boyut={boyut} yuvarlak={yuvarlak} />}

      {fotoVar ? (
        <Image
          source={kaynak}
          style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, { borderRadius: yuvarlak, backgroundColor: "transparent" }]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityLabel={ad ? `${ad} fotoğrafı` : "Fotoğraf"}
          onError={() => {
            bozukFotolar.add(uri);
            setHatali(true);
          }}
        />
      ) : null}

      {rozet && (fotoVar || rozetHep) ? <View style={s.avatarRozet}>{rozet}</View> : null}
    </View>
  );
}

/** Avatar köşesindeki küçük simge */
export function AvatarRozet({ ikon, tonAd = "gri" }) {
  const [zemin, yaziRengi] = ton(tonAd);

  return (
    <View style={[s.avatarRozetIc, { backgroundColor: zemin }]}>
      <Ikon ad={ikon} boyut={10} renkli={yaziRengi} kalinlik={2.6} />
    </View>
  );
}

/** Bilgi ızgarası: [[başlık, değer, renk?]] */
export function BilgiIzgara({ ogeler, sutun = 2 }) {
  return (
    <Izgara sutun={sutun}>
      {(ogeler ?? []).map(([k, v, r]) => (
        <View key={k} style={s.bilgiHucre}>
          <Text style={s.bilgiBaslik} numberOfLines={1}>
            {k}
          </Text>
          <Text style={[s.bilgiDeger, r && { color: r }]} numberOfLines={2}>
            {v}
          </Text>
        </View>
      ))}
    </Izgara>
  );
}

/* ========================================================================== */
/* Seçiciler                                                                  */
/* ========================================================================== */

/**
 * Yatay kayan çipler. Kenardan kenara kayıyor (tasarımdaki gibi):
 * kaydırılabildiği, son çipin yarım görünmesinden anlaşılıyor.
 */
export function Cipler({ ogeler, secili, sec }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.cipKaydir}
      contentContainerStyle={s.cipler}
      keyboardShouldPersistTaps="handled"
    >
      {(ogeler ?? []).map((o) => {
        const aktif = o.anahtar === secili;

        return (
          <TouchableOpacity
            key={String(o.anahtar)}
            style={[s.cip, aktif && s.cipAktif]}
            onPress={() => sec(o.anahtar)}
            activeOpacity={0.7}
          >
            <Text style={[s.cipYazi, aktif && s.cipYaziAktif]}>{o.ad}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** Segment: [{ anahtar, ad, sayi? }] */
export function Segment({ ogeler, secili, sec }) {
  return (
    <View style={s.segment}>
      {(ogeler ?? []).map((o) => {
        const aktif = o.anahtar === secili;

        return (
          <TouchableOpacity
            key={o.anahtar}
            style={[s.segmentDugme, aktif && s.segmentAktif]}
            onPress={() => sec(o.anahtar)}
            activeOpacity={0.7}
          >
            <Text style={[s.segmentYazi, aktif && s.segmentYaziAktif]} numberOfLines={1}>
              {o.ad}
            </Text>
            {o.sayi ? (
              <View style={s.segmentSayi}>
                <Text style={s.segmentSayiYazi}>{o.sayi}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Sekme çubuğu (şube detayı: Bugün · Kadro · Ekip) */
export function Sekmeler({ ogeler, secili, sec }) {
  return (
    <View style={s.sekmeler}>
      {ogeler.map((o) => {
        const aktif = o.anahtar === secili;

        return (
          <TouchableOpacity key={o.anahtar} style={[s.sekme, aktif && s.sekmeAktif]} onPress={() => sec(o.anahtar)} activeOpacity={0.7}>
            <Text style={[s.sekmeYazi, aktif && s.sekmeYaziAktif]}>{o.ad}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Arama kutusu */
export function AraKutu({ deger, degistir, yer, otomatikOdak = false }) {
  return (
    <View style={s.ara}>
      <Ikon ad="ara" boyut={18} renkli={P.soluk} />
      <TextInput
        value={deger}
        onChangeText={degistir}
        placeholder={yer}
        placeholderTextColor={P.soluk}
        style={s.araGirdi}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={otomatikOdak}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      {deger ? (
        <TouchableOpacity onPress={() => degistir("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ikon ad="carpi" boyut={16} renkli={P.soluk} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Arama kutusu görünümünde düğme (İK merkezinden arama ekranına) */
export function AraDugme({ yazi, bas }) {
  return (
    <TouchableOpacity style={s.ara} onPress={bas} activeOpacity={0.75}>
      <Ikon ad="ara" boyut={18} renkli={P.soluk} />
      <Text style={[s.araGirdi, { color: P.soluk }]}>{yazi}</Text>
    </TouchableOpacity>
  );
}

/* ========================================================================== */
/* Satırlar                                                                   */
/* ========================================================================== */

/** Doluluk çubuğu; oran 0–100 */
export function Cubukcuk({ oran, renkli }) {
  const o = Math.max(0, Math.min(100, Number(oran) || 0));

  return (
    <View style={s.cubuk}>
      <View style={[s.cubukDolu, { width: `${o}%`, backgroundColor: renkli ?? oranDolgu(o) }]} />
    </View>
  );
}

/** Genel liste satırı: solda kutu, ortada ad/açıklama, sağda değer */
export function Satir({ sol, baslik, alt, sag, bas, ilk = false, ekBaslik, vurgulu = false }) {
  const icerik = (
    <>
      {sol}
      <View style={s.satirOrta}>
        <Text style={s.satirBaslik} numberOfLines={1}>
          {baslik}
          {ekBaslik}
        </Text>
        {alt ? (
          <Text style={s.satirAlt} numberOfLines={1}>
            {alt}
          </Text>
        ) : null}
      </View>
      {sag}
    </>
  );

  const stil = [s.satir, ilk && s.satirIlk, vurgulu && s.satirVurgu];

  if (!bas) return <View style={stil}>{icerik}</View>;

  return (
    <TouchableOpacity style={stil} onPress={bas} accessibilityRole="button" activeOpacity={0.6}>
      {icerik}
    </TouchableOpacity>
  );
}

/** Sağ tarafta kalın değer + altında soluk açıklama */
export function SagDeger({ ust, alt, renkli }) {
  return (
    <View style={s.sagDeger}>
      {ust ? <Text style={[s.sagDegerUst, renkli && { color: renkli }]}>{ust}</Text> : null}
      {alt ? <Text style={s.sagDegerAlt}>{alt}</Text> : null}
    </View>
  );
}

/** Renkli durum etiketi */
export function DurumEtiket({ metin, tonAd = "gri", stil }) {
  const [zemin, yaziRengi] = ton(tonAd);

  return (
    <View style={[s.durumEtiket, { backgroundColor: zemin }, stil]}>
      <Text style={[s.durumEtiketYazi, { color: yaziRengi }]} numberOfLines={1}>
        {metin}
      </Text>
    </View>
  );
}

/** Ad yanındaki küçük etiket ("3 eksik", "eski çalışan") */
export function MiniEtiket({ metin, tonAd = "turuncu" }) {
  const [zemin, yaziRengi] = ton(tonAd);

  /* Baştaki düz boşluk: zemin rengi adın hemen bitişiğinden başlıyordu */
  return (
    <Text>
      {"  "}
      <Text style={[s.mini, { backgroundColor: zemin, color: yaziRengi }]}>{` ${metin} `}</Text>
    </Text>
  );
}

/**
 * Sıralama satırı: sıra no, ad + açıklama + çubuk, sağda değer.
 * @param oran  Çubuk doluluğu 0–100
 */
export function SiraSatiri({ no, ad, alt, oran, cubukRenk, deger, degerRenk, bas, ilk }) {
  const icerik = (
    <>
      {no !== undefined && no !== null ? <Text style={s.siraNo}>{no}</Text> : null}
      <View style={s.siraAd}>
        <Text style={s.satirBaslik} numberOfLines={1}>
          {ad}
        </Text>
        {alt ? (
          <Text style={s.satirAlt} numberOfLines={1}>
            {alt}
          </Text>
        ) : null}
        {oran !== undefined && oran !== null ? <Cubukcuk oran={oran} renkli={cubukRenk} /> : null}
      </View>
      <Text style={[s.siraDeger, degerRenk && { color: degerRenk }]}>{deger}</Text>
    </>
  );

  const stil = [s.sira, ilk && s.satirIlk];

  if (!bas) return <View style={stil}>{icerik}</View>;

  return (
    <TouchableOpacity style={stil} onPress={bas} accessibilityRole="button" activeOpacity={0.6}>
      {icerik}
    </TouchableOpacity>
  );
}

/** Şube satırı (Şubeler, Norm, arama) */
export function SubeSatiri({ sube, bas }) {
  const o = Number(sube?.oran) || 0;
  const doluluk = sube?.norm ? Math.round((sube.mevcut / sube.norm) * 100) : null;

  /* Tarih aralığında (1.6) "içeride" yalnızca bugünü kapsayan aralıkta
     geliyor; aralığın sayısı "okuttu" */
  const aralikli = sube?.okutan !== undefined && sube?.okutan !== null;

  const alt = [
    aralikli ? `${sube.okutan}/${sube?.beklenen ?? 0} okuttu` : `${sube?.iceride ?? 0} içeride`,
    `${sube?.izinli ?? 0} izinli`,
    sube?.raporlu ? `${sube.raporlu} raporlu` : null,
    sube?.mudur ? `Md. ${ilkAd(sube.mudur)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <TouchableOpacity style={s.sube} onPress={bas} accessibilityRole="button" activeOpacity={0.7}>
      <SimgeKutu metin={`%${o}`} tonAd={oranTon(o)} boyut={42} yuvarlak={13} />

      <View style={s.satirOrta}>
        <Text style={s.subeAd} numberOfLines={1}>
          {sube?.ad}
          {sube?.eksik ? <MiniEtiket metin={`${sube.eksik} eksik`} tonAd="turuncu" /> : null}
          {!sube?.eksik && sube?.fazla ? <MiniEtiket metin={`+${sube.fazla} fazla`} tonAd="mavi" /> : null}
        </Text>
        <Text style={s.satirAlt} numberOfLines={1}>
          {alt}
        </Text>
        {doluluk !== null ? <Cubukcuk oran={Math.min(100, doluluk)} renkli={oranDolgu(doluluk)} /> : null}
      </View>

      <SagDeger ust={`${sube?.mevcut ?? "—"}/${sube?.norm ?? "—"}`} alt="kadro" />
    </TouchableOpacity>
  );
}

/** Personel satırı (ekip, okutmayanlar, izinliler, arama) */
export function KisiSatiri({ kisi, bas, ilk, altYazi }) {
  const [etiket, tonAd] = durumBilgi(kisi?.durum, kisi?.saat, kisi?.okutmaGun);
  const alt = altYazi ?? [kisi?.poz, kisi?.sube].filter(Boolean).join(" · ");

  return (
    <Satir
      ilk={ilk}
      bas={bas}
      sol={<Avatar fotoUrl={kisi?.fotoUrl} ad={kisi?.ad} tonAd="gri" />}
      baslik={kisi?.ad}
      alt={alt}
      sag={kisi?.durum ? <DurumEtiket metin={etiket} tonAd={tonAd} /> : null}
    />
  );
}

/** Simgeli bağlantı satırı (dikkat listesi, İK merkezi, sunucu tanımlı sayfalar) */
export function IkonSatir({ ikon, tonAd, baslik, alt, bas, ilk, rozet }) {
  return (
    <TouchableOpacity style={[s.dikkat, ilk && s.dikkatIlk]} onPress={bas} activeOpacity={0.6} disabled={!bas} accessibilityRole="button">
      <SimgeKutu ikon={ikon} tonAd={tonAd} boyut={34} yuvarlak={11} ikonBoyut={17} />
      <View style={s.satirOrta}>
        <Text style={s.dikkatBaslik}>{baslik}</Text>
        {alt ? <Text style={s.satirAlt}>{alt}</Text> : null}
      </View>
      <SayiRozet sayi={rozet} />
      {bas ? <Ikon ad="ok" boyut={16} renkli="#b6bdb1" /> : null}
    </TouchableOpacity>
  );
}

/**
 * Turuncu sayı rozeti (sunucu tanımlı sayfaların `rozet` alanı).
 * Sayı değilse ya da sıfırsa çizilmiyor.
 */
export function SayiRozet({ sayi: deger, stil }) {
  const n = Number(deger);
  if (deger === null || deger === undefined || deger === "" || !Number.isFinite(n) || n <= 0) return null;

  return (
    <View style={[s.sayiRozet, stil]}>
      <Text style={s.sayiRozetYazi}>{n > 99 ? "99+" : String(Math.round(n))}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Düğme ve kutular                                                           */
/* ========================================================================== */

/**
 * Düğme.
 * @param tur ana | ikincil | red | koyu
 */
export function Dugme({ yazi, ikon, tur = "ana", bas, stil, yukleniyor = false, devreDisi = false }) {
  const renkler = {
    ana: [P.yesil, "#fff", null],
    ikincil: [P.gri, P.metin, null],
    red: ["#fff", P.turuncu, "#f6c4b2"],
    koyu: [P.metin, "#fff", null],
  }[tur] ?? [P.yesil, "#fff", null];

  return (
    <TouchableOpacity
      style={[
        s.dugme,
        { backgroundColor: renkler[0] },
        renkler[2] && { borderWidth: 1.5, borderColor: renkler[2] },
        (devreDisi || yukleniyor) && { opacity: 0.6 },
        stil,
      ]}
      onPress={bas}
      activeOpacity={0.75}
      disabled={devreDisi || yukleniyor}
      accessibilityRole="button"
      accessibilityLabel={yazi}
    >
      {yukleniyor ? (
        <ActivityIndicator color={renkler[1]} size="small" />
      ) : ikon ? (
        <Ikon ad={ikon} boyut={17} renkli={renkler[1]} />
      ) : null}
      {yazi ? <Text style={[s.dugmeYazi, { color: renkler[1] }]}>{yazi}</Text> : null}
    </TouchableOpacity>
  );
}

export function Dugmeler({ children, stil }) {
  return <View style={[s.dugmeler, stil]}>{children}</View>;
}

export function UyariKutu({ metin, stil }) {
  return (
    <View style={[s.uyari, stil]}>
      <Ikon ad="uyari" boyut={15} renkli={P.turuncuYazi} />
      <Text style={s.uyariYazi}>{metin}</Text>
    </View>
  );
}

export function NotKutu({ metin, cizgi, stil }) {
  return (
    <View style={[s.not, cizgi && { borderLeftColor: cizgi }, stil]}>
      <Text style={s.notYazi}>{metin}</Text>
    </View>
  );
}

export function BosDurum({ ikon = "tik", metin }) {
  return (
    <View style={s.bos}>
      <Ikon ad={ikon} boyut={36} renkli={P.yesil} />
      <Text style={s.bosYazi}>{metin}</Text>
    </View>
  );
}

/* ========================================================================== */

export const stiller = StyleSheet.create({
  /* Alt sayfa perdesi ve kâğıdı (AltSayfa bileşenine veriliyor) */
  perde: { backgroundColor: "rgba(15,22,10,0.45)" },
  kagit: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  tutamac: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#d7dcd2",
    alignSelf: "center",
    marginTop: 9,
    marginBottom: 8,
  },
  sayfaBaslik: { fontSize: 18, fontWeight: "800", color: P.metin, marginTop: 4 },
  sayfaAlt: { fontSize: 12.5, color: P.soluk, marginTop: 2, marginBottom: 12 },
  kucukBaslik: { fontSize: 12, fontWeight: "700", color: P.soluk, marginTop: 4, marginBottom: 6, letterSpacing: 0.4 },
});

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: P.zemin },
  govde: { paddingHorizontal: 14, paddingBottom: 120 },

  acikUst: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: P.zemin,
  },
  ustBaslik: { fontSize: 20, fontWeight: "800", color: P.metin, letterSpacing: -0.2 },
  ustAlt: { fontSize: 12, color: P.soluk, fontWeight: "500" },
  ustAralik: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  ustAralikYazi: { fontSize: 11.5, color: P.yesilKoyu, fontWeight: "700", flexShrink: 1 },
  geri: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.cizgi,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },

  guncel: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  guncelNokta: { width: 6, height: 6, borderRadius: 3 },
  guncelYazi: { fontSize: 11, fontWeight: "600" },

  ilk: { paddingVertical: 80, alignItems: "center" },
  hataKutu: { alignItems: "center", gap: 12, paddingVertical: 50, paddingHorizontal: 20 },
  hataYazi: { fontSize: 13.5, color: P.ikincil, textAlign: "center", lineHeight: 20 },

  kart: { backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 12, ...golge },
  kartBas: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  kartBaslik: { flex: 1, fontSize: 15, fontWeight: "700", color: P.metin },
  bag: { flexDirection: "row", alignItems: "center", gap: 2 },
  bagYazi: { fontSize: 12.5, fontWeight: "600", color: P.yesilKoyu },
  bolumBaslik: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: P.soluk,
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 4,
  },

  izgara: { gap: 10, marginBottom: 12 },
  izgaraSatir: { flexDirection: "row", gap: 10 },

  /* flexGrow: aynı satırdaki kutular eşit yükseklikte (biri iki satır
     açıklama taşısa da) */
  kpi: { flexGrow: 1, backgroundColor: "#fff", borderRadius: 18, padding: 13, minHeight: 118, overflow: "hidden", ...golge },
  kpiKucuk: { minHeight: 0 },
  kpiSimge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  kpiSpark: { position: "absolute", right: 10, top: 14 },
  kpiBaslik: { fontSize: 12, color: P.soluk, fontWeight: "600" },
  kpiDeger: { fontSize: 22, fontWeight: "800", color: P.metin, letterSpacing: -0.3, marginTop: 1 },
  kpiDegerKucuk: { fontSize: 20 },
  kpiDegerEk: { fontSize: 13, color: P.soluk, fontWeight: "600" },
  kpiAlt: { fontSize: 11.5, color: P.ikincil, marginTop: 1 },
  yukari: { color: P.yesilKoyu, fontWeight: "700" },
  asagi: { color: P.turuncu, fontWeight: "700" },

  simgeKutu: { alignItems: "center", justifyContent: "center" },

  avatarRozet: { position: "absolute", right: -3, bottom: -3 },
  avatarRozetIc: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },

  sayiRozet: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: P.turuncu,
    alignItems: "center",
    justifyContent: "center",
  },
  sayiRozetYazi: { fontSize: 11, fontWeight: "800", color: "#fff" },
  simgeKutuYazi: { fontWeight: "800" },

  bilgiHucre: { flexGrow: 1, backgroundColor: P.zemin, borderRadius: 13, paddingVertical: 9, paddingHorizontal: 11 },
  bilgiBaslik: { fontSize: 11, color: P.soluk },
  bilgiDeger: { fontSize: 14, fontWeight: "700", color: P.metin, marginTop: 1 },

  cipKaydir: { marginHorizontal: -14, flexGrow: 0 },
  cipler: { gap: 6, paddingHorizontal: 14, paddingBottom: 10 },
  cip: { borderWidth: 1, borderColor: P.cizgi, backgroundColor: "#fff", borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12 },
  cipAktif: { backgroundColor: P.metin, borderColor: P.metin },
  cipYazi: { fontSize: 12.5, fontWeight: "600", color: P.ikincil },
  cipYaziAktif: { color: "#fff" },

  segment: { flexDirection: "row", backgroundColor: P.segment, borderRadius: 13, padding: 3, gap: 2, marginBottom: 12 },
  segmentDugme: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 4, gap: 4 },
  segmentAktif: {
    backgroundColor: "#fff",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3 },
      android: { elevation: 1 },
      default: {},
    }),
  },
  segmentYazi: { fontSize: 12.5, fontWeight: "600", color: P.ikincil, flexShrink: 1 },
  segmentYaziAktif: { color: P.metin },
  segmentSayi: { backgroundColor: P.turuncu, borderRadius: 99, paddingHorizontal: 5, minWidth: 16, alignItems: "center" },
  segmentSayiYazi: { fontSize: 10.5, fontWeight: "800", color: "#fff" },

  sekmeler: { flexDirection: "row", gap: 4, borderBottomWidth: 1, borderBottomColor: P.cizgi, marginHorizontal: -16, paddingHorizontal: 12, marginBottom: 12, marginTop: -4 },
  sekme: { paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 2.5, borderBottomColor: "transparent", marginBottom: -1 },
  sekmeAktif: { borderBottomColor: P.yesil },
  sekmeYazi: { fontSize: 13, fontWeight: "600", color: P.soluk },
  sekmeYaziAktif: { color: P.metin },

  ara: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: P.cizgi, borderRadius: 14, paddingHorizontal: 12, height: 44, marginBottom: 10 },
  araGirdi: { flex: 1, fontSize: 14, color: P.metin, paddingVertical: 0, minWidth: 0 },

  cubuk: { height: 6, borderRadius: 9, backgroundColor: P.cizgi2, overflow: "hidden", marginTop: 5 },
  cubukDolu: { height: "100%", borderRadius: 9 },

  satir: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, borderTopWidth: 1, borderTopColor: P.cizgi2 },
  satirIlk: { borderTopWidth: 0 },
  /* Yeni gelen satır (canlı akış): kısa süre yeşil zemin */
  satirVurgu: { backgroundColor: P.yesilAcik, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 },
  satirOrta: { flex: 1, minWidth: 0 },
  satirBaslik: { fontSize: 13.5, fontWeight: "700", color: P.metin },
  satirAlt: { fontSize: 11.5, color: P.soluk, marginTop: 1 },
  sagDeger: { alignItems: "flex-end" },
  sagDegerUst: { fontSize: 14.5, fontWeight: "800", color: P.metin },
  sagDegerAlt: { fontSize: 11, color: P.soluk },

  durumEtiket: { borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, flexShrink: 0, maxWidth: 140 },
  durumEtiketYazi: { fontSize: 10.5, fontWeight: "700" },
  mini: { fontSize: 10.5, fontWeight: "700", borderRadius: 6, overflow: "hidden" },

  sira: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: P.cizgi2 },
  siraNo: { width: 24, fontWeight: "800", color: P.soluk, fontSize: 12.5, textAlign: "center" },
  siraAd: { flex: 1, minWidth: 0 },
  siraDeger: { fontWeight: "800", fontSize: 14, minWidth: 46, textAlign: "right", color: P.metin },

  sube: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 18, paddingVertical: 12, paddingHorizontal: 13, marginBottom: 8, ...golge },
  subeAd: { fontSize: 14, fontWeight: "700", color: P.metin },

  dikkat: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11, borderTopWidth: 1, borderTopColor: P.cizgi2 },
  dikkatIlk: { borderTopWidth: 0, paddingTop: 2 },
  dikkatBaslik: { fontSize: 13.5, fontWeight: "700", color: P.metin },

  dugme: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14 },
  dugmeYazi: { fontSize: 14, fontWeight: "700" },
  dugmeler: { flexDirection: "row", gap: 8 },

  uyari: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: P.turuncuAcik, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, marginBottom: 10 },
  uyariYazi: { flex: 1, fontSize: 12, fontWeight: "600", color: P.turuncuYazi },

  not: { backgroundColor: "#fafbf8", borderLeftWidth: 3, borderLeftColor: P.cizgi, paddingVertical: 6, paddingHorizontal: 10, borderTopRightRadius: 8, borderBottomRightRadius: 8, marginBottom: 12 },
  notYazi: { fontSize: 12.5, color: P.ikincil, lineHeight: 18 },

  bos: { alignItems: "center", paddingVertical: 26, paddingHorizontal: 10, gap: 8 },
  bosYazi: { fontSize: 13, color: P.soluk, textAlign: "center" },
});

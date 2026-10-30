/**
 * Patron · Özet
 * ---------------------------------------------------------------------------
 * Açılış ekranı: şu an mağazalarda kaç kişi var, onay bekleyen ne var,
 * kadro / başvuru / kart / sirkülasyon özetleri, dikkat edilmesi
 * gerekenler ve şube sıralaması — tek ekranda, kaydırarak.
 *
 * Ekran son görülen veriyle hemen açılıyor (önbellek), yenisi arka
 * planda geliyor. Özet geldikten sonra en sık açılan iki sekme (Onaylar,
 * Şubeler) önceden yükleniyor: patron o sekmelere geçtiğinde beklemiyor.
 *
 * Tarih aralığı (1.6): başlıktaki çiplerden "Bugün" dışında bir aralık
 * seçilince "Şu an mağazalarda" yerine aralığın okutma kartı geliyor;
 * başvuru, kart, sirkülasyon ve şube sıralaması o aralık için. Norm
 * kadro ve bekleyen onaylar şu anın sayısı (geçmişteki değeri tutulmuyor).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, Animated, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DurumCubugu from "expo-status-bar";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle } from "react-native-svg";

import { patronRenk as P } from "../../tema";
import { usePatron, patronOnceYukle, sayfalariSec, aralikliUc, useAralikVerisi } from "../../patronApi";
import { useOnbellek } from "../../onbellek";
import { modullerimAl } from "../../api";
import { gorunumYaz, patronYetkisiYaz } from "../../gorunum";
import Ikon, { ikonAdi } from "../../bilesenler/patron/Ikon";
import { OranHalka, Spark } from "../../bilesenler/patron/Grafikler";
import { usePatron360, hedefeGit } from "../../bilesenler/patron/Baglam";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni } from "../../bilesenler/patron/aralik";
import {
  Kart,
  KartBas,
  Kpi,
  AltYazi,
  Izgara,
  IkonSatir,
  SiraSatiri,
  SimgeKutu,
  SayiRozet,
  Avatar,
  GuncelBilgi,
  HataKutu,
} from "../../bilesenler/patron/Parcalar";
import {
  sayi,
  lira,
  kisa,
  ondalik,
  basHarf,
  oranRenk,
  oranDolgu,
  uzunTarih,
  selamla,
  buAy,
  onayOzeti,
  dolulukMetni,
} from "../../bilesenler/patron/bicim";

/* Dikkat satırı türü → simge ve ton */
const DIKKAT = {
  okutma: { ikon: "qr", ton: "turuncu" },
  kadro: { ikon: "kadro", ton: "mor" },
  basvuru: { ikon: "saat", ton: "sari" },
  etik: { ikon: "kalkan", ton: "kirmizi" },
  onay: { ikon: "onay", ton: "turuncu" },
};

export default function Ozet({ navigation }) {
  const kenar = useSafeAreaInsets();
  const { menuAc } = usePatron360();

  const aralik = useTarihAraligi();
  const o = usePatron(aralikliUc("Ozet", null, aralik));
  const modul = useOnbellek("patron/Modullerim", modullerimAl, { pasif: true });

  /* Aralık değişince yenisi gelene kadar önceki soluk */
  const { v, eski } = useAralikVerisi(o.veri);

  /* Özet geldikten sonra Onaylar ve Şubeler (aynı aralıkla) önceden yükleniyor */
  const onceYuklenen = useRef(null);
  const onceAnahtar = aralik.canli ? "-" : `${aralik.bas}|${aralik.bit}`;

  useEffect(() => {
    if (!o.veri || onceYuklenen.current === onceAnahtar) return;

    onceYuklenen.current = onceAnahtar;
    patronOnceYukle(aralikliUc("Onaylar", null, aralik));
    patronOnceYukle(aralikliUc("Subeler", null, aralik));
  }, [o.veri, onceAnahtar]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Oturum düştüyse girişe, yetki kaldırıldıysa personel ekranına */
  useEffect(() => {
    const h = o.hata ?? "";
    if (!h) return;

    if (/oturum/i.test(h) || /yeniden giriş/i.test(h)) {
      navigation.getParent()?.reset({ index: 0, routes: [{ name: "Giris" }] });
    } else if (/yetkiniz yok/i.test(h)) {
      patronYetkisiYaz(false);
      gorunumYaz(null);
      navigation.getParent()?.reset({ index: 0, routes: [{ name: "Uygulama" }] });
    }
  }, [o.hata, navigation]);

  /* Koyu başlık: durum çubuğu yazısı açık; başka sekmeye geçince koyu */
  useFocusEffect(
    useCallback(() => {
      DurumCubugu.setStatusBarStyle?.("light");
      return () => DurumCubugu.setStatusBarStyle?.("dark");
    }, [])
  );

  const git = (ekran, p) => navigation.navigate(ekran, p);

  return (
    <View style={s.tam}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={o.yenileniyor}
            onRefresh={() => o.yenile(true)}
            tintColor={P.yesil}
            colors={[P.yesil]}
            progressViewOffset={kenar.top}
          />
        }
      >
        <KoyuUst
          ust={kenar.top}
          kisi={modul.veri?.kisi}
          v={v}
          aralik={aralik}
          guncel={<GuncelBilgi zaman={o.zaman} guncelleniyor={o.guncelleniyor} hata={o.hata} yenile={o.yenile} koyu />}
          menuAc={menuAc}
          araAc={() => git("Ara")}
        />

        <View style={s.govde}>
          {!v ? (
            o.ilkYukleme ? (
              <Kart stil={{ paddingVertical: 60 }}>
                <GuncelBilgi guncelleniyor />
              </Kart>
            ) : (
              <Kart>
                <HataKutu metin={o.hata} yenile={o.yenile} />
              </Kart>
            )
          ) : (
            <AralikIcerik eski={eski}>
              {v.aralik ? <OkutmaKart okutma={v.okutma} aralik={v.aralik} git={git} /> : <CanliKart canli={v.canli} git={git} />}
              <OnaySeridi onay={v.onay} git={git} />
              {v.aralik ? <AralikKpiIzgara v={v} git={git} /> : <KpiIzgara v={v} git={git} />}
              <DikkatKart dikkat={v.dikkat} navigation={navigation} />
              <HizliErisim git={git} sayfalar={sayfalariSec(v, "ozet")} />
              <SubeSirasi liste={v.subeSirasi} git={git} aralik={v.aralik} />
            </AralikIcerik>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ========================================================================== */

function KoyuUst({ ust, kisi, v, aralik, guncel, menuAc, araAc }) {
  const [gen, setGen] = useState(0);
  const ad = kisi?.adSoyad || v?.ben?.ad || "";

  return (
    <View style={[s.koyu, { paddingTop: Math.max(ust, 12) + 14 }]} onLayout={(e) => setGen(e.nativeEvent.layout.width)}>
      {/* Zemin: koyu yeşil geçiş, sağ üstte ışık ve halka (tasarımdaki gibi) */}
      {gen > 0 ? (
        <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width={gen} height="100%">
          <Defs>
            <LinearGradient id="koyuZemin" x1="0" y1="0" x2="0.6" y2="1">
              <Stop offset="0" stopColor={P.koyu1} />
              <Stop offset="1" stopColor={P.koyu2} />
            </LinearGradient>
            <RadialGradient id="koyuIsik" cx={gen} cy="0" r={gen * 0.75} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#3d6b14" stopOpacity="1" />
              <Stop offset="1" stopColor="#3d6b14" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={gen} height="100%" fill="url(#koyuZemin)" />
          <Rect x="0" y="0" width={gen} height="100%" fill="url(#koyuIsik)" />
          <Circle cx={gen - 50} cy={70} r={93} fill="none" stroke="rgba(124,181,24,0.13)" strokeWidth={34} />
        </Svg>
      ) : null}

      <View style={s.ustSira}>
        <TouchableOpacity onPress={menuAc} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Hesap ve görünüm menüsü">
          {/* Patronun kendi fotoğrafı (Ozet.ben); yoksa baş harfler */}
          <Avatar
            fotoUrl={v?.ben?.fotoUrl}
            ad={ad}
            boyut={44}
            yuvarlak={14}
            yedek={
              <View style={s.avatar}>
                <Text style={s.avatarYazi}>{basHarf(ad) || "B"}</Text>
              </View>
            }
          />
          <View style={s.avatarRozet}>
            <Ikon ad="rotasyon" boyut={10} renkli="#fff" kalinlik={2.6} />
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.ustTarih}>{uzunTarih()}</Text>
          <Text style={s.ustSelam} numberOfLines={1}>
            {selamla()} 👋
          </Text>
          {guncel}
        </View>

        <TouchableOpacity style={s.yuvarlak} onPress={araAc} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Ara">
          <Ikon ad="ara" boyut={20} renkli="#fff" />
        </TouchableOpacity>
      </View>

      {v ? (
        <View style={s.rozet}>
          {aralik.canli ? <Nabiz renkli="#a4d64a" /> : <Ikon ad="takvim" boyut={12} renkli="#a4d64a" kalinlik={2.4} />}
          <Text style={s.rozetYazi} numberOfLines={1}>
            {aralik.canli ? "CANLI" : aralikMetni(aralik).toLocaleUpperCase("tr-TR")} · {sayi(v.birimSayisi)} BİRİM ·{" "}
            {sayi(v.calisan)} ÇALIŞAN
          </Text>
        </View>
      ) : null}

      {/* Tarih süzgeci: bütün patron sayfalarında ortak */}
      <TarihFiltresi koyu kenar={18} stil={{ marginTop: 12 }} />
    </View>
  );
}

/** Yanıp sönen "canlı" noktası */
function Nabiz({ renkli = P.yesil, boyut = 7 }) {
  const a = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const d = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 0.3, duration: 800, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(a, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== "web" }),
      ])
    );

    d.start();
    return () => d.stop();
  }, [a]);

  return <Animated.View style={{ width: boyut, height: boyut, borderRadius: boyut / 2, backgroundColor: renkli, opacity: a }} />;
}

/* ========================================================================== */

function CanliKart({ canli, git }) {
  if (!canli) return null;

  const beklenen = Number(canli.beklenen) || 0;
  const oran = beklenen ? canli.iceride / beklenen : 0;
  const yuzde = Math.round(oran * 100);

  const satirlar = [
    ["İçeride", canli.iceride, P.yesil, () => git("Gecis", { segment: "akis", t: Date.now() })],
    ["Okutmadı", canli.okutmadi, P.turuncu, () => git("Gecis", { segment: "okutmadi", t: Date.now() })],
    ["İzinli", canli.izinli, P.mavi, () => git("IkDetay", { bolum: "izin", sekme: "izin", t: Date.now() })],
    ["Raporlu", canli.raporlu, P.erik, () => git("IkDetay", { bolum: "izin", sekme: "rapor", t: Date.now() })],
    ["Geç kaldı", canli.gecKalan, P.sari, () => git("Gecis", { segment: "akis", t: Date.now() })],
  ];

  return (
    <Kart>
      <KartBas baslik="Şu an mağazalarda" bag="Geçişler" bagBas={() => git("Gecis", { segment: "akis", t: Date.now() })} />

      <View style={s.canli}>
        <OranHalka oran={oran} renkli={oranDolgu(yuzde)}>
          <Text style={s.halkaDeger}>{sayi(canli.iceride)}</Text>
          {/* İki satır: "/ 598 beklenen" tek satırda halkanın içine sığmıyordu */}
          <Text style={s.halkaAlt}>/ {sayi(beklenen)}</Text>
          <Text style={[s.halkaAlt, { marginTop: 0 }]}>beklenen</Text>
        </OranHalka>

        <View style={s.canliListe}>
          {satirlar.map(([ad, deger, r, bas]) =>
            deger === null || deger === undefined ? null : (
              <TouchableOpacity key={ad} style={s.canliSatir} onPress={bas} activeOpacity={0.6}>
                <View style={[s.canliKare, { backgroundColor: r }]} />
                <Text style={s.canliAd}>{ad}</Text>
                <Text style={s.canliDeger}>{sayi(deger)}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>

      <View style={s.canliAlt}>
        <View style={s.canliAltSol}>
          <Nabiz />
          <Text style={s.canliAltYazi} numberOfLines={1}>
            {canli.sonOkutma?.saat
              ? `Son okutma ${canli.sonOkutma.saat}${canli.sonOkutma.sube ? ` · ${canli.sonOkutma.sube}` : ""}`
              : "Bugün henüz okutma yok"}
          </Text>
        </View>
        <Text style={s.canliAltYazi}>%{yuzde} katılım</Text>
      </View>
    </Kart>
  );
}

/** Aralıkta okutma (1.6): en az bir gün okutan / beklenen */
function OkutmaKart({ okutma, aralik, git }) {
  if (!okutma) return null;

  const beklenen = Number(okutma.beklenen) || 0;
  const oran = beklenen ? okutma.okutan / beklenen : 0;
  const yuzde = okutma.oran ?? Math.round(oran * 100);
  const cokGun = (aralik?.gun ?? 1) > 1;

  const satirlar = [
    ["Okuttu", okutma.okutan, P.yesil, () => git("Gecis", { segment: "akis", t: Date.now() })],
    ["Hiç okutmadı", okutma.okutmadi, P.turuncu, () => git("Gecis", { segment: "okutmadi", t: Date.now() })],
    ["İzin alan", okutma.izinli, P.mavi, () => git("IkDetay", { bolum: "izin", sekme: "izin", t: Date.now() })],
    ["Rapor alan", okutma.raporlu, P.erik, () => git("IkDetay", { bolum: "izin", sekme: "rapor", t: Date.now() })],
    [cokGun ? "Geç kalınan gün" : "Geç kaldı", okutma.gecKalan, P.sari, () => git("Gecis", { segment: "akis", t: Date.now() })],
  ];

  const son = okutma.sonOkutma;

  return (
    <Kart>
      <KartBas baslik={`Okutma · ${aralik?.ad ?? ""}`} bag="Geçişler" bagBas={() => git("Gecis", { segment: "akis", t: Date.now() })} />

      <View style={s.canli}>
        <OranHalka oran={oran} renkli={oranDolgu(yuzde)}>
          <Text style={s.halkaDeger}>{sayi(okutma.okutan)}</Text>
          <Text style={s.halkaAlt}>/ {sayi(beklenen)}</Text>
          <Text style={[s.halkaAlt, { marginTop: 0 }]}>okuttu</Text>
        </OranHalka>

        <View style={s.canliListe}>
          {satirlar.map(([ad, deger, r, bas]) =>
            deger === null || deger === undefined ? null : (
              <TouchableOpacity key={ad} style={s.canliSatir} onPress={bas} activeOpacity={0.6}>
                <View style={[s.canliKare, { backgroundColor: r }]} />
                <Text style={s.canliAd}>{ad}</Text>
                <Text style={s.canliDeger}>{sayi(deger)}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>

      <View style={s.canliAlt}>
        <Text style={[s.canliAltYazi, { flex: 1 }]} numberOfLines={1}>
          {cokGun
            ? `Günde ort. ${sayi(okutma.gunlukOrt)} kişi okuttu`
            : son?.saat
            ? `Son okutma ${son.saat}${son.sube ? ` · ${son.sube}` : ""}`
            : "Bu günde okutma yok"}
        </Text>
        <Text style={s.canliAltYazi}>%{yuzde} katılım</Text>
      </View>
    </Kart>
  );
}

function OnaySeridi({ onay, git }) {
  if (!onay) return null;

  const toplam = Number(onay.toplam) || 0;

  if (toplam === 0)
    return (
      <View style={[s.serit, s.seritYesil]}>
        <View style={[s.seritSayi, { backgroundColor: P.yesil }]}>
          <Ikon ad="tik" boyut={20} renkli="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.seritBaslik}>Bekleyen onay yok</Text>
          <Text style={s.seritAlt}>Onayınızı bekleyen işlem kalmadı</Text>
        </View>
      </View>
    );

  return (
    <TouchableOpacity style={s.serit} onPress={() => git("Onaylar", { tur: "hepsi", t: Date.now() })} activeOpacity={0.8}>
      <View style={s.seritSayi}>
        <Text style={s.seritSayiYazi}>{toplam}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.seritBaslik}>Onayınızı bekleyen işlem</Text>
        <Text style={s.seritAlt} numberOfLines={1}>
          {onayOzeti(onay.turler) || "Dokunup inceleyin"}
        </Text>
      </View>
      <Ikon ad="ok" boyut={18} renkli={P.turuncu} />
    </TouchableOpacity>
  );
}

function KpiIzgara({ v, git }) {
  const kutular = [];

  if (v.norm)
    kutular.push(
      <Kpi
        key="norm"
        ikon="kadro"
        tonAd="mor"
        baslik="Norm kadro"
        deger={dolulukMetni(v.norm)}
        alt={<AltYazi parcalar={[[`${sayi(v.norm.eksik)} eksik`, "asagi"], ` · ${sayi(v.norm.fazla)} fazla · ${sayi(v.norm.norm)} norm`]} />}
        bas={() => git("Norm")}
      />
    );

  if (v.basvuru) {
    const b = v.basvuru;
    const degisim = b.gecenHafta ? Math.round(((b.hafta - b.gecenHafta) / b.gecenHafta) * 100) : null;

    kutular.push(
      <Kpi
        key="basvuru"
        ikon="kisiEkle"
        tonAd="mavi"
        spark={<Spark degerler={b.son7} renkli={P.mavi} />}
        baslik="Başvurular"
        deger={sayi(b.bugun)}
        degerEk="bugün"
        alt={
          <AltYazi
            parcalar={[
              `${sayi(b.hafta)} bu hafta`,
              ...(degisim === null ? [] : [" · ", [`${degisim >= 0 ? "▲" : "▼"} %${Math.abs(degisim)}`, degisim >= 0 ? "yukari" : "asagi"]]),
            ]}
          />
        }
        bas={() => git("Basvurular", { durum: null, t: Date.now() })}
      />
    );
  }

  if (v.kart)
    kutular.push(
      <Kpi
        key="kart"
        ikon="kart"
        tonAd="erik"
        baslik="Biçen Kart · bugün"
        deger={lira(v.kart.bugunHarcama)}
        alt={`kartla harcanan · ${sayi(v.kart.aktifKart)} aktif kart`}
        bas={() => git("Kart")}
      />
    );

  if (v.sirkulasyon)
    kutular.push(
      <Kpi
        key="sirk"
        ikon="rotasyon"
        tonAd="turuncu"
        spark={<Spark degerler={v.sirkulasyon.son6} renkli={P.turuncu} />}
        baslik={`Sirkülasyon · ${buAy()}`}
        deger={`%${ondalik(v.sirkulasyon.oran)}`}
        alt={`${sayi(v.sirkulasyon.ayGiris)} giriş · ${sayi(v.sirkulasyon.ayCikis)} çıkış`}
        bas={() => git("IkDetay", { bolum: "sirkulasyon", t: Date.now() })}
      />
    );

  if (!kutular.length) return null;

  return <Izgara>{kutular}</Izgara>;
}

/** Aralıklı KPI kutuları (1.6): başvuru, kart ve sirkülasyon aralığın; norm şu an */
function AralikKpiIzgara({ v, git }) {
  const ad = v.aralik?.ad ?? "";
  const kutular = [];

  if (v.norm)
    kutular.push(
      <Kpi
        key="norm"
        ikon="kadro"
        tonAd="mor"
        baslik="Norm kadro · şu an"
        deger={dolulukMetni(v.norm)}
        alt={<AltYazi parcalar={[[`${sayi(v.norm.eksik)} eksik`, "asagi"], ` · ${sayi(v.norm.fazla)} fazla · ${sayi(v.norm.norm)} norm`]} />}
        bas={() => git("Norm")}
      />
    );

  if (v.basvuru) {
    const b = v.basvuru;
    const degisim = b.onceki ? Math.round(((b.toplam - b.onceki) / b.onceki) * 100) : null;
    const seri = (b.seri ?? []).map((x) => x?.[1]);

    kutular.push(
      <Kpi
        key="basvuru"
        ikon="kisiEkle"
        tonAd="mavi"
        spark={<Spark degerler={seri} renkli={P.mavi} />}
        baslik={`Başvurular · ${ad}`}
        deger={sayi(b.toplam)}
        alt={
          <AltYazi
            parcalar={[
              `${sayi(b.alinan)} işe alındı`,
              ...(degisim === null ? [] : [" · ", [`${degisim >= 0 ? "▲" : "▼"} %${Math.abs(degisim)}`, degisim >= 0 ? "yukari" : "asagi"]]),
            ]}
          />
        }
        bas={() => git("Basvurular", { durum: null, t: Date.now() })}
      />
    );
  }

  if (v.kart)
    kutular.push(
      <Kpi
        key="kart"
        ikon="kart"
        tonAd="erik"
        baslik={`Biçen Kart · ${ad}`}
        deger={kisa(v.kart.harcanan)}
        degerEk="₺"
        alt={`kartla harcanan · ${sayi(v.kart.aktifKart)} aktif kart`}
        bas={() => git("Kart")}
      />
    );

  if (v.sirkulasyon)
    kutular.push(
      <Kpi
        key="sirk"
        ikon="rotasyon"
        tonAd="turuncu"
        spark={<Spark degerler={(v.sirkulasyon.seri ?? []).map((x) => x?.cikis)} renkli={P.turuncu} />}
        baslik={`Sirkülasyon · ${ad}`}
        deger={`%${ondalik(v.sirkulasyon.oran)}`}
        alt={`${sayi(v.sirkulasyon.giris)} giriş · ${sayi(v.sirkulasyon.cikis)} çıkış`}
        bas={() => git("IkDetay", { bolum: "sirkulasyon", t: Date.now() })}
      />
    );

  if (!kutular.length) return null;

  return <Izgara>{kutular}</Izgara>;
}

function DikkatKart({ dikkat, navigation }) {
  if (!dikkat?.length) return null;

  return (
    <Kart>
      <KartBas baslik="Dikkat edilmesi gerekenler" />
      {dikkat.map((d, i) => {
        const t = DIKKAT[d.tur] ?? { ikon: "uyari", ton: "gri" };

        return (
          <IkonSatir
            key={`${d.tur}-${i}`}
            ilk={i === 0}
            ikon={t.ikon}
            tonAd={t.ton}
            baslik={d.baslik}
            alt={d.alt}
            bas={d.hedef?.ekran ? () => hedefeGit(navigation, d.hedef) : undefined}
          />
        );
      })}
    </Kart>
  );
}

function HizliErisim({ git, sayfalar }) {
  const t = () => Date.now();

  /* Tasarımdaki "Duyuru gönder" ve "Haftalık rapor" çıkarıldı: ikisinin
     de sunucuda karşılığı yok. Yerlerine sirkülasyon ve etik hat.
     Sunucu tanımlı sayfalar (yer: "ozet") sona ekleniyor: duyuru gibi
     yeni sayfalar uygulama güncellemesi olmadan burada beliriyor. */
  const ogeler = [
    ["Başvurular", "kisiEkle", "mavi", () => git("Basvurular", { durum: null, t: t() })],
    ["Norm kadro", "kadro", "mor", () => git("Norm")],
    ["Geçişler", "qr", "yesil", () => git("Gecis", { segment: "akis", t: t() })],
    ["Personel ara", "ara", "gri", () => git("Ara")],
    ["İzin & rapor", "takvim", "sari", () => git("IkDetay", { bolum: "izin", t: t() })],
    ["Sirkülasyon", "rotasyon", "turuncu", () => git("IkDetay", { bolum: "sirkulasyon", t: t() })],
    ["Performans", "grafik", "erik", () => git("IkDetay", { bolum: "performans", t: t() })],
    ["Etik hat", "kalkan", "kirmizi", () => git("IkDetay", { bolum: "etik", t: t() })],
    ...(sayfalar ?? []).map((x) => [
      x.baslik || x.kod,
      ikonAdi(x.ikon),
      x.ton || "gri",
      () => git("WebSayfa", { kod: x.kod, baslik: x.baslik ?? null, t: t() }),
      x.rozet,
      `sayfa-${x.kod}`,
    ]),
  ];

  return (
    <Kart>
      <KartBas baslik="Hızlı erişim" />
      <Izgara sutun={4}>
        {ogeler.map(([ad, ikon, tonAd, bas, rozet, anahtar]) => (
          <TouchableOpacity key={anahtar ?? ad} style={s.hizli} onPress={bas} activeOpacity={0.7}>
            <View>
              <SimgeKutu ikon={ikon} tonAd={tonAd} boyut={50} yuvarlak={16} ikonBoyut={22} />
              <SayiRozet sayi={rozet} stil={s.hizliRozet} />
            </View>
            <Text style={s.hizliYazi} numberOfLines={2}>
              {ad}
            </Text>
          </TouchableOpacity>
        ))}
      </Izgara>
    </Kart>
  );
}

function SubeSirasi({ liste, git, aralik }) {
  if (!liste?.length) return null;

  /* İlk üç ve son iki; liste kısaysa hepsi */
  const ust = liste.length > 5 ? liste.slice(0, 3) : liste;
  const alt = liste.length > 5 ? liste.slice(-2) : [];

  const satir = (x, no, ilk) => (
    <SiraSatiri
      key={`${x.ad}-${no}`}
      ilk={ilk}
      no={no}
      ad={x.ad}
      alt={[
        x.bolge,
        aralik ? `${sayi(x.okutan)}/${sayi(x.beklenen)} okuttu` : `${sayi(x.iceride)}/${sayi(x.beklenen)} içeride`,
      ]
        .filter(Boolean)
        .join(" · ")}
      oran={x.oran}
      deger={x.oran === null || x.oran === undefined ? "—" : `%${x.oran}`}
      degerRenk={oranRenk(x.oran)}
      bas={() => git("SubeDetay", { ad: x.ad })}
    />
  );

  return (
    <Kart>
      <KartBas
        baslik={`Şube sıralaması · ${aralik ? aralik.ad : "bugün"}`}
        bag="Tümü"
        bagBas={() => git("Gecis", { segment: "sube", t: Date.now() })}
      />
      {ust.map((x, i) => satir(x, i + 1, i === 0))}
      {alt.length ? (
        <>
          <Text style={s.enDusuk}>En düşük</Text>
          {alt.map((x, i) => satir(x, liste.length - 1 + i, i === 0))}
        </>
      ) : null}
    </Kart>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: P.zemin },
  govde: { paddingHorizontal: 14, marginTop: -58 },

  koyu: { paddingHorizontal: 18, paddingBottom: 74, overflow: "hidden", backgroundColor: P.koyu2 },
  ustSira: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#82b52c",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.18)",
  },
  avatarYazi: { color: "#fff", fontWeight: "800", fontSize: 15 },
  avatarRozet: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: P.koyu2,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  ustTarih: { color: "rgba(255,255,255,0.66)", fontSize: 12.5 },
  ustSelam: { color: "#fff", fontSize: 19, fontWeight: "800", letterSpacing: -0.2 },
  yuvarlak: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  rozet: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  rozetYazi: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },

  canli: { flexDirection: "row", alignItems: "center", gap: 16 },
  halkaDeger: { fontSize: 26, fontWeight: "800", color: P.metin, letterSpacing: -0.6 },
  halkaAlt: { fontSize: 11, color: P.soluk, marginTop: 2 },
  canliListe: { flex: 1, gap: 7 },
  canliSatir: { flexDirection: "row", alignItems: "center", gap: 8 },
  canliKare: { width: 9, height: 9, borderRadius: 3 },
  canliAd: { flex: 1, fontSize: 13, color: P.ikincil },
  canliDeger: { fontSize: 13, fontWeight: "700", color: P.metin },
  canliAlt: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: P.cizgi2,
  },
  canliAltSol: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 },
  canliAltYazi: { fontSize: 12, color: P.soluk },

  serit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff3ec",
    borderWidth: 1,
    borderColor: "#f8cdb9",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  seritYesil: { backgroundColor: P.yesilAcik, borderColor: "#d5e8b5" },
  seritSayi: { width: 42, height: 42, borderRadius: 13, backgroundColor: P.turuncu, alignItems: "center", justifyContent: "center" },
  seritSayiYazi: { color: "#fff", fontWeight: "800", fontSize: 18 },
  seritBaslik: { fontSize: 14.5, fontWeight: "700", color: P.metin },
  seritAlt: { fontSize: 12, color: P.ikincil },

  hizli: { alignItems: "center", gap: 6, paddingVertical: 4 },
  hizliRozet: { position: "absolute", top: -5, right: -7, borderWidth: 2, borderColor: "#fff", height: 22, minWidth: 22, borderRadius: 11 },
  hizliYazi: { fontSize: 11.5, fontWeight: "600", color: P.ikincil, textAlign: "center", lineHeight: 14 },

  enDusuk: { fontSize: 11.5, color: P.soluk, marginTop: 8, marginBottom: 2 },
});

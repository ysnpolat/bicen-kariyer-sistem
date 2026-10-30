/**
 * Arıza Kayıt
 * ---------------------------------------------------------------------------
 * Üç bölüm: kayıt listesi, kayıt ayrıntısı ve yeni kayıt formu. Liste ile
 * form aynı ekranda duruyor çünkü personel çoğu zaman "bunu daha önce
 * bildirmiş miydik" diye bakıp sonra kayıt açıyor.
 *
 * Ayrıntı ayrı bir ekrana gitmiyor, kaplama olarak açılıyor: telefonda geri
 * tuşuyla listeye dönmek, kaydırma yerini kaybettiriyordu.
 *
 * Kayıt önce açılıyor, fotoğraflar sonra yükleniyor: mağazada ağ kopabiliyor
 * ve fotoğraf yüklenemedi diye kaydın kaybolması, işin tekrar yapılması
 * demek.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Image,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";

import {
  arizaFormAl,
  arizaAkisAl,
  arizaAc,
  arizalarimAl,
  arizaDetayAl,
  arizaDurumYaz,
  arizaYorumYaz,
  arizaGorselYukle,
  arizaGorselAdresi,
} from "../api360";
import { olcu, renk, yazi } from "../tema";
import { Kart, Rozet, Yukleniyor, Hata, Bos, Bilgi } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import BarBaslik from "../bilesenler/BarBaslik";
import ServisFormu from "./ServisFormu";
import Pencere from "../bilesenler/Pencere";

/* -------------------------------------------------------------------------- */

const DURUMLAR = {
  acik: { ad: "Açık", tur: "mavi" },
  devam: { ad: "Devam ediyor", tur: "mavi" },
  beklemede: { ad: "Beklemede", tur: "turuncu" },
  cozuldu: { ad: "Çözüldü", tur: "yesil" },
  kapandi: { ad: "Kapandı", tur: "gri" },
};

const ONCELIKLER = {
  dusuk: { ad: "Düşük", tur: "gri" },
  orta: { ad: "Orta", tur: "mavi" },
  yuksek: { ad: "Yüksek", tur: "turuncu" },
  acil: { ad: "Acil", tur: "mor" },
};

/**
 * Kimin kayıtları.
 *
 * Temsilci için "departmanıma açılanlar" ile "benim açtıklarım" ayrı
 * sorular; karışık tek liste hangisinin ne olduğunu gizliyordu. Temsilci
 * olmayanlar zaten yalnızca kendi kayıtlarını görüyor, onlara bu seçim
 * gösterilmiyor.
 */
const KAPSAMLAR = [
  { kod: "departmanim", ad: "Departmanım" },
  { kod: "benim", ad: "Benim" },
  { kod: "", ad: "Tümü" },
];

/**
 * Liste üstündeki süzgeç.
 *
 * Varsayılan "kapanmamış olanların tamamı": önceden yalnızca "açık"
 * gösteriliyordu ve bir kayıt beklemeye alındığı ya da üzerinde
 * çalışılmaya başlandığı anda listeden düşüyordu. Personel de temsilci de
 * işin bir kısmını göremiyor, ancak süzgeci kaldırınca fark ediyordu.
 *
 * "hepsi" sunucuya durum göndermez; çözülmüş ve kapanmışlar da gelir.
 */
const SUZGECLER = [
  { kod: "aktif", ad: "Bekleyenler" },
  { kod: "acik", ad: "Yeni" },
  { kod: "devam", ad: "Devam" },
  { kod: "beklemede", ad: "Beklemede" },
  { kod: "cozuldu", ad: "Çözülen" },
  { kod: "", ad: "Hepsi" },
];

const tarihYaz = (d) => {
  if (!d) return "";

  const t = new Date(d);

  return `${t.toLocaleDateString("tr-TR")} ${t.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

/**
 * SLA bitişine kalan süre.
 *
 * Kapanmış kayıtta gecikme gösterilmiyor: iş bittikten sonra "3 saat
 * gecikti" yazması, listeyi hâlâ sorun varmış gibi gösteriyordu.
 */
const slaMetni = (bitis, durum) => {
  if (!bitis) return null;

  if (durum === "cozuldu" || durum === "kapandi") return null;

  const saat = Math.round((new Date(bitis) - new Date()) / 3600000);

  if (saat < 0) return { metin: `${Math.abs(saat)} saat gecikti`, tur: "turuncu" };
  if (saat <= 8) return { metin: `${saat} saat kaldı`, tur: "turuncu" };

  return { metin: `${saat} saat kaldı`, tur: "gri" };
};

/* ========================================================================== */

export default function Ariza({ route }) {
  /* Envanterden gelindiğinde doğrudan yeni kayıt formu açılıyor ve cihaz
     seçili geliyor: kaydı açarken cihazı yeniden aramak, kayıtların
     cihazsız açılmasına yol açıyordu. */
  const hazirCihaz = route?.params?.envanterId ?? null;

  const [bolum, setBolum] = useState(hazirCihaz ? "yeni" : "liste");
  const [suzgec, setSuzgec] = useState("aktif");

  /* Temsilci için varsayılan "departmanım": temsilci uygulamayı çoğunlukla
     kendisine düşen işleri görmek için açıyor. */
  const [kapsam, setKapsam] = useState("departmanim");

  const [veri, setVeri] = useState(null);
  const [form, setForm] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState(null);

  const [acikKayit, setAcikKayit] = useState(null);

  const getir = useCallback(
    async (durum = suzgec, alan = kapsam) => {
      setHata(null);

      try {
        /* İkisi birlikte isteniyor: form listeleri kayıt açarken de,
           listedeki kategori adlarını göstermek için de gerekiyor. */
        const [kayitlar, formVerisi] = await Promise.all([
          arizalarimAl(durum, alan),
          arizaFormAl(),
        ]);

        setVeri(kayitlar);
        setForm(formVerisi);
      } catch (h) {
        setHata(h.message);
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [suzgec, kapsam]
  );

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const suzgecDegistir = (kod) => {
    setSuzgec(kod);
    setYukleniyor(true);
    getir(kod, kapsam);
  };

  const kapsamDegistir = (kod) => {
    setKapsam(kod);
    setYukleniyor(true);
    getir(suzgec, kod);
  };

  if (yukleniyor) return <Yukleniyor />;

  return (
    <SafeAreaView style={stil.sayfa} edges={["top", "bottom"]}>
      <BarBaslik ad="Arıza Kayıt" acik kendi />

      <View style={stil.sekmeler}>
        {[
          { kod: "liste", ad: "Kayıtlar" },
          { kod: "yeni", ad: "Yeni kayıt" },
        ].map((s) => (
          <TouchableOpacity
            key={s.kod}
            style={[stil.sekme, bolum === s.kod && stil.sekmeSecili]}
            onPress={() => setBolum(s.kod)}
          >
            <Text style={[stil.sekmeYazi, bolum === s.kod && stil.sekmeYaziSecili]}>
              {s.ad}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {hata && <Hata metin={hata} />}

      {bolum === "liste" ? (
        <Liste
          veri={veri}
          suzgec={suzgec}
          suzgecDegistir={suzgecDegistir}
          kapsam={kapsam}
          kapsamDegistir={kapsamDegistir}
          yenileniyor={yenileniyor}
          yenile={() => {
            setYenileniyor(true);
            getir();
          }}
          ac={setAcikKayit}
        />
      ) : (
        <YeniKayit
          form={form}
          hazirCihaz={hazirCihaz}
          hazirCihazAdi={route?.params?.cihazAdi}
          tamamlandi={() => {
            setBolum("liste");
            setYukleniyor(true);
            getir();
          }}
        />
      )}

      <Ayrinti
        id={acikKayit}
        temsilci={!!veri?.temsilci}
        turler={form?.turler ?? []}
        kapat={() => setAcikKayit(null)}
        guncellendi={() => getir()}
      />
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Liste                                                                      */
/* ========================================================================== */

function Liste({
  veri,
  suzgec,
  suzgecDegistir,
  kapsam,
  kapsamDegistir,
  yenileniyor,
  yenile,
  ac,
}) {
  const kayitlar = veri?.kayitlar ?? [];
  const ozet = veri?.ozet;
  const temsilci = !!veri?.temsilci;

  /* Kapsam seçimi yalnızca bir departmanın temsilcisi olana gösteriliyor;
     diğerleri zaten sadece kendi kayıtlarını görüyor ve üç seçenek de aynı
     listeyi verirdi. */
  const kapsamSecimi = (veri?.departmanSayisi ?? 0) > 0;

  return (
    <ScrollView
      contentContainerStyle={stil.icerik}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} />}
    >
      {ozet && (
        <View style={stil.ozet}>
          <OzetKutu ad="Bekleyen" deger={ozet.aktif ?? 0} />
          <OzetKutu ad="Devam" deger={ozet.devam ?? 0} />
          <OzetKutu
            ad="Geciken"
            deger={ozet.geciken ?? 0}
            vurgu={(ozet.geciken ?? 0) > 0}
          />
          <OzetKutu ad="Toplam" deger={ozet.toplam ?? 0} />
        </View>
      )}

      {kapsamSecimi && (
        <View style={stil.kapsamlar}>
          {KAPSAMLAR.map((k) => (
            <TouchableOpacity
              key={k.kod || "tumu"}
              style={[stil.kapsam, kapsam === k.kod && stil.kapsamSecili]}
              onPress={() => kapsamDegistir(k.kod)}
            >
              <Text
                style={[
                  stil.kapsamYazi,
                  kapsam === k.kod && stil.kapsamYaziSecili,
                ]}
              >
                {k.ad}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={stil.suzgecler}
      >
        {SUZGECLER.map((s) => (
          <TouchableOpacity
            key={s.kod || "hepsi"}
            style={[stil.suzgec, suzgec === s.kod && stil.suzgecSecili]}
            onPress={() => suzgecDegistir(s.kod)}
          >
            <Text
              style={[stil.suzgecYazi, suzgec === s.kod && stil.suzgecYaziSecili]}
            >
              {s.ad}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {temsilci && kapsam === "departmanim" && (
        <Bilgi>
          Temsilcisi olduğunuz departmana açılan kayıtlar. Durumlarını
          değiştirebilirsiniz.
        </Bilgi>
      )}

      {kayitlar.length === 0 ? (
        <Bos
          metin={
            kapsam === "departmanim"
              ? "Departmanınıza açılmış kayıt yok."
              : "Bu süzgeçte kayıt yok. Yeni kayıt sekmesinden arıza bildirebilirsiniz."
          }
        />
      ) : (
        kayitlar.map((k) => {
          const sla = slaMetni(k.slaBitis, k.durum);

          return (
            <TouchableOpacity key={k.id} activeOpacity={0.8} onPress={() => ac(k.id)}>
              <Kart serit={k.gecikti ? renk.turuncu : null}>
                <View style={stil.satirUst}>
                  <Text style={stil.baslik} numberOfLines={2}>
                    #{k.id} · {k.baslik}
                  </Text>
                  <Rozet
                    metin={DURUMLAR[k.durum]?.ad ?? k.durum}
                    tur={DURUMLAR[k.durum]?.tur ?? "gri"}
                  />
                </View>

                <Text style={stil.alt}>
                  {[k.departman, k.tur, k.subeKodu].filter(Boolean).join(" · ")}
                </Text>

                <View style={stil.rozetler}>
                  <Rozet
                    metin={ONCELIKLER[k.oncelik]?.ad ?? k.oncelik}
                    tur={ONCELIKLER[k.oncelik]?.tur ?? "gri"}
                  />
                  {sla && <Rozet metin={sla.metin} tur={sla.tur} />}
                </View>

                <Text style={stil.tarih}>
                  {tarihYaz(k.olusturma)}
                  {k.acanAdi ? ` · ${k.acanAdi}` : ""}
                  {k.atananAdi ? ` · ${k.atananAdi} üzerinde` : ""}
                  {k.gorselSayisi > 0 ? ` · ${k.gorselSayisi} fotoğraf` : ""}
                  {k.yorumSayisi > 0 ? ` · ${k.yorumSayisi} yorum` : ""}
                </Text>
              </Kart>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

function OzetKutu({ ad, deger, vurgu }) {
  return (
    <View style={stil.ozetKutu}>
      <Text style={[stil.ozetDeger, vurgu && { color: renk.turuncuKoyu }]}>
        {deger}
      </Text>
      <Text style={stil.ozetAd}>{ad}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Ayrıntı                                                                    */
/* ========================================================================== */

function Ayrinti({ id, temsilci, turler, kapat, guncellendi }) {
  /* Modal ayrı bir görünüm katmanında açılıyor ve SafeAreaView orada
     çalışmıyor: başlık çubuğu Dinamik Ada'nın altında kalıp geri düğmesi
     dokunulamaz oluyordu. Boşluk elle veriliyor. */
  const kenar = useSafeAreaInsets();

  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);

  const [yorum, setYorum] = useState("");
  const [icNot, setIcNot] = useState(false);

  const oku = useCallback(async () => {
    if (!id) return;

    setYukleniyor(true);

    try {
      setVeri(await arizaDetayAl(id));
    } catch (h) {
      Alert.alert("Açılamadı", h.message);
      kapat();
    } finally {
      setYukleniyor(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (id) oku();
      else {
        setVeri(null);
        setYorum("");
        setIcNot(false);
      }
    }, [id, oku])
  );

  /* Servis formu penceresi: hangi duruma geçileceğini taşıyor */
  const [servisFormuDurumu, setServisFormuDurumu] = useState(null);

  const durumDegistir = async (durum) => {
    /* Çözüldü ve kapatıldı doğrudan yazılmıyor: önce servis formu
       açılıyor, durum form kaydedilince değişiyor. "Çözüldü" yazan ama ne
       yapıldığı belli olmayan kayıt, aynı arıza tekrarladığında hiçbir
       şey anlatmıyordu. */
    if (durum === "cozuldu" || durum === "kapandi") {
      setServisFormuDurumu(durum);
      return;
    }

    setIsleniyor(true);

    try {
      await arizaDurumYaz(id, durum, null);
      await oku();
      guncellendi();
    } catch (h) {
      Alert.alert("Değiştirilemedi", h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const servisFormuKaydedildi = async () => {
    const durum = servisFormuDurumu;

    setServisFormuDurumu(null);
    setIsleniyor(true);

    try {
      await arizaDurumYaz(id, durum, null);
      await oku();
      guncellendi();
    } catch (h) {
      Alert.alert("Değiştirilemedi", h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const yorumGonder = async (cozum = false) => {
    if (!yorum.trim()) return;

    setIsleniyor(true);

    try {
      await arizaYorumYaz(id, yorum.trim(), { icNot, cozum });
      setYorum("");
      setIcNot(false);
      await oku();
      guncellendi();
    } catch (h) {
      Alert.alert("Gönderilemedi", h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const kayit = veri?.kayit;

  const cihaz = [kayit?.cihazTuru, kayit?.cihazMarka, kayit?.cihazModel]
    .filter(Boolean)
    .join(" ");

  const sla = kayit ? slaMetni(kayit.slaBitis, kayit.durum) : null;
  const turAdi = turler.find((t) => t.id === kayit?.turId)?.ad ?? kayit?.tur;

  return (
    <Modal visible={!!id} animationType="slide" onRequestClose={kapat}>
      <View
        style={[
          stil.sayfa,
          { paddingTop: Math.max(kenar.top, 12), paddingBottom: kenar.bottom },
        ]}
      >
        <View style={stil.baslikCubugu}>
          <TouchableOpacity
            onPress={kapat}
            style={stil.kapatDokun}
            /* Simge küçük; dokunma alanı çevresine genişletiliyor */
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          >
            <Simge ad="ok" boyut={20} renkli={renk.metin} />
          </TouchableOpacity>

          <Text style={stil.baslikYazi} numberOfLines={1}>
            {kayit ? `#${kayit.id}` : "Kayıt"}
          </Text>

          <View style={{ width: 40 }} />
        </View>

        {yukleniyor && !kayit ? (
          <Yukleniyor />
        ) : kayit ? (
          <ScrollView contentContainerStyle={stil.icerik} keyboardShouldPersistTaps="handled">
            <Kart>
              <Text style={stil.detayBaslik}>{kayit.baslik}</Text>

              <View style={stil.rozetler}>
                <Rozet
                  metin={DURUMLAR[kayit.durum]?.ad ?? kayit.durum}
                  tur={DURUMLAR[kayit.durum]?.tur ?? "gri"}
                />
                <Rozet
                  metin={ONCELIKLER[kayit.oncelik]?.ad ?? kayit.oncelik}
                  tur={ONCELIKLER[kayit.oncelik]?.tur ?? "gri"}
                />
                {sla && <Rozet metin={sla.metin} tur={sla.tur} />}
              </View>

              {/* Künye satırları: önceden nokta ile ayrılmış tek satırdı ve
                  hangi değerin ne olduğu anlaşılmıyordu. */}
              <View style={stil.kunye}>
                <KunyeSatiri ad="Departman" deger={kayit.departman} />
                <KunyeSatiri ad="Arıza türü" deger={turAdi} />
                <KunyeSatiri ad="Mağaza" deger={kayit.subeKodu} />
                <KunyeSatiri ad="Açan" deger={kayit.acanAdi} />

                {/* Numaraya dokununca telefon uygulaması açılıyor:
                    teknisyen çoğu kaydı önce arayarak çözüyor ve numarayı
                    başka bir ekrandan aramak zorunda kalıyordu. */}
                {!!veri.acanTelefon && (
                  <View style={stil.kunyeSatiri}>
                    <Text style={stil.kunyeAd}>Telefon</Text>

                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => Linking.openURL(`tel:${veri.acanTelefon}`)}
                    >
                      <Text style={stil.telefon}>
                        {telefonYaz(veri.acanTelefon)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                <KunyeSatiri ad="Açılış" deger={tarihYaz(kayit.olusturma)} />
                <KunyeSatiri ad="Üzerinde" deger={kayit.atananAdi} />
                <KunyeSatiri
                  ad="Cihaz"
                  deger={
                    cihaz
                      ? `${cihaz}${kayit.cihazSeriNo ? ` · ${kayit.cihazSeriNo}` : ""}`
                      : null
                  }
                />
              </View>
            </Kart>

            {/* Personelin adım adım verdiği cevaplar. Ayrıntı ekranı bunlar
                olmadan neredeyse boştu: teknisyen kaydı açtığında yalnızca
                başlığı görüyordu. */}
            {veri.yanitlar?.length > 0 && (
              <Kart baslik="Arıza bildirimi">
                {!!kayit.akisOzet && (
                  <View style={stil.ozetKutusu}>
                    <Text style={stil.ozetKutusuYazi}>{kayit.akisOzet}</Text>
                  </View>
                )}

                {veri.yanitlar.map((y, i) => (
                  <View key={i} style={stil.yanit}>
                    <View style={stil.yanitNo}>
                      <Text style={stil.yanitNoYazi}>{i + 1}</Text>
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      {!!y.soru && <Text style={stil.yanitSoru}>{y.soru}</Text>}
                      <Text style={stil.yanitCevap}>{y.cevap}</Text>

                      {!!y.aciklama && (
                        <Text style={stil.yanitAciklama}>{y.aciklama}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </Kart>
            )}

            {!!kayit.aciklama && (
              <Kart baslik="Personelin açıklaması">
                <Text style={stil.aciklama}>{kayit.aciklama}</Text>
              </Kart>
            )}

            {/* Aynı cihazda daha önce açılmış kayıtlar: tekrar eden arıza
                tek tek bakıldığında görünmüyordu. */}
            {veri.cihazGecmisi?.length > 0 && (
              <Kart baslik="Bu cihazın geçmiş kayıtları">
                {veri.cihazGecmisi.map((g) => (
                  <View key={g.id} style={stil.gecmis}>
                    <Text style={stil.gecmisYazi} numberOfLines={2}>
                      #{g.id} · {g.akisOzet || g.baslik}
                    </Text>
                    <Text style={stil.gecmisAlt}>
                      {DURUMLAR[g.durum]?.ad ?? g.durum} · {tarihYaz(g.olusturma)}
                    </Text>
                  </View>
                ))}
              </Kart>
            )}

            {veri.gorseller?.length > 0 && (
              <Kart baslik="Fotoğraflar">
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {veri.gorseller.map((g) => (
                    <Image
                      key={g}
                      source={{ uri: arizaGorselAdresi(g) }}
                      style={stil.gorsel}
                    />
                  ))}
                </ScrollView>
              </Kart>
            )}

            {temsilci && kayit.durum !== "kapandi" && (
              <Kart baslik="Durum">
                <View style={stil.dugmeler}>
                  {kayit.durum === "acik" && (
                    <DurumDugmesi
                      ad="Başladım"
                      pasif={isleniyor}
                      bas={() => durumDegistir("devam")}
                    />
                  )}

                  {kayit.durum !== "beklemede" && kayit.durum !== "cozuldu" && (
                    <DurumDugmesi
                      ad="Beklemede"
                      pasif={isleniyor}
                      bas={() => durumDegistir("beklemede")}
                    />
                  )}

                  {kayit.durum !== "cozuldu" && (
                    <DurumDugmesi
                      ad="Çözüldü"
                      pasif={isleniyor}
                      bas={() => durumDegistir("cozuldu")}
                    />
                  )}

                  <DurumDugmesi
                    ad="Kapat"
                    kapat
                    pasif={isleniyor}
                    bas={() => durumDegistir("kapandi")}
                  />
                </View>
              </Kart>
            )}

            <Kart baslik={`Yorumlar (${veri.yorumlar?.length ?? 0})`}>
              {(veri.yorumlar ?? []).length === 0 && (
                <Text style={stil.bosYorum}>Henüz yorum yok.</Text>
              )}

              {(veri.yorumlar ?? []).map((y) => (
                <View
                  key={y.id}
                  style={[
                    stil.yorum,
                    y.icNot && stil.yorumIcNot,
                    y.cozum && stil.yorumCozum,
                  ]}
                >
                  <View style={stil.yorumUst}>
                    <Text style={stil.yorumYazan}>{y.yazanAdi ?? "—"}</Text>
                    {y.icNot && <Rozet metin="İç not" tur="turuncu" />}
                    {y.cozum && <Rozet metin="Çözüm" tur="yesil" />}
                  </View>

                  <Text style={stil.yorumMetin}>{y.metin}</Text>
                  <Text style={stil.yorumTarih}>{tarihYaz(y.olusturma)}</Text>
                </View>
              ))}

              <TextInput
                style={[stil.girdi, stil.uzunGirdi]}
                placeholder="Yorum yazınız"
                placeholderTextColor={renk.pasif}
                value={yorum}
                onChangeText={setYorum}
                multiline
              />

              {temsilci && (
                <TouchableOpacity
                  style={stil.kutucuk}
                  onPress={() => setIcNot(!icNot)}
                >
                  <View style={[stil.kutu, icNot && stil.kutuSecili]} />
                  <Text style={stil.kutucukYazi}>
                    İç not — kaydı açana gösterilmez
                  </Text>
                </TouchableOpacity>
              )}

              <View style={stil.dugmeler}>
                <TouchableOpacity
                  style={[
                    stil.dugme,
                    { flex: 1 },
                    (isleniyor || !yorum.trim()) && stil.pasifDugme,
                  ]}
                  disabled={isleniyor || !yorum.trim()}
                  onPress={() => yorumGonder(false)}
                >
                  <Text style={stil.dugmeYazi}>Gönder</Text>
                </TouchableOpacity>

                {temsilci && kayit.durum !== "cozuldu" && kayit.durum !== "kapandi" && (
                  <TouchableOpacity
                    style={[
                      stil.kucukDugme,
                      (isleniyor || !yorum.trim()) && stil.pasifDugme,
                    ]}
                    disabled={isleniyor || !yorum.trim()}
                    onPress={() => yorumGonder(true)}
                  >
                    <Text style={stil.kucukDugmeYazi}>Çözüm olarak</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Kart>

            <Kart baslik="Geçmiş">
              {(veri.hareketler ?? []).map((h, i) => (
                <View key={i} style={stil.hareket}>
                  <Text style={stil.hareketYazi}>
                    {h.aciklama || DURUMLAR[h.durum]?.ad || h.durum}
                  </Text>
                  <Text style={stil.hareketAlt}>
                    {tarihYaz(h.olusturma)}
                    {h.yapan ? ` · ${h.yapan}` : ""}
                  </Text>
                </View>
              ))}
            </Kart>
          </ScrollView>
        ) : null}
      </View>
    
      {servisFormuDurumu ? (
        <ServisFormu
          arizaId={id}
          envanterId={kayit?.envanterId ?? null}
          yeniDurum={servisFormuDurumu}
          kapat={() => setServisFormuDurumu(null)}
          kaydedildi={servisFormuKaydedildi}
        />
      ) : null}
</Modal>
  );
}

/**
 * 5321112233 → 0532 111 22 33
 *
 * Aramaya ham numara gidiyor, ekranda okunur hâli duruyor: bitişik on
 * hane telefonda doğru okunduğundan emin olunamıyordu.
 */
function telefonYaz(ham) {
  const r = String(ham ?? "").replace(/\D/g, "");

  if (r.length !== 10) return ham;

  return `0${r.slice(0, 3)} ${r.slice(3, 6)} ${r.slice(6, 8)} ${r.slice(8)}`;
}

/** Ad ve değer; değeri olmayan satır hiç çizilmiyor. */
function KunyeSatiri({ ad, deger }) {
  if (!deger) return null;

  return (
    <View style={stil.kunyeSatiri}>
      <Text style={stil.kunyeAd}>{ad}</Text>
      <Text style={stil.kunyeDeger}>{deger}</Text>
    </View>
  );
}

function DurumDugmesi({ ad, bas, pasif, kapat }) {
  return (
    <TouchableOpacity
      style={[stil.kucukDugme, kapat && stil.kapatDugme, pasif && stil.pasifDugme]}
      disabled={pasif}
      onPress={bas}
    >
      <Text style={[stil.kucukDugmeYazi, kapat && stil.kapatYazi]}>{ad}</Text>
    </TouchableOpacity>
  );
}

/* ========================================================================== */
/* Yeni kayıt                                                                 */
/* ========================================================================== */

/**
 * Adım adım kayıt açma.
 *
 * Personel eskiden tek bir başlık yazıp bitiriyordu ("kasam çalışmıyor") ve
 * teknisyen mağazaya gidene kadar neyin bozulduğunu bilmiyordu. Artık
 * panelde tanımlanan akış soruluyor:
 *
 *     Yazarkasa › Fiş yazıcı › Silik çıkarıyor
 *
 * Her ekranda tek bir soru var. Uzun tek sayfalık formda personel alanları
 * atlıyor, sonda hangi zorunlu alanın eksik kaldığını bulamıyordu. Üstteki
 * yol yazısına ya da geri düğmesine basıp önceki adıma dönülebiliyor;
 * dönülünce o adımdan sonrası siliniyor — yanlış dalda verilmiş cevapların
 * kayda karışmaması için.
 *
 * Akışı tanımlanmamış türlerde eski serbest form (başlık + açıklama)
 * olduğu gibi duruyor: akış tanımlanana kadar o türe kayıt açılamaz hâle
 * gelmemeli.
 */
function YeniKayit({ form, tamamlandi, hazirCihaz, hazirCihazAdi }) {
  /* departman → tur → akis → detay */
  const [asama, setAsama] = useState("departman");

  const [departmanId, setDepartmanId] = useState(null);
  const [turId, setTurId] = useState(null);

  const [akis, setAkis] = useState(null);
  const [akisYukleniyor, setAkisYukleniyor] = useState(false);

  /* Yapılan seçimler, sunucunun beklediği sırayla. Çoklu seçimde aynı üst
     adıma bağlı birden fazla satır arka arkaya duruyor. */
  const [yol, setYol] = useState([]);

  /* Çoklu adımda henüz onaylanmamış işaretlemeler */
  const [cokluSecim, setCokluSecim] = useState([]);

  const [envanterId, setEnvanterId] = useState(hazirCihaz ?? null);
  const [oncelik, setOncelik] = useState("orta");
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");

  /* Adım kimliği → personelin yazdığı açıklama */
  const [aciklamalar, setAciklamalar] = useState({});

  const [fotograflar, setFotograflar] = useState([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const [kameraAcik, setKameraAcik] = useState(false);
  const [izin, izinIste] = useCameraPermissions();
  const kamera = useRef(null);

  /* Kaydın sonucu işletim sisteminin gri kutusu yerine uygulamanın kendi
     penceresinde gösteriliyor: personelin gördüğü tek geri bildirim bu ve
     kayıt numarası, akış özeti ve fotoğraf durumu bir arada okunmalı. */
  const [pencere, setPencere] = useState(null);

  const departmanlar = form?.departmanlar ?? [];

  /* Kategoriler departmana göre süzülüyor: departmana özel bir kategori
     başka departmanın kaydında görünmemeli. Departmanı boş olanlar genel. */
  const turler = !departmanId
    ? []
    : (form?.turler ?? []).filter(
        (t) => !t.departmanId || t.departmanId === departmanId
      );

  const tur = (form?.turler ?? []).find((t) => t.id === turId) ?? null;

  /* Tek departman varsa sormanın anlamı yok; doğrudan tür adımına. */
  const departmanSec = (id) => {
    setDepartmanId(id);
    setTurId(null);
    setAkis(null);
    setYol([]);
    setCokluSecim([]);
    setAsama(id ? "tur" : "departman");
  };

  const turSec = async (secilen) => {
    setTurId(secilen.id);
    setYol([]);
    setCokluSecim([]);
    setAciklamalar({});
    setEnvanterId(null);

    if (!secilen.akisVar) {
      setAkis(null);
      setAsama("detay");
      return;
    }

    setAkisYukleniyor(true);

    try {
      const veri = await arizaAkisAl(secilen.id);

      setAkis(veri);

      /* Akış tanımlı görünüyor ama etkin adım kalmamışsa (hepsi pasife
         alınmış olabilir) serbest forma düşülüyor; boş bir soru ekranında
         bırakmak kaydı hiç açtırmazdı. */
      setAsama((veri?.adimlar ?? []).length > 0 ? "akis" : "detay");
    } catch (h) {
      setAkis(null);
      setAsama("detay");
      Alert.alert("Sorular alınamadı", `${h.message} Kaydı açıklama yazarak açabilirsiniz.`);
    } finally {
      setAkisYukleniyor(false);
    }
  };

  /* ---------------------------------------------------------------- akış */

  const sonSecim = yol.length > 0 ? yol[yol.length - 1].adim : null;
  const secenekler = (sonSecim ? sonSecim.cocuklar : akis?.adimlar) ?? [];

  const suSoru = sonSecim
    ? sonSecim.soru || "Hangisi?"
    : akis?.soru || "Hangisi?";

  const cokluMu = !!sonSecim?.coklu;

  /** Son seviyedeki seçimleri atar; geri dönünce alt dal da temizlenmeli. */
  const sonSeviyeyiAt = () =>
    setYol((o) => {
      if (o.length === 0) return o;

      const ust = o[o.length - 1].adim.ustId ?? null;
      let i = o.length;

      while (i > 0 && (o[i - 1].adim.ustId ?? null) === ust) i -= 1;

      return o.slice(0, i);
    });

  const secenekSec = (adim) => {
    if (cokluMu) {
      setCokluSecim((o) =>
        o.some((x) => x.id === adim.id)
          ? o.filter((x) => x.id !== adim.id)
          : [...o, adim]
      );
      return;
    }

    const yeniYol = [...yol, { adim }];

    setYol(yeniYol);
    setCokluSecim([]);

    /* Alt seçeneği kalmadıysa akış bitti; ayrıntı ekranına geçiliyor. */
    setAsama((adim.cocuklar ?? []).length > 0 ? "akis" : "detay");
  };

  /* Çoklu seçim akışın sonu: iki seçenek işaretlendikten sonra hangisinin
     altına inileceği belirsiz kalırdı. Sunucu da böyle doğruluyor. */
  const cokluBitir = () => {
    if (cokluSecim.length === 0)
      return Alert.alert("Eksik", "En az bir seçenek işaretleyiniz.");

    setYol((o) => [...o, ...cokluSecim.map((adim) => ({ adim }))]);
    setCokluSecim([]);
    setAsama("detay");
  };

  const geri = () => {
    if (asama === "detay") {
      if (akis && yol.length > 0) {
        sonSeviyeyiAt();
        setCokluSecim([]);
        setAsama("akis");
      } else {
        setAsama("tur");
      }
      return;
    }

    if (asama === "akis") {
      if (yol.length > 0) {
        sonSeviyeyiAt();
        setCokluSecim([]);
      } else {
        setAsama("tur");
      }
      return;
    }

    if (asama === "tur") setAsama(departmanlar.length > 1 ? "departman" : "tur");
  };

  /* ------------------------------------------------------- akıştan gelen */

  const secilenler = yol.map((y) => y.adim);
  const tersi = [...secilenler].reverse();

  const akisCihazTuru = tersi.find((a) => a.cihazTuru)?.cihazTuru ?? null;
  const akisOncelik = tersi.find((a) => a.oncelik)?.oncelik ?? null;

  const gorselZorunlu = secilenler.some((a) => a.gorselZorunlu);
  const gorselIstenen = secilenler.some((a) => a.gorselIster || a.gorselZorunlu);

  const aciklamaIsteyenler = secilenler.filter(
    (a) => a.aciklamaIster || a.aciklamaZorunlu
  );

  /* Son seçimin kendi açıklama kutusu yoksa serbest açıklama onun adını
     taşıyor: "Ek açıklama" başlığı, personelin oraya ne yazacağını
     anlamamasına yol açıyordu. */
  const sonSecilen = secilenler[secilenler.length - 1] ?? null;

  const aciklamaBasligi =
    sonSecilen && !aciklamaIsteyenler.some((a) => a.id === sonSecilen.id)
      ? `${sonSecilen.ad} — açıklama`
      : "Ek açıklama";

  /** "Yazarkasa › Fiş yazıcı › Silik çıkarıyor + Kâğıt sıkışıyor" */
  const ozet = (() => {
    const parcalar = [];

    yol.forEach((y, i) => {
      const kardes =
        i > 0 && (y.adim.ustId ?? null) === (yol[i - 1].adim.ustId ?? null);

      if (kardes) parcalar[parcalar.length - 1] += ` + ${y.adim.ad}`;
      else parcalar.push(y.adim.ad);
    });

    return parcalar.join(" › ");
  })();

  /* Cihaz listesi: akıştaki tür varsa ona, yoksa kategorinin cihaz
     türlerine göre süzülüyor. Otuz dört şubenin envanteri değil, yalnızca
     kişinin kendi mağazasınınki geliyor. */
  const turCihazTurleri = (tur?.cihazTurleri ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  /* Kategorinin cihaz türü tanımlı değilse, kategoriyle aynı adı taşıyan
     cihaz türü aranıyor (envanterde tür olarak arıza kategorisi seçilebiliyor).
     Mağazada öyle bir cihaz yoksa liste eskisi gibi tümünü gösteriyor. */
  const kategoriAdi = (tur?.ad ?? "").trim().toLowerCase();
  const tumCihazlar = form?.cihazlar ?? [];
  const adaGoreVar =
    !!kategoriAdi &&
    tumCihazlar.some((c) => (c.tur ?? "").trim().toLowerCase() === kategoriAdi);

  const cihazlar = tumCihazlar.filter((c) => {
    const cihazTuru = (c.tur ?? "").trim().toLowerCase();

    if (akisCihazTuru) return cihazTuru === akisCihazTuru.trim().toLowerCase();
    if (turCihazTurleri.length > 0) return turCihazTurleri.includes(cihazTuru);
    if (adaGoreVar) return cihazTuru === kategoriAdi;

    return true;
  });

  const cihazZorunlu = !!akisCihazTuru && cihazlar.length > 0;

  /* ------------------------------------------------------------- gönder */

  const cek = async () => {
    if (!izin?.granted) {
      const sonuc = await izinIste();

      if (!sonuc.granted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Fotoğraf ekleyebilmek için kamera izni veriniz."
        );
        return;
      }
    }

    setKameraAcik(true);
  };

  const yakala = async () => {
    try {
      const foto = await kamera.current?.takePictureAsync({ quality: 0.6 });
      if (foto?.uri) setFotograflar((o) => [...o, foto.uri]);
    } catch {
      Alert.alert("Çekilemedi", "Fotoğraf alınamadı, tekrar deneyiniz.");
    } finally {
      setKameraAcik(false);
    }
  };

  const gonder = async () => {
    if (!departmanId) return Alert.alert("Eksik", "Departman seçiniz.");

    /* Akış zorunluysa yarım bırakılmış kayıt kabul edilmiyor. Sunucu da
       aynı denetimi yapıyor; buradaki, personeli fotoğraf çektikten sonra
       geri göndermemek için. */
    if (akis && tur?.akisZorunlu && yol.length === 0)
      return Alert.alert("Eksik", "Arıza türü için soruları yanıtlayınız.");

    if (!akis?.adimlar?.length && !baslik.trim())
      return Alert.alert("Eksik", "Başlık giriniz.");

    for (const a of aciklamaIsteyenler) {
      if (a.aciklamaZorunlu && !(aciklamalar[a.id] ?? "").trim())
        return Alert.alert("Eksik", `"${a.ad}" için açıklama yazınız.`);
    }

    if (cihazZorunlu && !envanterId)
      return Alert.alert("Eksik", "Arızalı cihazı seçiniz.");

    /* Fotoğraf kayıttan sonra yükleniyor; zorunluluk burada denetleniyor.
       Sunucuda denetlenseydi kayıt açılmaz, çekilen fotoğraflar da
       kaybolurdu. */
    if (gorselZorunlu && fotograflar.length === 0)
      return Alert.alert("Eksik", "Bu arıza için en az bir fotoğraf gerekiyor.");

    setGonderiliyor(true);

    try {
      const sonuc = await arizaAc({
        departmanId,
        turId: turId ?? 0,
        envanterId: envanterId ?? 0,

        /* Akış varsa başlığı sunucu özetten yazıyor */
        baslik: yol.length > 0 ? null : baslik.trim(),

        aciklama: aciklama.trim() || null,
        oncelik: akisOncelik ?? oncelik,

        /* Yalnızca adım kimliği ve açıklama gidiyor; soru ve cevap
           metinlerini sunucu kendi tablosundan yazıyor. */
        yanitlar: yol.map((y) => ({
          adimId: y.adim.id,
          aciklama: (aciklamalar[y.adim.id] ?? "").trim() || null,
        })),
      });

      /* Fotoğraflar kayıttan sonra yükleniyor. Biri yüklenemezse kayıt
         yine duruyor; sunucunun söylediği sebep olduğu gibi gösteriliyor.
         "Fotoğraf yüklenemedi" tek başına, klasör izni mi yetki mi boyut
         mu ayırt ettirmiyor ve sorun günlerce sürüyordu. */
      let eksik = 0;
      let sebep = null;

      for (const uri of fotograflar) {
        try {
          await arizaGorselYukle(sonuc.id, uri);
        } catch (h) {
          eksik += 1;
          sebep = sebep ?? h.message;
        }
      }

      const kunye = [
        `Kayıt no: #${sonuc.id}`,
        departmanlar.find((d) => d.id === departmanId)?.ad
          ? `Departman: ${departmanlar.find((d) => d.id === departmanId).ad}`
          : null,
        ozet ? `Arıza: ${ozet}` : null,
        fotograflar.length > 0
          ? `Fotoğraf: ${fotograflar.length - eksik}/${fotograflar.length} yüklendi`
          : null,
      ].filter(Boolean);

      setPencere({
        tur: eksik > 0 ? "uyari" : "basari",
        baslik: eksik > 0 ? "Kayıt açıldı, fotoğraf eklenemedi" : "Kaydınız açıldı",
        metin:
          eksik > 0
            ? sebep ?? "Fotoğraflar yüklenemedi, kaydın kendisi oluşturuldu."
            : "Kaydınız ilgili departmana iletildi. Durumunu Kayıtlar sekmesinden izleyebilirsiniz.",
        satirlar: kunye,
        kapatilamaz: true,
        dugmeler: [
          {
            ad: "Tamam",
            bas: () => {
              setPencere(null);
              tamamlandi();
            },
          },
        ],
      });
    } catch (h) {
      Alert.alert("Açılamadı", h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  /* ---------------------------------------------------------------- ekran */

  const basliklar = [
    departmanlar.find((d) => d.id === departmanId)?.ad,
    tur?.ad,
    ...(ozet ? [ozet] : []),
  ].filter(Boolean);

  const geriGorunsun =
    asama !== "departman" && !(asama === "tur" && departmanlar.length <= 1);

  return (
    <ScrollView contentContainerStyle={stil.icerik} keyboardShouldPersistTaps="handled">
      {basliklar.length > 0 && (
        <View style={stil.yolCubugu}>
          {geriGorunsun && (
            <TouchableOpacity
              onPress={geri}
              style={stil.yolGeri}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Simge ad="ok" boyut={16} renkli={renk.yesilKoyu} />
            </TouchableOpacity>
          )}

          <Text style={stil.yolYazi} numberOfLines={2}>
            {basliklar.join(" › ")}
          </Text>
        </View>
      )}

      {asama === "departman" && (
        <Kart baslik="Arıza hangi birimi ilgilendiriyor?">
          <Sirali
            secenekler={departmanlar}
            sec={(d) => departmanSec(d.id)}
          />
        </Kart>
      )}

      {asama === "tur" && (
        <>
          <Kart baslik="Arıza türü">
            {turler.length === 0 ? (
              <Text style={stil.ipucu}>
                Bu departman için tanımlı arıza türü yok. Aşağıdan devam edip
                açıklama yazarak kayıt açabilirsiniz.
              </Text>
            ) : (
              <Sirali
                secenekler={turler.map((t) => ({
                  ...t,
                  ad: t.departmanId ? t.ad : `${t.ad} · genel`,
                  alt: t.akisVar
                    ? "Birkaç soru sorulacak"
                    : t.aciklama || "Serbest bildirim",
                }))}
                sec={turSec}
              />
            )}

            {akisYukleniyor && (
              <View style={{ paddingVertical: 12 }}>
                <ActivityIndicator color={renk.yesil} />
              </View>
            )}
          </Kart>

          {turler.length === 0 && (
            <TouchableOpacity style={stil.dugme} onPress={() => setAsama("detay")}>
              <Text style={stil.dugmeYazi}>Tür seçmeden devam et</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {asama === "akis" && (
        <>
          <Kart baslik={`Adım ${yol.length + 1}`}>
            <Text style={stil.soru}>{suSoru}</Text>

            {!!sonSecim?.ipucu && <Text style={stil.ipucu}>{sonSecim.ipucu}</Text>}

            {cokluMu && (
              <Text style={stil.ipucu}>
                Birden fazla seçebilirsiniz.
              </Text>
            )}

            <Sirali
              secenekler={secenekler}
              secililer={cokluMu ? cokluSecim.map((x) => x.id) : []}
              sec={secenekSec}
            />
          </Kart>

          {cokluMu && (
            <TouchableOpacity
              style={[stil.dugme, cokluSecim.length === 0 && stil.pasifDugme]}
              disabled={cokluSecim.length === 0}
              onPress={cokluBitir}
            >
              <Text style={stil.dugmeYazi}>
                Devam ({cokluSecim.length} seçili)
              </Text>
            </TouchableOpacity>
          )}

          {!tur?.akisZorunlu && (
            <TouchableOpacity style={stil.atlaDugme} onPress={() => setAsama("detay")}>
              <Text style={stil.atlaYazi}>Bu adımı atla</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {asama === "detay" && (
        <>
          {!!ozet && (
            <Kart baslik="Bildiriminiz">
              <Text style={stil.ozetYazi}>{ozet}</Text>

              <Text style={stil.ipucu}>
                Değiştirmek için yukarıdaki geri okuna basınız.
              </Text>
            </Kart>
          )}

          {aciklamaIsteyenler.map((a) => (
            <Kart
              key={a.id}
              baslik={a.aciklamaZorunlu ? `${a.ad} — açıklama (zorunlu)` : `${a.ad} — açıklama`}
            >
              <TextInput
                style={[stil.girdi, stil.uzunGirdi]}
                placeholder="Ne olduğunu kısaca yazınız"
                placeholderTextColor={renk.pasif}
                value={aciklamalar[a.id] ?? ""}
                onChangeText={(m) => setAciklamalar((o) => ({ ...o, [a.id]: m }))}
                multiline
              />
            </Kart>
          ))}

          {/* Akışı olmayan türlerde eski serbest form */}
          {yol.length === 0 && (
            <Kart baslik="Arıza">
              <TextInput
                style={stil.girdi}
                placeholder="Kısa başlık"
                placeholderTextColor={renk.pasif}
                value={baslik}
                onChangeText={setBaslik}
                maxLength={150}
              />
            </Kart>
          )}

          {cihazlar.length > 0 && (
            <Kart
              baslik={
                akisCihazTuru
                  ? `Hangi ${akisCihazTuru}?${cihazZorunlu ? " (zorunlu)" : ""}`
                  : "Cihaz"
              }
            >
              <Secim
                secenekler={cihazlar.map((c) => ({
                  id: c.id,
                  ad:
                    [c.tur, c.marka, c.model].filter(Boolean).join(" ") ||
                    c.seriNo ||
                    c.sicilNo ||
                    "Cihaz",
                }))}
                secili={envanterId}
                sec={setEnvanterId}
              />

              <Text style={stil.ipucu}>
                Mağazanızda kayıtlı cihazlar listeleniyor.
              </Text>
            </Kart>
          )}

          <Kart baslik={aciklamaBasligi}>
            <TextInput
              style={[stil.girdi, stil.uzunGirdi]}
              placeholder={
                aciklamaBasligi === "Ek açıklama"
                  ? "Eklemek istediğiniz bir şey varsa yazınız"
                  : "Kısaca ne olduğunu yazınız"
              }
              placeholderTextColor={renk.pasif}
              value={aciklama}
              onChangeText={setAciklama}
              multiline
            />
          </Kart>

          {akisOncelik ? (
            <Kart baslik="Öncelik">
              <Rozet
                metin={ONCELIKLER[akisOncelik]?.ad ?? akisOncelik}
                tur={ONCELIKLER[akisOncelik]?.tur ?? "gri"}
              />
              <Text style={stil.ipucu}>
                Seçtiğiniz arızaya göre belirlendi.
              </Text>
            </Kart>
          ) : (
            <Kart baslik="Öncelik">
              <Secim
                secenekler={Object.entries(ONCELIKLER).map(([id, o]) => ({
                  id,
                  ad: o.ad,
                }))}
                secili={oncelik}
                sec={(d) => setOncelik(d ?? "orta")}
              />
            </Kart>
          )}

          <Kart baslik={gorselZorunlu ? "Fotoğraf (zorunlu)" : "Fotoğraf"}>
            {gorselIstenen && (
              <Text style={stil.ipucu}>
                {gorselZorunlu
                  ? "Bu arıza için en az bir fotoğraf gerekiyor."
                  : "Sorunun fotoğrafı işi hızlandırıyor."}
              </Text>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {fotograflar.map((u, i) => (
                <TouchableOpacity
                  key={i}
                  onLongPress={() =>
                    setFotograflar((o) => o.filter((_, j) => j !== i))
                  }
                >
                  <Image source={{ uri: u }} style={stil.gorsel} />
                </TouchableOpacity>
              ))}

              <TouchableOpacity style={stil.fotoEkle} onPress={cek}>
                <Simge ad="uyari" boyut={22} renkli={renk.yesilKoyu} />
                <Text style={stil.fotoEkleYazi}>Ekle</Text>
              </TouchableOpacity>
            </ScrollView>

            {fotograflar.length > 0 && (
              <Text style={stil.ipucu}>Kaldırmak için fotoğrafa basılı tutunuz.</Text>
            )}
          </Kart>

          <TouchableOpacity
            style={[stil.dugme, gonderiliyor && stil.pasifDugme]}
            disabled={gonderiliyor}
            onPress={gonder}
          >
            {gonderiliyor ? (
              <ActivityIndicator color={renk.beyaz} />
            ) : (
              <Text style={stil.dugmeYazi}>Kaydı aç</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      <Pencere veri={pencere} kapat={() => setPencere(null)} />

      <Modal visible={kameraAcik} animationType="slide">
        <View style={stil.kamera}>
          <CameraView ref={kamera} style={{ flex: 1 }} facing="back" />

          <View style={stil.kameraAlt}>
            <TouchableOpacity onPress={() => setKameraAcik(false)}>
              <Text style={stil.kameraVazgec}>Vazgeç</Text>
            </TouchableOpacity>

            <TouchableOpacity style={stil.deklansor} onPress={yakala} />

            <View style={{ width: 60 }} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/**
 * Alt alta, tam genişlikte seçenek listesi.
 *
 * Yan yana dizilen küçük etiketler yerine: seçenek metinleri uzun
 * ("Fiş çıkmıyor ama kesme yapıyor") ve dar ekranda satır ortasından
 * bölünüp okunmaz hâle geliyordu. Dokunma alanı da büyüdü.
 */
function Sirali({ secenekler, secililer = [], sec }) {
  return (
    <View>
      {secenekler.map((s) => {
        const secili = secililer.includes(s.id);

        return (
          <TouchableOpacity
            key={s.id}
            style={[stil.siraliSatir, secili && stil.siraliSecili]}
            activeOpacity={0.7}
            onPress={() => sec(s)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[stil.siraliYazi, secili && stil.siraliYaziSecili]}>
                {s.ad}
              </Text>

              {!!s.alt && <Text style={stil.siraliAlt}>{s.alt}</Text>}
            </View>

            <View style={[stil.siraliKutu, secili && stil.siraliKutuSecili]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Tek seçimlik etiket listesi; öncelik ve cihaz gibi kısa seçenekler için. */
function Secim({ secenekler, secili, sec }) {
  return (
    <View style={stil.secimler}>
      {secenekler.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[stil.secim, secili === s.id && stil.secimSecili]}
          onPress={() => sec(secili === s.id ? null : s.id)}
        >
          <Text style={[stil.secimYazi, secili === s.id && stil.secimYaziSecili]}>
            {s.ad}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* ========================================================================== */

const stil = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },

  sekmeler: {
    flexDirection: "row",
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  sekme: { flex: 1, paddingTop: 6, paddingBottom: 13, alignItems: "center" },
  sekmeSecili: { borderBottomWidth: 2, borderBottomColor: renk.yesil },
  sekmeYazi: { fontSize: 14, color: renk.pasif, fontWeight: "600" },
  sekmeYaziSecili: { color: renk.yesilKoyu },

  icerik: { padding: olcu.bosluk, paddingBottom: 40 },

  /* --------------------------------------------------------------- özet */
  ozet: {
    flexDirection: "row",
    gap: 8,
    marginBottom: olcu.kucukBosluk,
  },
  ozetKutu: {
    flex: 1,
    backgroundColor: renk.beyaz,
    borderRadius: olcu.yuvarlak,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  ozetDeger: { fontSize: 19, fontWeight: "700", color: renk.metin },
  ozetAd: { fontSize: 11, color: renk.pasif, marginTop: 2 },

  /* ------------------------------------------------------------ kapsam */
  kapsamlar: {
    flexDirection: "row",
    backgroundColor: renk.beyaz,
    borderRadius: olcu.yuvarlak,
    padding: 3,
    marginBottom: olcu.kucukBosluk,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  kapsam: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  kapsamSecili: { backgroundColor: renk.yesilAcik },
  kapsamYazi: { fontSize: 13, color: renk.pasif, fontWeight: "600" },
  kapsamYaziSecili: { color: renk.yesilKoyu },

  /* ------------------------------------------------------------ süzgeç */
  suzgecler: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  suzgec: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  suzgecSecili: { backgroundColor: renk.yesilAcik, borderColor: renk.yesil },
  suzgecYazi: { fontSize: 13, color: renk.metin },
  suzgecYaziSecili: { color: renk.yesilKoyu, fontWeight: "600" },

  /* ------------------------------------------------------------- liste */
  satirUst: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  baslik: { ...yazi.baslik, fontSize: 15, flex: 1 },
  alt: { fontSize: 13, color: renk.metin, marginTop: 4 },
  tarih: { fontSize: 12, color: renk.pasif, marginTop: 4 },
  rozetler: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },

  /* ----------------------------------------------------------- ayrıntı */
  baslikCubugu: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  kapatDokun: {
    width: 44,
    height: 44,
    justifyContent: "center",
    transform: [{ rotate: "180deg" }],
  },
  baslikYazi: { ...yazi.baslik, fontSize: 16 },
  detayBaslik: { ...yazi.baslik, fontSize: 16 },
  aciklama: { fontSize: 13.5, color: renk.metin, lineHeight: 20, marginTop: 10 },
  cihaz: { fontSize: 12.5, color: renk.pasif, marginTop: 8 },

  /* ------------------------------------------------------ ayrıntı künye */
  kunye: { marginTop: 10 },
  kunyeSatiri: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },
  kunyeAd: { width: 92, fontSize: 12, color: renk.pasif },
  kunyeDeger: { flex: 1, fontSize: 13, color: renk.metin, fontWeight: "600" },

  telefon: {
    fontSize: 14,
    color: renk.yesilKoyu,
    fontWeight: "700",
    textDecorationLine: "underline",
  },

  /* -------------------------------------------------------- akış yanıtları */
  ozetKutusu: {
    backgroundColor: renk.yesilAcik,
    borderWidth: 1,
    borderColor: "#d8ecc0",
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 10,
  },
  ozetKutusuYazi: { fontSize: 14, fontWeight: "700", color: "#4d6f1a", lineHeight: 20 },

  yanit: { flexDirection: "row", gap: 9, marginBottom: 11 },
  yanitNo: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: renk.yesil,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  yanitNoYazi: { fontSize: 11, fontWeight: "800", color: renk.beyaz },
  yanitSoru: { fontSize: 11.5, color: renk.pasif },
  yanitCevap: { fontSize: 14, fontWeight: "600", color: renk.metin, marginTop: 1 },
  yanitAciklama: {
    fontSize: 13,
    color: renk.metin,
    lineHeight: 19,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 9,
    backgroundColor: renk.zemin,
    borderLeftWidth: 3,
    borderLeftColor: renk.cizgi,
    borderRadius: 5,
  },

  gecmis: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },
  gecmisYazi: { fontSize: 13, color: renk.metin },
  gecmisAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 2 },

  hareket: { marginTop: 10 },
  hareketYazi: { fontSize: 13, color: renk.metin },
  hareketAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 2 },

  /* ----------------------------------------------------------- yorumlar */
  bosYorum: { fontSize: 13, color: renk.pasif, marginBottom: 8 },
  yorum: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: renk.zemin,
  },
  yorumIcNot: { backgroundColor: renk.turuncuAcik },
  yorumCozum: { backgroundColor: renk.yesilAcik },
  yorumUst: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  yorumYazan: { fontSize: 13, fontWeight: "600", color: renk.metin },
  yorumMetin: { fontSize: 13.5, color: renk.metin, lineHeight: 19 },
  yorumTarih: { fontSize: 11.5, color: renk.pasif, marginTop: 4 },

  kutucuk: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  kutu: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  kutuSecili: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  kutucukYazi: { fontSize: 12.5, color: renk.pasif, flex: 1 },

  /* ------------------------------------------------------------ görsel */
  gorsel: {
    width: 78,
    height: 78,
    borderRadius: 9,
    marginRight: 8,
    marginTop: 8,
    backgroundColor: renk.cizgi,
  },
  fotoEkle: {
    width: 78,
    height: 78,
    borderRadius: 9,
    marginTop: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: renk.yesil,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  fotoEkleYazi: { fontSize: 12, color: renk.yesilKoyu, fontWeight: "600" },
  ipucu: { fontSize: 11.5, color: renk.pasif, marginTop: 8 },

  /* ---------------------------------------------------------- akış yolu */

  /* Seçilen dal her ekranın üstünde duruyor: personel üçüncü adımda
     "ben neyi seçmiştim" diye geri gitmek zorunda kalıyordu. */
  yolCubugu: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: renk.yesilAcik,
    borderWidth: 1,
    borderColor: "#d8ecc0",
    borderRadius: olcu.yuvarlak,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 11,
  },
  yolGeri: { transform: [{ rotate: "180deg" }] },
  yolYazi: { flex: 1, fontSize: 12.5, color: "#4d6f1a", lineHeight: 18 },

  soru: { fontSize: 15.5, fontWeight: "600", color: renk.metin, lineHeight: 22 },

  ozetYazi: { fontSize: 15, fontWeight: "700", color: renk.metin, lineHeight: 22 },

  atlaDugme: { alignItems: "center", paddingVertical: 12 },
  atlaYazi: { fontSize: 13, color: renk.pasif, textDecorationLine: "underline" },

  /* ------------------------------------------------------ sıralı seçenek */

  /* Tam genişlikte satırlar: seçenek metinleri uzun olabiliyor ve yan yana
     dizilen küçük etiketler dar ekranda satır ortasından bölünüyordu. */
  siraliSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    backgroundColor: renk.beyaz,
    paddingVertical: 13,
    paddingHorizontal: 13,
    marginTop: 8,
  },
  siraliSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  siraliYazi: { fontSize: 14.5, color: renk.metin, fontWeight: "600" },
  siraliYaziSecili: { color: renk.yesilKoyu },
  siraliAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 2 },
  siraliKutu: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  siraliKutuSecili: {
    backgroundColor: renk.yesil,
    borderColor: renk.yesil,
  },

  /* -------------------------------------------------------------- form */
  secimler: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secim: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  secimSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  secimYazi: { fontSize: 13, color: renk.metin },
  secimYaziSecili: { color: renk.yesilKoyu, fontWeight: "600" },

  girdi: {
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: renk.metin,
    backgroundColor: renk.beyaz,
    marginBottom: 9,
  },
  uzunGirdi: { minHeight: 90, textAlignVertical: "top" },

  /* ------------------------------------------------------------ düğme */
  dugme: {
    backgroundColor: renk.yesil,
    borderRadius: 11,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: olcu.kucukBosluk,
  },
  dugmeYazi: { color: renk.beyaz, fontSize: 15, fontWeight: "700" },
  pasifDugme: { opacity: 0.5 },

  dugmeler: {
    flexDirection: "row",
    gap: 8,
    marginTop: olcu.kucukBosluk,
    flexWrap: "wrap",
    alignItems: "center",
  },
  kucukDugme: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: renk.yesilAcik,
    borderWidth: 1,
    borderColor: renk.yesil,
  },
  kucukDugmeYazi: { fontSize: 13, color: renk.yesilKoyu, fontWeight: "600" },
  kapatDugme: { backgroundColor: renk.turuncuAcik, borderColor: renk.turuncu },
  kapatYazi: { color: renk.turuncuKoyu },

  /* ------------------------------------------------------------ kamera */
  kamera: { flex: 1, backgroundColor: "#000" },
  kameraAlt: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 22,
    backgroundColor: "#000",
  },
  kameraVazgec: { color: renk.beyaz, fontSize: 15, width: 60 },
  deklansor: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: renk.beyaz,
    borderWidth: 4,
    borderColor: "#bbb",
  },
});

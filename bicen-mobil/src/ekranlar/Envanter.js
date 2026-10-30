/**
 * Envanter
 * ---------------------------------------------------------------------------
 * Personelin görebileceği cihazlar.
 *
 * Kapsam sunucuda belirleniyor: mağazada çalışan yalnızca kendi şubesini,
 * bir departmanın temsilcisi o departmanın bütün cihazlarını görüyor.
 * Ekranda kapsamın yazması gerekiyor; personel neden bazı cihazları
 * göremediğini sormasın.
 *
 * <p>
 * İki kademe: önce şube, sonra o şubenin cihazları. Binlerce cihazı tek
 * listede vermek telefonda kullanılamıyor.
 * </p>
 *
 * <p>
 * Cihaz kartı küçük tutuluyor ve ayrıntı dokununca açılan pencerede
 * duruyor. Her kartta ayrı bir "arıza kaydı aç" düğmesi varken otuz
 * cihazlı bir şubede otuz turuncu düğme alt alta diziliyor, liste iki
 * katı uzuyordu.
 * </p>
 */

import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran } from "../bilesenler/ModalAlani";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { api360, ADRES360 } from "../api360";
import { renk, olcu } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import Barkod from "../bilesenler/Barkod";
import BarBaslik from "../bilesenler/BarBaslik";

/* Karekod kitaplığı isteğe bağlı: kurulu değilse etiket barkodla
   gösteriliyor, ekran yine çalışıyor. */
let QRCode = null;

try {
  QRCode = require("react-native-qrcode-svg").default;
} catch {
  QRCode = null;
}

/* -------------------------------------------------------------------------- */

const tarihYaz = (deger) => {
  if (!deger) return "";

  const t = new Date(deger);

  if (Number.isNaN(t.getTime())) return "";

  const iki = (s) => String(s).padStart(2, "0");

  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
};

/** Bugüne göre kaç gün önce/sonra */
const gunFarki = (deger) =>
  Math.round((new Date(deger).getTime() - Date.now()) / 86400000);

/** Garanti bitişine kalan duruma göre rozet */
const garantiRozeti = (bitis) => {
  if (!bitis) return null;

  const gun = gunFarki(bitis);

  if (gun < 0) return { metin: "Garantisi bitti", tur: "gri" };
  if (gun <= 30) return { metin: `Garanti ${gun} gün`, tur: "turuncu" };

  return { metin: "Garantili", tur: "mavi" };
};

const cihazAdi = (c) =>
  [c?.marka, c?.model].filter(Boolean).join(" ") || c?.tur || "Adsız cihaz";

/** Durum kodları ekrandaki karşılıklarıyla */
const ARIZA_DURUMU = {
  acik: { ad: "Açık", renk: renk.turuncu },
  islemde: { ad: "İşlemde", renk: renk.mavi },
  beklemede: { ad: "Beklemede", renk: "#d48806" },
  cozuldu: { ad: "Çözüldü", renk: renk.yesilKoyu },
  kapandi: { ad: "Kapandı", renk: renk.pasif },
};

/* Durum süzgeçleri: teknik ekibin aradığı şey cihaz türü değil, sorunlu
   ya da garantisi bitmek üzere olan cihaz. */
const DURUMLAR = [
  { kod: "", ad: "Tümü" },
  { kod: "arizali", ad: "Açık arızalı" },
  { kod: "bitiyor", ad: "Garantisi bitiyor" },
  { kod: "bitti", ad: "Garantisi bitti" },
];

const SIRALAMALAR = [
  { kod: "arizali", ad: "Arızalılar önce" },
  { kod: "garanti", ad: "Garanti bitişine göre" },
  { kod: "marka", ad: "Marka / model" },
  { kod: "konum", ad: "Konuma göre" },
];

/* ========================================================================== */

export default function Envanter({ navigation }) {
  const [subeler, setSubeler] = useState(null);
  const [secilenSube, setSecilenSube] = useState(null);

  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [ara, setAra] = useState("");
  const [tur, setTur] = useState(null);
  const [durum, setDurum] = useState("");
  const [sira, setSira] = useState("arizali");

  const [suzgecAcik, setSuzgecAcik] = useState(false);
  const [kameraAcik, setKameraAcik] = useState(false);
  const [detay, setDetay] = useState(null);

  const [izin, izinIste] = useCameraPermissions();

  /** Şube listesi; ekran açılınca bir kez okunuyor */
  const subeleriGetir = useCallback(async () => {
    try {
      const c = await api360.al("/api/Mobil/EnvanterSubeleri");

      setSubeler(c);

      /* Yalnızca mağaza personelinde şube adımı atlanıyor: onun tek
         şubesi var ve seçtirmek gereksiz. Departman temsilcisinde liste
         her zaman gösteriliyor — bugün tek şubede cihaz olması yarın
         değişiyor ve ekranın davranışı buna göre değişmemeli. */
      if (c?.kapsam === "sube" && (c?.subeler ?? []).length === 1)
        setSecilenSube(c.subeler[0].subeKodu);

      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Şubeler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  /* Tür süzgeci sunucuya gönderilmiyor.

     Gönderildiğinde dönen listeden türetilen tür şeridi tek türe iniyor
     ve kullanıcı başka türe geçemiyordu. Arama sunucuda kalıyor: bütün
     alanlarda arıyor ve liste uzun. */
  const getir = useCallback(
    async (yenile = false) => {
      if (!secilenSube) return;

      if (yenile) setYenileniyor(true);

      try {
        const sorgu = new URLSearchParams();

        sorgu.set("sube", secilenSube);

        if (ara.trim()) sorgu.set("ara", ara.trim());

        setVeri(await api360.al(`/api/Mobil/Envanterim?${sorgu}`));
        setHata("");
      } catch (e) {
        setHata(e?.message ?? "Envanter alınamadı.");
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [secilenSube, ara]
  );

  useFocusEffect(
    useCallback(() => {
      if (!subeler) subeleriGetir();
    }, [subeler, subeleriGetir])
  );

  /* Arama yazarken her harfte istek atmamak için gecikme: reyonda
     bağlantı yavaş ve her tuşta sorgu ekranı kilitliyordu. */
  useEffect(() => {
    if (!secilenSube) return;

    const zamanlayici = setTimeout(() => getir(), ara.trim() ? 400 : 0);

    return () => clearTimeout(zamanlayici);
  }, [getir, ara, secilenSube]);

  const hepsi = veri?.kayitlar ?? [];
  const turler = veri?.turler ?? [];

  /* Süzgeç ve sıralama telefonda: liste zaten bir şubenin cihazları
     kadar ve her dokunuşta sunucuya gitmek reyonda yavaş. */
  const kayitlar = hepsi
    .filter((c) => {
      if (tur && c.tur !== tur) return false;

      const gun = c.garantiBitis ? gunFarki(c.garantiBitis) : null;

      if (durum === "arizali") return (c.acikAriza ?? 0) > 0;
      if (durum === "bitti") return gun !== null && gun < 0;
      if (durum === "bitiyor") return gun !== null && gun >= 0 && gun <= 30;

      return true;
    })
    .sort((a, b) => {
      const gunA = a.garantiBitis ? gunFarki(a.garantiBitis) : 99999;
      const gunB = b.garantiBitis ? gunFarki(b.garantiBitis) : 99999;

      if (sira === "arizali")
        return (b.acikAriza ?? 0) - (a.acikAriza ?? 0) || gunA - gunB;

      if (sira === "garanti") return gunA - gunB;

      if (sira === "konum")
        return (a.konum ?? "").localeCompare(b.konum ?? "", "tr");

      return cihazAdi(a).localeCompare(cihazAdi(b), "tr");
    });

  const arizaliSayi = hepsi.filter((c) => (c.acikAriza ?? 0) > 0).length;

  const garantisizSayi = hepsi.filter(
    (c) => c.garantiBitis && gunFarki(c.garantiBitis) < 0
  ).length;

  /* ----------------------------------------------------------- karekod */

  const kameraAc = async () => {
    if (!izin?.granted) {
      const sonuc = await izinIste();

      if (!sonuc?.granted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Cihaz etiketini okutmak için uygulamaya kamera izni veriniz."
        );

        return;
      }
    }

    setKameraAcik(true);
  };

  const kodOkundu = async (kod) => {
    setKameraAcik(false);

    try {
      const c = await api360.al(
        `/api/Mobil/EnvanterBul?kod=${encodeURIComponent(kod)}`
      );

      if (!c?.bulundu) {
        Alert.alert("Cihaz bulunamadı", c?.bilgi ?? "Kod eşleşmedi.");
        return;
      }

      /* Cihaz başka şubedeyse oraya geçiliyor: okutan kişi cihazın
         yanında duruyor, listeyi elle bulmasını beklemek gereksiz. */
      if (c.cihaz.subeKodu !== secilenSube) {
        setSecilenSube(c.cihaz.subeKodu);
        setVeri(null);
        setAra("");
      }

      detayAc(c.cihaz.id, c.cihaz);
    } catch (e) {
      Alert.alert("Cihaz bulunamadı", e?.message ?? "Tekrar deneyiniz.");
    }
  };

  /* ------------------------------------------------------------- detay */

  const detayAc = async (id, ozet) => {
    setDetay({ cihaz: ozet ?? hepsi.find((x) => x.id === id), gecmis: null });

    try {
      const c = await api360.al(`/api/Mobil/EnvanterArizalari/${id}`);

      setDetay((d) =>
        d && d.cihaz?.id === id ? { ...d, gecmis: c?.kayitlar ?? [] } : d
      );
    } catch {
      /* Geçmiş alınamazsa pencere yine açık kalıyor: künye ve arıza
         açma düğmesi geçmişe bağlı değil. */
      setDetay((d) => (d && d.cihaz?.id === id ? { ...d, gecmis: [] } : d));
    }
  };

  const arizaAc = (c) => {
    setDetay(null);

    navigation.navigate("Ariza", {
      envanterId: c.id,
      cihazAdi: cihazAdi(c),
    });
  };

  /* ========================================================================= */

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      {/* Şube seçiliyken başlıkta şube adı: hangi mağazaya baktığı
          listeyi kaydırınca da görünsün. Tek şubesi olan personelde
          gereksiz, orada ekranın adı yazıyor. */}
      <BarBaslik
        ad={secilenSube && subeler?.kapsam !== "sube" ? secilenSube : "Envanter"}
        acik
        kendi
      />

      {/* Şube seçilmemişken süzgeç gösterilmiyor: seçilecek şey cihaz
          değil şube ve arama kutusu yanıltıcı oluyordu. */}
      {secilenSube && (
        <View style={s.ustBar}>
          <View style={s.aramaSatir}>
            <View style={s.aramaKutu}>
              <Simge ad="kare" boyut={15} renkli={renk.pasif} />

              <TextInput
                style={s.arama}
                value={ara}
                onChangeText={setAra}
                placeholder="Marka, model, seri no ya da konum"
                placeholderTextColor="#c8ccc4"
              />

              {ara.length > 0 && (
                <TouchableOpacity onPress={() => setAra("")}>
                  <Text style={s.temizle}>temizle</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Etiket okutma: numarayı elle yazmak yavaştı ve bir hanesi
                yanlış girilince başka cihaza kayıt açılıyordu. */}
            <TouchableOpacity
              style={s.karekodDugme}
              onPress={kameraAc}
              activeOpacity={0.85}
            >
              <Simge ad="kare" boyut={21} renkli={renk.beyaz} dolgu />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.cipSerit}
          >
            {DURUMLAR.map((d) => {
              const say =
                d.kod === "arizali"
                  ? arizaliSayi
                  : d.kod === "bitti"
                  ? garantisizSayi
                  : d.kod === "bitiyor"
                  ? hepsi.filter((c) => {
                      const g = c.garantiBitis ? gunFarki(c.garantiBitis) : null;
                      return g !== null && g >= 0 && g <= 30;
                    }).length
                  : hepsi.length;

              if (d.kod && say === 0) return null;

              const secili = durum === d.kod;

              return (
                <TouchableOpacity
                  key={d.kod || "tumu"}
                  style={[
                    s.cip,
                    secili && s.cipSecili,
                    secili && d.kod === "arizali" && s.cipUyari,
                  ]}
                  onPress={() => setDurum(secili ? "" : d.kod)}
                >
                  <Text style={[s.cipYazi, secili && s.cipYaziSecili]}>
                    {d.ad}
                  </Text>

                  <View style={[s.cipSay, secili && s.cipSaySecili]}>
                    <Text style={[s.cipSayYazi, secili && s.cipYaziSecili]}>
                      {say}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {turler.map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.cip, tur === t && s.cipSecili]}
                onPress={() => setTur(tur === t ? null : t)}
              >
                <Text style={[s.cipYazi, tur === t && s.cipYaziSecili]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
        {yukleniyor ? (
          <Yukleniyor />
        ) : hata ? (
          <Hata metin={hata} />
        ) : !secilenSube ? (
          <SubeListesi
            veri={subeler}
            sec={(kod) => {
              setSecilenSube(kod);
              setVeri(null);
              setAra("");
              setTur(null);
              setDurum("");
            }}
          />
        ) : (
          <>
            {/* Şubeler arası dönüş: tek şubesi olan personelde
                gösterilmiyor, gidecek başka yer yok. */}
            {subeler?.kapsam !== "sube" && (
              <TouchableOpacity
                style={s.geriSatir}
                onPress={() => {
                  setSecilenSube(null);
                  setVeri(null);
                  setDurum("");
                  setTur(null);
                }}
              >
                <Simge ad="ok" boyut={15} renkli={renk.pasif} />
                <Text style={s.geriYazi}>Şube listesine dön</Text>
              </TouchableOpacity>
            )}

            {/* Üç sayı hem özet hem süzgeç: aynı bilgiyi bir kez yazıp
                ayrıca süzgeç şeridi koymak yer kaplıyordu. */}
            <View style={s.ozet}>
              <TouchableOpacity
                style={[s.ozetKutu, durum === "" && s.ozetSecili]}
                onPress={() => setDurum("")}
              >
                <Text style={s.ozetDeger}>{hepsi.length}</Text>
                <Text style={s.ozetAd}>CİHAZ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.ozetKutu, durum === "arizali" && s.ozetSecili]}
                onPress={() => setDurum(durum === "arizali" ? "" : "arizali")}
              >
                <Text style={[s.ozetDeger, { color: renk.turuncu }]}>
                  {arizaliSayi}
                </Text>
                <Text style={s.ozetAd}>ARIZALI</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.ozetKutu, durum === "bitti" && s.ozetSecili]}
                onPress={() => setDurum(durum === "bitti" ? "" : "bitti")}
              >
                <Text style={[s.ozetDeger, { color: renk.pasif }]}>
                  {garantisizSayi}
                </Text>
                <Text style={s.ozetAd}>GARANTİSİZ</Text>
              </TouchableOpacity>
            </View>

            <View style={s.baslikSatir}>
              <Text style={s.baslikYazi}>
                {kayitlar.length} cihaz
                {veri?.kapsam === "departman" ? " · departmanınızın" : ""}
              </Text>

              <TouchableOpacity
                style={s.siralaDugme}
                onPress={() => setSuzgecAcik(true)}
              >
                <Text style={s.siralaYazi}>
                  {SIRALAMALAR.find((x) => x.kod === sira).ad}
                </Text>
                <Simge ad="diger" boyut={13} renkli={renk.yesilKoyu} />
              </TouchableOpacity>
            </View>

            {kayitlar.length === 0 ? (
              <Bilgi>
                {ara.trim() || tur || durum
                  ? "Bu süzgeçte cihaz yok."
                  : "Görebileceğiniz kayıtlı cihaz bulunmuyor."}
              </Bilgi>
            ) : (
              kayitlar.map((c) => {
                const garanti = garantiRozeti(c.garantiBitis);

                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[s.kart, c.acikAriza > 0 && s.kartUyarili]}
                    activeOpacity={0.8}
                    onPress={() => detayAc(c.id)}
                  >
                    <View style={s.gorselKutu}>
                      {c.kapakId ? (
                        <Image
                          source={{
                            uri: `${ADRES360}/api/Envanter/Gorsel/${c.kapakId}`,
                          }}
                          style={s.gorsel}
                          resizeMode="cover"
                        />
                      ) : (
                        <Simge ad="kutu" boyut={24} renkli="#c2c8cf" dolgu />
                      )}
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.kartAd} numberOfLines={1}>
                        {cihazAdi(c)}
                      </Text>

                      <Text style={s.kartAlt} numberOfLines={1}>
                        {c.tur ?? "—"}
                        {c.konum ? ` · ${c.konum}` : ""}
                      </Text>

                      <View style={s.rozetler}>
                        {c.acikAriza > 0 && (
                          <Rozet
                            metin={`${c.acikAriza} açık arıza`}
                            tur="kirmizi"
                          />
                        )}

                        {garanti && (
                          <Rozet metin={garanti.metin} tur={garanti.tur} />
                        )}

                        {/* Tekrar eden arıza: aynı cihaz üçüncü kez
                            bozuluyorsa tamir mi değişim mi kararı buna
                            bakıyor. */}
                        {(c.toplamAriza ?? 0) >= 3 && (
                          <Rozet
                            metin={`${c.toplamAriza}. kez`}
                            tur="turuncu"
                          />
                        )}
                      </View>
                    </View>

                    <Simge ad="ok" boyut={15} renkli={renk.pasif} />
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* ------------------------------------------------------- süzgeç */}
      <Modal
        visible={suzgecAcik}
        transparent
        animationType="slide"
        onRequestClose={() => setSuzgecAcik(false)}
      >
        <View style={s.perde}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSuzgecAcik(false)}
          />

          <View style={s.serit}>
            <View style={s.seritUst}>
              <Text style={s.seritBaslik}>Sıralama</Text>

              <TouchableOpacity onPress={() => setSuzgecAcik(false)} hitSlop={10}>
                <Text style={s.seritKapat}>✕</Text>
              </TouchableOpacity>
            </View>

            {SIRALAMALAR.map((x) => (
              <TouchableOpacity
                key={x.kod}
                style={[s.secenek, sira === x.kod && s.secenekSecili]}
                onPress={() => {
                  setSira(x.kod);
                  setSuzgecAcik(false);
                }}
              >
                <Text
                  style={[s.secenekYazi, sira === x.kod && s.secenekYaziSecili]}
                >
                  {x.ad}
                </Text>

                {sira === x.kod && (
                  <Simge ad="onay" boyut={16} renkli={renk.beyaz} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------------- kamera */}
      <Modal
        {...modalTamEkran}
        visible={kameraAcik}
        animationType="slide"
        onRequestClose={() => setKameraAcik(false)}
      >
        <ModalAlani style={s.kameraSayfa} edges={["top", "bottom"]}>
          <View style={s.kameraUst}>
            <Text style={s.kameraBaslik}>Cihaz etiketi okut</Text>

            <TouchableOpacity onPress={() => setKameraAcik(false)} hitSlop={10}>
              <Text style={s.kameraKapat}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={s.kameraKutu}>
            <CameraView
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ["qr", "code128", "code39", "ean13"],
              }}
              onBarcodeScanned={({ data }) => {
                if (!kameraAcik) return;

                const kod = (data ?? "").trim();

                if (kod.length >= 3) kodOkundu(kod);
              }}
            />

            {/* Kaplama kameranın çocuğu değil kardeşi: yeni mimaride
                kameranın içindeki görünümler çizilmiyor. */}
            <View style={s.kameraKaplama} pointerEvents="none">
              <View style={s.hedef} />
            </View>
          </View>

          <Text style={s.kameraYazi}>
            Cihazın üzerindeki sicil etiketini çerçeveye alınız
          </Text>
        </ModalAlani>
      </Modal>

      {/* -------------------------------------------------- cihaz detayı */}
      <CihazDetayi
        detay={detay}
        kapat={() => setDetay(null)}
        arizaAc={arizaAc}
      />
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Cihaz detayı                                                               */
/* ========================================================================== */

/**
 * Cihaz penceresi: künye, arıza geçmişi, arıza açma ve etiket.
 *
 * Geçmiş ayrı bir istekle geliyor ve gelene kadar pencere açık duruyor:
 * künye ile arıza açma düğmesi geçmişe bağlı değil, onları bekletmenin
 * anlamı yok.
 */
function CihazDetayi({ detay, kapat, arizaAc }) {
  const [etiket, setEtiket] = useState(false);

  useEffect(() => {
    if (!detay) setEtiket(false);
  }, [detay]);

  if (!detay?.cihaz) return null;

  const c = detay.cihaz;
  const garanti = garantiRozeti(c.garantiBitis);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={kapat}>
      <View style={s.perde}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={kapat} />

        <View style={s.serit}>
          <View style={s.seritUst}>
            <Text style={s.seritBaslik} numberOfLines={1}>
              {etiket ? "Karekod etiketi" : cihazAdi(c)}
            </Text>

            <TouchableOpacity onPress={kapat} hitSlop={10}>
              <Text style={s.seritKapat}>✕</Text>
            </TouchableOpacity>
          </View>

          {etiket ? (
            <View style={s.etiketKutu}>
              <View style={s.etiketCerceve}>
                {QRCode ? (
                  <QRCode
                    value={c.sicilNo || c.seriNo || String(c.id)}
                    size={172}
                    backgroundColor="#fff"
                    color={renk.siyah}
                  />
                ) : (
                  <Barkod
                    deger={c.sicilNo || c.seriNo || String(c.id)}
                    genislik={190}
                    yukseklik={70}
                  />
                )}
              </View>

              <Text style={s.etiketYazi}>{c.sicilNo || c.seriNo || "—"}</Text>

              <Text style={s.etiketNot}>
                Cihaza yapıştırılacak etiket. Okutulduğunda bu cihaz açılır.
              </Text>

              <TouchableOpacity
                style={[s.seritDugme, s.seritDugmeBos]}
                onPress={() => setEtiket(false)}
              >
                <Text style={s.seritDugmeBosYazi}>Geri</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.detayUst}>
                <View style={s.detayGorsel}>
                  {c.kapakId ? (
                    <Image
                      source={{
                        uri: `${ADRES360}/api/Envanter/Gorsel/${c.kapakId}`,
                      }}
                      style={s.gorsel}
                      resizeMode="cover"
                    />
                  ) : (
                    <Simge ad="kutu" boyut={32} renkli="#c2c8cf" dolgu />
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.detayAd}>{cihazAdi(c)}</Text>

                  <Text style={s.detayAlt} numberOfLines={2}>
                    {[c.tur, c.subeKodu, c.konum].filter(Boolean).join(" · ")}
                  </Text>

                  <View style={s.rozetler}>
                    {c.acikAriza > 0 ? (
                      <Rozet metin={`${c.acikAriza} açık arıza`} tur="kirmizi" />
                    ) : (
                      <Rozet metin="Arızasız" tur="yesil" />
                    )}

                    {garanti && <Rozet metin={garanti.metin} tur={garanti.tur} />}
                  </View>
                </View>
              </View>

              <View style={s.kunyeIzgara}>
                <KunyeKutu etiket="Seri no" deger={c.seriNo} />
                <KunyeKutu etiket="Sicil no" deger={c.sicilNo} />
                <KunyeKutu
                  etiket="Garanti bitişi"
                  deger={tarihYaz(c.garantiBitis)}
                />
                <KunyeKutu etiket="Departman" deger={c.departman} />
                {c.sahibi ? (
                  <KunyeKutu etiket="Zimmetli" deger={c.sahibi} />
                ) : null}
              </View>

              <Text style={s.bolumBaslik}>Arıza geçmişi</Text>

              {detay.gecmis === null ? (
                <Text style={s.gecmisNot}>Yükleniyor…</Text>
              ) : detay.gecmis.length === 0 ? (
                <Text style={s.gecmisNot}>
                  Bu cihaz için açılmış arıza kaydı yok.
                </Text>
              ) : (
                detay.gecmis.map((a, i) => {
                  const d = ARIZA_DURUMU[a.durum] ?? {
                    ad: a.durum,
                    renk: renk.pasif,
                  };

                  const gun = Math.abs(gunFarki(a.olusturma));

                  return (
                    <View key={a.id} style={[s.gecmis, i > 0 && s.gecmisCizgi]}>
                      <Text style={s.gecmisNo}>#{a.id}</Text>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.gecmisBaslik} numberOfLines={1}>
                          {a.baslik}
                        </Text>

                        <Text style={s.gecmisAlt} numberOfLines={1}>
                          {gun === 0 ? "bugün" : `${gun} gün önce`}
                          {a.turAdi ? ` · ${a.turAdi}` : ""}
                        </Text>
                      </View>

                      <View
                        style={[s.gecmisDurum, { backgroundColor: d.renk + "22" }]}
                      >
                        <Text style={[s.gecmisDurumYazi, { color: d.renk }]}>
                          {d.ad}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}

              {/* Cihazdan doğrudan arıza: kaydı açarken cihazı ayrıca
                  aramak, kayıtların cihazsız açılmasına yol açıyordu. */}
              <TouchableOpacity
                style={[s.seritDugme, s.seritDugmeTuruncu]}
                activeOpacity={0.85}
                onPress={() => arizaAc(c)}
              >
                <Simge ad="uyari" boyut={16} renkli={renk.beyaz} dolgu />
                <Text style={s.seritDugmeYazi}>Bu cihaz için arıza kaydı aç</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.seritDugme, s.seritDugmeBos]}
                activeOpacity={0.85}
                onPress={() => setEtiket(true)}
              >
                <Text style={s.seritDugmeBosYazi}>Karekod etiketini göster</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function KunyeKutu({ etiket, deger }) {
  return (
    <View style={s.kunyeKutu}>
      <Text style={s.kunyeEtiket}>{etiket.toLocaleUpperCase("tr")}</Text>
      <Text style={s.kunyeDeger} numberOfLines={1}>
        {deger || "—"}
      </Text>
    </View>
  );
}

/* ========================================================================== */

/**
 * Şube listesi.
 *
 * Arızalı cihaz sayısı hem yazıyla hem ince bir oran çubuğuyla duruyor ve
 * liste arızalıya göre sıralanıyor: teknik ekip hangi mağazaya gideceğine
 * bakışta karar veriyor.
 */
function SubeListesi({ veri, sec }) {
  const liste = [...(veri?.subeler ?? [])].sort(
    (a, b) => (b.arizali ?? 0) - (a.arizali ?? 0)
  );

  if (liste.length === 0)
    return <Bilgi>Görebileceğiniz kayıtlı cihaz bulunmuyor.</Bilgi>;

  const toplam = liste.reduce((t, x) => t + (x.adet ?? 0), 0);
  const arizali = liste.reduce((t, x) => t + (x.arizali ?? 0), 0);

  return (
    <>
      <View style={s.ozet}>
        <View style={s.ozetKutu}>
          <Text style={s.ozetDeger}>{liste.length}</Text>
          <Text style={s.ozetAd}>ŞUBE</Text>
        </View>

        <View style={s.ozetKutu}>
          <Text style={s.ozetDeger}>{toplam}</Text>
          <Text style={s.ozetAd}>CİHAZ</Text>
        </View>

        <View style={s.ozetKutu}>
          <Text style={[s.ozetDeger, { color: renk.turuncu }]}>{arizali}</Text>
          <Text style={s.ozetAd}>ARIZALI</Text>
        </View>
      </View>

      <Text style={s.kapsam}>
        {veri?.kapsam === "departman"
          ? `${(veri?.departmanlar ?? []).join(", ") || "Departmanınızın"} cihazları`
          : "Şubenizin cihazları"}
      </Text>

      {liste.map((x) => (
        <TouchableOpacity
          key={x.subeKodu}
          style={s.subeKart}
          activeOpacity={0.75}
          onPress={() => sec(x.subeKodu)}
        >
          <View style={s.subeSimge}>
            <Simge ad="kutu" boyut={19} renkli={renk.yesilKoyu} dolgu />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.subeAd}>{x.subeKodu}</Text>

            <Text style={s.subeAlt}>
              {x.adet} cihaz
              {x.arizali > 0 ? ` · ${x.arizali} tanesinde açık arıza` : ""}
            </Text>

            {/* Oran çubuğu: iki mağazayı karşılaştırmak sayıyı okumaktan
                hızlı. */}
            <View style={s.subeYol}>
              <View
                style={[
                  s.subeDolu,
                  { width: `${((x.arizali ?? 0) / Math.max(x.adet, 1)) * 100}%` },
                ]}
              />
            </View>
          </View>

          {x.arizali > 0 ? (
            <View style={s.arizaRozet}>
              <Text style={s.arizaRozetYazi}>{x.arizali}</Text>
            </View>
          ) : (
            <Simge ad="ok" boyut={15} renkli={renk.pasif} />
          )}
        </TouchableOpacity>
      ))}
    </>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: olcu.bosluk, paddingBottom: 34, gap: 10 },

  /* --------------------------------------------------------- üst bar */
  ustBar: {
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 9,
  },
  aramaSatir: { flexDirection: "row", gap: 8 },
  aramaKutu: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: renk.zemin,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minWidth: 0,
  },
  arama: { flex: 1, fontSize: 13.5, color: renk.metin, padding: 0 },
  temizle: { fontSize: 11.5, color: renk.pasif, fontWeight: "600" },
  karekodDugme: {
    width: 44,
    borderRadius: 12,
    backgroundColor: renk.yesil,
    alignItems: "center",
    justifyContent: "center",
  },

  cipSerit: { gap: 6, paddingTop: 9, paddingRight: 4 },
  cip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: renk.cizgi,
    backgroundColor: renk.zemin,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cipSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  cipUyari: { backgroundColor: renk.turuncu, borderColor: renk.turuncu },
  cipYazi: { fontSize: 12, fontWeight: "700", color: renk.pasif },
  cipYaziSecili: { color: renk.beyaz },
  cipSay: {
    backgroundColor: "rgba(0,0,0,.08)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  cipSaySecili: { backgroundColor: "rgba(255,255,255,.25)" },
  cipSayYazi: { fontSize: 10.5, fontWeight: "800", color: renk.pasif },

  /* ------------------------------------------------------------ özet */
  ozet: { flexDirection: "row", gap: 8 },
  ozetKutu: {
    flex: 1,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 13,
    paddingVertical: 10,
    alignItems: "center",
  },
  ozetSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  ozetDeger: { fontSize: 20, fontWeight: "800", letterSpacing: -0.5, color: renk.metin },
  ozetAd: {
    fontSize: 9.5,
    fontWeight: "800",
    color: renk.pasif,
    marginTop: 1,
    letterSpacing: 0.4,
  },

  baslikSatir: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  baslikYazi: {
    fontSize: 11.5,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.5,
  },
  siralaDugme: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5 },
  siralaYazi: { fontSize: 11.5, fontWeight: "700", color: renk.yesilKoyu },

  /* ------------------------------------------------------- şube kartı */
  kapsam: { fontSize: 11.5, color: renk.pasif, fontWeight: "600", marginTop: 2 },
  subeKart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 12,
  },
  subeSimge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
  },
  subeAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  subeAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  subeYol: {
    height: 5,
    borderRadius: 3,
    backgroundColor: renk.zemin,
    marginTop: 6,
    overflow: "hidden",
  },
  subeDolu: { height: 5, borderRadius: 3, backgroundColor: renk.turuncu },
  arizaRozet: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
  },
  arizaRozetYazi: { fontSize: 11, fontWeight: "800", color: renk.beyaz },

  geriSatir: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2 },
  geriYazi: { fontSize: 12.5, color: renk.pasif, fontWeight: "600" },

  /* ------------------------------------------------------ cihaz kartı */
  kart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 10,
  },
  kartUyarili: { borderColor: "#f5bda8" },
  gorselKutu: {
    width: 52,
    height: 52,
    borderRadius: 11,
    backgroundColor: "#eef0ec",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gorsel: { width: "100%", height: "100%" },
  kartAd: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  kartAlt: { fontSize: 11, color: renk.pasif, marginTop: 1 },
  rozetler: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },

  /* --------------------------------------------------------- pencere */
  perde: { flex: 1, backgroundColor: "rgba(20,24,18,.5)" },
  serit: {
    backgroundColor: renk.beyaz,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 18,
    paddingBottom: 30,
    maxHeight: "84%",
  },
  seritUst: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  seritBaslik: { fontSize: 16.5, fontWeight: "800", color: renk.metin, flex: 1, minWidth: 0 },
  seritKapat: { fontSize: 20, color: renk.pasif, fontWeight: "600" },

  secenek: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: renk.zemin,
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 15,
    marginBottom: 8,
  },
  secenekSecili: { backgroundColor: renk.yesil },
  secenekYazi: { fontSize: 14, fontWeight: "700", color: renk.metin },
  secenekYaziSecili: { color: renk.beyaz },

  seritDugme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 15,
    paddingVertical: 15,
    marginTop: 12,
  },
  seritDugmeTuruncu: { backgroundColor: renk.turuncu },
  seritDugmeYazi: { fontSize: 14, fontWeight: "800", color: renk.beyaz },
  seritDugmeBos: {
    backgroundColor: renk.zemin,
    borderWidth: 1,
    borderColor: renk.cizgi,
    marginTop: 9,
  },
  seritDugmeBosYazi: { fontSize: 13.5, fontWeight: "700", color: renk.metin },

  /* ----------------------------------------------------- cihaz detayı */
  detayUst: { flexDirection: "row", alignItems: "center", gap: 13 },
  detayGorsel: {
    width: 78,
    height: 78,
    borderRadius: 15,
    backgroundColor: "#eef0ec",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  detayAd: { fontSize: 16, fontWeight: "800", color: renk.metin },
  detayAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },

  kunyeIzgara: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 16,
  },
  kunyeKutu: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: renk.zemin,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  kunyeEtiket: { fontSize: 9.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.3 },
  kunyeDeger: { fontSize: 13, fontWeight: "700", color: renk.metin, marginTop: 2 },

  bolumBaslik: {
    fontSize: 11.5,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 6,
  },
  gecmisNot: { fontSize: 12.5, color: renk.pasif, paddingVertical: 8 },
  gecmis: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  gecmisCizgi: { borderTopWidth: 1, borderTopColor: renk.cizgi },
  gecmisNo: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, minWidth: 44 },
  gecmisBaslik: { fontSize: 12.5, fontWeight: "700", color: renk.metin },
  gecmisAlt: { fontSize: 11, color: renk.pasif, marginTop: 1 },
  gecmisDurum: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  gecmisDurumYazi: { fontSize: 10, fontWeight: "800" },

  etiketKutu: { alignItems: "center", gap: 12, paddingTop: 6 },
  etiketCerceve: { backgroundColor: renk.beyaz, padding: 14, borderRadius: 16 },
  etiketYazi: { fontSize: 14, fontWeight: "800", letterSpacing: 2, color: renk.metin },
  etiketNot: {
    fontSize: 12,
    color: renk.pasif,
    textAlign: "center",
    lineHeight: 17,
    paddingHorizontal: 10,
  },

  /* ---------------------------------------------------------- kamera */
  kameraSayfa: { flex: 1, backgroundColor: renk.beyaz, padding: 18 },
  kameraUst: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  kameraBaslik: { fontSize: 17, fontWeight: "800", color: renk.metin },
  kameraKapat: { fontSize: 20, color: renk.pasif, fontWeight: "600" },
  kameraKutu: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: renk.siyah,
  },
  kameraKaplama: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hedef: {
    width: "72%",
    height: 180,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,.9)",
    borderRadius: 14,
  },
  kameraYazi: {
    fontSize: 13,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 16,
  },
});

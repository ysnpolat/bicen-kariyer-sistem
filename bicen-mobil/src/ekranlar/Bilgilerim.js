/**
 * Bilgilerim
 * ---------------------------------------------------------------------------
 * Personelin kendisine ait bilgiler. Diğer ekranındaki künye kartına
 * basılınca açılır.
 *
 * Şimdilik tek bölüm var: yazarkasa kullanıcı kodu ve şifresi. Yeni bilgi
 * eklendikçe bu ekrana bölüm olarak girer, bölüm başlığı deseni aşağıda.
 *
 * Kayıtlar oturumdaki kişinin kimlik numarasıyla eşleştirilir; ekran
 * hiçbir yere sicil ya da kimlik göndermez, sunucu kimin sorduğunu
 * jetondan bilir.
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
  Linking,
  Modal,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import {
  yazarkasaAl,
  yazarkasaSifreYaz,
  belgelerimAl,
  belgeAdresi,
  pusulalarimAl,
  pusulaAdresi,
  pusulaOnayla,
  pusulaItiraz,
  haftalikIznimAl,
  izinTalepleriAl,
  izinTalebiOnayla,
  nobetlerimAl,
  oturumKapat,
  modullerimAl,
} from "../api";
import { gorunumYaz } from "../gorunum";
import { bildirimDurumu } from "../bildirim";
import Constants from "expo-constants";
import { olcu, renk } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import SimgeKutu from "../bilesenler/SimgeKutu";
import Pencere from "../bilesenler/Pencere";

/** 2026-09-11T08:00:00 → 11.09.2026 */
const tarihYaz = (deger) => {
  if (!deger) return "";

  const t = new Date(deger);

  if (Number.isNaN(t.getTime())) return "";

  const iki = (s) => String(s).padStart(2, "0");

  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
};

export default function Bilgilerim({ navigation }) {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [gorunsun, setGorunsun] = useState(false);
  const [degistir, setDegistir] = useState(false);
  const [yeni, setYeni] = useState("");
  const [tekrar, setTekrar] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Özlük belgeleri. Yazarkasa kaydı olmayan personelin de belgesi
     olabiliyor, bu yüzden ayrı çekiliyor ve ayrı hata tutuyor. */
  const [belgeler, setBelgeler] = useState([]);

  /* Ücret pusulaları. Onay imza yerine geçtiği için akış iki adımlı:
     önce kuralı anlatan bilgilendirme, sonra onay. */
  const [pusulalar, setPusulalar] = useState([]);
  const [onayGunu, setOnayGunu] = useState(7);
  const [pencere, setPencere] = useState(null);
  const [itirazEdilen, setItirazEdilen] = useState(null);
  const [islemde, setIslemde] = useState(false);

  /* Haftalık izin günü: personel seçiyor, mağaza müdürü onaylıyor.
     Onaysız geçerli olmuyor. */
  const [izinGunu, setIzinGunu] = useState(null);

  /* Seçim hakkı gruptan geliyor; izin günü sabit olan görevlerde bölüm
     hiç çizilmiyor. */
  const [izinSecebilir, setIzinSecebilir] = useState(false);

  /* Müdürün onayını bekleyen talepler; müdür değilse boş gelir */
  const [talepler, setTalepler] = useState([]);

  const [nobetler, setNobetler] = useState([]);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      /* İkisi birlikte isteniyor; belge okunamazsa yazarkasa bölümü yine
         açılmalı, bu yüzden hatası yutuluyor. */
      /* Hepsi birlikte isteniyor; biri okunamazsa diğer bölümler yine
         açılmalı, bu yüzden her birinin hatası ayrı yutuluyor. */
      const [k, b, p, i, t, n] = await Promise.all([
        yazarkasaAl(),
        belgelerimAl().catch(() => ({ belgeler: [] })),
        pusulalarimAl().catch(() => ({ pusulalar: [] })),
        haftalikIznimAl().catch(() => ({ kayit: null })),
        izinTalepleriAl().catch(() => ({ talepler: [] })),
        nobetlerimAl().catch(() => ({ nobetler: [] })),
      ]);

      setVeri(k);
      setBelgeler(b?.belgeler ?? []);
      setPusulalar(p?.pusulalar ?? []);
      setIzinGunu(i?.kayit ?? null);
      setIzinSecebilir(!!i?.secebilir);
      setTalepler(t?.talepler ?? []);
      setNobetler(n?.nobetler ?? []);

      if (p?.onayGunu) setOnayGunu(p.onayGunu);

      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Bilgiler alınamadı.");
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  const GUN_ADLARI = [
    "Pazar",
    "Pazartesi",
    "Salı",
    "Çarşamba",
    "Perşembe",
    "Cuma",
    "Cumartesi",
  ];


  const talebiKarara_bagla = async (talep, onay) => {
    setIslemde(true);

    try {
      await izinTalebiOnayla(talep.id, onay, onay ? null : "Uygun görülmedi.");

      setPencere({
        tur: onay ? "basari" : "bilgi",
        baslik: onay ? "Onaylandı" : "Reddedildi",
        metin: `${talep.adSoyad} için talep ${onay ? "onaylandı" : "reddedildi"}.`,
      });

      getir();
    } catch (e) {
      setPencere({
        tur: "hata",
        baslik: "İşlem tamamlanamadı",
        metin: e?.message ?? "Tekrar deneyiniz.",
      });
    } finally {
      setIslemde(false);
    }
  };

  /* Onay iki adımlı: tek dokunuşla imzalanan bir pusula, yanlışlıkla
     basıldığında geri alınamıyordu. Önce kural anlatılıyor, sonra onay. */
  const onayaSor = (pusula) =>
    setPencere({
      tur: "bilgi",
      baslik: `${pusula.donemAdi} pusulasını onaylıyor musunuz?`,
      metin:
        "Onayladığınızda pusulayı incelediğinizi ve içeriğine katıldığınızı " +
        "beyan etmiş olursunuz. Onay imza yerine geçer ve geri alınamaz.",
      satirlar: [
        `${onayGunu} gün içinde onaylamadığınız veya itiraz etmediğiniz ` +
          "takdirde pusula onaylanmış sayılacaktır.",
        "İçeriğinde bir yanlışlık varsa onaylamak yerine itiraz ediniz.",
      ],
      dugmeler: [
        { ad: "Vazgeç", ikincil: true, bas: () => setPencere(null) },
        { ad: "Onaylıyorum", bas: () => onayla(pusula) },
      ],
    });

  const onayla = async (pusula) => {
    setIslemde(true);

    try {
      await pusulaOnayla(pusula.id);

      setPencere({
        tur: "basari",
        baslik: "Pusula onaylandı",
        metin: `${pusula.donemAdi} dönemine ait ücret pusulanız onaylandı.`,
      });

      getir();
    } catch (e) {
      setPencere({
        tur: "hata",
        baslik: "Onaylanamadı",
        metin: e?.message ?? "İşlem tamamlanamadı.",
      });
    } finally {
      setIslemde(false);
    }
  };

  const itirazGonder = async (pusula, sebep, aciklama) => {
    if (!sebep) {
      Alert.alert("Eksik", "İtiraz sebebini seçiniz.");
      return;
    }

    if (!aciklama.trim()) {
      Alert.alert("Eksik", "Açıklama yazınız.");
      return;
    }

    setIslemde(true);

    try {
      await pusulaItiraz(pusula.id, sebep, aciklama.trim());

      setItirazEdilen(null);

      setPencere({
        tur: "basari",
        baslik: "İtirazınız iletildi",
        metin:
          "İnsan Kaynakları itirazınızı inceleyip size dönecek. " +
          "Sonucu bu ekrandan görebilirsiniz.",
      });

      getir();
    } catch (e) {
      setPencere({
        tur: "hata",
        baslik: "İtiraz iletilemedi",
        metin: e?.message ?? "İşlem tamamlanamadı.",
      });
    } finally {
      setIslemde(false);
    }
  };

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

          <Text style={s.baslik}>Bilgilerim</Text>
        </View>

        {hata ? <Hata metin={hata} /> : null}

        {/* ------------------------------------------------------ modüller

            Belgeler, pusulalar ve kasa bilgileri tek sayfada alt alta
            diziliydi; sayfa uzadıkça personel aradığını bulamıyordu.
            Her biri artık kendi ekranında açılıyor. */}
        <View style={s.modulKart}>
          {[
            {
              kod: "belgeler",
              ad: "Belgelerim",
              alt: "İnsan Kaynakları'nın paylaştığı evraklar",
              simge: "belge",
              rozet: belgeler.length,
            },
            {
              kod: "pusula",
              ad: "Ücret Pusulalarım",
              alt: "Aylık bordrolar ve onay durumu",
              simge: "para",
              rozet: pusulalar.filter((p) => p.durum === "bekliyor").length,
            },
            {
              kod: "kasa",
              ad: "Kasa ve Terminal",
              alt: "Yazarkasa kullanıcı kodu ve şifre",
              simge: "kare",
            },
            {
              kod: "egitim",
              ad: "Eğitim Dokümanları",
              alt: "Video, belge ve bağlantılar",
              simge: "kitap",
            },
            {
              kod: "kartvizit",
              ad: "Kartvizitim",
              alt: "Karekodla bilgilerinizi paylaşın",
              simge: "kisi",
            },
          ].map((m, i, dizi) => (
            <TouchableOpacity
              key={m.kod}
              style={[s.modulSatir, i === dizi.length - 1 && s.modulSon]}
              activeOpacity={0.65}
              onPress={() =>
                navigation.navigate("BilgiModul", { bolum: m.kod })
              }
            >
              {/* Renkli zeminli simge: düz yeşil listede bütün satırlar
                  aynı görünüyordu ve aranan bölüm ancak adı okunarak
                  bulunuyordu. */}
              <SimgeKutu kod={m.kod} ad={m.simge} boyut={38} />

              <View style={{ flex: 1 }}>
                <Text style={s.modulAd}>{m.ad}</Text>
                <Text style={s.modulAlt}>{m.alt}</Text>
              </View>

              {m.rozet > 0 ? (
                <View style={s.modulRozet}>
                  <Text style={s.modulRozetYazi}>{m.rozet}</Text>
                </View>
              ) : null}

              <Simge ad="ok" renkli="#c8ccc4" boyut={17} />
            </TouchableOpacity>
          ))}
        </View>

        {/* --------------------------------------------- haftalık izin günü

            Personel gününü artık kendisi seçmiyor (28.09.2026): haftalık izin
            günü yöneticinin vardiya planında verdiği gündür. Personel yalnızca
            o gün için özel durum bildirebilir; bu Vardiya Planı ekranında. */}
        {izinSecebilir || izinGunu?.gun !== null && izinGunu?.gun !== undefined ? (
        <>
        <Text style={[s.bolumBaslik, { marginTop: 22 }]}>Haftalık İzin Günüm</Text>

        <View style={s.izinKutu}>
          {izinGunu?.gun !== null && izinGunu?.gun !== undefined ? (
            <View style={s.izinUst}>
              <Text style={s.izinGun}>{GUN_ADLARI[izinGunu.gun]}</Text>
              <Rozet metin="Sabit gün" tur="yesil" />
            </View>
          ) : (
            <Text style={s.izinBos}>Haftalık izin gününüz vardiya planınızda görünür.</Text>
          )}

          <Text style={s.izinAciklama}>
            Haftalık izin gününüzü yöneticiniz vardiya planında belirler. O gün sizin için uygun
            değilse Vardiya Planı ekranından özel durum bildirebilirsiniz; yöneticiniz kabul ederse
            izin gününüz değişir.
          </Text>

          <TouchableOpacity
            style={s.izinPlanDugme}
            activeOpacity={0.8}
            onPress={() => navigation.navigate("VardiyaPlani")}
          >
            <Text style={s.izinPlanDugmeYazi}>Vardiya planımı aç</Text>
          </TouchableOpacity>
        </View>
        </>
        ) : null}

        {/* ------------------------------------------- müdür onay bekleyenler

            Yalnızca mağaza müdürüne dolu geliyor; sunucu kendi şubesi
            dışındaki talepleri vermiyor. */}
        {talepler.length > 0 ? (
          <>
            <Text style={[s.bolumBaslik, { marginTop: 22 }]}>
              Onay Bekleyen İzin Talepleri
            </Text>

            {talepler.map((t) => (
              <View key={t.id} style={s.talep}>
                <Text style={s.talepAd}>{t.adSoyad}</Text>

                <Text style={s.talepAlt}>
                  {t.pozisyon ? `${t.pozisyon} · ` : ""}
                  {t.mevcutGun ? `${t.mevcutGun} → ` : ""}
                  {t.talepGun}
                </Text>

                {t.talepNotu ? (
                  <Text style={s.talepNot}>{t.talepNotu}</Text>
                ) : null}

                <View style={s.talepDugmeler}>
                  <TouchableOpacity
                    style={[s.talepDugme, s.talepRed]}
                    disabled={islemde}
                    onPress={() => talebiKarara_bagla(t, false)}
                  >
                    <Text style={s.talepRedYazi}>Reddet</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.talepDugme}
                    disabled={islemde}
                    onPress={() => talebiKarara_bagla(t, true)}
                  >
                    <Text style={s.talepOnayYazi}>Onayla</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {/* ------------------------------------------------------- nöbetler */}
        {nobetler.length > 0 ? (
          <>
            <Text style={[s.bolumBaslik, { marginTop: 22 }]}>Nöbetlerim</Text>

            {nobetler.map((n) => (
              <View key={n.id} style={s.nobet}>
                <Text style={s.nobetTarih}>{tarihYaz(n.tarih)}</Text>
                <Text style={s.nobetAlt}>
                  {n.aciklama || "Nöbet görevi"}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {/* ------------------------------------------------ ücret pusulası

            Bordronun kendisi PDF olarak açılıyor; ekranda yalnızca dönem,
            durum ve yapılacak işlem duruyor. */}
        {pusulalar.length > 0 ? (
          <>
            <Text style={[s.bolumBaslik, { marginTop: 22 }]}>Ücret Pusulası</Text>

            {pusulalar.map((p) => (
              <View key={p.id} style={s.pusula}>
                <View style={s.pusulaUst}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.pusulaDonem}>{p.donemAdi}</Text>

                    <Text style={s.pusulaAlt}>
                      {p.durum === "onaylandi"
                        ? `Onaylandı · ${tarihYaz(p.onayTarihi)}${
                            p.otomatik ? " (süre doldu)" : ""
                          }`
                        : p.durum === "itiraz"
                        ? `İtiraz edildi · ${tarihYaz(p.itirazTarihi)}`
                        : p.kalanGun !== null && p.kalanGun >= 0
                        ? `Son ${p.kalanGun} gün`
                        : "İşlem bekliyor"}
                    </Text>
                  </View>

                  <Rozet
                    metin={
                      p.durum === "onaylandi"
                        ? "Onaylandı"
                        : p.durum === "itiraz"
                        ? "İtirazda"
                        : "Bekliyor"
                    }
                    tur={
                      p.durum === "onaylandi"
                        ? "yesil"
                        : p.durum === "itiraz"
                        ? "turuncu"
                        : "mavi"
                    }
                  />
                </View>

                {/* İtiraz yazışması: İK yanıtladıysa personel görsün */}
                {p.itirazSebebi ? (
                  <View style={s.itirazKutu}>
                    <Text style={s.itirazBaslik}>İtirazınız · {p.itirazSebebi}</Text>

                    {p.itirazMetni ? (
                      <Text style={s.itirazMetin}>{p.itirazMetni}</Text>
                    ) : null}

                    {p.itirazYanit ? (
                      <>
                        <View style={s.itirazAyrac} />
                        <Text style={s.itirazBaslik}>İnsan Kaynakları yanıtı</Text>
                        <Text style={s.itirazMetin}>{p.itirazYanit}</Text>
                      </>
                    ) : null}
                  </View>
                ) : null}

                <View style={s.pusulaDugmeler}>
                  <TouchableOpacity
                    style={[s.pusulaDugme, s.ikincil]}
                    activeOpacity={0.75}
                    onPress={() => {
                      const adres = pusulaAdresi(p.id);

                      if (adres) Linking.openURL(adres);
                    }}
                  >
                    <Text style={[s.pusulaDugmeYazi, s.ikincilYazi]}>
                      Pusulayı gör
                    </Text>
                  </TouchableOpacity>

                  {p.durum === "bekliyor" ? (
                    <>
                      <TouchableOpacity
                        style={[s.pusulaDugme, s.itirazDugme]}
                        activeOpacity={0.75}
                        disabled={islemde}
                        onPress={() => setItirazEdilen(p)}
                      >
                        <Text style={[s.pusulaDugmeYazi, s.itirazYazi]}>
                          İtiraz et
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[s.pusulaDugme, islemde && s.soluk]}
                        activeOpacity={0.75}
                        disabled={islemde}
                        onPress={() => onayaSor(p)}
                      >
                        <Text style={s.pusulaDugmeYazi}>Onayla</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>

                {p.durum === "bekliyor" ? (
                  <Text style={s.pusulaKural}>
                    {onayGunu} gün içinde onaylamadığınız veya itiraz
                    etmediğiniz takdirde onaylanmış sayılacaktır.
                  </Text>
                ) : null}
              </View>
            ))}
          </>
        ) : null}

        {/* ------------------------------------------------- belgelerim

            İK panelinden yüklenen özlük evrakları. Yazarkasa kaydı
            olmayan personelin de belgesi olabiliyor, bu yüzden bölüm
            yukarıdaki koşulun dışında duruyor. */}
        {belgeler.length > 0 ? (
          <>
            <Text style={[s.bolumBaslik, { marginTop: 22 }]}>Belgelerim</Text>

            {belgeler.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={s.belge}
                activeOpacity={b.acilabilir ? 0.7 : 1}
                onPress={() => {
                  if (!b.acilabilir) {
                    Alert.alert(
                      "Açılamıyor",
                      "Bu belge telefonda görüntülenemiyor. İnsan Kaynakları'ndan " +
                        "bir kopyasını isteyebilirsiniz."
                    );
                    return;
                  }

                  const adres = belgeAdresi(b.id);

                  if (adres) Linking.openURL(adres);
                }}
              >
                <View style={s.belgeSol}>
                  <Rozet metin={b.tur} tur="mavi" />
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.belgeBaslik} numberOfLines={2}>
                    {b.baslik}
                  </Text>

                  {b.aciklama ? (
                    <Text style={s.belgeAciklama} numberOfLines={2}>
                      {b.aciklama}
                    </Text>
                  ) : null}

                  <Text style={s.belgeAlt}>
                    {tarihYaz(b.olusturma)}
                    {b.acilabilir ? " · görüntülemek için dokununuz" : ""}
                  </Text>
                </View>

                {b.acilabilir ? (
                  <Simge ad="ok" renkli={renk.pasif} boyut={16} />
                ) : null}
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        {/* 1.9: Diğer sekmesindeki hesap işlemleri buraya taşındı */}
        <HesapBolumu navigation={navigation} />
      </ScrollView>

      <Pencere veri={pencere} kapat={() => setPencere(null)} />

      {itirazEdilen ? (
        <ItirazFormu
          pusula={itirazEdilen}
          islemde={islemde}
          kapat={() => setItirazEdilen(null)}
          gonder={(sebep, aciklama) =>
            itirazGonder(itirazEdilen, sebep, aciklama)
          }
        />
      ) : null}
    </SafeAreaView>
  );
}

/* ========================================================================== */

/**
 * İtiraz formu.
 *
 * Sebep hazır listeden seçiliyor: serbest metinde herkes farklı yazıyor ve
 * İK hangi konuda itiraz edildiğini ancak açıklamayı okuyarak anlıyordu.
 */
const SEBEPLER = [
  "Fazla mesai eksik",
  "Prim eksik veya yanlış",
  "İzin kesintisi hatalı",
  "Avans görünmüyor",
  "Net ücret hatalı",
  "Diğer",
];

function ItirazFormu({ pusula, islemde, kapat, gonder }) {
  const [sebep, setSebep] = useState("");
  const [aciklama, setAciklama] = useState("");

  return (
    <Modal visible transparent animationType="slide" onRequestClose={kapat}>
      <View style={s.formPerde}>
        <View style={s.formKutu}>
          <Text style={s.formBaslik}>{pusula.donemAdi} · itiraz</Text>

          <Text style={s.formAlt}>
            İtirazınız İnsan Kaynakları'na iletilir ve yanıtlanana kadar
            pusula onaylanmaz.
          </Text>

          <Text style={s.formEtiket}>İtiraz sebebi</Text>

          <View style={s.sebepler}>
            {SEBEPLER.map((x) => (
              <TouchableOpacity
                key={x}
                style={[s.sebep, sebep === x && s.sebepSecili]}
                activeOpacity={0.7}
                onPress={() => setSebep(x)}
              >
                <Text style={[s.sebepYazi, sebep === x && s.sebepYaziSecili]}>
                  {x}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.formEtiket}>Açıklama</Text>

          <TextInput
            style={[s.giris, s.uzunGiris]}
            value={aciklama}
            onChangeText={setAciklama}
            multiline
            placeholder="Neyin yanlış olduğunu kısaca yazınız"
            placeholderTextColor="#c8ccc4"
          />

          <View style={s.dugmeSatir}>
            <TouchableOpacity
              style={[s.dugme, s.ikincil, { flex: 1 }]}
              activeOpacity={0.75}
              disabled={islemde}
              onPress={kapat}
            >
              <Text style={[s.dugmeYazi, s.ikincilYazi]}>Vazgeç</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.dugme, { flex: 1 }, islemde && s.soluk]}
              activeOpacity={0.75}
              disabled={islemde}
              onPress={() => gonder(sebep, aciklama)}
            >
              <Text style={s.dugmeYazi}>
                {islemde ? "Gönderiliyor…" : "İtirazı gönder"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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

  /* -------------------------------------------------------------- modüller */

  modulKart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.yuvarlak,
    overflow: "hidden",
  },
  modulSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },
  modulSon: { borderBottomWidth: 0 },
  modulSimge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
  },
  modulAd: { fontSize: 15, fontWeight: "600", color: renk.metin },
  modulAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },

  /* Bekleyen sayısı: personel neyin ilgi beklediğini listeye girmeden
     görmeli. */
  modulRozet: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
  },
  modulRozetYazi: { fontSize: 11.5, fontWeight: "800", color: renk.beyaz },

  /* -------------------------------------------------- haftalık izin günü */

  izinKutu: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 14,
  },
  izinUst: { flexDirection: "row", alignItems: "center", gap: 10 },
  izinGun: { flex: 1, fontSize: 18, fontWeight: "800", color: renk.yesilKoyu },
  izinBos: { fontSize: 14, color: renk.pasif },

  izinBekleyen: {
    backgroundColor: renk.turuncuAcik,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 11,
    marginTop: 9,
  },
  izinBekleyenYazi: { fontSize: 12.5, color: renk.turuncuKoyu, lineHeight: 18 },

  izinRed: { fontSize: 12.5, color: renk.kirmizi, marginTop: 8, lineHeight: 18 },
  izinAciklama: { fontSize: 11.5, color: renk.pasif, marginTop: 9, lineHeight: 17 },

  /* Günler tek satırda: yedi gün alt alta listelenince bölüm gereksiz
     yer kaplıyordu. */
  gunler: { flexDirection: "row", gap: 5, marginTop: 11 },
  gun: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: renk.cizgi,
    alignItems: "center",
    backgroundColor: renk.beyaz,
  },
  gunSecili: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  izinPlanDugme: {
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: renk.beyaz,
  },
  izinPlanDugmeYazi: { fontSize: 13, fontWeight: "800", color: renk.yesilKoyu },
  gunBekleyen: { backgroundColor: renk.turuncu, borderColor: renk.turuncu },
  gunYazi: { fontSize: 12, fontWeight: "700", color: renk.metin },
  gunYaziSecili: { color: renk.beyaz },

  /* ------------------------------------------------------------ talepler */

  talep: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 13,
    padding: 13,
    marginBottom: 9,
  },
  talepAd: { fontSize: 15, fontWeight: "700", color: renk.metin },
  talepAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },
  talepNot: { fontSize: 12.5, color: renk.metin, marginTop: 6, lineHeight: 18 },

  talepDugmeler: { flexDirection: "row", gap: 8, marginTop: 11 },
  talepDugme: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: renk.yesil,
  },
  talepOnayYazi: { fontSize: 13.5, fontWeight: "700", color: renk.beyaz },
  talepRed: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  talepRedYazi: { fontSize: 13.5, fontWeight: "700", color: renk.metin },

  /* ------------------------------------------------------------- nöbetler */

  nobet: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderLeftWidth: 3,
    borderLeftColor: renk.mavi,
    borderRadius: 11,
    padding: 12,
    marginBottom: 8,
  },
  nobetTarih: { fontSize: 14.5, fontWeight: "700", color: renk.metin },
  nobetAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },

  /* ------------------------------------------------------ ücret pusulası */

  pusula: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  pusulaUst: { flexDirection: "row", alignItems: "center", gap: 10 },
  pusulaDonem: { fontSize: 15.5, fontWeight: "700", color: renk.metin },
  pusulaAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },

  pusulaDugmeler: { flexDirection: "row", gap: 8, marginTop: 12 },

  pusulaDugme: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 11,
    alignItems: "center",
    backgroundColor: renk.yesil,
  },
  pusulaDugmeYazi: { fontSize: 13.5, fontWeight: "700", color: renk.beyaz },

  itirazDugme: { backgroundColor: renk.turuncuAcik, borderWidth: 1, borderColor: "#ffbb96" },
  itirazYazi: { color: renk.turuncuKoyu },

  /* Kural her kartın altında tekrar ediliyor: personel bir pusulayı
     açtığında süreyi hatırlamak zorunda kalmasın. */
  pusulaKural: { fontSize: 11.5, color: renk.pasif, marginTop: 9, lineHeight: 17 },

  itirazKutu: {
    backgroundColor: renk.zemin,
    borderRadius: 10,
    padding: 11,
    marginTop: 11,
  },
  itirazBaslik: { fontSize: 12.5, fontWeight: "700", color: renk.metin },
  itirazMetin: { fontSize: 12.5, color: renk.pasif, marginTop: 3, lineHeight: 18 },
  itirazAyrac: {
    height: 1,
    backgroundColor: renk.cizgi,
    marginVertical: 9,
  },

  /* ------------------------------------------------------- itiraz formu */

  formPerde: {
    flex: 1,
    backgroundColor: "rgba(20, 24, 20, 0.45)",
    justifyContent: "flex-end",
  },
  formKutu: {
    backgroundColor: renk.beyaz,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 30,
  },
  formBaslik: { fontSize: 17, fontWeight: "700", color: renk.metin },
  formAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 6, lineHeight: 18 },

  sebepler: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sebep: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  sebepSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  sebepYazi: { fontSize: 13, color: renk.metin },
  sebepYaziSecili: { color: renk.yesilKoyu, fontWeight: "700" },

  uzunGiris: { height: 96, textAlignVertical: "top", paddingTop: 11 },

  /* ------------------------------------------------------------ belgeler */

  belge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  belgeSol: { flex: 0 },
  belgeBaslik: { fontSize: 14, fontWeight: "600", color: renk.metin },
  belgeAciklama: { fontSize: 12.5, color: renk.pasif, marginTop: 2, lineHeight: 18 },
  belgeAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 4 },

  bolumBaslik: {
    fontSize: 12,
    fontWeight: "700",
    color: renk.pasif,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
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

  /* Rakamlar küçültüldü: 30 punto tek başına ekranın üçte birini
     kaplıyordu, okunurluk 24'te de yeterli. */
  kod: {
    fontSize: 24,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: 1,
  },

  ustSatir: { flexDirection: "row", alignItems: "flex-start", gap: 10 },

  rozetlerSag: { flexDirection: "row", gap: 6, flexShrink: 0 },

  rozetler: { flexDirection: "row", gap: 6, marginTop: 10 },

  ayrac: {
    height: 1,
    backgroundColor: "#eef0ea",
    marginVertical: 12,
  },

  gorev: { fontSize: 12.5, color: renk.pasif, marginTop: 6 },

  sifreSatir: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sifre: {
    fontSize: 24,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: 5,
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


/* ========================================================================== */
/* Hesap (1.9): tüm modüller, patron görünümü, bildirim durumu, çıkış          */
/* ========================================================================== */

function HesapBolumu({ navigation }) {
  const [patron, setPatron] = useState(false);

  useFocusEffect(
    useCallback(() => {
      modullerimAl()
        .then((d) => setPatron(d?.patron === true))
        .catch(() => undefined);
    }, [])
  );

  const cikisSor = () =>
    Alert.alert("Çıkış yapılsın mı?", "Yeniden giriş için kimlik numaranız ve SMS doğrulaması gerekecek.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çıkış yap",
        style: "destructive",
        onPress: async () => {
          await oturumKapat();
          navigation.getParent()?.reset({ index: 0, routes: [{ name: "Giris" }] });
        },
      },
    ]);

  const Satir = ({ simge, zemin, renkli, ad, alt, bas, son }) => (
    <TouchableOpacity style={[h.satir, son && { borderBottomWidth: 0 }]} activeOpacity={0.65} onPress={bas}>
      <View style={[h.simge, { backgroundColor: zemin }]}>
        <Simge ad={simge} renkli={renkli} boyut={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={h.ad}>{ad}</Text>
        {alt ? <Text style={h.alt}>{alt}</Text> : null}
      </View>
      <Simge ad="ok" renkli="#c8ccc4" boyut={16} />
    </TouchableOpacity>
  );

  return (
    <View style={{ marginTop: 18 }}>
      <Text style={h.bolum}>Hesap</Text>
      <View style={h.kart}>
        <Satir simge="izgara" zemin={renk.yesilAcik} renkli={renk.yesilKoyu} ad="Tüm modüller" alt="Yetkili olduğunuz bütün ekranlar" bas={() => navigation.navigate("Diger")} />
        {patron ? (
          <Satir
            simge="kalkan"
            zemin={renk.yesilAcik}
            renkli={renk.yesilKoyu}
            ad="Patron görünümü"
            alt="Şubeler, onaylar, İK ve Biçen Kart özeti"
            bas={async () => {
              await gorunumYaz("patron");
              navigation.getParent()?.reset({ index: 0, routes: [{ name: "Patron" }] });
            }}
          />
        ) : null}
        <Satir
          simge="zil"
          zemin="#eef4fb"
          renkli="#1a4d80"
          ad="Bildirim durumu"
          alt={`${bildirimDurumu.asama}${bildirimDurumu.hata ? " · hata var" : ""}`}
          bas={() => Alert.alert("Bildirim durumu", `Aşama: ${bildirimDurumu.asama}\n\nJeton: ${bildirimDurumu.jeton ?? "yok"}\n\nHata: ${bildirimDurumu.hata ?? "yok"}`)}
        />
        <Satir simge="cikis" zemin="#fff2e8" renkli={renk.turuncu} ad="Çıkış yap" alt="Yeniden giriş için SMS doğrulaması gerekir" bas={cikisSor} son />
      </View>
      <Text style={h.surum}>Biçen360 · sürüm {Constants.expoConfig?.version ?? "—"}</Text>
    </View>
  );
}

const h = StyleSheet.create({
  bolum: { fontSize: 12, fontWeight: "700", color: renk.pasif, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 },
  kart: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, overflow: "hidden" },
  satir: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  simge: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  ad: { fontSize: 15, fontWeight: "600", color: renk.metin },
  alt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  surum: { textAlign: "center", color: "#a3a9b0", fontSize: 12, marginTop: 14, marginBottom: 110 },
});

/**
 * Bilgilerim — alt ekranlar
 * ---------------------------------------------------------------------------
 * Belgelerim, ücret pusulaları, kasa bilgileri, kartvizit ve eğitim
 * dokümanları tek bir ekranda alt alta diziliydi; sayfa uzadıkça personel
 * aradığını bulamıyordu. Artık Bilgilerim bir modül listesi, her modül
 * burada açılıyor.
 *
 * Hepsi tek dosyada çünkü hepsi aynı veriyi ve aynı düzeni paylaşıyor;
 * ayrı dosyalara bölmek beş kez tekrar eden başlık, yükleme ve hata
 * yönetimi demekti. Hangi bölümün açılacağını rota parametresi söylüyor.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  RefreshControl,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
/* Karekod çizici isteğe bağlı yükleniyor.

   Doğrudan import edildiğinde, paket kurulu değilse uygulama açılışta
   beyaz ekranda kalıyordu: App.js bu ekranı en baştan yüklüyor ve
   çözülemeyen bir import bütün paketi düşürüyor. Kartvizit bölümünün
   çalışmaması, uygulamanın hiç açılmamasından iyidir. */
let QRCode = null;

try {
  QRCode = require("react-native-qrcode-svg").default;
} catch {
  QRCode = null;
}

import {
  belgelerimAl,
  belgeAdresi,
  pusulalarimAl,
  pusulaAdresi,
  egitimlerimAl,
  egitimAdresi,
  egitimOkundu,
  yazarkasaAl,
  ozetAl,
} from "../api";
import { olcu, renk } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import BarBaslik from "../bilesenler/BarBaslik";

/* -------------------------------------------------------------------------- */

const BASLIKLAR = {
  belgeler: "Belgelerim",
  pusula: "Ücret Pusulalarım",
  kasa: "Kasa ve Terminal",
  kartvizit: "Kartvizitim",
  egitim: "Eğitim Dokümanları",
};

/** 1536000 → "1,5 MB" */
const boyutYaz = (bayt) => {
  if (!bayt) return "";
  if (bayt < 1024 * 1024) return `${Math.round(bayt / 1024)} KB`;

  return `${(bayt / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
};

const tarihYaz = (deger) => {
  if (!deger) return "";

  const t = new Date(deger);

  if (Number.isNaN(t.getTime())) return "";

  const iki = (s) => String(s).padStart(2, "0");

  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
};

/* ========================================================================== */

export default function BilgiModul({ route, navigation }) {
  const bolum = route?.params?.bolum ?? "belgeler";

  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const getir = useCallback(
    async (yenile = false) => {
      if (yenile) setYenileniyor(true);

      try {
        /* Her bölüm yalnızca kendi verisini çekiyor: tek ekranken hepsi
           birden isteniyordu ve açılış gereksiz yavaştı. */
        const veriler = {
          belgeler: () => belgelerimAl(),
          pusula: () => pusulalarimAl(),
          kasa: () => yazarkasaAl(),
          egitim: () => egitimlerimAl(),
          kartvizit: () => ozetAl(),
        };

        setVeri(await veriler[bolum]());
        setHata("");
      } catch (e) {
        setHata(e?.message ?? "Bilgiler alınamadı.");
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [bolum]
  );

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <BarBaslik ad={BASLIKLAR[bolum] ?? "Bilgilerim"} acik kendi />

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
        ) : bolum === "belgeler" ? (
          <Belgeler veri={veri} />
        ) : bolum === "pusula" ? (
          <Pusulalar veri={veri} navigation={navigation} />
        ) : bolum === "kasa" ? (
          <Kasa veri={veri} />
        ) : bolum === "egitim" ? (
          <Egitimler veri={veri} tazele={getir} />
        ) : (
          <Kartvizit veri={veri} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Belgelerim                                                                 */
/* ========================================================================== */

function Belgeler({ veri }) {
  const liste = veri?.belgeler ?? [];

  if (liste.length === 0)
    return <Bilgi>İnsan Kaynakları sizinle henüz belge paylaşmadı.</Bilgi>;

  return liste.map((b) => (
    <TouchableOpacity
      key={b.id}
      style={s.satir}
      activeOpacity={b.acilabilir ? 0.7 : 1}
      onPress={() => {
        if (!b.acilabilir) {
          Alert.alert(
            "Açılamıyor",
            "Bu belge telefonda görüntülenemiyor. İnsan Kaynakları'ndan bir kopyasını isteyebilirsiniz."
          );
          return;
        }

        const adres = belgeAdresi(b.id);

        if (adres) Linking.openURL(adres);
      }}
    >
      <Rozet metin={b.tur} tur="mavi" />

      <View style={s.satirGovde}>
        <Text style={s.satirBaslik} numberOfLines={2}>
          {b.baslik}
        </Text>

        {b.aciklama ? (
          <Text style={s.satirAlt} numberOfLines={2}>
            {b.aciklama}
          </Text>
        ) : null}

        <Text style={s.satirKunye}>
          {tarihYaz(b.olusturma)}
          {b.boyut ? ` · ${boyutYaz(b.boyut)}` : ""}
        </Text>
      </View>

      {b.acilabilir ? <Simge ad="ok" renkli={renk.pasif} boyut={16} /> : null}
    </TouchableOpacity>
  ));
}

/* ========================================================================== */
/* Ücret pusulaları                                                           */
/* ========================================================================== */

function Pusulalar({ veri, navigation }) {
  const liste = veri?.pusulalar ?? [];

  if (liste.length === 0)
    return <Bilgi>Henüz ücret pusulanız yüklenmedi.</Bilgi>;

  return (
    <>
      <Bilgi>
        Onay ve itiraz işlemleri Bilgilerim ekranının altındaki pusula
        bölümünden yapılır.
      </Bilgi>

      {liste.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={s.satir}
          activeOpacity={0.7}
          onPress={() => {
            const adres = pusulaAdresi(p.id);

            if (adres) Linking.openURL(adres);
          }}
        >
          <Rozet
            metin={
              p.durum === "onaylandi"
                ? "Onaylı"
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

          <View style={s.satirGovde}>
            <Text style={s.satirBaslik}>{p.donemAdi}</Text>

            <Text style={s.satirKunye}>
              {p.durum === "onaylandi"
                ? `Onaylandı · ${tarihYaz(p.onayTarihi)}`
                : p.kalanGun !== null && p.kalanGun >= 0
                ? `Son ${p.kalanGun} gün`
                : "İşlem bekliyor"}
            </Text>
          </View>

          <Simge ad="ok" renkli={renk.pasif} boyut={16} />
        </TouchableOpacity>
      ))}
    </>
  );
}

/* ========================================================================== */
/* Kasa ve terminal                                                           */
/* ========================================================================== */

function Kasa({ veri }) {
  const [gizli, setGizli] = useState(true);

  if (!veri?.kullaniciKodu)
    return (
      <Bilgi>
        Yazarkasa kaydınız bulunamadı. Şubenizin sorumlusuyla ya da İnsan
        Kaynakları ile görüşünüz.
      </Bilgi>
    );

  return (
    <>
      <View style={s.kutu}>
        <Text style={s.kutuBaslik}>YAZARKASA</Text>

        <View style={s.alan}>
          <Text style={s.alanAd}>Kullanıcı kodu</Text>
          <Text style={s.alanDeger}>{veri.kullaniciKodu}</Text>
        </View>

        <View style={s.alan}>
          <Text style={s.alanAd}>Şifre</Text>

          {/* Şifre kapalı başlıyor: personel kasada dururken ekranı
              başkasının görmesi olağan. */}
          <TouchableOpacity onPress={() => setGizli((o) => !o)}>
            <Text style={s.alanDeger}>
              {gizli ? "••••••" : veri.sifre ?? "—"}
            </Text>
            <Text style={s.gosterYazi}>
              {gizli ? "Görmek için dokununuz" : "Gizlemek için dokununuz"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[s.kutu, { opacity: 0.6 }]}>
        <Text style={s.kutuBaslik}>EL TERMİNALİ</Text>

        <Text style={s.satirAlt}>
          Terminal kullanıcı kodu ve şifresi yakında burada görünecek.
        </Text>
      </View>
    </>
  );
}

/* ========================================================================== */
/* Kartvizit                                                                  */
/* ========================================================================== */

/**
 * Karekod vCard biçiminde.
 *
 * Telefonun kamerası bu biçimi tanıyıp doğrudan "Kişilere ekle" ekranını
 * açıyor; düz metin karekodda kişi bilgileri elle yazılmak zorunda
 * kalıyordu.
 */
function vCard(kisi) {
  const ad = (kisi?.adSoyad ?? "").trim();
  const parcalar = ad.split(" ");
  const soyad = parcalar.length > 1 ? parcalar.pop() : "";
  const isim = parcalar.join(" ");

  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${soyad};${isim};;;`,
    `FN:${ad}`,
    "ORG:Biçen Market",
    kisi?.gorev ? `TITLE:${kisi.gorev}` : null,
    kisi?.telefon ? `TEL;TYPE=CELL:${kisi.telefon}` : null,
    kisi?.subeAdi ? `ADR;TYPE=WORK:;;${kisi.subeAdi};;;;` : null,
    "END:VCARD",
  ]
    .filter(Boolean)
    .join("\n");
}

function Kartvizit({ veri }) {
  const kisi = {
    adSoyad: veri?.kisi?.adSoyad,
    gorev: veri?.kisi?.gorev ?? veri?.gorev,
    telefon: veri?.kisi?.telefon,
    subeAdi: veri?.kisi?.subeAdi,
  };

  if (!kisi.adSoyad) return <Bilgi>Kartvizit bilgileriniz alınamadı.</Bilgi>;

  const icerik = vCard(kisi);

  return (
    <>
      <View style={s.kart}>
        <View style={s.karekodAlan}>
          {QRCode ? (
            <QRCode value={icerik} size={190} backgroundColor="#fff" />
          ) : (
            <Text style={s.karekodYok}>
              Karekod bu sürümde görüntülenemiyor. Bilgilerinizi aşağıdaki
              düğmeyle paylaşabilirsiniz.
            </Text>
          )}
        </View>

        <Text style={s.kartAd}>{kisi.adSoyad}</Text>

        <Text style={s.kartGorev}>
          {kisi.gorev ?? ""}
          {kisi.subeAdi ? ` · ${kisi.subeAdi}` : ""}
        </Text>

        {kisi.telefon ? <Text style={s.kartTel}>{kisi.telefon}</Text> : null}
      </View>

      <Bilgi>
        Karşınızdaki kişi telefonunun kamerasıyla bu karekodu okuttuğunda
        bilgileriniz doğrudan rehberine eklenir.
      </Bilgi>

      <TouchableOpacity
        style={s.dugme}
        activeOpacity={0.8}
        onPress={() =>
          Share.share({
            message:
              `${kisi.adSoyad}\n${kisi.gorev ?? ""}` +
              `${kisi.subeAdi ? ` · ${kisi.subeAdi}` : ""}` +
              `${kisi.telefon ? `\n${kisi.telefon}` : ""}\nBiçen Market`,
          })
        }
      >
        <Text style={s.dugmeYazi}>Bilgilerimi paylaş</Text>
      </TouchableOpacity>
    </>
  );
}

/* ========================================================================== */
/* Eğitim dokümanları                                                         */
/* ========================================================================== */

function Egitimler({ veri, tazele }) {
  const liste = veri?.egitimler ?? [];

  if (liste.length === 0)
    return <Bilgi>Sizinle paylaşılmış eğitim dokümanı yok.</Bilgi>;

  return (
    <>
      {veri?.bekleyen > 0 ? (
        <Bilgi>
          {veri.bekleyen} zorunlu eğitimi henüz açmadınız.
        </Bilgi>
      ) : null}

      {liste.map((e) => (
        <TouchableOpacity
          key={e.id}
          style={s.satir}
          activeOpacity={0.7}
          onPress={async () => {
            /* Bağlantı türünde okundu işareti ayrı isteniyor: tarayıcıya
               çıkıldığında sunucu bunu göremiyor. */
            if (e.acilis) {
              try {
                await egitimOkundu(e.id);
              } catch {
                /* İşaret konamazsa içerik yine açılmalı */
              }

              Linking.openURL(e.acilis);
              tazele();
              return;
            }

            const adres = egitimAdresi(e.id);

            if (adres) {
              Linking.openURL(adres);
              setTimeout(tazele, 1500);
            }
          }}
        >
          <Rozet
            metin={
              e.tur === "video" ? "Video" : e.tur === "baglanti" ? "Bağlantı" : "Belge"
            }
            tur={e.tur === "video" ? "turuncu" : "mavi"}
          />

          <View style={s.satirGovde}>
            <Text style={s.satirBaslik} numberOfLines={2}>
              {e.baslik}
            </Text>

            {e.aciklama ? (
              <Text style={s.satirAlt} numberOfLines={3}>
                {e.aciklama}
              </Text>
            ) : null}

            <Text style={s.satirKunye}>
              {e.bolum ? `${e.bolum} · ` : ""}
              {tarihYaz(e.olusturma)}
              {e.boyut ? ` · ${boyutYaz(e.boyut)}` : ""}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end", gap: 5 }}>
            {e.zorunlu && !e.okundu ? (
              <View style={s.zorunlu}>
                <Text style={s.zorunluYazi}>ZORUNLU</Text>
              </View>
            ) : null}

            {e.okundu ? <Rozet metin="İzlendi" tur="yesil" /> : null}
          </View>
        </TouchableOpacity>
      ))}
    </>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 110 },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 13,
    padding: 13,
    marginBottom: 9,
  },
  satirGovde: { flex: 1, minWidth: 0 },
  satirBaslik: { fontSize: 14.5, fontWeight: "600", color: renk.metin },
  satirAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 3, lineHeight: 18 },
  satirKunye: { fontSize: 11.5, color: renk.pasif, marginTop: 5 },

  zorunlu: {
    backgroundColor: "#fff1f0",
    borderWidth: 1,
    borderColor: "#ffa39e",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  zorunluYazi: { fontSize: 9.5, fontWeight: "800", color: renk.kirmizi },

  kutu: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.yuvarlak,
    padding: 15,
    marginBottom: 12,
  },
  kutuBaslik: {
    fontSize: 11.5,
    fontWeight: "700",
    color: renk.pasif,
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  alan: { marginBottom: 12 },
  alanAd: { fontSize: 12, color: renk.pasif },
  alanDeger: { fontSize: 17, fontWeight: "700", color: renk.metin, marginTop: 2 },
  gosterYazi: { fontSize: 11, color: renk.yesilKoyu, marginTop: 3 },

  /* -------------------------------------------------------- kartvizit */

  kart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    marginBottom: 12,
  },
  karekodAlan: {
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 16,
  },
  karekodYok: {
    width: 190,
    fontSize: 12.5,
    color: renk.pasif,
    textAlign: "center",
    lineHeight: 18,
  },

  kartAd: { fontSize: 19, fontWeight: "800", color: renk.metin },
  kartGorev: { fontSize: 13, color: renk.pasif, marginTop: 3, textAlign: "center" },
  kartTel: { fontSize: 15, fontWeight: "600", color: renk.yesilKoyu, marginTop: 8 },

  dugme: {
    backgroundColor: renk.yesil,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  dugmeYazi: { fontSize: 15, fontWeight: "700", color: renk.beyaz },
});

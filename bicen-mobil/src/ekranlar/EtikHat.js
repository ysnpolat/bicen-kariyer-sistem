/**
 * Etik Hat
 * ---------------------------------------------------------------------------
 * Personelin yolsuzluk, mobbing, taciz gibi konuları bildirdiği ekran.
 *
 * Anonim bildirimde kimlik bilgisi sunucuya hiç gönderilmiyor ve kayda hiç
 * yazılmıyor; ekranda gizlemek yetmezdi. Bunun doğal sonucu: anonim
 * bildirim "Bildirimlerim" listesinde çıkmıyor, çünkü kayıtla personeli
 * eşleştirecek bir veri yok. Takip numarasıyla sorgulanıyor ve numara
 * bildirimden sonra bir kez gösteriliyor — personelin not almasını
 * söylemek şart.
 * ---------------------------------------------------------------------------
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
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import {
  etikSecenekler,
  etikAc,
  etikBenim,
  etikSorgu,
  etikMesaj,
} from "../api";
import { olcu, renk } from "../tema";
import { Yukleniyor, Hata, Bilgi, Rozet } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import BarBaslik from "../bilesenler/BarBaslik";
import Pencere from "../bilesenler/Pencere";

/* -------------------------------------------------------------------------- */

const DURUMLAR = {
  alindi: { ad: "Alındı", tur: "mavi" },
  inceleniyor: { ad: "İnceleniyor", tur: "mavi" },
  ek_bilgi: { ad: "Ek bilgi bekleniyor", tur: "turuncu" },
  sonuclandi: { ad: "Sonuçlandırıldı", tur: "yesil" },
  kapandi: { ad: "Kapatıldı", tur: "gri" },
};

const tarihYaz = (deger) => {
  if (!deger) return "";

  const t = new Date(deger);

  if (Number.isNaN(t.getTime())) return "";

  const iki = (s) => String(s).padStart(2, "0");

  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
};

/* ========================================================================== */

export default function EtikHat() {
  const [sekme, setSekme] = useState("yeni");

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <BarBaslik ad="Etik Hat" acik kendi />

      <View style={s.sekmeler}>
        {[
          { kod: "yeni", ad: "Bildirim yap" },
          { kod: "takip", ad: "Bildirimlerim" },
        ].map((x) => (
          <TouchableOpacity
            key={x.kod}
            style={[s.sekme, sekme === x.kod && s.sekmeSecili]}
            onPress={() => setSekme(x.kod)}
          >
            <Text style={[s.sekmeYazi, sekme === x.kod && s.sekmeYaziSecili]}>
              {x.ad}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {sekme === "yeni" ? <YeniBildirim /> : <Takip />}
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Yeni bildirim                                                              */
/* ========================================================================== */

function YeniBildirim() {
  const [secenekler, setSecenekler] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  const [tur, setTur] = useState("");
  const [yer, setYer] = useState("");
  const [subeAdi, setSubeAdi] = useState("");
  const [olayTarihi, setOlayTarihi] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [anonim, setAnonim] = useState(true);

  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [pencere, setPencere] = useState(null);

  useFocusEffect(
    useCallback(() => {
      etikSecenekler()
        .then((c) => {
          setSecenekler(c);
          setSubeAdi(c?.subeAdi ?? "");
        })
        .catch(() => setSecenekler({ turler: [], yerler: [] }))
        .finally(() => setYukleniyor(false));
    }, [])
  );

  const gonder = async () => {
    if (!tur) return Alert.alert("Eksik", "Bildirim türünü seçiniz.");

    if (aciklama.trim().length < 20)
      return Alert.alert(
        "Eksik",
        "Olayı biraz daha ayrıntılı anlatınız. Ne olduğu, ne zaman ve kimlerin bulunduğu incelemeyi hızlandırır."
      );

    setGonderiliyor(true);

    try {
      const sonuc = await etikAc({
        tur,
        yer,
        subeAdi,
        olayTarihi,
        aciklama: aciklama.trim(),
        anonim,
      });

      /* Numara bir kez gösteriliyor; anonim bildirimde tek takip yolu bu */
      setPencere({
        tur: "basari",
        baslik: "Bildiriminiz alındı",
        metin: anonim
          ? "Kimlik bilgileriniz kaydedilmedi. Bildiriminizi yalnızca aşağıdaki numarayla takip edebilirsiniz — lütfen not alınız."
          : "Bildiriminiz etik kurula iletildi. Bildirimlerim sekmesinden takip edebilirsiniz.",
        satirlar: [`Takip numarası: ${sonuc.numara}`],
        kapatilamaz: true,
        dugmeler: [
          {
            /* Panoya kopyalama react-native çekirdeğinden kaldırıldı ve
               ayrı bir paket gerektiriyor; paylaşım sayfası her sürümde
               var ve numarayı not almanın birden çok yolunu sunuyor. */
            ad: "Numarayı paylaş",
            ikincil: true,
            bas: () =>
              Share.share({
                message:
                  `Etik hat bildirim takip numaram: ${sonuc.numara}`,
              }),
          },
          {
            ad: "Tamam",
            bas: () => {
              setPencere(null);
              setTur("");
              setYer("");
              setOlayTarihi("");
              setAciklama("");
            },
          },
        ],
      });
    } catch (e) {
      setPencere({
        tur: "hata",
        baslik: "Gönderilemedi",
        metin: e?.message ?? "Bildiriminiz iletilemedi, tekrar deneyiniz.",
      });
    } finally {
      setGonderiliyor(false);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

  return (
    <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
      <Bilgi>
        Bildiriminiz etik kurul dışında kimseye gösterilmez. Anonim
        seçtiğinizde adınız ve sicilinizin sisteme kaydedilmez.
      </Bilgi>

      <Text style={s.etiket}>Bildirim türü</Text>

      <View style={s.secenekler}>
        {(secenekler?.turler ?? []).map((x) => (
          <TouchableOpacity
            key={x}
            style={[s.secenek, tur === x && s.secenekSecili]}
            activeOpacity={0.7}
            onPress={() => setTur(x)}
          >
            <Text style={[s.secenekYazi, tur === x && s.secenekYaziSecili]}>
              {x}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.etiket}>Olay nerede gerçekleşti?</Text>

      <View style={s.secenekler}>
        {(secenekler?.yerler ?? []).map((x) => (
          <TouchableOpacity
            key={x}
            style={[s.secenek, yer === x && s.secenekSecili]}
            activeOpacity={0.7}
            onPress={() => setYer(x)}
          >
            <Text style={[s.secenekYazi, yer === x && s.secenekYaziSecili]}>
              {x}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.etiket}>Şube / birim</Text>

      <TextInput
        style={s.girdi}
        value={subeAdi}
        onChangeText={setSubeAdi}
        placeholder="Örn. Merter"
        placeholderTextColor="#c8ccc4"
      />

      <Text style={s.etiket}>Olay tarihi</Text>

      <TextInput
        style={s.girdi}
        value={olayTarihi}
        onChangeText={setOlayTarihi}
        placeholder="2026-09-12"
        placeholderTextColor="#c8ccc4"
      />

      <Text style={s.etiket}>Açıklama</Text>

      <TextInput
        style={[s.girdi, s.uzunGirdi]}
        value={aciklama}
        onChangeText={setAciklama}
        multiline
        placeholder="Ne olduğunu, ne zaman gerçekleştiğini ve kimlerin bulunduğunu mümkün olduğunca ayrıntılı yazınız."
        placeholderTextColor="#c8ccc4"
      />

      <Text style={s.etiket}>Bildirim şekli</Text>

      {[
        {
          deger: true,
          ad: "Anonim bildirim yapmak istiyorum",
          alt: "Adınız ve siciliniz hiçbir yere kaydedilmez. Takip numarasıyla izlersiniz.",
        },
        {
          deger: false,
          ad: "Kimliğimi paylaşarak bildirim yapmak istiyorum",
          alt: "Etik kurul size doğrudan ulaşabilir, bildiriminiz listenizde görünür.",
        },
      ].map((x) => (
        <TouchableOpacity
          key={String(x.deger)}
          style={[s.sekil, anonim === x.deger && s.sekilSecili]}
          activeOpacity={0.7}
          onPress={() => setAnonim(x.deger)}
        >
          <View style={[s.kutucuk, anonim === x.deger && s.kutucukSecili]} />

          <View style={{ flex: 1 }}>
            <Text style={s.sekilAd}>{x.ad}</Text>
            <Text style={s.sekilAlt}>{x.alt}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={[s.dugme, gonderiliyor && s.soluk]}
        disabled={gonderiliyor}
        activeOpacity={0.8}
        onPress={gonder}
      >
        <Text style={s.dugmeYazi}>
          {gonderiliyor ? "Gönderiliyor…" : "Bildirimi gönder"}
        </Text>
      </TouchableOpacity>

      <Text style={s.dipnot}>
        Kanıt eklemek isterseniz bildiriminiz alındıktan sonra etik kurul
        sizden isteyecektir.
      </Text>

      <Pencere veri={pencere} kapat={() => setPencere(null)} />
    </ScrollView>
  );
}

/* ========================================================================== */
/* Takip                                                                      */
/* ========================================================================== */

function Takip() {
  const [liste, setListe] = useState([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [numara, setNumara] = useState("");
  const [sorgu, setSorgu] = useState(null);
  const [mesaj, setMesaj] = useState("");
  const [islemde, setIslemde] = useState(false);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      const c = await etikBenim();

      setListe(c?.bildirimler ?? []);
      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Bildirimler alınamadı.");
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

  const numarayiSorgula = async (no) => {
    const hedef = (no ?? numara).trim();

    if (!hedef) return Alert.alert("Eksik", "Takip numarasını yazınız.");

    setIslemde(true);

    try {
      setSorgu(await etikSorgu(hedef));
    } catch (e) {
      Alert.alert("Bulunamadı", e?.message ?? "Bu numarayla bildirim bulunamadı.");
    } finally {
      setIslemde(false);
    }
  };

  const mesajGonder = async () => {
    if (!mesaj.trim()) return;

    setIslemde(true);

    try {
      await etikMesaj(sorgu.kayit.numara, mesaj.trim());
      setMesaj("");
      await numarayiSorgula(sorgu.kayit.numara);
    } catch (e) {
      Alert.alert("Gönderilemedi", e?.message ?? "Tekrar deneyiniz.");
    } finally {
      setIslemde(false);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

  /* Sorgulanan bildirim açıkken liste yerine onun ayrıntısı gösteriliyor */
  if (sorgu)
    return (
      <ScrollView contentContainerStyle={s.govde}>
        <TouchableOpacity style={s.geriSatir} onPress={() => setSorgu(null)}>
          <Simge ad="ok" boyut={15} renkli={renk.pasif} />
          <Text style={s.geriYazi}>Listeye dön</Text>
        </TouchableOpacity>

        <View style={s.kutu}>
          <View style={s.kutuUst}>
            <Text style={s.numara}>{sorgu.kayit.numara}</Text>
            <Rozet
              metin={DURUMLAR[sorgu.kayit.durum]?.ad ?? sorgu.kayit.durum}
              tur={DURUMLAR[sorgu.kayit.durum]?.tur ?? "gri"}
            />
          </View>

          <Text style={s.tur}>{sorgu.kayit.tur}</Text>

          <Text style={s.kunye}>
            {sorgu.kayit.subeAdi || sorgu.kayit.yer || ""}
            {sorgu.kayit.olayTarihi
              ? ` · olay ${tarihYaz(sorgu.kayit.olayTarihi)}`
              : ""}
          </Text>

          <Text style={s.aciklama}>{sorgu.kayit.aciklama}</Text>
        </View>

        {sorgu.kayit.sonuc ? (
          <View style={[s.kutu, { borderLeftWidth: 3, borderLeftColor: renk.yesil }]}>
            <Text style={s.etiketKucuk}>SONUÇ</Text>
            <Text style={s.aciklama}>{sorgu.kayit.sonuc}</Text>
          </View>
        ) : null}

        <Text style={s.etiket}>İşlem geçmişi</Text>

        {(sorgu.hareketler ?? []).map((h, i) => (
          <View key={i} style={s.hareket}>
            <Text style={s.hareketUst}>
              {h.bildiren ? "Siz" : "Etik kurul"} ·{" "}
              {tarihYaz(h.olusturma)}
              {h.durum ? ` · ${DURUMLAR[h.durum]?.ad ?? h.durum}` : ""}
            </Text>

            {h.metin ? <Text style={s.hareketMetin}>{h.metin}</Text> : null}
          </View>
        ))}

        <Text style={s.etiket}>Ek bilgi yazın</Text>

        <TextInput
          style={[s.girdi, s.uzunGirdi]}
          value={mesaj}
          onChangeText={setMesaj}
          multiline
          placeholder="Eklemek istediğiniz bilgi varsa yazınız"
          placeholderTextColor="#c8ccc4"
        />

        <TouchableOpacity
          style={[s.dugme, islemde && s.soluk]}
          disabled={islemde}
          onPress={mesajGonder}
        >
          <Text style={s.dugmeYazi}>Gönder</Text>
        </TouchableOpacity>
      </ScrollView>
    );

  return (
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
      {hata ? <Hata metin={hata} /> : null}

      <Text style={s.etiket}>Takip numarasıyla sorgula</Text>

      <View style={s.sorguSatir}>
        <TextInput
          style={[s.girdi, { flex: 1 }]}
          value={numara}
          onChangeText={setNumara}
          autoCapitalize="characters"
          placeholder="ETH-2026-000184"
          placeholderTextColor="#c8ccc4"
        />

        <TouchableOpacity
          style={[s.sorguDugme, islemde && s.soluk]}
          disabled={islemde}
          onPress={() => numarayiSorgula()}
        >
          <Text style={s.dugmeYazi}>Sorgula</Text>
        </TouchableOpacity>
      </View>

      <Bilgi>
        Anonim bildirimleriniz aşağıdaki listede görünmez; kimlik bilgisi
        kaydedilmediği için eşleştirilemez. Onları takip numarasıyla
        sorgulayınız.
      </Bilgi>

      {liste.length === 0 ? (
        <Bilgi>Kimliğinizle açtığınız bildirim yok.</Bilgi>
      ) : (
        liste.map((b) => (
          <TouchableOpacity
            key={b.id}
            style={s.satir}
            activeOpacity={0.7}
            onPress={() => numarayiSorgula(b.numara)}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.numara}>{b.numara}</Text>
              <Text style={s.satirAlt}>
                {b.tur} · {tarihYaz(b.olusturma)}
              </Text>
            </View>

            <Rozet
              metin={DURUMLAR[b.durum]?.ad ?? b.durum}
              tur={DURUMLAR[b.durum]?.tur ?? "gri"}
            />
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 120 },

  sekmeler: {
    flexDirection: "row",
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  sekme: { flex: 1, paddingVertical: 13, alignItems: "center" },
  sekmeSecili: { borderBottomWidth: 2, borderBottomColor: renk.yesil },
  sekmeYazi: { fontSize: 14, color: renk.pasif, fontWeight: "600" },
  sekmeYaziSecili: { color: renk.yesilKoyu },

  etiket: {
    fontSize: 12.5,
    fontWeight: "700",
    color: renk.pasif,
    marginTop: 18,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  etiketKucuk: {
    fontSize: 11,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.5,
    marginBottom: 5,
  },

  secenekler: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  secenek: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  secenekSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  secenekYazi: { fontSize: 13, color: renk.metin },
  secenekYaziSecili: { color: renk.yesilKoyu, fontWeight: "700" },

  girdi: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 14.5,
    color: renk.metin,
  },
  uzunGirdi: { height: 130, textAlignVertical: "top", paddingTop: 12 },

  /* Bildirim şekli: kutucuk büyük, açıklama altında. Bu seçim geri
     alınamıyor ve personelin ne seçtiğini anlaması şart. */
  sekil: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
  },
  sekilSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  kutucuk: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: renk.cizgi,
    marginTop: 2,
  },
  kutucukSecili: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  sekilAd: { fontSize: 14, fontWeight: "600", color: renk.metin },
  sekilAlt: { fontSize: 12, color: renk.pasif, marginTop: 3, lineHeight: 17 },

  dugme: {
    backgroundColor: renk.yesil,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 18,
  },
  dugmeYazi: { fontSize: 15.5, fontWeight: "700", color: renk.beyaz },
  soluk: { opacity: 0.6 },

  dipnot: {
    fontSize: 11.5,
    color: renk.pasif,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 17,
  },

  sorguSatir: { flexDirection: "row", gap: 8 },
  sorguDugme: {
    backgroundColor: renk.yesil,
    paddingHorizontal: 18,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
  },
  numara: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  satirAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 3 },

  kutu: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.yuvarlak,
    padding: 14,
    marginBottom: 10,
  },
  kutuUst: { flexDirection: "row", alignItems: "center", gap: 10 },
  tur: { fontSize: 14, fontWeight: "600", color: renk.metin, marginTop: 8 },
  kunye: { fontSize: 12, color: renk.pasif, marginTop: 3 },
  aciklama: { fontSize: 13.5, color: renk.metin, lineHeight: 20, marginTop: 8 },

  hareket: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    padding: 12,
    marginBottom: 7,
  },
  hareketUst: { fontSize: 11.5, color: renk.pasif, fontWeight: "600" },
  hareketMetin: { fontSize: 13, color: renk.metin, marginTop: 4, lineHeight: 19 },

  geriSatir: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  geriYazi: { fontSize: 13.5, color: renk.pasif },
});

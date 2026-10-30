/**
 * Fiyat Kontrol
 * ---------------------------------------------------------------------------
 * Barkod okutulduğunda ürünün üç fiyatı, yer kodu ve şubedeki eldeki
 * stoğu gösterilir.
 *
 * Kamera açık kalıyor ve okutma arka arkaya yapılabiliyor: reyonda
 * çalışan personel her ürün için kamerayı yeniden açmak zorunda
 * kalıyordu.
 *
 * Okutulan ürünler listeye biriktirilip şubeye mail olarak
 * gönderilebiliyor; şube bu listeden raf etiketi basıyor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";

/* İstek katmanı doğrudan kullanılıyor.

   Daha önce api360.js'e eklenen yardımcı işlevlerden okunuyordu; o dosya
   güncellenmediğinde işlevler tanımsız kalıyor ve ekran "undefined is not
   a function" ile düşüyordu. Uçlar burada yazılı olunca ekran tek
   dosyaya bağlı kalıyor. */
import { api360, ADRES360 } from "../api360";
import { renk, olcu } from "../tema";
import { Yukleniyor, Bilgi } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import BarBaslik from "../bilesenler/BarBaslik";
import Pencere from "../bilesenler/Pencere";
import { EtiketKaydiKart, SktKutu } from "../bilesenler/EtiketDenetimi";
import InsertUrunleri from "./InsertUrunleri";

/* -------------------------------------------------------------------------- */

const paraYaz = (d) =>
  d === null || d === undefined
    ? "—"
    : Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

/* ========================================================================== */

export default function FiyatKontrol() {
  const [izin, izinIste] = useCameraPermissions();

  /* Sonuç kartına kaydırmak için: kamera ekranın üstünü kapladığında
     sonuç altta kalıyor ve personel okumanın gerçekleşip
     gerçekleşmediğini göremiyordu. */
  const kaydirRef = useRef(null);
  const sonucY = useRef(0);

  const [subeler, setSubeler] = useState([]);
  const [secilen, setSecilen] = useState(null);
  const [subeAcik, setSubeAcik] = useState(false);

  /* Şube personeli yalnızca kendi şubesini sorgular (seçim kilitli);
     bu hafta vardiya planı yoksa sayfa kullanılamaz. İkisini de sunucu
     söylüyor. */
  const [kilitli, setKilitli] = useState(false);
  const [engel, setEngel] = useState("");

  const [kameraAcik, setKameraAcik] = useState(false);
  const [barkod, setBarkod] = useState("");
  const [sonuc, setSonuc] = useState(null);
  const [sorguluyor, setSorguluyor] = useState(false);
  const [hata, setHata] = useState("");

  /* Etiket listesi (11.10.2026): her kalemde adet var; aynı ürün yeniden
     eklenince adet artıyor. Liste sunucuda kişiye bağlı taslak olarak
     saklanıyor: uygulama kapansa ya da telefon değişse de kaybolmuyor. */
  const [liste, setListe] = useState([]);
  const taslakOkundu = useRef(false);
  const [pencere, setPencere] = useState(null);
  /* 26.10.2026: insert kampanya ürünleri */
  const [insertAcik, setInsertAcik] = useState(false);
  const [eklendi, setEklendi] = useState("");

  /* Son gönderilen listeler */
  const [sonListeler, setSonListeler] = useState([]);
  const [acikListe, setAcikListe] = useState(null);

  /* Aynı barkodun arka arkaya okunmasını engeller: kamera saniyede
     birkaç kez okuyor ve her birinde sorgu atmak sunucuyu boşuna
     yoruyordu. */
  const sonOkutma = useRef({ deger: "", zaman: 0 });

  const sonListeleriGetir = useCallback(() => {
    api360
      .al("/api/FiyatKontrol/SonListeler")
      .then((c) => setSonListeler(c?.listeler ?? []))
      .catch(() => undefined);
  }, []);

  /* Taslak bir kez okunuyor; sonraki her değişiklik yazılıyor */
  useEffect(() => {
    api360
      .al("/api/FiyatKontrol/Taslak")
      .then((c) => {
        const k = (c?.kalemler ?? []).map((x) => ({ ...x, adet: x.adet > 0 ? x.adet : 1 }));
        setListe((o) => (o.length ? o : k));
      })
      .catch(() => undefined)
      .finally(() => {
        taslakOkundu.current = true;
      });
    sonListeleriGetir();
  }, [sonListeleriGetir]);

  useEffect(() => {
    if (!taslakOkundu.current) return;
    const t = setTimeout(() => {
      api360
        .gonder(
          "/api/FiyatKontrol/Taslak",
          { kalemler: liste.map((x) => ({ barkod: x.barkod, urunAdi: x.urunAdi, adet: x.adet, fiyat: x.fiyat ?? null })) },
          "PUT"
        )
        .catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [liste]);

  useEffect(() => {
    if (!eklendi) return;
    const t = setTimeout(() => setEklendi(""), 2200);
    return () => clearTimeout(t);
  }, [eklendi]);

  const adetDegistir = (barkod, d) =>
    setListe((o) =>
      o.map((x) => (x.barkod === barkod ? { ...x, adet: Math.min(99, Math.max(1, (x.adet ?? 1) + d)) } : x))
    );

  const geriAl = (l) => {
    setListe((o) => {
      const yeni = [...o];
      for (const k of l.kalemler ?? []) {
        const i = yeni.findIndex((x) => x.barkod === k.barkod);
        if (i >= 0) yeni[i] = { ...yeni[i], adet: Math.min(99, (yeni[i].adet ?? 1) + (k.adet ?? 1)) };
        else yeni.push({ barkod: k.barkod, urunAdi: k.urunAdi ?? k.barkod, adet: k.adet ?? 1 });
      }
      return yeni;
    });
    setEklendi(`${l.rfKodu} listesi etiket listesine alındı.`);
  };

  const toplamEtiket = liste.reduce((t, x) => t + (x.adet ?? 1), 0);

  useEffect(() => {
    api360.al("/api/FiyatKontrol/Sube")
      .then((c) => {
        setSubeler(c?.subeler ?? []);
        setSecilen(c?.secilen ?? null);
        setKilitli(!!c?.kilitli);
        setEngel(c?.vardiyaEngeli ?? "");
      })
      .catch(() => setSubeler([]));
  }, []);

  const sorgula = useCallback(async (deger, kameradan = false) => {
    const hedef = (deger ?? "").trim();

    if (!hedef) return;

    setSorguluyor(true);
    setHata("");

    /* Kameradan okunduğunda kamera hemen kapanıyor.

       Açık bırakmak iki sorun çıkarıyordu: sonuç kameranın altında
       kaldığı için görünmüyor, ve kamera okumaya devam edip aynı ürünü
       yeniden sorguluyordu. Yeni ürün için düğmeye basmak, yanlış
       okumayla uğraşmaktan hızlı. */
    if (kameradan) setKameraAcik(false);

    try {
      setSonuc(
        await api360.al(
          /* g=2: fiyatlar ayrı alanlarda gelsin (1.7). Eski uygulamaya
             sunucu büyük kutu için geçerli fiyatı fiyat1'de gönderiyor. */
          `/api/FiyatKontrol/Sorgula?barkod=${encodeURIComponent(hedef)}&g=2`
        )
      );
      setBarkod("");

      /* Sonuç kartına kaydırılıyor: ekranın üstünde şube seçici ve
         okutma düğmesi var, sonuç onların altında kalıyordu. */
      setTimeout(
        () => kaydirRef.current?.scrollTo({ y: sonucY.current, animated: true }),
        150
      );
    } catch (e) {
      setSonuc(null);

      if (e?.kod === "vardiyaPlaniYok") {
        setEngel(e.message);
        return;
      }

      setHata(e?.message ?? "Sorgulanamadı.");
    } finally {
      setSorguluyor(false);
    }
  }, []);

  const okundu = ({ data }) => {
    const simdi = Date.now();

    if (
      data === sonOkutma.current.deger &&
      simdi - sonOkutma.current.zaman < 2500
    )
      return;

    sonOkutma.current = { deger: data, zaman: simdi };

    sorgula(data, true);
  };

  const subeyiSec = async (kod) => {
    setSecilen(kod);
    setSubeAcik(false);
    setSonuc(null);

    try {
      await api360.gonder("/api/FiyatKontrol/Sube", { subeKodu: kod });
    } catch (e) {
      Alert.alert("Seçilemedi", e?.message ?? "Şube kaydedilemedi.");
    }
  };

  const listeyeEkle = () => {
    const u = sonuc?.urun;

    if (!u) return;

    /* Aynı ürün yeniden eklenince adedi artıyor (birden çok etiket) */
    const fiyat = u.satisFiyati ?? u.fiyat1 ?? null;
    const var_ = liste.find((x) => x.barkod === u.barkod);

    setListe((o) =>
      var_
        ? o.map((x) => (x.barkod === u.barkod ? { ...x, adet: Math.min(99, (x.adet ?? 1) + 1) } : x))
        : [...o, { barkod: u.barkod, urunAdi: u.urunAdi, adet: 1, fiyat }]
    );

    setEklendi(var_ ? `${u.urunAdi}: ${Math.min(99, (var_.adet ?? 1) + 1)} adet` : `${u.urunAdi} listeye eklendi.`);
  };

  const listeyiGonder = async () => {
    const sube = subeler.find((s) => s.subeKodu === secilen);

    try {
      /* Adres olmasa da gönderiliyor: liste artık sunucuda kayıtlı ve
         şube etiket programındaki "Mobilden" düğmesinden alıyor. Mail
         ikinci yol; eskiden adres yoksa liste hiç gitmiyordu. */
      const c = await api360.gonder("/api/FiyatKontrol/ListeGonder", {
        adres: sube?.eposta ?? "",
        subeKodu: secilen,
        /* Adet kadar satır: şube her satır için bir etiket basıyor */
        barkodlar: liste.flatMap((x) => Array.from({ length: x.adet ?? 1 }, () => x.barkod)),
      });

      const kod = c?.rfKodu ? `\n\nListe kodu: ${c.rfKodu}` : "";

      setPencere({
        tur: "basari",
        baslik: "Liste gönderildi",
        metin: c?.uyari
          ? `${c.uyari}${kod}`
          : `${liste.length} ürün, ${toplamEtiket} etiket ${sube?.subeAdi ?? secilen} şubesine `
            + `iletildi. Şube, etiket programındaki Mobilden düğmesinden `
            + `listeyi açabilir.${kod}`,
      });

      setListe([]);
      sonListeleriGetir();
    } catch (e) {
      setPencere({
        tur: "hata",
        baslik: "Gönderilemedi",
        metin: e?.message ?? "Mail iletilemedi.",
      });
    }
  };

  if (engel) {
    return (
      <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
        <BarBaslik ad="Fiyat Kontrol" acik kendi />

        <View style={s.engelKutu}>
          <View style={s.engelSimge}>
            <Simge ad="takvim" boyut={26} renkli={renk.turuncu} />
          </View>
          <Text style={s.engelBaslik}>Vardiya planınız yok</Text>
          <Text style={s.engelMetin}>{engel}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const u = sonuc?.urun;

  /* Sunucu eskiyse (satisFiyati yok) eski davranış: fiyat1 raf */
  const rafFiyat = u?.rafFiyat !== undefined ? u.rafFiyat : u?.fiyat1;
  const bicardli = u?.fiyatTuru === "bicard";
  const satisFiyati = u?.satisFiyati !== undefined ? u.satisFiyati : u?.fiyat1;

  const subeAdi =
    subeler.find((s) => s.subeKodu === secilen)?.subeAdi ?? secilen ?? "Seçiniz";

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <BarBaslik ad="Fiyat Kontrol" acik kendi />

      <ScrollView
        ref={kaydirRef}
        contentContainerStyle={s.govde}
        keyboardShouldPersistTaps="handled"
      >
        {/* ------------------------------------------------------- şube */}
        <TouchableOpacity
          style={s.subeSatir}
          activeOpacity={kilitli ? 1 : 0.7}
          disabled={kilitli}
          onPress={() => setSubeAcik((o) => !o)}
        >
          <Simge ad="kare" boyut={16} renkli={renk.pasif} />
          <Text style={s.subeYazi}>{subeAdi}</Text>
          {kilitli ? null : <Text style={s.subeDegis}>değiştir</Text>}
        </TouchableOpacity>

        {subeAcik && !kilitli ? (
          <View style={s.subeListe}>
            {subeler.map((x) => (
              <TouchableOpacity
                key={x.subeKodu}
                style={[s.subeSec, secilen === x.subeKodu && s.subeSecili]}
                onPress={() => subeyiSec(x.subeKodu)}
              >
                <Text style={s.subeSecYazi}>{x.subeAdi ?? x.subeKodu}</Text>
                {!x.depoNo ? <Text style={s.depoYok}>depo yok</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* ----------------------------------------------------- okutma */}
        {kameraAcik && izin?.granted ? (
          <View style={s.kameraKutu}>
            <CameraView
              style={s.kamera}
              facing="back"
              barcodeScannerSettings={{
                /* 13.10.2026 (1.8): karekod da okunuyor; içeriği sunucu çözüyor */
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "qr", "datamatrix"],
              }}
              onBarcodeScanned={okundu}
            />

            {/* Kaplama kameranın çocuğu değil kardeşi: yeni mimaride
                kameranın içindeki görünümler çizilmiyor.

                Çerçeve dikdörtgen; barkod yatay ve uzun bir şekil,
                kare çerçeve kullanıcıyı telefonu yanlış açıda tutmaya
                yönlendiriyordu. */}
            <View style={s.kameraKaplama} pointerEvents="box-none">
              <View style={s.hedef}>
                {/* Köşe işaretleri: tam kenarlık, barkodun kendi
                    çizgileriyle karışıyordu. */}
                <View style={[s.kose, s.koseSolUst]} />
                <View style={[s.kose, s.koseSagUst]} />
                <View style={[s.kose, s.koseSolAlt]} />
                <View style={[s.kose, s.koseSagAlt]} />
              </View>

              <Text style={s.kameraYazi}>
                Barkodu ya da karekodu çerçeveye alınız
              </Text>

              <TouchableOpacity
                style={s.kameraKapat}
                onPress={() => setKameraAcik(false)}
              >
                <Text style={s.kameraKapatYazi}>Kamerayı kapat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={s.okutDugme}
            activeOpacity={0.85}
            onPress={async () => {
              if (!izin?.granted) {
                const c = await izinIste();

                if (!c.granted) {
                  Alert.alert(
                    "Kamera izni gerekiyor",
                    "Barkod ve karekod okutmak için kamera izni veriniz."
                  );
                  return;
                }
              }

              setKameraAcik(true);
            }}
          >
            <Simge ad="kare" boyut={18} renkli={renk.beyaz} />
            <Text style={s.okutYazi}>Barkod / karekod okut</Text>
          </TouchableOpacity>
        )}

        <View style={s.elleSatir}>
          <TextInput
            style={s.girdi}
            value={barkod}
            onChangeText={setBarkod}
            keyboardType="number-pad"
            placeholder="Barkodu elle yazınız"
            placeholderTextColor="#c8ccc4"
            onSubmitEditing={() => sorgula(barkod)}
          />

          <TouchableOpacity
            style={s.sorguDugme}
            onPress={() => sorgula(barkod)}
            disabled={sorguluyor}
          >
            <Text style={s.sorguYazi}>{sorguluyor ? "…" : "Sorgula"}</Text>
          </TouchableOpacity>
        </View>

        {hata ? <Bilgi>{hata}</Bilgi> : null}
        {sorguluyor && !sonuc ? <Yukleniyor /> : null}

        {/* ------------------------------------------------------ sonuç */}
        {u ? (
          <View
            style={s.kart}
            onLayout={(olay) => {
              /* Kartın konumu ölçülüyor: sabit bir değere kaydırmak,
                 şube listesi açıkken yanlış yere götürüyordu. */
              sonucY.current = Math.max(olay.nativeEvent.layout.y - 12, 0);
            }}
          >
            {sonuc.gorselId ? (
              <Image
                source={{ uri: `${ADRES360}/api/FiyatKontrol/Gorsel/${sonuc.gorselId}` }}
                style={s.gorsel}
                resizeMode="contain"
              />
            ) : null}

            <Text style={s.urunAd}>{u.urunAdi}</Text>

            <Text style={s.urunKunye}>
              {u.barkod} · {u.birim}
              {u.yerKodu ? ` · Yer: ${u.yerKodu}` : ""}
            </Text>

            {u.pasif || u.satisDursun ? (
              <View style={s.uyariSerit}>
                <Text style={s.uyariYazi}>
                  {u.pasif ? "Pasif ürün" : "Satışı durdurulmuş ürün"}
                </Text>
              </View>
            ) : null}

            {/* 1.8: raf etiketinin karekodu okunduysa etiket denetimi.
                26.10.2026: etiket kimliği varsa ayrıntılı karşılaştırma */}
            {sonuc.etiketKaydi ? (
              <EtiketKaydiKart k={sonuc.etiketKaydi} />
            ) : sonuc.etiket ? (
              <View style={sonuc.etiket.guncel ? s.etiketTamam : s.uyariSerit}>
                <Text style={sonuc.etiket.guncel ? s.etiketTamamYazi : s.uyariYazi}>
                  {sonuc.etiket.guncel
                    ? `Etiket güncel${sonuc.etiket.basim ? ` · basım ${String(sonuc.etiket.basim).slice(8, 10)}.${String(sonuc.etiket.basim).slice(5, 7)}.${String(sonuc.etiket.basim).slice(0, 4)}` : ""}`
                    : sonuc.etiket.uyari}
                </Text>
              </View>
            ) : null}

            {/* Geçerli fiyat (09.10.2026): BiCard 0'dan büyükse BiCard,
                değilse raf. Diğer fiyat yanındaki küçük kutuda. */}
            <View style={s.rafKutu}>
              <Text style={s.rafBaslik}>
                {bicardli ? "BiCARD FİYATI" : "RAF FİYATI"}
              </Text>
              <Text style={s.rafFiyat}>{paraYaz(satisFiyati)}</Text>
            </View>

            <View style={s.ikiliSatir}>
              <View style={s.kucukKutu}>
                <Text style={s.kucukBaslik}>{bicardli ? "Raf fiyatı" : "Bicard"}</Text>
                <Text style={s.kucukDeger}>
                  {paraYaz(bicardli ? rafFiyat : u.bicardFiyat ?? u.fiyat2)}
                </Text>
              </View>

              <View style={s.kucukKutu}>
                <Text style={s.kucukBaslik}>Trendyol</Text>
                <Text style={s.kucukDeger}>{paraYaz(u.fiyat3)}</Text>
              </View>

              <View style={s.kucukKutu}>
                <Text style={s.kucukBaslik}>Stok</Text>
                <Text
                  style={[
                    s.kucukDeger,
                    (sonuc.stok ?? 0) <= 0 && { color: renk.kirmizi },
                  ]}
                >
                  {sonuc.stok ?? 0}
                </Text>
              </View>
            </View>

            {/* 26.10.2026: menşei ve son fiyat değişikliği */}
            {sonuc.mensei || u.sonFiyatTarihi ? (
              <View style={s.ekBilgi}>
                {sonuc.mensei ? (
                  <Text style={s.ekBilgiYazi}>
                    Menşei: <Text style={s.ekBilgiKalin}>{sonuc.mensei}</Text>
                  </Text>
                ) : null}
                {u.sonFiyatTarihi ? (
                  <Text style={s.ekBilgiYazi}>
                    Fiyat değişim:{" "}
                    <Text style={s.ekBilgiKalin}>
                      {`${String(u.sonFiyatTarihi).slice(8, 10)}.${String(u.sonFiyatTarihi).slice(5, 7)}.${String(u.sonFiyatTarihi).slice(0, 4)}`}
                    </Text>
                  </Text>
                ) : null}
              </View>
            ) : null}

            <SktKutu skt={sonuc.skt} />

            <UrunDurumu p={sonuc.pusula} />

            <TouchableOpacity style={s.ekleDugme} onPress={listeyeEkle}>
              <Text style={s.ekleYazi}>
                {liste.some((x) => x.barkod === u.barkod)
                  ? `Bir etiket daha ekle (listede ${liste.find((x) => x.barkod === u.barkod)?.adet ?? 1})`
                  : "Etiket listesine ekle"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {eklendi ? (
          <View style={s.eklendi}>
            <Simge ad="onay" boyut={14} renkli={renk.yesilKoyu} />
            <Text style={s.eklendiYazi} numberOfLines={2}>{eklendi}</Text>
          </View>
        ) : null}

        {/* --------------------------------------- insert ürünleri (26.10.2026) */}
        <TouchableOpacity style={s.insertKart} activeOpacity={0.85} onPress={() => setInsertAcik(true)}>
          <View style={s.insertSimge}>
            <Simge ad="etiket" boyut={20} renkli="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.insertBaslik}>Kampanyalar</Text>
            <Text style={s.insertAlt}>İnsert, Haftanın Ürünü, Tamamla Kazan… ürünleri fiyat ve tarihleriyle; seçip biŞube'ye gönderin</Text>
          </View>
          <Simge ad="ok" boyut={16} renkli={renk.pasif} />
        </TouchableOpacity>

        {/* ------------------------------------------------------ liste */}
        {liste.length > 0 ? (
          <View style={s.kart}>
            <Text style={s.listeBaslik}>
              Etiket listesi · {liste.length} ürün, {toplamEtiket} etiket
            </Text>
            <Text style={s.listeIpucu}>Liste kaydediliyor; uygulamayı kapatsanız da kaybolmaz.</Text>

            {liste.map((x) => (
              <View key={x.barkod} style={s.listeSatir}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.listeAd} numberOfLines={1}>
                    {x.urunAdi}
                  </Text>
                  <Text style={s.listeBarkod}>{x.barkod}</Text>
                </View>

                <View style={s.adetKutu}>
                  <TouchableOpacity
                    style={s.adetDugme}
                    onPress={() => adetDegistir(x.barkod, -1)}
                    disabled={(x.adet ?? 1) <= 1}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Text style={[s.adetIsaret, (x.adet ?? 1) <= 1 && { color: "#c3cabb" }]}>−</Text>
                  </TouchableOpacity>
                  <Text style={s.adetDeger}>{x.adet ?? 1}</Text>
                  <TouchableOpacity
                    style={s.adetDugme}
                    onPress={() => adetDegistir(x.barkod, 1)}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Text style={s.adetIsaret}>+</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => setListe((o) => o.filter((y) => y.barkod !== x.barkod))}
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                >
                  <Text style={s.listeSil}>Sil</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity style={s.gonderDugme} onPress={listeyiGonder}>
              <Text style={s.ekleYazi}>Şubeye gönder · {toplamEtiket} etiket</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ------------------------------------------- son gönderilen listeler */}
        {sonListeler.length > 0 ? (
          <View style={s.kart}>
            <Text style={s.listeBaslik}>Son gönderdiğiniz listeler</Text>

            {sonListeler.map((l) => {
              const acik = acikListe === l.id;
              const tarih = new Date(l.olusturma);
              return (
                <View key={l.id} style={s.sonListe}>
                  <TouchableOpacity
                    style={s.sonListeUst}
                    onPress={() => setAcikListe(acik ? null : l.id)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.sonListeKod}>{l.rfKodu}</Text>
                      <Text style={s.listeBarkod}>
                        {tarih.toLocaleDateString("tr-TR")} {tarih.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {l.subeAdi ?? ""} · {l.adet} etiket
                      </Text>
                    </View>
                    <View style={[s.durumHap, { backgroundColor: l.alindi ? renk.yesilAcik : renk.turuncuAcik }]}>
                      <Text style={[s.durumYazi, { color: l.alindi ? renk.yesilKoyu : renk.turuncuKoyu }]}>
                        {l.alindi ? "şube aldı" : "bekliyor"}
                      </Text>
                    </View>
                    <Text style={s.acKapa}>{acik ? "▴" : "▾"}</Text>
                  </TouchableOpacity>

                  {acik ? (
                    <View style={{ paddingTop: 6 }}>
                      {(l.kalemler ?? []).map((k) => (
                        <View key={k.barkod} style={s.sonKalem}>
                          <Text style={[s.listeAd, { flex: 1 }]} numberOfLines={1}>
                            {k.urunAdi ?? k.barkod}
                          </Text>
                          <Text style={s.sonKalemAdet}>× {k.adet}</Text>
                        </View>
                      ))}
                      <TouchableOpacity style={s.geriAlDugme} onPress={() => geriAl(l)}>
                        <Text style={s.geriAlYazi}>Bu listeyi etiket listesine al</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      <Pencere veri={pencere} kapat={() => setPencere(null)} />

      <InsertUrunleri
        acik={insertAcik}
        kapat={() => setInsertAcik(false)}
        subeKodu={secilen}
        eposta={subeler.find((x) => x.subeKodu === secilen)?.eposta}
        gonderildi={(c, n) => {
          setInsertAcik(false);
          sonListeleriGetir();
          setPencere({
            tur: "basari",
            baslik: "Kampanya etiketleri gönderildi",
            metin: `${n} ürün şubenin etiket programına iletildi. biŞube'de Mobilden düğmesinden açılır.`
              + (c?.rfKodu ? `\n\nListe kodu: ${c.rfKodu}` : "")

          });
        }}
      />
    </SafeAreaView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },

  engelKutu: {
    margin: 16,
    padding: 22,
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderRadius: olcu.kartYuvarlak,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  engelSimge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: renk.turuncuAcik,
    alignItems: "center",
    justifyContent: "center",
  },
  engelBaslik: { fontSize: 17, fontWeight: "700", color: renk.metin },
  engelMetin: {
    fontSize: 14,
    lineHeight: 21,
    color: renk.pasif,
    textAlign: "center",
  },
  govde: { padding: 16, paddingBottom: 110 },

  subeSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  subeYazi: { flex: 1, fontSize: 14.5, fontWeight: "600", color: renk.metin },
  subeDegis: { fontSize: 12.5, color: renk.yesilKoyu, fontWeight: "600" },

  subeListe: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    marginTop: 6,
    overflow: "hidden",
  },
  subeSec: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },
  subeSecili: { backgroundColor: renk.yesilAcik },
  subeSecYazi: { fontSize: 14, color: renk.metin },
  depoYok: { fontSize: 11, color: renk.turuncuKoyu },

  /* Kamera açık kalıyor: reyonda arka arkaya okutma yapılıyor */
  kameraKutu: {
    height: 300,
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 12,
    backgroundColor: "#000",
  },
  kamera: { flex: 1 },

  kameraKaplama: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    elevation: 5,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Barkod yatay ve uzun: dikdörtgen çerçeve doğru tutuşu
     kendiliğinden öğretiyor. */
  hedef: {
    width: "78%",
    height: 110,
    borderRadius: 12,
  },

  kose: {
    position: "absolute",
    width: 26,
    height: 26,
    borderColor: renk.yesil,
  },
  koseSolUst: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
  },
  koseSagUst: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 12,
  },
  koseSolAlt: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 12,
  },
  koseSagAlt: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 12,
  },

  kameraYazi: {
    color: "#fff",
    fontSize: 13.5,
    textAlign: "center",
    marginTop: 18,
    paddingHorizontal: 30,
  },

  kameraKapat: {
    marginTop: 20,
    backgroundColor: "rgba(0,0,0,.6)",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  kameraKapatYazi: { color: renk.beyaz, fontSize: 13, fontWeight: "600" },

  okutDugme: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: renk.yesil,
    paddingVertical: 15,
    borderRadius: 12,
    marginTop: 12,
  },
  okutYazi: { fontSize: 15.5, fontWeight: "700", color: renk.beyaz },

  elleSatir: { flexDirection: "row", gap: 8, marginTop: 10 },
  girdi: {
    flex: 1,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 14.5,
    color: renk.metin,
  },
  sorguDugme: {
    paddingHorizontal: 18,
    justifyContent: "center",
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 11,
  },
  sorguYazi: { fontSize: 14, fontWeight: "700", color: renk.metin },

  kart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.yuvarlak,
    padding: 15,
    marginTop: 14,
  },
  gorsel: {
    width: "100%",
    height: 150,
    backgroundColor: renk.zemin,
    borderRadius: 10,
    marginBottom: 12,
  },
  urunAd: { fontSize: 16.5, fontWeight: "700", color: renk.metin },
  urunKunye: { fontSize: 12, color: renk.pasif, marginTop: 3 },

  uyariSerit: {
    backgroundColor: "#fff1f0",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginTop: 9,
  },
  uyariYazi: { fontSize: 12.5, color: renk.kirmizi, fontWeight: "600" },
  etiketTamam: {
    backgroundColor: renk.yesilAcik,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginTop: 9,
  },
  insertKart: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e6efd6",
  },
  insertSimge: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#c2410c", alignItems: "center", justifyContent: "center" },
  insertBaslik: { fontSize: 15, fontWeight: "800", color: renk.metin },
  insertAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  ekBilgi: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 10, paddingHorizontal: 2 },
  ekBilgiYazi: { fontSize: 12.5, color: renk.pasif },
  ekBilgiKalin: { color: renk.metin, fontWeight: "700" },
  etiketTamamYazi: { fontSize: 12.5, color: renk.yesilKoyu ?? renk.metin, fontWeight: "600" },

  /* Raf fiyatı büyük: personelin baktığı ilk sayı bu */
  rafKutu: {
    backgroundColor: renk.yesilAcik,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  rafBaslik: {
    fontSize: 11,
    fontWeight: "800",
    color: renk.yesilKoyu,
    letterSpacing: 0.6,
  },
  rafFiyat: { fontSize: 30, fontWeight: "800", color: renk.yesilKoyu, marginTop: 3 },

  ikiliSatir: { flexDirection: "row", gap: 8, marginTop: 10 },
  kucukKutu: {
    flex: 1,
    backgroundColor: renk.zemin,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  kucukBaslik: { fontSize: 11, color: renk.pasif },
  kucukDeger: { fontSize: 15, fontWeight: "700", color: renk.metin, marginTop: 2 },

  ekleDugme: {
    backgroundColor: renk.yesil,
    paddingVertical: 13,
    borderRadius: 11,
    alignItems: "center",
    marginTop: 14,
  },
  ekleYazi: { fontSize: 14.5, fontWeight: "700", color: renk.beyaz },

  listeBaslik: { fontSize: 14.5, fontWeight: "700", color: renk.metin, marginBottom: 8 },
  listeIpucu: { fontSize: 11.5, color: renk.pasif, marginTop: -4, marginBottom: 8 },
  adetKutu: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 10,
    marginHorizontal: 8,
  },
  adetDugme: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  adetIsaret: { fontSize: 18, fontWeight: "800", color: renk.yesilKoyu },
  adetDeger: { minWidth: 22, textAlign: "center", fontSize: 14.5, fontWeight: "800", color: renk.metin },
  eklendi: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: renk.yesilAcik,
  },
  eklendiYazi: { flex: 1, fontSize: 13, fontWeight: "600", color: renk.yesilKoyu },
  sonListe: { borderTopWidth: 1, borderTopColor: "#f0f2ee", paddingVertical: 10 },
  sonListeUst: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  sonListeKod: { fontSize: 14, fontWeight: "800", color: renk.metin },
  durumHap: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  durumYazi: { fontSize: 11.5, fontWeight: "700" },
  acKapa: { fontSize: 14, color: renk.pasif, width: 18, textAlign: "center" },
  sonKalem: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  sonKalemAdet: { fontSize: 13, fontWeight: "700", color: renk.pasif },
  geriAlDugme: {
    marginTop: 8,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: renk.yesil,
    backgroundColor: renk.yesilAcik,
  },
  geriAlYazi: { fontSize: 13.5, fontWeight: "700", color: renk.yesilKoyu },
  listeSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f4f0",
  },
  listeAd: { fontSize: 13.5, color: renk.metin },
  listeBarkod: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  listeSil: { fontSize: 12.5, color: renk.kirmizi, fontWeight: "600" },

  gonderDugme: {
    backgroundColor: renk.mavi,
    paddingVertical: 13,
    borderRadius: 11,
    alignItems: "center",
    marginTop: 12,
  },
});

/* ------------------------------------------------------------------ */
/* Ürün durumu (30.10.2026): Pusula'dan şubenin satırı                 */
/* ------------------------------------------------------------------ */

const DURUM_RENGI = {
  DS: ["#e8f1fb", "#1f4f82"],
  SS: ["#fff3e5", "#b45309"],
  YS: ["#fdecec", "#b42318"],
  MK: ["#f3ecfb", "#6b3fa0"],
  ÜS: ["#fff8e1", "#8a6d00"],
  ÜY: ["#fff8e1", "#8a6d00"],
};

const sayiYaz = (v, ondalik = 0) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: ondalik });

function UrunDurumu({ p }) {
  if (!p) return null;
  const [zemin, yazi] = DURUM_RENGI[p.sembol] ?? ["#f1f3ef", renk.metin];
  const saat = p.hesapZamani
    ? `${String(p.hesapZamani).slice(8, 10)}.${String(p.hesapZamani).slice(5, 7)} ${String(p.hesapZamani).slice(11, 16)}`
    : "";

  return (
    <View style={ud.kutu}>
      <View style={ud.ust}>
        <Text style={ud.baslik}>Ürün durumu</Text>
        {p.sembol ? (
          <View style={[ud.hap, { backgroundColor: zemin }]}>
            <Text style={[ud.hapYazi, { color: yazi }]}>
              {p.durumAdi && p.durumAdi !== p.sembol ? `${p.sembol} · ${p.durumAdi}` : p.sembol}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={ud.satir}>
        <View style={ud.hucre}>
          <Text style={ud.etiket}>Sıra</Text>
          <Text style={ud.deger}>{p.sira ? `#${sayiYaz(p.sira)}` : "—"}</Text>
        </View>
        <View style={ud.hucre}>
          <Text style={ud.etiket}>21 gün satış</Text>
          <Text style={ud.deger}>{sayiYaz(p.satis21, 1)}</Text>
        </View>
        <View style={ud.hucre}>
          <Text style={ud.etiket}>Stok günü</Text>
          <Text style={ud.deger}>{p.satisYok ? "Satış yok" : sayiYaz(p.sdg, 1)}</Text>
        </View>
      </View>

      <Text style={ud.alt}>
        {p.tip ? `${p.tip} · ` : ""}Pusula {saat}
      </Text>
    </View>
  );
}

const ud = StyleSheet.create({
  kutu: { marginTop: 12, borderWidth: 1, borderColor: "#e3e6e1", borderRadius: 12, padding: 12, backgroundColor: "#fbfcfa" },
  ust: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  baslik: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  hap: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, flexShrink: 1 },
  hapYazi: { fontSize: 12, fontWeight: "700" },
  satir: { flexDirection: "row", gap: 8 },
  hucre: { flex: 1 },
  etiket: { fontSize: 11.5, color: renk.pasif },
  deger: { fontSize: 15, fontWeight: "800", color: renk.metin, marginTop: 2 },
  alt: { fontSize: 11.5, color: renk.pasif, marginTop: 8 },
});

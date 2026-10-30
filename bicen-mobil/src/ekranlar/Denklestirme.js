/**
 * Denkleştirme (23.10.2026)
 * ---------------------------------------------------------------------------
 * Fazla çalışma ücret yerine ×1,5 izin alacağı; erken çıkış / geç geliş
 * bire bir borç (kapatmak için borcun 1,5'te biri kadar fazla çalışma
 * yeter); denkleştirme izni alacaktan düşer.
 *
 * Akış: form → çıktı al, imzala → imzalı formu yükle → yönetici onayı →
 * İK onayı. Bakiyeye yalnız İK'nın onayladıkları işlenir. Fazla mesai
 * modülünde onaylanıp karşılığı "izin" olanlar kendiliğinden gelir.
 *
 * DenklestirmeOnay: yöneticinin onay listesi (Yönetici İşlemleri'nden).
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import {
  denklestirmeOzetAl,
  denklestirmeFormGonder,
  denklestirmeIptal,
  denklestirmeImzaliYukle,
  denklestirmeOnayAl,
  denklestirmeKarar,
  oturumluAdres,
} from "../api";
import { galeridenSec, kameradanCek } from "../dosyaSecici";
import { renk } from "../tema";
import { useKlavye, klavyePayi } from "../klavye";

const CARPAN = 1.5;
const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUNLER = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

const YESIL = "#5f8c10";
const YESIL_A = "#eef5e1";
const TURUNCU = "#b45309";
const TURUNCU_A = "#fff6e5";
const MAVI = "#1d63b8";
const MAVI_A = "#eaf2fc";
const KIRMIZI = "#c2410c";
const KIRMIZI_A = "#fff1ec";

const TURLER = [
  { kod: "fazla", ad: "Fazla çalıştım", alt: "ücret yerine izin alacağım (×1,5)", isaret: "+", renk: YESIL, zemin: YESIL_A },
  { kod: "eksik", ad: "Erken çıktım / geç geldim", alt: "eksik çalışmamı sonra kapatacağım", isaret: "−", renk: TURUNCU, zemin: TURUNCU_A },
  { kod: "izin", ad: "Denkleştirme izni kullanacağım", alt: "alacağımdan düşülür", isaret: "İ", renk: MAVI, zemin: MAVI_A },
];
const TUR = Object.fromEntries(TURLER.map((t) => [t.kod, t]));

const DURUM = {
  imza: { ad: "İmzalı form bekleniyor", renk: MAVI, zemin: MAVI_A },
  yonetici: { ad: "Yönetici onayında", renk: TURUNCU, zemin: TURUNCU_A },
  ik: { ad: "İK onayında", renk: TURUNCU, zemin: TURUNCU_A },
  onaylandi: { ad: "Onaylandı", renk: YESIL, zemin: YESIL_A },
  reddedildi: { ad: "Reddedildi", renk: KIRMIZI, zemin: KIRMIZI_A },
};

export const sure = (dk) => {
  dk = Math.round(Math.abs(dk ?? 0));
  const s = Math.floor(dk / 60);
  const d = dk % 60;
  return s && d ? `${s} sa ${d} dk` : s ? `${s} sa` : `${d} dk`;
};
export const isaretli = (dk) => (dk > 0 ? "+" : dk < 0 ? "−" : "") + (dk ? sure(dk) : "0");

const isoGun = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const gunOku = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const kisaTarih = (s) => {
  const d = gunOku(s);
  return d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}` : "";
};
const saatBicim = (v) => {
  const r = String(v).replace(/\D/g, "").slice(0, 4);
  return r.length <= 2 ? r : `${r.slice(0, 2)}:${r.slice(2)}`;
};
const dakika = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const d = Number(m[2]);
  if (h === 24 && d === 0) return 1440;
  if (h > 23 || d > 59) return null;
  return h * 60 + d;
};

/* ========================================================================== */

export default function Denklestirme() {
  return <Kendi />;
}

/** Yöneticinin onay listesi: ayrı ekran adıyla (DenklestirmeOnay) */
export function DenklestirmeOnay() {
  return <OnayListesi />;
}

/* ------------------------------------------------------------- personel */

function Kendi() {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [gorunum, setGorunum] = useState("liste"); // liste | form | detay
  const [secili, setSecili] = useState(null);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await denklestirmeOzetAl());
      setHata("");
    } catch (h) {
      setHata(h.message);
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const geri = gorunum !== "liste" ? () => setGorunum("liste") : undefined;

  if (!veri && hata) return <Hata metin={hata} />;
  if (!veri) return <Yukleniyor />;

  if (gorunum === "form")
    return (
      <SafeAreaView style={s.tam} edges={["top"]}>
        <BarBaslik ad="Denkleştirme formu" acik geri={geri} />
        <Form
          bakiye={veri.bakiye?.netDk ?? 0}
          olustu={(k) => {
            getir();
            setSecili(k);
            setGorunum("detay");
          }}
        />
      </SafeAreaView>
    );

  if (gorunum === "detay" && secili)
    return (
      <SafeAreaView style={s.tam} edges={["top"]}>
        <BarBaslik ad={`Form ${secili.formNo}`} acik geri={geri} />
        <Detay
          k={secili}
          degisti={(yeni) => {
            getir();
            if (yeni) setSecili(yeni);
            else setGorunum("liste");
          }}
        />
      </SafeAreaView>
    );

  const b = veri.bakiye ?? {};
  const formlar = veri.formlar ?? [];
  const bekleyen = formlar.filter((f) => ["imza", "yonetici", "ik"].includes(f.durum));
  const gecerli = [
    ...formlar.filter((f) => f.durum === "onaylandi").map((f) => ({ ...f, kaynak: "form" })),
    ...(veri.fazlaMesai ?? []).map((f) => ({ ...f, kaynak: "fazlamesai" })),
  ].sort((a, c) => (a.tarih < c.tarih ? 1 : -1));
  const reddedilen = formlar.filter((f) => f.durum === "reddedildi").slice(0, 5);

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Denkleştirme" acik />
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        <View style={s.bakiye}>
          <Text style={s.bakiyeEt}>DENKLEŞTİRME BAKİYEM</Text>
          <Text style={s.bakiyeSay}>{isaretli(b.netDk ?? 0)}</Text>
          <Text style={s.bakiyeAlt}>
            {(b.netDk ?? 0) > 0
              ? "alacaklısınız · denkleştirme izni olarak kullanabilirsiniz"
              : (b.netDk ?? 0) < 0
              ? `borçlusunuz · kapatmak için ${sure(Math.abs(b.netDk) / CARPAN)} fazla çalışma yeterli`
              : "alacak ya da borcunuz yok"}
          </Text>
          <View style={s.ucl}>
            <View style={s.uclK}>
              <Text style={s.uclE}>Alacak</Text>
              <Text style={s.uclD}>+{sure(b.alacakDk ?? 0)}</Text>
            </View>
            <View style={s.uclK}>
              <Text style={s.uclE}>Borç / kullanılan</Text>
              <Text style={s.uclD}>−{sure(b.borcDk ?? 0)}</Text>
            </View>
            <View style={s.uclK}>
              <Text style={s.uclE}>Onay bekleyen</Text>
              <Text style={s.uclD}>{b.bekleyen ?? 0} form</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={s.ana} activeOpacity={0.85} onPress={() => setGorunum("form")}>
          <Text style={s.anaYazi}>＋ Denkleştirme formu doldur</Text>
        </TouchableOpacity>

        {bekleyen.length > 0 && <Text style={s.grup}>SÜREÇTE · {bekleyen.length}</Text>}
        {bekleyen.map((f) => (
          <HareketSatiri
            key={f.id}
            f={f}
            onPress={() => {
              setSecili(f);
              setGorunum("detay");
            }}
          />
        ))}

        <Text style={s.grup}>GEÇERLİ HAREKETLER</Text>
        {gecerli.length === 0 ? (
          <Text style={s.bos}>Henüz onaylanmış bir hareket yok.</Text>
        ) : (
          gecerli.map((f) => (
            <HareketSatiri
              key={`${f.kaynak}${f.id}`}
              f={f}
              onPress={
                f.kaynak === "form"
                  ? () => {
                      setSecili(f);
                      setGorunum("detay");
                    }
                  : undefined
              }
            />
          ))
        )}

        {reddedilen.length > 0 && <Text style={s.grup}>REDDEDİLEN</Text>}
        {reddedilen.map((f) => (
          <HareketSatiri
            key={f.id}
            f={f}
            onPress={() => {
              setSecili(f);
              setGorunum("detay");
            }}
          />
        ))}

        <Text style={s.dip}>
          Fazla çalışma ×1,5 alacak yazılır; erken çıkış ve geç geliş bire bir borçtur. Fazla mesai modülünde onaylanıp karşılığı izin
          olan çalışmalar buraya kendiliğinden gelir. Formlar İK onayından sonra geçerlidir.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function HareketSatiri({ f, onPress }) {
  const fm = f.kaynak === "fazlamesai";
  const t = TUR[f.tur] ?? TUR.fazla;
  const d = !fm && f.durum !== "onaylandi" ? DURUM[f.durum] : null;
  const etki = f.etkiDk ?? 0;
  return (
    <TouchableOpacity style={s.satir} activeOpacity={onPress ? 0.8 : 1} onPress={onPress} disabled={!onPress}>
      <View style={[s.ik, { backgroundColor: t.zemin }]}>
        <Text style={[s.ikYazi, { color: t.renk }]}>{fm ? "FM" : t.isaret}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.satirAd} numberOfLines={1}>
          {fm ? "Fazla mesai" : f.turAdi} · {sure(f.dk)}
        </Text>
        <Text style={s.satirAlt} numberOfLines={1}>
          {kisaTarih(f.tarih)} · {f.baslangic}–{f.bitis}
          {fm ? " · fazla mesai modülünden" : f.aciklama ? ` · ${f.aciklama}` : ""}
        </Text>
        {d ? (
          <View style={[s.hap, { backgroundColor: d.zemin }]}>
            <Text style={[s.hapYazi, { color: d.renk }]}>{d.ad}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.etki, { color: f.durum === "reddedildi" ? renk.pasif : etki >= 0 ? YESIL : KIRMIZI }]}>{isaretli(etki)}</Text>
        <Text style={s.etkiAlt}>{f.tur === "fazla" ? "×1,5" : f.tur === "izin" ? "izin" : "borç"}</Text>
      </View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------- form */

function Form({ bakiye, olustu }) {
  const klavye = useKlavye();
  const [tur, setTur] = useState("fazla");
  const [tarih, setTarih] = useState(isoGun(new Date()));
  const [bas, setBas] = useState("");
  const [bit, setBit] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState("");

  const bugun = new Date();
  const gunler =
    tur === "izin"
      ? Array.from({ length: 45 }, (_, i) => {
          const d = new Date(bugun);
          d.setDate(d.getDate() + i);
          return d;
        })
      : Array.from({ length: 31 }, (_, i) => {
          const d = new Date(bugun);
          d.setDate(d.getDate() - i);
          return d;
        });

  const b = dakika(bas);
  const e = dakika(bit);
  let dk = b != null && e != null ? e - b : null;
  if (dk != null && dk <= 0) dk += 1440;

  const turSec = (k) => {
    setTur(k);
    setHata("");
    if (k === "izin" ? tarih < isoGun(bugun) : tarih > isoGun(bugun)) setTarih(isoGun(bugun));
  };

  const gonder = async () => {
    if (dk == null) return setHata("Başlangıç ve bitiş saatini yazınız (ör. 18:00).");
    if (dk < 15) return setHata("Süre en az 15 dakika olmalı.");
    if (dk > 16 * 60) return setHata("Süre 16 saati geçemez.");
    if (tur !== "izin" && aciklama.trim().length < 3) return setHata("Kısa bir açıklama yazınız (ör. sayım, doktor).");
    setGonderiliyor(true);
    setHata("");
    try {
      const k = await denklestirmeFormGonder({ tur, tarih, baslangic: bas, bitis: bit, aciklama: aciklama.trim() });
      olustu(k);
    } catch (h) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const t = TUR[tur];

  return (
    <ScrollView
      contentContainerStyle={[s.govde, { paddingBottom: 120 + klavyePayi(klavye) }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {TURLER.map((x) => (
        <TouchableOpacity key={x.kod} style={[s.tur, tur === x.kod && s.turOn]} activeOpacity={0.85} onPress={() => turSec(x.kod)}>
          <View style={[s.ik, { backgroundColor: x.zemin }]}>
            <Text style={[s.ikYazi, { color: x.renk }]}>{x.isaret}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.satirAd}>{x.ad}</Text>
            <Text style={s.satirAlt}>{x.alt}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={s.etiket}>Tarih</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {gunler.map((d, i) => {
          const g = isoGun(d);
          const sec = g === tarih;
          const ad = tur === "izin" ? (i === 0 ? "Bugün" : i === 1 ? "Yarın" : GUNLER[d.getDay()]) : i === 0 ? "Bugün" : i === 1 ? "Dün" : GUNLER[d.getDay()];
          return (
            <TouchableOpacity key={g} style={[s.gun, sec && s.gunOn]} onPress={() => setTarih(g)}>
              <Text style={[s.gunUst, sec && s.beyaz]}>{ad}</Text>
              <Text style={[s.gunAlt, sec && s.beyaz]}>
                {d.getDate()} {AYLAR[d.getMonth()]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.etiket}>{tur === "eksik" ? "Çıkış / ayrılış" : "Başlangıç"}</Text>
          <TextInput
            style={s.girdi}
            value={bas}
            onChangeText={(v) => setBas(saatBicim(v))}
            placeholder={tur === "eksik" ? "15:00" : "19:00"}
            placeholderTextColor="#b6bcb1"
            keyboardType="number-pad"
            maxLength={5}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.etiket}>{tur === "eksik" ? "Vardiya bitişi" : "Bitiş"}</Text>
          <TextInput
            style={s.girdi}
            value={bit}
            onChangeText={(v) => setBit(saatBicim(v))}
            placeholder={tur === "eksik" ? "18:00" : "00:00"}
            placeholderTextColor="#b6bcb1"
            keyboardType="number-pad"
            maxLength={5}
          />
        </View>
      </View>
      {tur === "eksik" ? (
        <Text style={s.ipucu}>Geç geldiyseniz: başlangıç vardiya başı, bitiş geldiğiniz saat.</Text>
      ) : null}

      <Text style={s.etiket}>Açıklama{tur === "izin" ? " (isteğe bağlı)" : ""}</Text>
      <TextInput
        style={[s.girdi, { minHeight: 64, textAlignVertical: "top", fontSize: 15 }]}
        value={aciklama}
        onChangeText={setAciklama}
        placeholder={tur === "eksik" ? "ör. doktor randevusu" : tur === "fazla" ? "ör. ay sonu sayımı" : ""}
        placeholderTextColor="#b6bcb1"
        multiline
        maxLength={500}
      />

      <Hesap tur={tur} dk={dk} bakiye={bakiye} />

      {hata ? <Text style={s.hata}>{hata}</Text> : null}

      <TouchableOpacity style={[s.ana, gonderiliyor && { opacity: 0.6 }]} disabled={gonderiliyor} onPress={gonder} activeOpacity={0.85}>
        {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Text style={s.anaYazi}>Formu oluştur</Text>}
      </TouchableOpacity>
      <Text style={[s.dip, { textAlign: "center" }]}>
        Form, çıktısını imzalayıp yükledikten sonra {t.kod === "izin" ? "onaya" : "yöneticinize ve İK'ya"} gider.
      </Text>
    </ScrollView>
  );
}

export function Hesap({ tur, dk, bakiye }) {
  if (dk == null)
    return (
      <View style={[s.hesap, { backgroundColor: "#f4f6f1", borderColor: renk.cizgi }]}>
        <Text style={s.satirAlt}>Saatleri yazınca bakiyenize etkisi burada görünür.</Text>
      </View>
    );
  if (tur === "fazla") {
    const etki = Math.round(dk * CARPAN);
    return (
      <View style={[s.hesap, { backgroundColor: YESIL_A, borderColor: "#cfe2ae" }]}>
        <Satir a="Fazla çalışma" b={sure(dk)} />
        <Satir a="Katsayı" b="× 1,5" />
        <Text style={[s.hesapBuyuk, { color: "#4a6e0c" }]}>+{sure(etki)} alacak</Text>
        <Satir a="Bakiyeniz" b={`${isaretli(bakiye)} → ${isaretli(bakiye + etki)}`} />
        <Text style={s.hesapNot}>Fazla mesai modülünde onaylanan çalışmalar zaten kendiliğinden eklenir; aynı saati iki kez girmeyin.</Text>
      </View>
    );
  }
  if (tur === "eksik") {
    const gerek = Math.ceil(dk / CARPAN);
    return (
      <View style={[s.hesap, { backgroundColor: TURUNCU_A, borderColor: "#f4d9a8" }]}>
        <Satir a="Eksik çalışma" b={sure(dk)} />
        <Text style={[s.hesapBuyuk, { color: KIRMIZI }]}>−{sure(dk)} borç</Text>
        <Satir a="Kapatmak için gereken fazla çalışma" b={sure(gerek)} />
        <Satir a="Bakiyeniz" b={`${isaretli(bakiye)} → ${isaretli(bakiye - dk)}`} />
        <Text style={s.hesapNot}>
          {bakiye >= dk
            ? "Alacağınız bu süreyi karşılıyor, ek çalışma gerekmez."
            : `${sure(dk)} eksik çalışma → ${sure(gerek)} fazla çalışma yeterli (${sure(gerek)} × 1,5 = ${sure(dk)}).`}
        </Text>
      </View>
    );
  }
  return (
    <View style={[s.hesap, { backgroundColor: MAVI_A, borderColor: "#c7dbf3" }]}>
      <Satir a="Kullanılacak izin" b={sure(dk)} />
      <Text style={[s.hesapBuyuk, { color: MAVI }]}>−{sure(dk)}</Text>
      <Satir a="Bakiyeniz" b={`${isaretli(bakiye)} → ${isaretli(bakiye - dk)}`} />
      {bakiye >= dk ? (
        <Text style={s.hesapNot}>Alacağınızdan düşülür.</Text>
      ) : (
        <Text style={[s.hesapNot, { color: KIRMIZI, fontWeight: "700" }]}>
          Alacağınız {sure(Math.max(0, bakiye))}; {sure(dk - Math.max(0, bakiye))} borç olarak yazılır.
        </Text>
      )}
    </View>
  );
}

const Satir = ({ a, b }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
    <Text style={s.hesapA}>{a}</Text>
    <Text style={s.hesapB}>{b}</Text>
  </View>
);

/* ------------------------------------------------------------- detay */

function Detay({ k, degisti }) {
  const [yukleniyor, setYukleniyor] = useState(false);
  const d = DURUM[k.durum] ?? DURUM.imza;
  const imzaAsamasi = ["imza", "yonetici"].includes(k.durum);
  const bitmis = ["onaylandi", "reddedildi"].includes(k.durum);

  const formuAc = () =>
    Linking.openURL(oturumluAdres(`/api/Denklestirme/${k.id}/Form`)).catch(() => Alert.alert("Açılamadı", "Form açılamadı; bağlantınızı kontrol edin."));

  const yukle = async (kaynak) => {
    try {
      const r =
        kaynak === "kamera"
          ? await kameradanCek({ quality: 0.6 })
          : await galeridenSec({ quality: 0.6 }, { pdfDahil: true });
      const a = r?.assets?.[0];
      if (r?.canceled || !a) return;
      setYukleniyor(true);
      const c = await denklestirmeImzaliYukle(k.id, { uri: a.uri, ad: a.fileName ?? `denklestirme_${k.id}.jpg`, tip: a.mimeType ?? "image/jpeg" });
      Alert.alert("Yüklendi", c?.durum === "ik" ? "Form İK onayına gönderildi." : "Form yöneticinizin onayına gönderildi.");
      degisti({ ...k, durum: c?.durum ?? "yonetici", belgeVar: true });
    } catch (h) {
      Alert.alert("Yüklenemedi", h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const iptal = () =>
    Alert.alert("Form iptal edilsin mi?", "İptal edilen form onaya gitmez.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "İptal et",
        style: "destructive",
        onPress: async () => {
          try {
            await denklestirmeIptal(k.id);
            degisti(null);
          } catch (h) {
            Alert.alert("İptal edilemedi", h.message);
          }
        },
      },
    ]);

  const adim = (n, ad, alt, durum, icerik) => (
    <View style={s.adim}>
      <View style={s.adimSol}>
        <View style={[s.adimN, durum === "tamam" && s.adimTamam, durum === "simdi" && s.adimSimdi]}>
          <Text style={[s.adimNYazi, durum === "tamam" && { color: "#fff" }, durum === "simdi" && { color: YESIL }]}>
            {durum === "tamam" ? "✓" : n}
          </Text>
        </View>
        {n < 5 ? <View style={[s.adimCizgi, durum === "tamam" && { backgroundColor: YESIL }]} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: 14 }}>
        <Text style={s.satirAd}>{ad}</Text>
        {alt ? <Text style={s.satirAlt}>{alt}</Text> : null}
        {icerik}
      </View>
    </View>
  );

  const yon = k.durum === "imza" || k.durum === "yonetici" ? (k.durum === "yonetici" ? "simdi" : "") : "tamam";
  const ik = k.durum === "onaylandi" ? "tamam" : k.durum === "ik" ? "simdi" : "";

  return (
    <ScrollView contentContainerStyle={s.govde}>
      <View style={s.kart}>
        <View style={[s.hap, { backgroundColor: d.zemin, alignSelf: "flex-start" }]}>
          <Text style={[s.hapYazi, { color: d.renk }]}>{d.ad}</Text>
        </View>
        <Text style={[s.satirAd, { fontSize: 17, marginTop: 6 }]}>
          {k.turAdi} · {sure(k.dk)}
        </Text>
        <Text style={s.satirAlt}>
          {kisaTarih(k.tarih)} · {k.baslangic}–{k.bitis}
          {k.aciklama ? ` · ${k.aciklama}` : ""}
        </Text>
        <View style={{ marginTop: 8, gap: 3 }}>
          <Satir a="Bakiyeye etkisi" b={isaretli(k.etkiDk)} />
          {k.tur === "eksik" ? <Satir a="Kapatmak için gereken fazla çalışma" b={sure(Math.ceil(k.dk / CARPAN))} /> : null}
        </View>
        {k.durum === "reddedildi" && k.redNedeni ? <Text style={[s.hata, { marginTop: 8 }]}>Red sebebi: {k.redNedeni}</Text> : null}
      </View>

      {k.durum !== "reddedildi" && (
        <View style={s.kart}>
          {adim(1, "Form dolduruldu", null, "tamam")}
          {adim(
            2,
            "Çıktı al ve imzala",
            "Siz ve yöneticiniz imzalayın.",
            k.belgeVar ? "tamam" : "simdi",
            <TouchableOpacity style={s.ikinci} onPress={formuAc}>
              <Text style={s.ikinciYazi}>⎙ Formu aç / yazdır</Text>
            </TouchableOpacity>
          )}
          {adim(
            3,
            "İmzalı formu yükle",
            k.belgeVar ? "Yüklendi" : "Fotoğrafını çekin ya da PDF seçin.",
            k.belgeVar ? "tamam" : "simdi",
            imzaAsamasi ? (
              yukleniyor ? (
                <ActivityIndicator color={YESIL} style={{ marginTop: 10, alignSelf: "flex-start" }} />
              ) : (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TouchableOpacity style={[s.ana, { flex: 1, paddingVertical: 11, marginTop: 0 }]} onPress={() => yukle("kamera")}>
                    <Text style={s.anaYazi}>{k.belgeVar ? "Yeniden çek" : "Fotoğraf çek"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.ikinci, { flex: 1, marginTop: 0 }]} onPress={() => yukle("galeri")}>
                    <Text style={s.ikinciYazi}>Galeri / PDF</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : null
          )}
          {adim(4, "Yönetici onayı", k.yoneticiAd ? `${k.yoneticiAd}` : null, yon)}
          {adim(5, "İK onayı", k.durum === "onaylandi" ? "Bakiyenize işlendi" : "Onaylanınca bakiyenize işlenir", ik)}
        </View>
      )}

      {!bitmis && (
        <TouchableOpacity style={s.kirmiziD} onPress={iptal}>
          <Text style={{ color: KIRMIZI, fontWeight: "700" }}>Formu iptal et</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------- yönetici */

function OnayListesi() {
  const klavye = useKlavye();
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [islenen, setIslenen] = useState(null);
  const [red, setRed] = useState(null);
  const [sebep, setSebep] = useState("");

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await denklestirmeOnayAl());
      setHata("");
    } catch (h) {
      setHata(h.message);
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  const karar = async (id, onay, not) => {
    setIslenen(id);
    try {
      await denklestirmeKarar(id, onay, not);
      setRed(null);
      setSebep("");
      await getir();
    } catch (h) {
      Alert.alert("İşlenemedi", h.message);
    } finally {
      setIslenen(null);
    }
  };

  if (!veri && hata) return <Hata metin={hata} />;
  if (!veri) return <Yukleniyor />;
  const l = veri.kayitlar ?? [];

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Denkleştirme onayı" acik />
      <ScrollView
        contentContainerStyle={[s.govde, { paddingBottom: 120 + klavyePayi(klavye) }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        {l.length === 0 ? <Text style={[s.bos, { marginTop: 30, textAlign: "center" }]}>Onayınızı bekleyen denkleştirme formu yok.</Text> : null}
        {l.map(({ kayit: k, bakiye }) => {
          const net = bakiye?.netDk ?? 0;
          return (
            <View key={k.id} style={s.kart}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <View style={s.av}>
                  <Text style={s.avYazi}>
                    {(k.adSoyad ?? "?")
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((x) => x[0])
                      .join("")}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.satirAd} numberOfLines={1}>
                    {k.adSoyad}
                  </Text>
                  <Text style={s.satirAlt} numberOfLines={1}>
                    {k.gorev} · {k.sube}
                  </Text>
                </View>
              </View>
              <Text style={[s.satirAd, { marginTop: 10 }]}>
                {k.turAdi} · {sure(k.dk)}
              </Text>
              <Text style={s.satirAlt}>
                {kisaTarih(k.tarih)} · {k.baslangic}–{k.bitis}
                {k.aciklama ? ` · ${k.aciklama}` : ""}
              </Text>
              <View style={s.ozet}>
                <View style={s.ozetK}>
                  <Text style={s.uclE2}>Bu form</Text>
                  <Text style={[s.ozetD, { color: k.etkiDk >= 0 ? YESIL : KIRMIZI }]}>{isaretli(k.etkiDk)}</Text>
                </View>
                <View style={s.ozetK}>
                  <Text style={s.uclE2}>Mevcut bakiye</Text>
                  <Text style={s.ozetD}>{isaretli(net)}</Text>
                </View>
                <View style={s.ozetK}>
                  <Text style={s.uclE2}>Sonrası</Text>
                  <Text style={s.ozetD}>{isaretli(net + k.etkiDk)}</Text>
                </View>
              </View>
              {k.belgeVar ? (
                <TouchableOpacity
                  style={s.belge}
                  onPress={() => Linking.openURL(oturumluAdres(`/api/Denklestirme/${k.id}/ImzaliForm`)).catch(() => {})}
                >
                  <Text style={{ color: "#4a6e0c", fontWeight: "700" }}>İmzalı formu aç ›</Text>
                </TouchableOpacity>
              ) : null}
              {red === k.id ? (
                <View style={{ gap: 8, marginTop: 10 }}>
                  <TextInput
                    style={[s.girdi, { minHeight: 60, textAlignVertical: "top", fontSize: 15 }]}
                    value={sebep}
                    onChangeText={setSebep}
                    placeholder="Red nedeni"
                    placeholderTextColor="#b6bcb1"
                    multiline
                    autoFocus
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={[s.ikinci, { flex: 1, marginTop: 0 }]} onPress={() => setRed(null)}>
                      <Text style={s.ikinciYazi}>Vazgeç</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.kirmiziD, { flex: 1, marginTop: 0 }]}
                      disabled={sebep.trim().length < 3 || islenen === k.id}
                      onPress={() => karar(k.id, false, sebep.trim())}
                    >
                      <Text style={{ color: KIRMIZI, fontWeight: "800", opacity: sebep.trim().length < 3 ? 0.4 : 1 }}>Reddet</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity style={[s.kirmiziD, { flex: 1, marginTop: 0 }]} onPress={() => setRed(k.id)} disabled={islenen === k.id}>
                    <Text style={{ color: KIRMIZI, fontWeight: "700" }}>Reddet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.ana, { flex: 1, marginTop: 0 }]} onPress={() => karar(k.id, true, "")} disabled={islenen === k.id}>
                    {islenen === k.id ? <ActivityIndicator color="#fff" /> : <Text style={s.anaYazi}>Onayla</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 14, gap: 10, paddingBottom: 120 },
  bakiye: { backgroundColor: "#4f7a0e", borderRadius: 20, padding: 16 },
  bakiyeEt: { color: "#e6f0d4", fontSize: 11.5, fontWeight: "700", letterSpacing: 0.6 },
  bakiyeSay: { color: "#fff", fontSize: 30, fontWeight: "800", marginVertical: 2 },
  bakiyeAlt: { color: "#eef5e1", fontSize: 12.5 },
  ucl: { flexDirection: "row", gap: 6, marginTop: 12 },
  uclK: { flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, padding: 8 },
  uclE: { color: "#e6f0d4", fontSize: 11 },
  uclD: { color: "#fff", fontSize: 14, fontWeight: "800", marginTop: 1 },
  ana: { backgroundColor: YESIL, borderRadius: 13, paddingVertical: 13, alignItems: "center", justifyContent: "center", marginTop: 2 },
  anaYazi: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  ikinci: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: "#cfe2ae", paddingVertical: 10, alignItems: "center", marginTop: 8 },
  ikinciYazi: { color: "#4a6e0c", fontWeight: "800" },
  kirmiziD: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: "#f3c7b5", paddingVertical: 12, alignItems: "center", marginTop: 4 },
  grup: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.5, marginTop: 8, marginLeft: 2 },
  bos: { color: renk.pasif, fontSize: 13 },
  dip: { color: renk.pasif, fontSize: 12, lineHeight: 17, marginTop: 6 },
  satir: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi },
  ik: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  ikYazi: { fontWeight: "800", fontSize: 16 },
  satirAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  satirAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  hap: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9, marginTop: 4 },
  hapYazi: { fontSize: 11, fontWeight: "800" },
  etki: { fontSize: 14, fontWeight: "800" },
  etkiAlt: { fontSize: 11, color: renk.pasif, fontWeight: "600" },
  tur: { flexDirection: "row", gap: 10, alignItems: "center", padding: 11, borderRadius: 14, borderWidth: 1.5, borderColor: renk.cizgi, backgroundColor: "#fff" },
  turOn: { borderColor: YESIL, backgroundColor: YESIL_A },
  etiket: { fontSize: 12, fontWeight: "800", color: renk.pasif, marginTop: 6 },
  gun: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: renk.cizgi, alignItems: "center" },
  gunOn: { backgroundColor: YESIL, borderColor: YESIL },
  gunUst: { fontSize: 11.5, color: renk.pasif, fontWeight: "700" },
  gunAlt: { fontSize: 13.5, color: renk.metin, fontWeight: "800" },
  beyaz: { color: "#fff" },
  girdi: { backgroundColor: "#fff", borderWidth: 1, borderColor: renk.cizgi, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 18, color: renk.metin },
  ipucu: { fontSize: 12, color: renk.pasif },
  hesap: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 5, marginTop: 4 },
  hesapA: { fontSize: 13, color: renk.metin, flex: 1 },
  hesapB: { fontSize: 13, color: renk.metin, fontWeight: "800" },
  hesapBuyuk: { fontSize: 22, fontWeight: "800" },
  hesapNot: { fontSize: 12.5, color: renk.pasif, lineHeight: 17 },
  hata: { color: KIRMIZI, fontSize: 13, fontWeight: "600" },
  kart: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: renk.cizgi, padding: 14 },
  adim: { flexDirection: "row", gap: 12 },
  adimSol: { alignItems: "center", width: 30 },
  adimN: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#eceee8", alignItems: "center", justifyContent: "center" },
  adimTamam: { backgroundColor: YESIL },
  adimSimdi: { backgroundColor: "#fff", borderWidth: 2, borderColor: YESIL },
  adimNYazi: { fontWeight: "800", color: renk.pasif, fontSize: 13 },
  adimCizgi: { flex: 1, width: 2, backgroundColor: renk.cizgi, marginVertical: 2 },
  av: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#e6efd5", alignItems: "center", justifyContent: "center" },
  avYazi: { color: "#3f5f0a", fontWeight: "800" },
  ozet: { flexDirection: "row", gap: 6, marginTop: 10 },
  ozetK: { flex: 1, backgroundColor: renk.zemin, borderRadius: 10, padding: 8 },
  uclE2: { fontSize: 11, color: renk.pasif },
  ozetD: { fontSize: 14, fontWeight: "800", color: renk.metin, marginTop: 1 },
  belge: { marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: YESIL_A },
});

/**
 * Görevlendirme (26.10.2026)
 * ---------------------------------------------------------------------------
 * Şirketin gönderdiği iş görüşmesi, toplantı, seminer, eğitim, fuar…
 * Şehir içi ya da şehir dışı; gidiş ve dönüş tarihiyle girilir, açıklama
 * zorunlu. İzin Yönetimi ekranından açılır.
 *
 * <p>
 * Onay süreci İK paneli › İzin Yönetimi › Görevlendirme'den kurulur:
 * onay istenmeyebilir (kayıt hemen geçerli) ya da birim yöneticisi /
 * üst onay / İK adımları seçilir. Formun altında bu kişinin akışı yazar.
 * Onaylanan görev günlerinde QR okutulmasa da devamsız sayılmaz.
 * </p>
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import BarBaslik from "../bilesenler/BarBaslik";
import Takvim from "../bilesenler/Takvim";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import { gorevlendirmeAl, gorevlendirmeGir, gorevlendirmeIptal } from "../api";
import { renk } from "../tema";
import { useKlavye, klavyePayi } from "../klavye";

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** Yerel tarihten "YYYY-MM-DD" (toISOString saat dilimiyle gün kaydırır) */
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const gunOku = (s) => {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
};

const tarihYaz = (s) => {
  const d = s instanceof Date ? s : gunOku(s);
  return d ? `${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}` : "";
};

const kisa = (s) => {
  const d = gunOku(s);
  return d ? `${d.getDate()} ${AYLAR[d.getMonth()].slice(0, 3)}` : "";
};

const DURUM = {
  bekliyor: { ad: "Onay bekliyor", renk: "#ad6800", zemin: "#fff7e6" },
  onaylandi: { ad: "Onaylandı", renk: "#3f6212", zemin: "#f2f9e8" },
  reddedildi: { ad: "Reddedildi", renk: "#a8071a", zemin: "#fff1f0" },
  iptal: { ad: "İptal edildi", renk: "#6b7280", zemin: "#f1f3ef" },
};

const EN_AZ_ACIKLAMA = 10;

/* ========================================================================== */

export default function Gorevlendirme() {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [form, setForm] = useState(false);
  const [acik, setAcik] = useState(null);
  const [isleniyor, setIsleniyor] = useState(null);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await gorevlendirmeAl());
      setHata("");
    } catch (h) {
      setHata(h?.message ?? "Görevlendirmeler alınamadı.");
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  if (!veri && hata) return <Hata metin={hata} />;
  if (!veri) return <Yukleniyor />;

  if (form)
    return (
      <SafeAreaView style={s.tam} edges={["top"]}>
        <BarBaslik ad="Yeni görevlendirme" acik geri={() => setForm(false)} />
        <Form
          veri={veri}
          bitti={(mesaj) => {
            setForm(false);
            getir();
            if (mesaj) Alert.alert("Kaydedildi", mesaj);
          }}
        />
      </SafeAreaView>
    );

  const kayitlar = veri.kayitlar ?? [];
  const bugun = iso(new Date());
  const surecte = kayitlar.filter((k) => k.durum === "bekliyor");
  const yaklasan = kayitlar.filter((k) => k.durum === "onaylandi" && String(k.donus).slice(0, 10) >= bugun);
  const gecmis = kayitlar.filter((k) => !surecte.includes(k) && !yaklasan.includes(k));

  const iptal = (k) =>
    Alert.alert("Görevlendirme iptal edilsin mi?", `${k.yer} · ${tarihYaz(k.gidis)}`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "İptal et",
        style: "destructive",
        onPress: async () => {
          setIsleniyor(k.id);
          try {
            await gorevlendirmeIptal(k.id);
            await getir();
          } catch (h) {
            Alert.alert("İptal edilemedi", h?.message ?? "");
          } finally {
            setIsleniyor(null);
          }
        },
      },
    ]);

  const grup = (ad, l) =>
    l.length === 0 ? null : (
      <>
        <Text style={s.grup}>
          {ad} · {l.length}
        </Text>
        {l.map((k) => (
          <KayitKarti
            key={k.id}
            k={k}
            acik={acik === k.id}
            ac={() => setAcik(acik === k.id ? null : k.id)}
            iptal={() => iptal(k)}
            isleniyor={isleniyor === k.id}
          />
        ))}
      </>
    );

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Görevlendirme" acik />
      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
      >
        <View style={s.giris}>
          <Text style={s.girisBaslik}>Şirket adına bir etkinliğe mi gidiyorsunuz?</Text>
          <Text style={s.girisMetin}>
            Toplantı, seminer, eğitim, fuar ya da iş görüşmesi için şehir içi veya şehir dışı görevinizi buradan girin.
            Görevde olduğunuz günler devamsızlık sayılmaz.
          </Text>
          {veri.akis ? <Text style={s.akis}>Onay: {veri.akis}</Text> : null}
        </View>

        {veri.girebilir ? (
          <TouchableOpacity style={s.ana} activeOpacity={0.85} onPress={() => setForm(true)}>
            <Text style={s.anaYazi}>＋ Görevlendirme gir</Text>
          </TouchableOpacity>
        ) : veri.neden ? (
          <View style={s.uyari}>
            <Text style={s.uyariYazi}>{veri.neden}</Text>
          </View>
        ) : null}

        {grup("SÜREÇTE", surecte)}
        {grup("YAKLAŞAN / DEVAM EDEN", yaklasan)}
        {grup("GEÇMİŞ", gecmis)}

        {kayitlar.length === 0 ? <Text style={s.bos}>Henüz görevlendirme kaydınız yok.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------ kayıt kartı */

function KayitKarti({ k, acik, ac, iptal, isleniyor }) {
  const d = DURUM[k.durum] ?? DURUM.bekliyor;
  return (
    <TouchableOpacity style={s.kart} activeOpacity={0.9} onPress={ac}>
      <View style={s.kartUst}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kartAd} numberOfLines={1}>
            {k.yer}
          </Text>
          <Text style={s.kartAlt} numberOfLines={1}>
            {k.kapsamAdi} · {k.etkinlikTuru}
          </Text>
        </View>
        <View style={[s.hap, { backgroundColor: d.zemin }]}>
          <Text style={[s.hapYazi, { color: d.renk }]}>{d.ad}</Text>
        </View>
      </View>

      <Text style={s.kartTarih}>
        {kisa(k.gidis)} – {kisa(k.donus)} · {k.gun} gün
      </Text>
      {k.kimde ? <Text style={s.kimde}>{k.kimde}</Text> : null}

      {acik ? (
        <View style={s.ayrinti}>
          <Text style={s.ayrintiBaslik}>{k.etkinlikAdi}</Text>
          <Text style={s.ayrintiMetin}>{k.aciklama}</Text>

          {Array.isArray(k.sira) && k.sira.length > 0 ? (
            <View style={{ marginTop: 10, gap: 4 }}>
              {k.sira.map((x, i) => (
                <Text key={i} style={s.adim}>
                  {x.karar === "onay" ? "✓" : x.karar === "red" ? "✗" : x.karar === "atlandi" ? "–" : "○"} {x.ad}
                  {x.kim ? ` · ${x.kim}` : ""}
                  {x.not ? ` — ${x.not}` : ""}
                </Text>
              ))}
            </View>
          ) : null}

          {k.durum === "reddedildi" && k.kararNot ? (
            <Text style={[s.adim, { color: renk.kirmizi, marginTop: 8 }]}>Ret sebebi: {k.kararNot}</Text>
          ) : null}

          {k.iptalEdilebilir ? (
            <TouchableOpacity style={s.iptal} onPress={iptal} disabled={isleniyor} activeOpacity={0.85}>
              {isleniyor ? <ActivityIndicator color={renk.kirmizi} /> : <Text style={s.iptalYazi}>İptal et</Text>}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ form */

function Form({ veri, bitti }) {
  const klavye = useKlavye();
  const turler = veri.turler ?? [];

  const [kapsam, setKapsam] = useState(null);
  const [tur, setTur] = useState(null);
  const [etkinlik, setEtkinlik] = useState("");
  const [yer, setYer] = useState("");
  const [gidis, setGidis] = useState(null);
  const [donus, setDonus] = useState(null);
  const [aciklama, setAciklama] = useState("");
  const [takvim, setTakvim] = useState(null); // gidis | donus
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState("");

  const bugun = new Date(new Date().toDateString());
  const enAz = new Date(bugun.getTime() - (veri.geriGun ?? 7) * 86400000);
  const gun = gidis && donus ? Math.round((donus - gidis) / 86400000) + 1 : null;

  const eksik = !kapsam
    ? "Şehir içi ya da şehir dışı seçin."
    : !tur
    ? "Etkinlik türünü seçin."
    : etkinlik.trim().length < 3
    ? "Etkinliğin adını yazın."
    : yer.trim().length < 2
    ? "Gidilecek yeri yazın."
    : !gidis || !donus
    ? "Gidiş ve dönüş tarihini seçin."
    : aciklama.trim().length < EN_AZ_ACIKLAMA
    ? `Açıklama zorunlu (en az ${EN_AZ_ACIKLAMA} karakter).`
    : null;

  const gonder = async () => {
    if (eksik) {
      setHata(eksik);
      return;
    }
    setGonderiliyor(true);
    setHata("");
    try {
      const r = await gorevlendirmeGir({
        kapsam,
        etkinlikTuru: tur,
        etkinlikAdi: etkinlik.trim(),
        yer: yer.trim(),
        gidis: iso(gidis),
        donus: iso(donus),
        aciklama: aciklama.trim(),
      });
      bitti(r?.mesaj);
    } catch (h) {
      setHata(h?.message ?? "Kaydedilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[s.govde, { paddingBottom: 160 + klavyePayi(klavye) }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.etiket}>NEREYE</Text>
      <View style={s.ikili}>
        {[
          { k: "sehir_ici", ad: "Şehir içi" },
          { k: "sehir_disi", ad: "Şehir dışı" },
        ].map((x) => (
          <TouchableOpacity
            key={x.k}
            style={[s.secenek, kapsam === x.k && s.secenekAcik]}
            onPress={() => setKapsam(x.k)}
            activeOpacity={0.85}
          >
            <Text style={[s.secenekYazi, kapsam === x.k && s.secenekYaziAcik]}>{x.ad}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.etiket}>ETKİNLİK TÜRÜ</Text>
      <View style={s.cipler}>
        {turler.map((t) => (
          <TouchableOpacity key={t} style={[s.cip, tur === t && s.cipAcik]} onPress={() => setTur(t)} activeOpacity={0.85}>
            <Text style={[s.cipYazi, tur === t && s.cipYaziAcik]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.etiket}>ETKİNLİĞİN ADI</Text>
      <TextInput
        style={s.girdi}
        value={etkinlik}
        onChangeText={setEtkinlik}
        placeholder="Ör. Tedarikçi toplantısı, gıda güvenliği semineri"
        placeholderTextColor="#9aa29a"
        maxLength={200}
      />

      <Text style={s.etiket}>{kapsam === "sehir_disi" ? "ŞEHİR / YER" : "YER"}</Text>
      <TextInput
        style={s.girdi}
        value={yer}
        onChangeText={setYer}
        placeholder={kapsam === "sehir_disi" ? "Ör. İstanbul, Ankara" : "Ör. firma adı, otel, adres"}
        placeholderTextColor="#9aa29a"
        maxLength={150}
      />

      <Text style={s.etiket}>TARİHLER</Text>
      <View style={s.ikili}>
        {[
          { k: "gidis", ad: "Gidiş", d: gidis },
          { k: "donus", ad: "Dönüş", d: donus },
        ].map((x) => (
          <TouchableOpacity
            key={x.k}
            style={[s.tarihKutu, takvim === x.k && s.secenekAcik]}
            onPress={() => setTakvim(takvim === x.k ? null : x.k)}
            activeOpacity={0.85}
          >
            <Text style={s.tarihEt}>{x.ad.toUpperCase()}</Text>
            <Text style={s.tarihDeger}>{x.d ? tarihYaz(x.d) : "Seçin"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {takvim ? (
        <View style={s.takvim}>
          <Takvim
            deger={(takvim === "gidis" ? gidis : donus) ?? gidis ?? bugun}
            enAz={takvim === "donus" && gidis ? gidis : enAz}
            onSec={(d) => {
              if (takvim === "gidis") {
                setGidis(d);
                if (!donus || donus < d) setDonus(d);
                setTakvim("donus");
              } else {
                setDonus(d);
                setTakvim(null);
              }
            }}
          />
        </View>
      ) : null}

      {gun ? <Text style={s.gunYazi}>{gun} gün görevde olacaksınız.</Text> : null}

      <Text style={s.etiket}>AÇIKLAMA (ZORUNLU)</Text>
      <TextInput
        style={[s.girdi, { minHeight: 96, textAlignVertical: "top" }]}
        value={aciklama}
        onChangeText={setAciklama}
        placeholder="Görevin amacı, kimin adına gidildiği, kimlerle…"
        placeholderTextColor="#9aa29a"
        multiline
        maxLength={1000}
      />
      <Text style={[s.sayac, aciklama.trim().length >= EN_AZ_ACIKLAMA && { color: renk.yesilKoyu }]}>
        {aciklama.trim().length < EN_AZ_ACIKLAMA
          ? `En az ${EN_AZ_ACIKLAMA} karakter · ${aciklama.trim().length}/${EN_AZ_ACIKLAMA}`
          : `${aciklama.trim().length} karakter`}
      </Text>

      {veri.akis ? <Text style={s.akis}>Onay: {veri.akis}</Text> : null}
      {hata ? <Text style={s.hata}>{hata}</Text> : null}

      <TouchableOpacity
        style={[s.ana, (eksik || gonderiliyor) && { opacity: 0.55 }]}
        onPress={gonder}
        disabled={gonderiliyor}
        activeOpacity={0.85}
      >
        {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Text style={s.anaYazi}>Gönder</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ================================================================ stiller */

const TURKUAZ = "#0e7490";

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 140, gap: 10 },

  giris: { backgroundColor: "#e6f6f9", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#c4e6ee" },
  girisBaslik: { fontSize: 16, fontWeight: "800", color: "#0b4f5f" },
  girisMetin: { fontSize: 13, color: "#245f6d", marginTop: 6, lineHeight: 19 },
  akis: { fontSize: 12, color: renk.pasif, marginTop: 8, fontWeight: "700" },

  ana: {
    backgroundColor: TURKUAZ,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  anaYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },

  uyari: { backgroundColor: "#fff7e6", borderRadius: 12, padding: 12 },
  uyariYazi: { color: "#ad6800", fontSize: 13, fontWeight: "600" },

  grup: { fontSize: 11, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, marginTop: 14 },
  bos: { fontSize: 13, color: renk.pasif, textAlign: "center", marginTop: 24 },

  kart: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: renk.cizgi },
  kartUst: { flexDirection: "row", alignItems: "center", gap: 10 },
  kartAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  kartAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },
  kartTarih: { fontSize: 13, color: renk.metin, marginTop: 8, fontWeight: "600" },
  kimde: { fontSize: 12, color: "#ad6800", marginTop: 4, fontWeight: "700" },
  hap: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  hapYazi: { fontSize: 11, fontWeight: "800" },

  ayrinti: { marginTop: 10, borderTopWidth: 1, borderTopColor: renk.cizgi, paddingTop: 10 },
  ayrintiBaslik: { fontSize: 13, fontWeight: "800", color: renk.metin },
  ayrintiMetin: { fontSize: 13, color: renk.metin, marginTop: 4, lineHeight: 19 },
  adim: { fontSize: 12, color: renk.pasif },
  iptal: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ffccc7",
    paddingVertical: 10,
    alignItems: "center",
  },
  iptalYazi: { color: renk.kirmizi, fontWeight: "800" },

  etiket: { fontSize: 11, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, marginTop: 8 },
  ikili: { flexDirection: "row", gap: 10 },
  secenek: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    paddingVertical: 13,
    alignItems: "center",
  },
  secenekAcik: { borderColor: TURKUAZ, backgroundColor: "#e6f6f9" },
  secenekYazi: { fontSize: 14, fontWeight: "700", color: renk.metin },
  secenekYaziAcik: { color: TURKUAZ },

  cipler: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cip: {
    backgroundColor: "#fff",
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  cipAcik: { borderColor: TURKUAZ, backgroundColor: "#e6f6f9" },
  cipYazi: { fontSize: 13, fontWeight: "600", color: renk.metin },
  cipYaziAcik: { color: TURKUAZ, fontWeight: "800" },

  girdi: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 14,
    color: renk.metin,
  },

  tarihKutu: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    padding: 12,
  },
  tarihEt: { fontSize: 10, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6 },
  tarihDeger: { fontSize: 14, fontWeight: "800", color: renk.metin, marginTop: 3 },
  takvim: { backgroundColor: "#fff", borderRadius: 14, padding: 8, borderWidth: 1, borderColor: renk.cizgi },
  gunYazi: { fontSize: 13, fontWeight: "700", color: TURKUAZ },

  sayac: { fontSize: 11, color: "#ad6800", textAlign: "right" },
  hata: { fontSize: 13, color: renk.kirmizi, fontWeight: "700" },
});

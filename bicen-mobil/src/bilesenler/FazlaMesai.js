/**
 * Fazla mesai (1.6)
 * ---------------------------------------------------------------------------
 * Ekibim › personel ayrıntısında yöneticiye "Fazla mesai gir". Tarih,
 * başlangıç ve bitiş saati ile neden yazılır; sunucu formu (İK-FM-01)
 * doldurup şubenin mailine gönderir. Şubede çıktı alınıp çalışan, birim
 * yöneticisi ve bölge müdürü imzalar; ıslak imzalı form İK'ya fiziki
 * gönderilir. İK formu yükleyip onaylayınca durum burada görünür.
 *
 * Sunucu yetki vermezse (personel değil yönetici değilse) kart hiç çizilmez.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
} from "react-native";

import { fazlaMesaiKisiAl, fazlaMesaiGir, fazlaMesaiIptal } from "../api";
import { renk } from "../tema";
import ModalAlani, { modalTamEkran } from "./ModalAlani";

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUNLER = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

const iki = (n) => String(n).padStart(2, "0");
const isoGun = (d) => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
const tarihOku = (t) => {
  const [y, a, g] = String(t).slice(0, 10).split("-").map(Number);
  return new Date(y, a - 1, g);
};
const kisaTarih = (t) => {
  const d = tarihOku(t);
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${GUNLER[d.getDay()]}`;
};

/** "1830" → "18:30"; yazarken iki noktayı kendisi koyar */
const saatBicim = (v) => {
  const r = String(v).replace(/\D/g, "").slice(0, 4);
  return r.length <= 2 ? r : `${r.slice(0, 2)}:${r.slice(2)}`;
};

const dakika = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const d = Number(m[2]);
  return h < 24 && d < 60 ? h * 60 + d : null;
};

const sureYaz = (dk) =>
  dk % 60 === 0 ? `${dk / 60} saat` : dk < 60 ? `${dk} dakika` : `${Math.floor(dk / 60)} saat ${dk % 60} dakika`;

const DURUM = {
  /* Onay akışı (08.10.2026): izin talebiyle aynı; önce üst yönetici, sonra İK */
  /* 09.10.2026: önce birim yöneticisi imzalı formu yükleyip onaylar (İzin Onayları) */
  form: { ad: "Form yükleyip onaylayın", zemin: "#fff4e6", yazi: "#9a3412" },
  ust: { ad: "Üst yönetici onayında", zemin: "#eef4fb", yazi: "#1f4f82" },
  bekliyor: { ad: "İK onayı bekleniyor", zemin: "#fff8e6", yazi: "#92600e" },
  onaylandi: { ad: "Onaylandı", zemin: "#eef6e1", yazi: "#3f6108" },
  reddedildi: { ad: "Reddedildi", zemin: "#fdecec", yazi: "#b42318" },
  iptal: { ad: "İptal", zemin: "#f1f3ef", yazi: "#6b7280" },
};

/* ========================================================================== */
/* Kişi ayrıntısındaki kart                                                    */
/* ========================================================================== */

export default function FazlaMesaiKarti({ sicil, adSoyad }) {
  const [veri, setVeri] = useState(null);
  const [form, setForm] = useState(false);

  const getir = useCallback(() => {
    fazlaMesaiKisiAl(sicil)
      .then(setVeri)
      .catch(() => setVeri({ girebilir: false }));
  }, [sicil]);

  useEffect(() => {
    getir();
  }, [getir]);

  if (!veri?.girebilir) return null;

  const kayitlar = veri.kayitlar ?? [];

  const iptal = (k) =>
    Alert.alert("Fazla mesai iptal edilsin mi?", `${kisaTarih(k.tarih)} · ${k.baslangic}–${k.bitis}`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "İptal et",
        style: "destructive",
        onPress: async () => {
          try {
            await fazlaMesaiIptal(k.id);
            getir();
          } catch (h) {
            Alert.alert("İptal edilemedi", h.message);
          }
        },
      },
    ]);

  return (
    <>
      <Text style={s.baslik}>FAZLA MESAİ</Text>
      <View style={s.kart}>
        <TouchableOpacity style={s.ekle} activeOpacity={0.85} onPress={() => setForm(true)}>
          <Text style={s.ekleArti}>+</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.ekleYazi}>Fazla mesai gir</Text>
            <Text style={s.ekleAlt}>Form şube mailine gider; imzalı formu yükleyip İzin Onayları'ndan onaylarsınız</Text>
          </View>
        </TouchableOpacity>

        {kayitlar.length === 0 ? (
          <Text style={s.bos}>Son 90 günde fazla mesai kaydı yok.</Text>
        ) : (
          kayitlar.slice(0, 8).map((k) => {
            const d = DURUM[k.durum] ?? DURUM.bekliyor;
            return (
              <View key={k.id} style={s.kayit}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.kayitUst}>
                    {kisaTarih(k.tarih)} · {k.baslangic}–{k.bitis}
                  </Text>
                  <Text style={s.kayitAlt} numberOfLines={1}>
                    {k.sure} · {k.aciklama}
                  </Text>
                  {k.durum === "reddedildi" && k.kararNotu ? (
                    <Text style={[s.kayitAlt, { color: "#b42318" }]}>Sebep: {k.kararNotu}</Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <View style={[s.cip, { backgroundColor: d.zemin }]}>
                    <Text style={[s.cipYazi, { color: d.yazi }]}>{d.ad}</Text>
                  </View>
                  {k.durum === "bekliyor" || k.durum === "ust" || k.durum === "form" ? (
                    <TouchableOpacity onPress={() => iptal(k)} hitSlop={8}>
                      <Text style={s.iptal}>İptal</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      {form ? (
        <FazlaMesaiGir
          sicil={sicil}
          adSoyad={adSoyad}
          geriyeGun={veri.geriyeGun ?? 31}
          kapat={() => setForm(false)}
          bitti={() => {
            setForm(false);
            getir();
          }}
        />
      ) : null}
    </>
  );
}

/* ========================================================================== */
/* Giriş formu                                                                 */
/* ========================================================================== */

/** Klavyenin sayfanın altını kapattığı yükseklik (Android kenardan kenara) */
function useKlavye() {
  const [h, setH] = useState(0);

  useEffect(() => {
    const ac = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setH(e?.endCoordinates?.height ?? 0)
    );
    const kapa = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setH(0));
    return () => {
      ac.remove();
      kapa.remove();
    };
  }, []);

  return h;
}

function FazlaMesaiGir({ sicil, adSoyad, geriyeGun = 31, kapat, bitti }) {
  const bugun = new Date();
  /* 13.10.2026: sabit 7 gün yerine sunucudaki fm.geriyeGun (varsayılan 31) */
  const gunSayisi = Math.min(Math.max(Number(geriyeGun) || 0, 0), 62) + 1;
  const gunler = Array.from({ length: gunSayisi }, (_, i) => {
    const d = new Date(bugun);
    d.setDate(d.getDate() - i);
    return d;
  });

  const [tarih, setTarih] = useState(isoGun(bugun));
  const [bas, setBas] = useState("");
  const [bit, setBit] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [hata, setHata] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState(null);

  const kaydirma = useRef(null);
  const klavye = useKlavye();

  const b = dakika(bas);
  const e = dakika(bit);
  const sure = b !== null && e !== null ? (e > b ? e - b : e + 1440 - b) : null;
  const geceyeTasiyor = b !== null && e !== null && e <= b;

  const gecerli = sure !== null && sure >= 15 && sure <= 16 * 60 && aciklama.trim().length >= 3;

  const gonder = async () => {
    setHata("");

    if (b === null || e === null) return setHata("Başlangıç ve bitiş saatini yazınız (ör. 18:00).");
    if (sure < 15) return setHata("Fazla mesai en az 15 dakika olmalı.");
    if (sure > 16 * 60) return setHata("Tek seferde en fazla 16 saat girilebilir; saatleri kontrol ediniz.");
    if (aciklama.trim().length < 3) return setHata("Fazla mesainin nedenini yazınız.");

    setGonderiliyor(true);
    try {
      setSonuc(await fazlaMesaiGir({ sicil, tarih, baslangic: bas, bitis: bit, aciklama: aciklama.trim() }));
    } catch (h) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={s.tam} edges={["top", "bottom"]}>
        <View style={s.ust}>
          <TouchableOpacity onPress={sonuc ? bitti : kapat} hitSlop={12}>
            <Text style={s.vazgec}>{sonuc ? "Kapat" : "Vazgeç"}</Text>
          </TouchableOpacity>
          <Text style={s.ustBaslik}>Fazla mesai</Text>
          <View style={{ width: 52 }} />
        </View>

        {sonuc ? (
          <View style={s.sonuc}>
            <View style={[s.sonucIkon, !sonuc.formGitti && { backgroundColor: "#fff8e6" }]}>
              <Text style={[s.sonucIkonYazi, !sonuc.formGitti && { color: "#92600e" }]}>{sonuc.formGitti ? "✓" : "!"}</Text>
            </View>
            <Text style={s.sonucBaslik}>Fazla mesai kaydedildi</Text>
            <Text style={s.sonucAlt}>
              {adSoyad} · {kisaTarih(tarih)} · {bas}–{bit} · {sonuc.sure}
            </Text>
            <View style={s.adimlar}>
              {[
                sonuc.formGitti ? `Form ${sonuc.formAdres} adresine gönderildi.` : "Form maille gönderilemedi; İK panelden yazdırabilir.",
                /* 09.10.2026: imzalı formu birim yöneticisi yükleyip onaylar */
                "Çıktısını alın; çalışana ve bölge müdürüne imzalatın, siz de imzalayın.",
                "İmzalı formu yükleyin: İzin Onayları'ndaki kartta \"İmzalı formu yükle\" (ya da ana sayfadaki kart).",
                "İzin Onayları'ndan onaylayın; ıslak imzalı aslını İnsan Kaynakları'na gönderin.",
              ].map((x, i) => (
                <View key={i} style={s.adim}>
                  <Text style={s.adimNo}>{i + 1}</Text>
                  <Text style={s.adimYazi}>{x}</Text>
                </View>
              ))}
            </View>
            <Text style={s.not}>
              {sonuc.durum === "form"
                ? `Siz onaylayınca kayıt ${sonuc.onaylayacak ? `${sonuc.onaylayacak} onayına, ardından ` : ""}İK'ya geçer. Sonucu bu ekranda ve bildirim olarak görürsünüz.`
                : sonuc.durum === "ust"
                ? `Kayıt önce ${sonuc.onaylayacak || "üst yöneticinizin"} onayına gitti; ardından İK formu aldığında onaylar. Sonucu bu ekranda ve bildirim olarak görürsünüz.`
                : "İK formu aldığında onaylar; sonucu bu ekranda ve bildirim olarak görürsünüz."}
            </Text>
            <TouchableOpacity style={s.ana} onPress={bitti}>
              <Text style={s.anaYazi}>Tamam</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView
              ref={kaydirma}
              contentContainerStyle={{ padding: 16, paddingBottom: 120 + klavye, gap: 10 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={s.kisi}>
                <Text style={s.kisiAd}>{adSoyad}</Text>
                <Text style={s.kisiAlt}>Fazla mesai formu (İK-FM-01) bu bilgilerle doldurulur.</Text>
              </View>

              {/* Ne girilecek (08.10.2026): mesai bitişinden sonraki çalışma */}
              <View style={{ backgroundColor: "#eef4fb", borderRadius: 12, padding: 12 }}>
                <Text style={{ fontSize: 13, color: "#1a4d80", lineHeight: 19 }}>
                  <Text style={{ fontWeight: "800" }}>Fazla mesai, mesai bitiş saatinden sonra yapılan çalışmadır.</Text> Örneğin mağaza
                  akşam satışa kapandıktan sonra temizlik ya da sayım yapıldıysa, bu çalışmanın başladığı ve bittiği saati girin.
                </Text>
              </View>

              <Text style={s.etiket}>Tarih</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {gunler.map((d, i) => {
                  const g = isoGun(d);
                  const sec = g === tarih;
                  return (
                    <TouchableOpacity key={g} style={[s.gun, sec && s.gunSecili]} onPress={() => setTarih(g)}>
                      <Text style={[s.gunUst, sec && s.secYazi]}>{i === 0 ? "Bugün" : i === 1 ? "Dün" : GUNLER[d.getDay()]}</Text>
                      <Text style={[s.gunAlt, sec && s.secYazi]}>
                        {d.getDate()} {AYLAR[d.getMonth()]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.etiket}>Başlangıç saati</Text>
                  <TextInput
                    style={s.saat}
                    value={bas}
                    onChangeText={(v) => {
                      setHata("");
                      setBas(saatBicim(v));
                    }}
                    placeholder="22:00"
                    placeholderTextColor="#b6bcb1"
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.etiket}>Bitiş saati</Text>
                  <TextInput
                    style={s.saat}
                    value={bit}
                    onChangeText={(v) => {
                      setHata("");
                      setBit(saatBicim(v));
                    }}
                    placeholder="23:30"
                    placeholderTextColor="#b6bcb1"
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                </View>
              </View>

              <View style={s.sure}>
                <Text style={s.sureEt}>Toplam fazla mesai</Text>
                <Text style={s.sureDeger}>{sure !== null ? sureYaz(sure) : "—"}</Text>
                {geceyeTasiyor ? <Text style={s.sureNot}>Bitiş ertesi gün</Text> : null}
              </View>

              <Text style={s.etiket}>Fazla mesainin nedeni / açıklama</Text>
              <TextInput
                style={s.aciklama}
                value={aciklama}
                onChangeText={(v) => {
                  setHata("");
                  setAciklama(v);
                }}
                placeholder="Örn. mağaza satışa kapandıktan sonra genel temizlik ve sayım"
                placeholderTextColor="#a3a9a0"
                multiline
                maxLength={500}
                onFocus={() => setTimeout(() => kaydirma.current?.scrollToEnd({ animated: true }), 300)}
              />

              {hata ? (
                <View style={s.hata}>
                  <Text style={s.hataYazi}>{hata}</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={[s.alt, klavye > 0 && { bottom: klavye, paddingBottom: 10 }]}>
              <TouchableOpacity style={[s.ana, (!gecerli || gonderiliyor) && s.anaPasif]} disabled={gonderiliyor} onPress={gonder}>
                {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Text style={s.anaYazi}>Kaydet ve formu gönder</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  baslik: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.7, marginTop: 20, marginBottom: 8 },
  kart: { backgroundColor: renk.beyaz, borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 12, gap: 8 },
  ekle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.yesilAcik,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9ecbc",
    padding: 11,
  },
  ekleArti: { fontSize: 22, fontWeight: "800", color: renk.yesilKoyu, width: 24, textAlign: "center" },
  ekleYazi: { fontSize: 14.5, fontWeight: "800", color: "#3f6108" },
  ekleAlt: { fontSize: 11.5, color: "#5f7a3a", marginTop: 1 },
  bos: { fontSize: 12.5, color: renk.pasif, paddingVertical: 4 },
  kayit: { flexDirection: "row", gap: 10, borderTopWidth: 1, borderTopColor: "#f1f3ef", paddingTop: 8 },
  kayitUst: { fontSize: 13, fontWeight: "700", color: renk.metin },
  kayitAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  cip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  cipYazi: { fontSize: 10.5, fontWeight: "800" },
  iptal: { fontSize: 12, fontWeight: "700", color: renk.kirmizi },

  tam: { flex: 1, backgroundColor: renk.zemin },
  ust: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  ustBaslik: { fontSize: 16, fontWeight: "800", color: renk.metin },
  vazgec: { fontSize: 14, fontWeight: "700", color: renk.yesilKoyu, width: 52 },

  kisi: { backgroundColor: renk.beyaz, borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 12 },
  kisiAd: { fontSize: 16, fontWeight: "800", color: renk.metin },
  kisiAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },

  etiket: { fontSize: 12.5, fontWeight: "700", color: renk.metin, marginTop: 6 },
  gun: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    minWidth: 64,
  },
  gunSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  gunUst: { fontSize: 12, fontWeight: "800", color: renk.metin },
  gunAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  secYazi: { color: "#fff" },

  saat: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 6,
  },
  sure: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    backgroundColor: renk.maviAcik,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  sureEt: { fontSize: 12.5, color: renk.mavi, fontWeight: "700" },
  sureDeger: { fontSize: 17, fontWeight: "800", color: renk.mavi, flex: 1, textAlign: "right" },
  sureNot: { fontSize: 11, color: renk.mavi },

  aciklama: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 12,
    minHeight: 96,
    fontSize: 14,
    color: renk.metin,
    textAlignVertical: "top",
    marginTop: 6,
  },
  hata: { backgroundColor: "#fdecec", borderRadius: 10, padding: 10 },
  hataYazi: { color: "#b42318", fontSize: 13, fontWeight: "600" },

  alt: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: renk.zemin },
  ana: { backgroundColor: renk.yesilKoyu, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  anaPasif: { opacity: 0.5 },
  anaYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },

  sonuc: { padding: 20, gap: 10 },
  sonucIkon: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  sonucIkonYazi: { fontSize: 30, fontWeight: "800", color: renk.yesilKoyu },
  sonucBaslik: { fontSize: 19, fontWeight: "800", color: renk.metin, textAlign: "center" },
  sonucAlt: { fontSize: 13, color: renk.pasif, textAlign: "center" },
  adimlar: { backgroundColor: renk.beyaz, borderRadius: 14, borderWidth: 1, borderColor: renk.cizgi, padding: 12, gap: 10, marginTop: 6 },
  adim: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  adimNo: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: renk.yesilAcik,
    color: renk.yesilKoyu,
    textAlign: "center",
    lineHeight: 22,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  adimYazi: { flex: 1, fontSize: 13.5, color: renk.metin, lineHeight: 19 },
  not: { fontSize: 12, color: renk.pasif, textAlign: "center", marginBottom: 6 },
});

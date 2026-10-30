/**
 * Rotasyon (şube değişikliği) talebi (1.6)
 * ---------------------------------------------------------------------------
 * - RotasyonKarti: Ekibim › personel ayrıntısında yöneticiye "Rotasyon
 *   talebi oluştur". Tür (yönetici / personel isteği), zorunlu açıklama ve
 *   hedef şubeler; o pozisyonda kadrosu açık şubeler öneri olarak önde.
 * - RotasyonOnaylari: bölge müdürünün İzin Onayları ekranında bekleyenler.
 * - RotasyonDetay: personelin ana sayfa kartından açılan salt okunur ayrıntı.
 *
 * Sunucu yetki vermezse kart hiç çizilmez.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  rotasyonKisiAl,
  rotasyonSecenekAl,
  rotasyonOlustur,
  rotasyonIptal,
  rotasyonOnaylarAl,
  rotasyonKarar,
} from "../api";
import { renk } from "../tema";
import ModalAlani, { modalTamEkran } from "./ModalAlani";

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const kisaTarih = (t) => {
  if (!t) return "";
  const d = new Date(t);
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}`;
};

export const ROTASYON_DURUM = {
  bolge: { ad: "Bölge müdürü onayında", zemin: "#eef4fb", yazi: "#1a4d80" },
  ik: { ad: "İK onayında", zemin: "#fff8e6", yazi: "#92600e" },
  onaylandi: { ad: "Onaylandı", zemin: "#eef6e1", yazi: "#3f6108" },
  reddedildi: { ad: "Reddedildi", zemin: "#fdecec", yazi: "#b42318" },
  iptal: { ad: "Geri çekildi", zemin: "#f1f3ef", yazi: "#6b7280" },
};

const hedefMetni = (k) => (k.hedefler ?? []).map((h) => h.ad).join(", ");

/* ========================================================================== */
/* Ekibim › personel kartı                                                     */
/* ========================================================================== */

export default function RotasyonKarti({ sicil, adSoyad }) {
  const [veri, setVeri] = useState(null);
  const [form, setForm] = useState(false);

  const getir = useCallback(() => {
    rotasyonKisiAl(sicil)
      .then(setVeri)
      .catch(() => setVeri({ acabilir: false }));
  }, [sicil]);

  useEffect(() => {
    getir();
  }, [getir]);

  if (!veri?.acabilir) return null;

  const kayitlar = veri.kayitlar ?? [];
  const acik = kayitlar.find((k) => k.durum === "bolge" || k.durum === "ik");

  const geriCek = (k) =>
    Alert.alert("Talep geri çekilsin mi?", `${hedefMetni(k)}`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Geri çek",
        style: "destructive",
        onPress: async () => {
          try {
            await rotasyonIptal(k.id);
            getir();
          } catch (h) {
            Alert.alert("Geri çekilemedi", h.message);
          }
        },
      },
    ]);

  return (
    <>
      <Text style={s.baslik}>ROTASYON (ŞUBE DEĞİŞİKLİĞİ)</Text>
      <View style={s.kart}>
        {!acik ? (
          <TouchableOpacity style={s.ekle} activeOpacity={0.85} onPress={() => setForm(true)}>
            <Text style={s.ekleArti}>⇄</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.ekleYazi}>Rotasyon talebi oluştur</Text>
              <Text style={s.ekleAlt}>Kadrosu açık şubeler önce önerilir · personel yalnızca görür</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {kayitlar.length === 0 ? (
          <Text style={s.bos}>Bu personel için rotasyon talebi yok.</Text>
        ) : (
          kayitlar.slice(0, 5).map((k) => {
            const d = ROTASYON_DURUM[k.durum] ?? ROTASYON_DURUM.ik;
            return (
              <View key={k.id} style={s.kayit}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.kayitUst} numberOfLines={2}>
                    {k.sube} → {k.onaylananSube ?? hedefMetni(k)}
                  </Text>
                  <Text style={s.kayitAlt}>
                    {k.turAdi} · {kisaTarih(k.olusturma)}
                  </Text>
                  {k.durum === "reddedildi" && (k.ikNot || k.bolgeNot) ? (
                    <Text style={[s.kayitAlt, { color: "#b42318" }]}>Sebep: {k.ikNot ?? k.bolgeNot}</Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <View style={[s.cip, { backgroundColor: d.zemin }]}>
                    <Text style={[s.cipYazi, { color: d.yazi }]}>{d.ad}</Text>
                  </View>
                  {k.durum === "bolge" || k.durum === "ik" ? (
                    <TouchableOpacity onPress={() => geriCek(k)} hitSlop={8}>
                      <Text style={s.iptal}>Geri çek</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      {form ? (
        <RotasyonFormu
          sicil={sicil}
          adSoyad={adSoyad}
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
/* Talep formu                                                                 */
/* ========================================================================== */

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

function RotasyonFormu({ sicil, adSoyad, kapat, bitti }) {
  const [secenek, setSecenek] = useState(null);
  const [yukHata, setYukHata] = useState("");
  const [tur, setTur] = useState(null);
  const [secili, setSecili] = useState([]);
  const [aciklama, setAciklama] = useState("");
  const [ara, setAra] = useState("");
  const [digerAcik, setDigerAcik] = useState(false);
  const [hata, setHata] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState(null);

  const kaydirma = useRef(null);
  const klavye = useKlavye();

  useEffect(() => {
    rotasyonSecenekAl(sicil)
      .then((c) => {
        setSecenek(c);
        if (!(c?.oneriler ?? []).length) setDigerAcik(true);
      })
      .catch((h) => setYukHata(h.message));
  }, [sicil]);

  const q = ara.trim().toLocaleLowerCase("tr");
  const digerleri = useMemo(
    () => (secenek?.digerleri ?? []).filter((x) => !q || x.ad.toLocaleLowerCase("tr").includes(q)),
    [secenek, q]
  );

  const sec = (ad) => {
    setHata("");
    setSecili((l) => (l.includes(ad) ? l.filter((x) => x !== ad) : l.length >= 5 ? l : [...l, ad]));
  };

  const gecerli = !!tur && secili.length > 0 && aciklama.trim().length >= 10;

  const gonder = async () => {
    setHata("");
    if (!tur) return setHata("Talebin yönetici isteği mi personel isteği mi olduğunu seçiniz.");
    if (secili.length === 0) return setHata("En az bir hedef şube seçiniz.");
    if (aciklama.trim().length < 10) return setHata("Rotasyon gerekçesini açıklayınız (en az 10 karakter).");

    setGonderiliyor(true);
    try {
      setSonuc(await rotasyonOlustur({ sicil, tur, aciklama: aciklama.trim(), hedefler: secili }));
    } catch (h) {
      setHata(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const SubeSatiri = ({ x, oneri }) => {
    const sec_ = secili.includes(x.ad);
    return (
      <TouchableOpacity style={[s.sube, sec_ && s.subeSecili]} activeOpacity={0.85} onPress={() => sec(x.ad)}>
        <View style={[s.kutu, sec_ && s.kutuSecili]}>{sec_ ? <Text style={s.kutuTik}>✓</Text> : null}</View>
        <Text style={[s.subeAd, sec_ && { color: "#3f6108" }]} numberOfLines={1}>
          {x.ad}
        </Text>
        {oneri ? (
          <View style={s.acikCip}>
            <Text style={s.acikYazi}>{String(x.acik).replace(".", ",")} açık</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={s.tam} edges={["top", "bottom"]}>
        <View style={s.ust}>
          <TouchableOpacity onPress={sonuc ? bitti : kapat} hitSlop={12}>
            <Text style={s.vazgec}>{sonuc ? "Kapat" : "Vazgeç"}</Text>
          </TouchableOpacity>
          <Text style={s.ustBaslik}>Rotasyon talebi</Text>
          <View style={{ width: 52 }} />
        </View>

        {sonuc ? (
          <View style={s.sonuc}>
            <View style={s.sonucIkon}>
              <Text style={s.sonucIkonYazi}>✓</Text>
            </View>
            <Text style={s.sonucBaslik}>Talep gönderildi</Text>
            <Text style={s.sonucAlt}>
              {adSoyad} · {secili.join(", ")}
            </Text>
            <Text style={s.not}>{sonuc.mesaj}</Text>
            <Text style={s.not}>Personel talebi ana sayfasında görür; sonucu size bildirim olarak gelir.</Text>
            <TouchableOpacity style={s.ana} onPress={bitti}>
              <Text style={s.anaYazi}>Tamam</Text>
            </TouchableOpacity>
          </View>
        ) : !secenek ? (
          <View style={{ padding: 30, alignItems: "center" }}>
            {yukHata ? <Text style={s.hataYazi}>{yukHata}</Text> : <ActivityIndicator color={renk.yesil} />}
          </View>
        ) : (
          <>
            <ScrollView
              ref={kaydirma}
              contentContainerStyle={{ padding: 16, paddingBottom: 120 + klavye, gap: 10 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={s.kisi}>
                <Text style={s.kisiAd}>{secenek.kisi?.adSoyad ?? adSoyad}</Text>
                <Text style={s.kisiAlt}>
                  {secenek.kisi?.pozisyon} · şu an {secenek.kisi?.sube}
                </Text>
              </View>

              <Text style={s.etiket}>Talep kimin isteği?</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[
                  ["yonetici", "Yönetici isteği", "Bölge müdürü, sonra İK onaylar"],
                  ["personel", "Personel isteği", "Doğrudan İK onaylar"],
                ].map(([k, ad, alt]) => (
                  <TouchableOpacity
                    key={k}
                    style={[s.tur, tur === k && s.turSecili]}
                    activeOpacity={0.85}
                    onPress={() => {
                      setHata("");
                      setTur(k);
                    }}
                  >
                    <Text style={[s.turAd, tur === k && { color: "#fff" }]}>{ad}</Text>
                    <Text style={[s.turAlt, tur === k && { color: "#e9f5d6" }]}>{alt}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.etiket}>
                Hedef şube {secili.length > 0 ? `· ${secili.length} seçili` : "(en fazla 5)"}
              </Text>

              {(secenek.oneriler ?? []).length > 0 ? (
                <>
                  <Text style={s.grupBaslik}>
                    ÖNERİLEN · {secenek.bolum ?? "bu pozisyonda"} kadrosu açık
                  </Text>
                  {secenek.oneriler.map((x) => (
                    <SubeSatiri key={x.ad} x={x} oneri />
                  ))}
                </>
              ) : (
                <Text style={s.bos}>Bu pozisyonda kadrosu açık şube yok; diğer şubelerden seçebilirsiniz.</Text>
              )}

              <TouchableOpacity style={s.digerBas} onPress={() => setDigerAcik((x) => !x)} activeOpacity={0.8}>
                <Text style={s.grupBaslik}>DİĞER ŞUBELER · {(secenek.digerleri ?? []).length}</Text>
                <Text style={s.digerOk}>{digerAcik ? "Gizle" : "Göster"}</Text>
              </TouchableOpacity>

              {digerAcik ? (
                <>
                  <TextInput
                    style={s.ara}
                    value={ara}
                    onChangeText={setAra}
                    placeholder="Şube ara"
                    placeholderTextColor="#a3a9a0"
                  />
                  {digerleri.map((x) => (
                    <SubeSatiri key={x.ad} x={x} />
                  ))}
                </>
              ) : null}

              <Text style={s.etiket}>Gerekçe / açıklama (zorunlu)</Text>
              <TextInput
                style={s.aciklama}
                value={aciklama}
                onChangeText={(v) => {
                  setHata("");
                  setAciklama(v);
                }}
                placeholder="Örn. eve yakın şubeye geçmek istiyor; Adakent'te kasiyer açığı var"
                placeholderTextColor="#a3a9a0"
                multiline
                maxLength={1000}
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
                {gonderiliyor ? <ActivityIndicator color="#fff" /> : <Text style={s.anaYazi}>Talebi gönder</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */
/* Bölge müdürü: İzin Onayları ekranındaki bekleyenler                          */
/* ========================================================================== */

export function RotasyonOnaylari({ degisti, sayiBildir }) {
  const [liste, setListe] = useState([]);
  const [islenen, setIslenen] = useState(null);
  const [ret, setRet] = useState(null);
  const [sebep, setSebep] = useState("");

  /* Yönetici İşlemleri (1.7) kategori rozeti için sayı yukarı bildiriliyor */
  const bildirRef = useRef(sayiBildir);
  bildirRef.current = sayiBildir;

  const getir = useCallback(() => {
    rotasyonOnaylarAl()
      .then((c) => {
        const l = c?.kayitlar ?? [];
        setListe(l);
        bildirRef.current?.(l.length);
      })
      .catch(() => {
        setListe([]);
        bildirRef.current?.(0);
      });
  }, []);

  useEffect(() => {
    getir();
  }, [getir, degisti]);

  if (liste.length === 0) return null;

  const karar = async (k, onay, not) => {
    setIslenen(k.id);
    try {
      await rotasyonKarar(k.id, onay, not ?? "");
      setRet(null);
      setSebep("");
      getir();
      Alert.alert(onay ? "Onaylandı" : "Reddedildi", onay ? "Talep İnsan Kaynakları'na geçti." : "Talebi açan yöneticiye bildirildi.");
    } catch (h) {
      Alert.alert("Kaydedilemedi", h.message);
    } finally {
      setIslenen(null);
    }
  };

  return (
    <View style={{ gap: 10, marginBottom: 14 }}>
      <Text style={s.baslik}>ROTASYON TALEPLERİ · {liste.length}</Text>
      {liste.map((k) => (
        <View key={k.id} style={s.kart}>
          <Text style={s.kayitUst}>{k.adSoyad}</Text>
          <Text style={s.kayitAlt}>
            {k.pozisyon} · {k.sube}
          </Text>
          <View style={s.hedefKutu}>
            <Text style={s.hedefEt}>Hedef</Text>
            <Text style={s.hedefDeger}>
              {(k.hedefler ?? []).map((h) => (h.acik > 0 ? `${h.ad} (${String(h.acik).replace(".", ",")} açık)` : h.ad)).join(", ")}
            </Text>
          </View>
          <Text style={s.aciklamaYazi}>“{k.aciklama}”</Text>
          <Text style={s.kayitAlt}>
            {k.turAdi} · {k.talepEden} · {kisaTarih(k.olusturma)}
          </Text>

          {ret?.id === k.id ? (
            <>
              <TextInput
                style={[s.aciklama, { minHeight: 70 }]}
                value={sebep}
                onChangeText={setSebep}
                placeholder="Ret sebebi (zorunlu)"
                placeholderTextColor="#a3a9a0"
                multiline
              />
              <View style={s.dugmeler}>
                <TouchableOpacity style={[s.dugme, s.dugmeIkincil]} onPress={() => setRet(null)}>
                  <Text style={s.dugmeIkincilYazi}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.dugme, s.dugmeRed, (sebep.trim().length < 3 || islenen === k.id) && s.anaPasif]}
                  disabled={sebep.trim().length < 3 || islenen === k.id}
                  onPress={() => karar(k, false, sebep.trim())}
                >
                  <Text style={s.anaYazi}>Reddet</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={s.dugmeler}>
              <TouchableOpacity style={[s.dugme, s.dugmeIkincil]} onPress={() => setRet(k)} disabled={islenen === k.id}>
                <Text style={[s.dugmeIkincilYazi, { color: renk.kirmizi }]}>Reddet</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.dugme, s.dugmeOnay, islenen === k.id && s.anaPasif]}
                disabled={islenen === k.id}
                onPress={() => karar(k, true)}
              >
                <Text style={s.anaYazi}>{islenen === k.id ? "Kaydediliyor" : "Onayla"}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/* ========================================================================== */
/* Personel: salt okunur ayrıntı                                               */
/* ========================================================================== */

export function RotasyonDetay({ talep, kapat }) {
  const k = talep;
  const d = ROTASYON_DURUM[k.durum] ?? ROTASYON_DURUM.ik;

  const adimlar = [
    { ad: "Yöneticiniz talep oluşturdu", alt: `${k.talepEden} · ${kisaTarih(k.olusturma)}`, durum: "tamam" },
    ...(k.tur === "yonetici"
      ? [
          {
            ad: "Bölge müdürü onayı",
            alt: k.bolgeKarar ? `${k.bolgeKarar} · ${kisaTarih(k.bolgeTarih)}` : "bekleniyor",
            durum: k.bolgeKarar === "Reddedildi" ? "red" : k.bolgeKarar ? "tamam" : k.durum === "bolge" ? "sirada" : "bekliyor",
          },
        ]
      : []),
    {
      ad: "İnsan Kaynakları onayı",
      alt: k.ikKarar ? `${k.ikKarar} · ${kisaTarih(k.ikTarih)}` : "bekleniyor",
      durum: k.ikKarar === "Reddedildi" ? "red" : k.ikKarar ? "tamam" : k.durum === "ik" ? "sirada" : "bekliyor",
    },
  ];

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={s.tam} edges={["top", "bottom"]}>
        <View style={s.ust}>
          <TouchableOpacity onPress={kapat} hitSlop={12}>
            <Text style={s.vazgec}>Kapat</Text>
          </TouchableOpacity>
          <Text style={s.ustBaslik}>Rotasyon talebi</Text>
          <View style={{ width: 52 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View style={s.kisi}>
            <View style={[s.cip, { backgroundColor: d.zemin, alignSelf: "flex-start", marginBottom: 6 }]}>
              <Text style={[s.cipYazi, { color: d.yazi }]}>{d.ad}</Text>
            </View>
            <Text style={s.kisiAd}>
              {k.sube} → {k.onaylananSube ?? hedefMetni(k)}
            </Text>
            <Text style={s.kisiAlt}>{k.turAdi}</Text>
          </View>

          <View style={s.kart}>
            {adimlar.map((a, i) => (
              <View key={i} style={s.adim}>
                <Text
                  style={[
                    s.adimNo,
                    a.durum === "tamam" && { backgroundColor: renk.yesilAcik, color: renk.yesilKoyu },
                    a.durum === "red" && { backgroundColor: "#fdecec", color: "#b42318" },
                    a.durum === "sirada" && { backgroundColor: "#fff8e6", color: "#92600e" },
                  ]}
                >
                  {a.durum === "tamam" ? "✓" : a.durum === "red" ? "×" : i + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.kayitUst}>{a.ad}</Text>
                  <Text style={s.kayitAlt}>{a.alt}</Text>
                </View>
              </View>
            ))}
          </View>

          {k.durum === "onaylandi" ? (
            <Text style={s.not}>
              {k.onaylananSube} şubesine geçişiniz onaylandı. Başlangıç tarihi için yöneticiniz ve İnsan Kaynakları sizinle görüşecek.
            </Text>
          ) : k.durum === "reddedildi" ? (
            <Text style={s.not}>Talep reddedildi. Ayrıntı için yöneticinizle görüşebilirsiniz.</Text>
          ) : (
            <Text style={s.not}>Bu talep yöneticiniz tarafından açıldı; sizin bir işlem yapmanız gerekmiyor.</Text>
          )}
        </ScrollView>
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
    backgroundColor: renk.maviAcik,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d3e2f3",
    padding: 11,
  },
  ekleArti: { fontSize: 20, fontWeight: "800", color: renk.mavi, width: 24, textAlign: "center" },
  ekleYazi: { fontSize: 14.5, fontWeight: "800", color: renk.mavi },
  ekleAlt: { fontSize: 11.5, color: "#3d6491", marginTop: 1 },
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

  tur: { flex: 1, backgroundColor: renk.beyaz, borderWidth: 1, borderColor: renk.cizgi, borderRadius: 12, padding: 11 },
  turSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  turAd: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  turAlt: { fontSize: 11, color: renk.pasif, marginTop: 2 },

  grupBaslik: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.5, marginTop: 4 },
  sube: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  subeSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  subeAd: { flex: 1, fontSize: 14, fontWeight: "700", color: renk.metin },
  kutu: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: "#c5cbc0", alignItems: "center", justifyContent: "center" },
  kutuSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  kutuTik: { color: "#fff", fontSize: 12, fontWeight: "800" },
  acikCip: { backgroundColor: "#eef6e1", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  acikYazi: { fontSize: 11, fontWeight: "800", color: "#3f6108" },
  digerBas: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  digerOk: { fontSize: 12.5, fontWeight: "700", color: renk.yesilKoyu },
  ara: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: renk.metin,
  },

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
  not: { fontSize: 12.5, color: renk.pasif, textAlign: "center", lineHeight: 18 },

  hedefKutu: { backgroundColor: renk.maviAcik, borderRadius: 10, padding: 9 },
  hedefEt: { fontSize: 10.5, fontWeight: "800", color: renk.mavi },
  hedefDeger: { fontSize: 13, fontWeight: "700", color: renk.metin, marginTop: 2 },
  aciklamaYazi: { fontSize: 13, color: renk.metin, fontStyle: "italic" },
  dugmeler: { flexDirection: "row", gap: 8, marginTop: 4 },
  dugme: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  dugmeOnay: { backgroundColor: renk.yesilKoyu },
  dugmeRed: { backgroundColor: renk.kirmizi },
  dugmeIkincil: { backgroundColor: renk.beyaz, borderWidth: 1, borderColor: renk.cizgi },
  dugmeIkincilYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },

  adim: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  adimNo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f1f3ef",
    color: renk.pasif,
    textAlign: "center",
    lineHeight: 24,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
});

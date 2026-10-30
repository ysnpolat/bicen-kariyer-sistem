/**
 * Personel ayrıntısı — yöneticinin gördüğü
 * ---------------------------------------------------------------------------
 * Puantaj ve Ekibim ekranlarından açılıyor. Bugün izinli mi, izin
 * bakiyesi, planlı izinler, bekleyen talep ve son 30 günün puantajı —
 * vardiya girişi yapılmayan günler ayrıca listeleniyor.
 *
 * Sunucu yalnızca sorumlu olunan kişide dönüyor (İK'nın izin onay
 * tablosundan ya da bölge müdürünün bölgesinden).
 */

import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran } from "./ModalAlani";

import { ekipKisiAl, ekipGunAl, vardiyaArkadasAl } from "../api";
import { renk } from "../tema";
import FazlaMesaiKarti from "./FazlaMesai";
import RotasyonKarti from "./Rotasyon";

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUN_ADI = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const GUN_KISA = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];

export const DURUM = {
  okuttu: { ad: "Okuttu", renk: "#5f8c10", zemin: "#eaf5d9" },
  okutmadi: { ad: "Okutmadı", renk: "#cf1322", zemin: "#fdecec" },
  izinli: { ad: "İzinli", renk: "#1a4d80", zemin: "#e6eff9" },
  haftalik: { ad: "Haftalık izin", renk: "#6b7280", zemin: "#eef0ec" },
  tatil: { ad: "Resmî tatil", renk: "#7c5bc4", zemin: "#efeafa" },
};

const tarihOku = (s) => (s ? new Date(s) : null);

const saat = (s) => {
  const d = tarihOku(s);
  return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
};

const kisaTarih = (s) => {
  const d = tarihOku(s);
  return d ? `${d.getDate()} ${AYLAR[d.getMonth()]}` : "";
};

const sayi = (n) => String(Math.round(Number(n ?? 0) * 100) / 100).replace(".", ",");

const AY_TAM = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const isoGun = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2 sa 30 dk" */
const sureYaz = (dk) => {
  const n = Math.round(Number(dk) || 0);
  if (n <= 0) return "";
  const sa = Math.floor(n / 60);
  const d = n % 60;
  return sa === 0 ? `${d} dk` : d === 0 ? `${sa} sa` : `${sa} sa ${d} dk`;
};

/** Fazla mesai işareti ve listesi */
const FM_RENK = { renk: "#0c8599", zemin: "#e3f6f9" };

/**
 * Aralık: 0 → son 30 gün; 1 → bu ay; 2 → geçen ay; ... (en çok 24 ay)
 * 12.10.2026 (1.7): personel yalnızca son 30 günü görebiliyordu.
 */
const aralikBul = (geri) => {
  if (!geri) return { ad: "Son 30 gün", baslik: "SON 30 GÜN", aralik: null };
  const bugun = new Date();
  const bas = new Date(bugun.getFullYear(), bugun.getMonth() - (geri - 1), 1);
  const son = new Date(bas.getFullYear(), bas.getMonth() + 1, 0);
  const bit = son > bugun ? bugun : son;
  const ad = `${AY_TAM[bas.getMonth()]} ${bas.getFullYear()}`;
  return { ad, baslik: ad.toLocaleUpperCase("tr-TR"), aralik: { bas: isoGun(bas), bit: isoGun(bit) } };
};

export default function KisiDetay({ sicil, kapat, gomulu = false }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");

  /* Takvimde güne dokununca o günün bütün okutmaları */
  const [gun, setGun] = useState(null);

  /* Bu haftanın vardiya planı: yönetici de personel de görebiliyor */
  const [vardiya, setVardiya] = useState(null);

  /* Tarih aralığı (1.7): 0 son 30 gün, 1 bu ay, 2 geçen ay ... */
  const [geri, setGeri] = useState(0);
  const [araliktaYukleniyor, setAraliktaYukleniyor] = useState(false);
  const ar = aralikBul(geri);

  useEffect(() => {
    let iptal = false;

    setAraliktaYukleniyor(true);

    ekipKisiAl(sicil, 30, ar.aralik)
      .then((c) => {
        if (iptal) return;
        setVeri(c);
        setHata("");
      })
      .catch((h) => !iptal && setHata(h.message))
      .finally(() => !iptal && setAraliktaYukleniyor(false));

    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sicil, geri]);

  useEffect(() => {
    let iptal = false;

    vardiyaArkadasAl(sicil)
      .then((c) => !iptal && setVardiya(c))
      .catch(() => {});

    return () => {
      iptal = true;
    };
  }, [sicil]);

  const p = veri?.personel;
  const bugun = veri?.bugun;
  const gunler = veri?.gunler ?? [];
  const okutmadigi = gunler.filter((g) => g.durum === "okutmadi").reverse();

  /* Takvim ızgarası: son 30 gün, haftalar satır satır (pazartesiden) */
  const hucreler = [];
  if (gunler.length) {
    const ilk = tarihOku(gunler[0].tarih);
    const bosluk = (ilk.getDay() + 6) % 7;
    for (let i = 0; i < bosluk; i++) hucreler.push(null);
    for (const g of gunler) hucreler.push(g);
  }

  const bugunDurum = bugun?.izin
    ? { ...DURUM.izinli, ad: `${bugun.izin.tur} · ${kisaTarih(bugun.izin.donus)}'e kadar` }
    : DURUM[bugun?.durum] ?? DURUM.okutmadi;

  const fazlaMesailer = veri?.fazlaMesailer ?? [];
  const fmToplam = veri?.ozet?.fazlaMesaiDk ?? 0;

  const icerik = (
    <>
        {!veri && !hata ? (
          <ActivityIndicator color={renk.yesilKoyu} style={{ marginTop: 40 }} />
        ) : hata ? (
          <Text style={s.hata}>{hata}</Text>
        ) : (
          /* Personelin kendi çizelgesinde yüzen alt menü son kartın üstüne binmesin */
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: gomulu ? 130 : 40 }}>
            {/* ------------------------------------------------ kimlik */}
            <View style={s.kimlik}>
              <View style={s.avatar}>
                <Text style={s.avatarYazi}>
                  {(p.adSoyad ?? "").split(" ").map((x) => x[0]).slice(0, 2).join("")}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.ad}>{p.adSoyad}</Text>
                <Text style={s.alt}>
                  {p.pozisyon} · {p.sube}
                </Text>
                {p.haftalikIzinGunu != null ? (
                  <Text style={s.alt}>Haftalık izin günü: {GUN_ADI[p.haftalikIzinGunu]}</Text>
                ) : null}
              </View>
            </View>

            {/* ------------------------------------------- fazla mesai (1.6) */}
            {/* Yalnızca yöneticinin açtığı ayrıntıda; personelin kendi puantajında değil */}
            {!gomulu ? <FazlaMesaiKarti sicil={sicil} adSoyad={p.adSoyad} /> : null}

            {/* Rotasyon talebi (1.6): yönetici açar, personel yalnızca görür */}
            {!gomulu ? <RotasyonKarti sicil={sicil} adSoyad={p.adSoyad} /> : null}

            {/* ------------------------------------------------- bugün */}
            <View style={[s.bugun, { backgroundColor: bugunDurum.zemin }]}>
              <Text style={[s.bugunEt, { color: bugunDurum.renk }]}>BUGÜN</Text>
              <Text style={[s.bugunDeger, { color: bugunDurum.renk }]}>
                {bugunDurum.ad}
                {bugun?.giris ? ` · giriş ${saat(bugun.giris)}` : ""}
              </Text>
            </View>

            {/* --------------------------------------- bu haftanın vardiyası */}
            {vardiya?.gunler?.length ? (
              <>
                <Text style={s.baslik}>BU HAFTANIN VARDİYASI</Text>
                <View style={s.vardiyaSerit}>
                  {vardiya.gunler.map((g, i) => (
                    <View key={i} style={s.vardiyaGun}>
                      <Text style={s.vardiyaGunAd}>{["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"][i]}</Text>
                      <View
                        style={[
                          s.vardiyaKutu,
                          g.baslangic
                            ? { backgroundColor: DURUM.okuttu.zemin }
                            : g.tur === "yillik"
                            ? { backgroundColor: DURUM.izinli.zemin }
                            : { backgroundColor: renk.zemin },
                        ]}
                      >
                        <Text style={s.vardiyaYazi} numberOfLines={1}>
                          {g.baslangic ? g.baslangic : g.tur === "off" ? "—" : g.ad.slice(0, 3)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* ------------------------------------------------ bakiye */}
            <Text style={s.baslik}>YILLIK İZİN</Text>
            <View style={s.kutular}>
              {[
                ["Kalan", veri.bakiye.kalan, renk.yesilKoyu],
                ["Hak edilen", veri.bakiye.hakedilen],
                ["Kullanılan", veri.bakiye.kullanilan],
                ["Planlı", veri.bakiye.planli, renk.mavi],
              ].map(([a, d, r]) => (
                <View key={a} style={s.kutu}>
                  <Text style={[s.kutuDeger, r && { color: r }]}>{sayi(d)}</Text>
                  <Text style={s.kutuAd}>{a}</Text>
                </View>
              ))}
            </View>

            {(veri.planliIzinler ?? []).length > 0 && (
              <View style={s.kart}>
                <Text style={s.kartBaslik}>Planlı izinler</Text>
                {veri.planliIzinler.map((x, i) => (
                  <Text key={i} style={s.satir}>
                    {kisaTarih(x.cikis)} – {kisaTarih(x.donus)} · {x.tur} · {sayi(x.gun)} gün
                  </Text>
                ))}
              </View>
            )}

            {veri.bekleyenTalep ? (
              <View style={[s.kart, { backgroundColor: "#fff8e6", borderColor: "#f5e3b3" }]}>
                <Text style={s.kartBaslik}>Onay bekleyen talep</Text>
                <Text style={s.satir}>
                  {kisaTarih(veri.bekleyenTalep.cikis)} – {kisaTarih(veri.bekleyenTalep.donus)} ·{" "}
                  {veri.bekleyenTalep.tur} · {veri.bekleyenTalep.durum}
                </Text>
              </View>
            ) : null}

            {/* ------------------------------------- dönem (1.7: tarih seçilebiliyor) */}
            <View style={s.donemBar}>
              <TouchableOpacity
                style={[s.donemOk, geri >= 24 && { opacity: 0.3 }]}
                disabled={geri >= 24}
                onPress={() => setGeri((g) => Math.min(24, g + 1))}
                hitSlop={8}
              >
                <Text style={s.donemOkYazi}>‹</Text>
              </TouchableOpacity>

              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={s.donemAd}>{ar.ad}</Text>
                <Text style={s.donemAlt}>
                  {araliktaYukleniyor ? "yükleniyor…" : geri === 0 ? "önceki aylar için ‹" : "puantaj çizelgesi"}
                </Text>
              </View>

              <TouchableOpacity
                style={[s.donemOk, geri === 0 && { opacity: 0.3 }]}
                disabled={geri === 0}
                onPress={() => setGeri((g) => Math.max(0, g - 1))}
                hitSlop={8}
              >
                <Text style={s.donemOkYazi}>›</Text>
              </TouchableOpacity>

              {geri > 0 ? (
                <TouchableOpacity style={s.donemSon} onPress={() => setGeri(0)}>
                  <Text style={s.donemSonYazi}>Son 30 gün</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={s.baslik}>{ar.baslik}</Text>
            <View style={s.ozet}>
              <Text style={[s.ozetYazi, { color: DURUM.okuttu.renk }]}>
                {veri.ozet.okuttu} gün okuttu
              </Text>
              <Text style={[s.ozetYazi, { color: DURUM.okutmadi.renk }]}>
                {veri.ozet.okutmadi} gün okutmadı
              </Text>
              <Text style={[s.ozetYazi, { color: DURUM.izinli.renk }]}>{veri.ozet.izinli} gün izinli</Text>
              {fmToplam > 0 ? (
                <Text style={[s.ozetYazi, { color: FM_RENK.renk }]}>{sureYaz(fmToplam)} fazla mesai</Text>
              ) : null}
            </View>

            <View style={s.takvim}>
              {[1, 2, 3, 4, 5, 6, 0].map((g) => (
                <Text key={g} style={s.takvimBaslik}>
                  {GUN_KISA[g]}
                </Text>
              ))}
              {hucreler.map((g, i) => (
                <View key={i} style={s.hucre}>
                  {g ? (
                    <TouchableOpacity
                      style={[s.hucreIc, { backgroundColor: DURUM[g.durum]?.zemin }]}
                      activeOpacity={0.7}
                      onPress={() => setGun(g)}
                    >
                      <Text style={[s.hucreYazi, { color: DURUM[g.durum]?.renk }]}>
                        {tarihOku(g.tarih).getDate()}
                      </Text>
                      {g.durum === "okuttu" && g.cikis ? <View style={s.ciftNokta} /> : null}
                      {g.fazlaMesaiDk > 0 ? <View style={s.fmNokta} /> : null}
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={s.lejant}>
              {Object.entries(DURUM).map(([k, d]) => (
                <View key={k} style={s.lejantOge}>
                  <View style={[s.lejantNokta, { backgroundColor: d.renk }]} />
                  <Text style={s.lejantYazi}>{d.ad}</Text>
                </View>
              ))}
              <View style={s.lejantOge}>
                <View style={[s.lejantNokta, { backgroundColor: FM_RENK.renk }]} />
                <Text style={s.lejantYazi}>Fazla mesai</Text>
              </View>
            </View>

            {/* Fazla mesailer (1.7): personel onaylananları, yönetici
                süreçtekileri de görüyor */}
            {fazlaMesailer.length > 0 ? (
              <View style={[s.kart, { borderColor: "#b6e3ea" }]}>
                <Text style={[s.kartBaslik, { color: FM_RENK.renk }]}>
                  Fazla mesailer{fmToplam > 0 ? ` · onaylı ${sureYaz(fmToplam)}` : ""}
                </Text>
                {fazlaMesailer.map((f) => {
                  const d = tarihOku(f.tarih);
                  return (
                    <View key={f.id} style={s.fmSatir}>
                      <View style={s.fmTarih}>
                        <Text style={s.fmGun}>{d.getDate()}</Text>
                        <Text style={s.fmAy}>{AYLAR[d.getMonth()]}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.fmSaat}>
                          {f.baslangic}–{f.bitis} · {f.sure}
                        </Text>
                        {f.aciklama ? (
                          <Text style={s.fmNeden} numberOfLines={2}>
                            {f.aciklama}
                          </Text>
                        ) : null}
                      </View>
                      <View style={[s.fmHap, f.onayli ? { backgroundColor: DURUM.okuttu.zemin } : { backgroundColor: "#fff7e6" }]}>
                        <Text style={[s.fmHapYazi, { color: f.onayli ? DURUM.okuttu.renk : "#ad6800" }]} numberOfLines={1}>
                          {f.onayli ? "Onaylı" : f.durumAdi}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : gomulu ? (
              <Text style={s.fmBos}>Bu dönemde onaylanmış fazla mesainiz yok.</Text>
            ) : null}

            {okutmadigi.length > 0 && (
              <View style={[s.kart, { borderColor: "#f3c2c2" }]}>
                <Text style={[s.kartBaslik, { color: DURUM.okutmadi.renk }]}>
                  Vardiya girişi yapılmayan günler
                </Text>
                {okutmadigi.map((g, i) => {
                  const d = tarihOku(g.tarih);
                  return (
                    <Text key={i} style={s.satir}>
                      {d.getDate()} {AYLAR[d.getMonth()]} · {GUN_ADI[d.getDay()]}
                    </Text>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
    </>
  );

  const gunPenceresi = gun ? (
    <GunAyrinti sicil={sicil} gun={gun} kapat={() => setGun(null)} />
  ) : null;

  /* Personelin kendi puantajı: ekranın içinde, pencere olmadan */
  if (gomulu)
    return (
      <View style={{ flex: 1 }}>
        {icerik}
        {gunPenceresi}
      </View>
    );

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={s.tam} edges={["top", "bottom"]}>
        <View style={s.ust}>
          <Text style={s.ustBaslik}>Personel</Text>
          <TouchableOpacity onPress={kapat} hitSlop={12}>
            <Text style={s.kapat}>Kapat</Text>
          </TouchableOpacity>
        </View>

        {icerik}
      </ModalAlani>

      {gunPenceresi}
    </Modal>
  );
}

/* ========================================================================== */

/**
 * Bir günün okutmaları: kaç kez okutmuş, hangi saatlerde, giriş mi çıkış mı.
 *
 * Takvimde yalnızca renk vardı; "kaça okutmuş" sorusunun cevabı ilk ve son
 * okutmadan görünmüyordu. Gün içindeki her okutma burada.
 */
export function GunAyrinti({ sicil, gun, kapat, tumunuAc }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    let iptal = false;

    ekipGunAl(sicil, String(gun.tarih).slice(0, 10))
      .then((c) => !iptal && setVeri(c))
      .catch((h) => !iptal && setHata(h.message));

    return () => {
      iptal = true;
    };
  }, [sicil, gun]);

  const d = tarihOku(gun.tarih);
  const durum = DURUM[veri?.durum ?? gun.durum] ?? DURUM.okutmadi;

  const sure = (dk) =>
    dk == null ? null : `${Math.floor(dk / 60)} sa ${String(dk % 60).padStart(2, "0")} dk`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={kapat}>
      <TouchableOpacity style={s.perde} activeOpacity={1} onPress={kapat}>
        <TouchableOpacity activeOpacity={1} style={s.gunKart}>
          <Text style={s.gunBaslik}>
            {d?.getDate()} {AYLAR[d?.getMonth()]} · {GUN_ADI[d?.getDay()]}
          </Text>

          <View style={[s.gunDurum, { backgroundColor: durum.zemin }]}>
            <Text style={[s.gunDurumYazi, { color: durum.renk }]}>
              {veri?.izinTuru ?? durum.ad}
              {veri?.okutma ? ` · ${veri.okutma} okutma` : ""}
              {veri?.dakika != null ? ` · ${sure(veri.dakika)}` : ""}
            </Text>
          </View>

          {gun.fazlaMesaiDk > 0 ? (
            <View style={[s.gunDurum, { backgroundColor: FM_RENK.zemin, marginTop: 6 }]}>
              <Text style={[s.gunDurumYazi, { color: FM_RENK.renk }]}>Onaylı fazla mesai · {sureYaz(gun.fazlaMesaiDk)}</Text>
            </View>
          ) : null}

          {!veri && !hata ? (
            <ActivityIndicator color={renk.yesilKoyu} style={{ marginVertical: 20 }} />
          ) : hata ? (
            <Text style={[s.hata, { padding: 12 }]}>{hata}</Text>
          ) : veri.okutmalar.length === 0 ? (
            <Text style={s.gunBos}>Bu gün için okutma kaydı yok.</Text>
          ) : (
            veri.okutmalar.map((o, i) => (
              <View key={i} style={s.gunSatir}>
                <View
                  style={[
                    s.gunTur,
                    { backgroundColor: o.tur === "cikis" ? "#fdecec" : DURUM.okuttu.zemin },
                  ]}
                >
                  <Text
                    style={[
                      s.gunTurYazi,
                      { color: o.tur === "cikis" ? DURUM.okutmadi.renk : DURUM.okuttu.renk },
                    ]}
                  >
                    {o.tur === "cikis" ? "çıkış" : "giriş"}
                  </Text>
                </View>

                <Text style={s.gunSaat}>{saat(o.zaman)}</Text>

                <Text style={s.gunKaynak}>
                  {o.kaynak === "kart" ? "kart" : "uygulama"}
                  {o.subeAdi ? ` · ${o.subeAdi}` : ""}
                </Text>
              </View>
            ))
          )}

          {tumunuAc ? (
            <TouchableOpacity
              style={[s.gunKapat, { backgroundColor: renk.yesilAcik }]}
              onPress={tumunuAc}
            >
              <Text style={[s.gunKapatYazi, { color: renk.yesilKoyu }]}>
                Personelin puantaj ayrıntısı
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={s.gunKapat} onPress={kapat}>
            <Text style={s.gunKapatYazi}>Kapat</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  /* Dönem seçici (1.7) */
  donemBar: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  donemOk: { paddingHorizontal: 14, paddingVertical: 4 },
  donemOkYazi: { fontSize: 24, color: renk.metin, fontWeight: "600" },
  donemAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  donemAlt: { fontSize: 11, color: renk.pasif, fontWeight: "700" },
  donemSon: { backgroundColor: renk.yesilAcik, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, marginRight: 4 },
  donemSonYazi: { fontSize: 11.5, fontWeight: "800", color: renk.yesilKoyu },

  fmNokta: { position: "absolute", top: 3, right: 3, width: 7, height: 7, borderRadius: 4, backgroundColor: "#0c8599" },
  fmSatir: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#f0f2ee" },
  fmTarih: { width: 40, alignItems: "center", backgroundColor: "#e3f6f9", borderRadius: 10, paddingVertical: 4 },
  fmGun: { fontSize: 16, fontWeight: "800", color: "#0c8599" },
  fmAy: { fontSize: 10, fontWeight: "700", color: "#0c8599" },
  fmSaat: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  fmNeden: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  fmHap: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 120 },
  fmHapYazi: { fontSize: 11, fontWeight: "800" },
  fmBos: { fontSize: 12, color: renk.pasif, marginTop: 10, textAlign: "center" },

  tam: { flex: 1, backgroundColor: renk.zemin },
  ust: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14 },
  ustBaslik: { flex: 1, fontSize: 18, fontWeight: "800", color: renk.metin },
  kapat: { fontSize: 14, fontWeight: "700", color: renk.pasif },
  hata: { color: renk.kirmizi, padding: 20, textAlign: "center" },

  kimlik: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarYazi: { fontSize: 18, fontWeight: "800", color: renk.yesilKoyu },
  ad: { fontSize: 18, fontWeight: "800", color: renk.metin },
  alt: { fontSize: 12.5, color: renk.pasif, marginTop: 2 },

  bugun: { marginTop: 14, borderRadius: 14, padding: 12 },
  bugunEt: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6 },
  bugunDeger: { fontSize: 15, fontWeight: "800", marginTop: 2 },

  baslik: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.7, marginTop: 20, marginBottom: 8 },
  kutular: { flexDirection: "row", gap: 8 },
  kutu: {
    flex: 1,
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  kutuDeger: { fontSize: 18, fontWeight: "800", color: renk.metin },
  kutuAd: { fontSize: 10.5, fontWeight: "700", color: renk.pasif, marginTop: 1 },

  kart: {
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  kartBaslik: { fontSize: 13, fontWeight: "800", color: renk.metin, marginBottom: 6 },
  satir: { fontSize: 13, color: renk.metin, paddingVertical: 3 },

  ozet: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4, marginBottom: 8 },
  ozetYazi: { fontSize: 12.5, fontWeight: "800" },

  takvim: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: renk.beyaz,
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  takvimBaslik: { width: "14.28%" /* 100/7 yuvarlanınca bazı Android ekranlarda 7. gün alt satıra düşüyordu */, textAlign: "center", fontSize: 10.5, fontWeight: "800", color: renk.pasif, paddingVertical: 4 },
  hucre: { width: "14.28%" /* 100/7 yuvarlanınca bazı Android ekranlarda 7. gün alt satıra düşüyordu */, padding: 2 },
  hucreIc: { height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  hucreYazi: { fontSize: 12.5, fontWeight: "800" },

  vardiyaSerit: { flexDirection: "row", gap: 4 },
  vardiyaGun: { flex: 1, alignItems: "center" },
  vardiyaGunAd: { fontSize: 10, fontWeight: "800", color: renk.pasif, marginBottom: 3 },
  vardiyaKutu: { width: "100%", borderRadius: 9, paddingVertical: 8, alignItems: "center" },
  vardiyaYazi: { fontSize: 10.5, fontWeight: "800", color: renk.metin },

  ciftNokta: { position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.25)" },

  perde: { flex: 1, backgroundColor: "rgba(20,24,18,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  gunKart: { width: "100%", backgroundColor: renk.beyaz, borderRadius: 20, padding: 16 },
  gunBaslik: { fontSize: 17, fontWeight: "800", color: renk.metin },
  gunDurum: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  gunDurumYazi: { fontSize: 13, fontWeight: "800" },
  gunBos: { fontSize: 13, color: renk.pasif, paddingVertical: 16, textAlign: "center" },
  gunSatir: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: renk.cizgi },
  gunTur: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  gunTurYazi: { fontSize: 11, fontWeight: "800" },
  gunSaat: { fontSize: 16, fontWeight: "800", color: renk.metin, flex: 1 },
  gunKaynak: { fontSize: 11.5, color: renk.pasif },
  gunKapat: { marginTop: 14, alignItems: "center", paddingVertical: 10, backgroundColor: renk.zemin, borderRadius: 12 },
  gunKapatYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },

  lejant: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  lejantOge: { flexDirection: "row", alignItems: "center", gap: 4 },
  lejantNokta: { width: 8, height: 8, borderRadius: 4 },
  lejantYazi: { fontSize: 11, color: renk.pasif },
});

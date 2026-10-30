/**
 * Yönetici İşlemleri (12.10.2026, uygulama 1.7)
 * ---------------------------------------------------------------------------
 * Eski adı İzin Onayları. Yöneticinin bütün talep ve onay işleri tek
 * ekranda, kategori kategori:
 *
 *   - İzin talepleri: onay bekleyenler ve sorumlu olunan personelin
 *     taleplerinin süreci (birim yöneticisi → üst yönetici → İK).
 *   - Fazla mesai: onay bekleyenler ve girilen fazla mesailerin süreci.
 *     Önce yönetici girdiği fazla mesaiyi bir daha göremiyordu.
 *   - Avans: onay zincirinde adı geçen talepler.
 *   - Haftalık gün ve rotasyon: yalnızca bekleyen varsa görünüyor.
 *
 * Bildirimler ilgili kategoriyi açıyor ("izinonay|fazlamesai" gibi).
 *
 * Reddetmek sebep istiyor. Sebepsiz ret, personele yalnızca "olmadı"
 * diyor; hangi güne geçmesi gerektiğini bilmeden aynı günü yeniden
 * seçiyordu.
 *
 * 26.10.2026 (2.0): "Eksik bildir" — reddetmek yerine personelden düzeltme
 * istenir; talep aynı adımda bekler, personel tamamlayınca yöneticiye
 * bildirim gelir. Süreç kartlarında karar verildikten sonra da imzalı form,
 * rapor ve evraklar açılabiliyor (önce yalnızca onay bekleyen kartta vardı).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking } from "react-native";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import {
  izinTalepleriAl,
  izinTalebiOnayla,
  yillikIzinBekleyenlerAl,
  yillikIzinKarar,
  yillikIzinEksikBildir,
  mazeretBelgeYukle,
  oturumluAdres,
  yoneticiSurecAl,
  rotasyonOnaylarAl,
  onayRozeti,
} from "../api";
import { modullerimAl, denklestirmeOnayAl } from "../api";
import { dosyaAl } from "../bilesenler/Gorevler";
import { renk, olcu } from "../tema";
import { Yukleniyor, Hata, Bilgi, Kart } from "../bilesenler/Ortak";
import Simge from "../bilesenler/Simge";
import BarBaslik from "../bilesenler/BarBaslik";
import AltSayfa from "../bilesenler/AltSayfa";
import { RotasyonOnaylari } from "../bilesenler/Rotasyon";

/* -------------------------------------------------------------------------- */

const tarihYaz = (deger) => {
  if (!deger) return "";

  const t = new Date(deger);

  if (Number.isNaN(t.getTime())) return "";

  const iki = (s) => String(s).padStart(2, "0");

  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
};

const gunFarki = (deger) => {
  if (!deger) return null;

  const t = new Date(deger);

  if (Number.isNaN(t.getTime())) return null;

  return Math.max(0, Math.floor((Date.now() - t.getTime()) / 86400000));
};

/* ========================================================================== */

/* Fazla mesai onayı (08.10.2026): onay akışı izin talebiyle aynı; üst
   yöneticinin onayını bekleyen fazla mesailer bu listede. 1.6 aynı kaydı
   izin kartıyla gösteriyor. */
function FazlaMesaiOzet({ t }) {
  return (
    <>
      <View style={s.ust}>
        <View style={[s.avatar, { backgroundColor: "#eef4fb" }]}>
          <Text style={[s.avatarYazi, { color: "#1f4f82" }]}>
            {(t.adSoyad ?? "").split(" ").map((x) => x[0]).slice(0, 2).join("")}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.ad} numberOfLines={1}>{t.adSoyad}</Text>
          <Text style={s.alt} numberOfLines={1}>
            {[t.gorev, t.subeAdi].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={[s.sure, { backgroundColor: "#eef4fb" }]}>
          <Text style={[s.sureYazi, { color: "#1f4f82" }]}>Fazla mesai</Text>
        </View>
      </View>

      <View style={s.gunSatir}>
        <View style={s.gunKutu}>
          <Text style={s.gunEtiket}>TARİH</Text>
          <Text style={s.gunDeger}>{tarihYaz(t.tarih ?? t.cikisTarihi)}</Text>
        </View>
        <View style={s.gunKutu}>
          <Text style={s.gunEtiket}>SAAT</Text>
          <Text style={s.gunDeger}>{t.baslangic}–{t.bitis}</Text>
        </View>
        <View style={[s.gunKutu, s.gunIstenen]}>
          <Text style={[s.gunEtiket, { color: renk.yesilKoyu }]}>SÜRE</Text>
          <Text style={[s.gunDeger, { color: renk.yesilKoyu }]} numberOfLines={1}>{t.sureKisa ?? t.sure}</Text>
        </View>
      </View>

      {t.neden ? (
        <View style={s.not}>
          <Text style={s.notYazi}>{t.neden}</Text>
        </View>
      ) : null}

    </>
  );
}

/** Avans talebi kartı (1.7): tutar, taksit, ilk kesinti ve onay sırası */
const lira = (v) => "₺" + Math.round(Number(v) || 0).toLocaleString("tr-TR");

function AvansOzet({ t }) {
  const sira = t.sira ?? [];
  return (
    <>
      <View style={s.ust}>
        <View style={[s.avatar, { backgroundColor: "#fdf3e6" }]}>
          <Text style={[s.avatarYazi, { color: "#9a5b13" }]}>
            {(t.adSoyad ?? "").split(" ").map((x) => x[0]).slice(0, 2).join("")}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.ad} numberOfLines={1}>{t.adSoyad}</Text>
          <Text style={s.alt} numberOfLines={1}>
            {[t.gorev, t.subeAdi].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={[s.sure, { backgroundColor: "#fdf3e6" }]}>
          <Text style={[s.sureYazi, { color: "#9a5b13" }]}>Avans</Text>
        </View>
      </View>

      <View style={s.gunSatir}>
        <View style={[s.gunKutu, s.gunIstenen]}>
          <Text style={[s.gunEtiket, { color: renk.yesilKoyu }]}>TUTAR</Text>
          <Text style={[s.gunDeger, { color: renk.yesilKoyu }]} numberOfLines={1}>{lira(t.tutar)}</Text>
        </View>
        <View style={s.gunKutu}>
          <Text style={s.gunEtiket}>TAKSİT</Text>
          <Text style={s.gunDeger} numberOfLines={1}>{t.taksit === 1 ? "Tek" : t.taksit}</Text>
        </View>
        <View style={s.gunKutu}>
          <Text style={s.gunEtiket}>İLK KESİNTİ</Text>
          <Text style={s.gunDeger} numberOfLines={1}>{tarihYaz(t.ilkKesinti)}</Text>
        </View>
      </View>

      {t.neden || t.not ? (
        <View style={s.not}>
          <Text style={s.notYazi}>
            {[t.neden, t.not].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ) : null}

      {sira.length > 1 ? (
        <Text style={s.tarih}>
          {sira
            .map((x) => `${x.karar === "onay" ? "✓ " : x.karar === "atlandi" ? "– " : ""}${x.ad}`)
            .join("  →  ")}
        </Text>
      ) : null}
    </>
  );
}

/**
 * İmzalı form (09.10.2026): birim yöneticisi kart içinden yükler; bölge
 * müdürü yüklenen formu açıp görerek onaylar. Sunucu formYukle / formVar
 * alanlarını gönderiyor; 1.6 bunları tanımıyor, ana sayfa kartıyla yüklüyor.
 */
function FormEylemi({ t, yuklendi, acildi }) {
  const [secim, setSecim] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);

  if (!t.formYukle && !t.formVar) return null;

  const yukle = async (kaynak) => {
    setSecim(false);
    try {
      const dosya = await dosyaAl(kaynak);
      if (!dosya) return;
      setYukleniyor(true);
      await mazeretBelgeYukle(t.formYukleKimlik ?? t.id, t.tip === "fazlamesai" ? "İmzalı fazla mesai formu" : "İmzalı izin formu", dosya, "form");
      yuklendi?.();
    } catch (h) {
      Alert.alert("Yüklenemedi", h?.message ?? "Form yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  };

  const ac = () => {
    acildi?.();
    Linking.openURL(oturumluAdres(t.formYolu)).catch(() => Alert.alert("Açılamadı", "Form açılamadı; bağlantınızı kontrol edin."));
  };

  if (t.formYukle)
    return (
      <View style={s.formKutu}>
        <Text style={s.formBaslik}>İmzalı formu yükleyin</Text>
        <Text style={s.formAlt}>
          Şubeye maille gelen formu imzalatıp fotoğrafını çekin. Form yüklenmeden onaylayamazsınız.
        </Text>
        {yukleniyor ? (
          <ActivityIndicator color={renk.yesilKoyu} style={{ alignSelf: "flex-start", marginTop: 8 }} />
        ) : secim ? (
          <View style={s.formKaynaklar}>
            {[
              ["kamera", "Fotoğraf çek"],
              ["galeri", "Galeriden"],
              ["dosya", "PDF"],
            ].map(([k, ad]) => (
              <TouchableOpacity key={k} style={s.formKaynak} onPress={() => yukle(k)} activeOpacity={0.8}>
                <Text style={s.formKaynakYazi}>{ad}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <TouchableOpacity style={s.formDugme} onPress={() => setSecim(true)} activeOpacity={0.85}>
            <Simge ad="belge" boyut={15} renkli={renk.beyaz} />
            <Text style={s.formDugmeYazi}>İmzalı formu yükle</Text>
          </TouchableOpacity>
        )}
      </View>
    );

  /* Raporlu izin (1.9): imzalı form yok, rapor var */
  if (t.rapor)
    return (
      <TouchableOpacity style={[s.formGor, { borderColor: "#d9c6f7", backgroundColor: "#f8f3ff" }]} onPress={ac} activeOpacity={0.8}>
        <Simge ad="belge" boyut={16} renkli={renk.mor} />
        <Text style={[s.formGorYazi, { color: renk.mor }]}>Raporu gör</Text>
        <Text style={s.formGorAlt}>onaylamadan önce</Text>
      </TouchableOpacity>
    );

  return (
    <TouchableOpacity style={s.formGor} onPress={ac} activeOpacity={0.8}>
      <Simge ad="belge" boyut={16} renkli={renk.yesilKoyu} />
      <Text style={s.formGorYazi}>İmzalı formu gör</Text>
      <Text style={s.formGorAlt}>yüklendi</Text>
    </TouchableOpacity>
  );
}

/**
 * Evrak listesi (26.10.2026): talebin imzalı formu, raporu, mazeret belgesi
 * ya da avans belgesi; telefon tarayıcısında açılır. Sunucu "evraklar"
 * gönderiyor; eski sunucu göndermezse hiçbir şey çizilmez.
 */
function EvrakListesi({ evraklar, acildi }) {
  if (!Array.isArray(evraklar) || evraklar.length === 0) return null;

  const ac = (e) => {
    acildi?.();
    Linking.openURL(oturumluAdres(e.yol)).catch(() => Alert.alert("Açılamadı", "Belge açılamadı; bağlantınızı kontrol edin."));
  };

  return (
    <View style={s.evraklar}>
      <Text style={s.evrakBaslik}>EVRAKLAR</Text>
      {evraklar.map((e) => (
        <TouchableOpacity key={`${e.kalem}-${e.belgeId}`} style={s.evrak} onPress={() => ac(e)} activeOpacity={0.8}>
          <Simge ad="belge" boyut={15} renkli={e.kalem === "form" ? renk.yesilKoyu : renk.mor} />
          <Text style={s.evrakAd} numberOfLines={1}>{e.ad}</Text>
          <Text style={s.evrakTarih}>{tarihYaz(e.tarih)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Yöneticinin eksik bildirimi şeridi (26.10.2026): personel gördü mü, tamamladı mı */
function EksikSeridi({ eksik }) {
  if (!eksik) return null;
  const tamam = eksik.durum === "tamamlandi";
  return (
    <View style={[s.not, { backgroundColor: tamam ? "#eef6e1" : "#fff4e6", marginTop: 10 }]}>
      <Text style={[s.notYazi, { fontWeight: "800", color: tamam ? "#3f6108" : "#9a3412" }]}>
        {tamam ? "Personel eksiği tamamladığını bildirdi" : eksik.durumAdi ?? "Eksik bildirildi · personelin düzeltmesi bekleniyor"}
      </Text>
      {eksik.aciklama ? <Text style={s.notYazi}>Bildirdiğiniz: {eksik.aciklama}</Text> : null}
      {tamam && eksik.personelNotu ? <Text style={s.notYazi}>Personel: {eksik.personelNotu}</Text> : null}
      {!tamam && eksik.jetonVar === false ? (
        <Text style={[s.notYazi, { color: renk.pasif }]}>Personelin uygulamasında bildirim yok; duyurularda görür.</Text>
      ) : null}
    </View>
  );
}

/* ========================================================================== */
/* Kategoriler ve süreç                                                       */
/* ========================================================================== */

const KATEGORILER = [
  { kod: "izin", ad: "İzin talepleri", simge: "takvim", renk: "#2b8a3e", zemin: "#e6f5e9" },
  { kod: "fazlamesai", ad: "Fazla mesai", simge: "saat", renk: "#1f4f82", zemin: "#eef4fb" },
  { kod: "avans", ad: "Avans", simge: "para", renk: "#9a5b13", zemin: "#fdf3e6" },
  /* 26.10.2026: şirketin gönderdiği toplantı, seminer, eğitim… */
  { kod: "gorevlendirme", ad: "Görevlendirme", simge: "canta", renk: "#0e7490", zemin: "#e6f6f9" },
  { kod: "haftalik", ad: "Haftalık gün", simge: "takvim", renk: "#5b5bd6", zemin: "#ececfb" },
  { kod: "rotasyon", ad: "Rotasyon", simge: "magaza", renk: "#c41d7f", zemin: "#fbe8f3" },
];

const DURUM_HAP = {
  surecte: { ad: "Süreçte", renk: "#ad6800", zemin: "#fff7e6" },
  onaylandi: { ad: "Onaylandı", renk: "#3f6212", zemin: "#f2f9e8" },
  reddedildi: { ad: "Reddedildi", renk: "#a8071a", zemin: "#fff1f0" },
  iptal: { ad: "İptal", renk: "#6b7280", zemin: "#f1f3ef" },
};

const ADIM = {
  tamam: { renk: "#5f8c10", ad: "Onayladı" },
  bekliyor: { renk: "#d48806", ad: "Bekliyor" },
  red: { renk: "#cf1322", ad: "Reddetti" },
  atlandi: { renk: "#9aa29a", ad: "Atlandı" },
  sirada: { renk: "#cdd3ca", ad: "Sırada" },
};

const kisaAdim = (ad) =>
  ({ "Birim yöneticisi": "Birim yön.", "Üst yönetici": "Üst yön.", "İnsan Kaynakları": "İK" }[ad] ?? ad);

const kisaTarih = (deger) => {
  if (!deger) return "";
  const t = new Date(deger);
  if (Number.isNaN(t.getTime())) return "";
  return `${String(t.getDate()).padStart(2, "0")}.${String(t.getMonth() + 1).padStart(2, "0")}`;
};

const basHarf = (ad) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("");

/** Kategorinin süreç listesindeki satırın alt yazısı */
const surecAlt = (t) => {
  if (t.tip === "fazlamesai")
    return `${tarihYaz(t.tarih)} · ${t.baslangic}–${t.bitis} · ${t.sure}`;
  if (t.tip === "avans")
    return `${lira(t.tutar)} · ${t.taksit === 1 ? "tek seferde" : `${t.taksit} taksit`}${t.neden ? ` · ${t.neden}` : ""}`;
  return `${t.altTur ? `${t.tur} · ${t.altTur}` : t.tur} · ${kisaTarih(t.cikisTarihi)}–${kisaTarih(t.donusTarihi)} · ${String(t.gun).replace(".", ",")} gün`;
};

/** Süreç kartı: kim, ne, durum ve adımlar. Dokununca adımların ayrıntısı. */
function SurecKarti({ t, acik, ac }) {
  const d = DURUM_HAP[t.durum] ?? DURUM_HAP.surecte;
  const adimlar = t.adimlar ?? [];

  return (
    <TouchableOpacity style={s.surecKart} activeOpacity={0.85} onPress={ac}>
      <View style={s.ust}>
        <View style={[s.avatar, s.avatarKucuk]}>
          <Text style={[s.avatarYazi, { fontSize: 12 }]}>{basHarf(t.adSoyad)}</Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.surecAd} numberOfLines={1}>{t.adSoyad}</Text>
          <Text style={s.surecAlt} numberOfLines={1}>{surecAlt(t)}</Text>
        </View>

        <View style={[s.hap, { backgroundColor: d.zemin }]}>
          <Text style={[s.hapYazi, { color: d.renk }]}>{d.ad}</Text>
        </View>
      </View>

      {/* Adımlar: renkli noktalar, aralarında çizgi */}
      <View style={s.adimSerit}>
        {adimlar.map((a, i) => {
          const r = ADIM[a.durum] ?? ADIM.sirada;
          return (
            <View key={i} style={s.adimHucre}>
              <View style={s.adimCizgiSatir}>
                <View style={[s.adimCizgi, { backgroundColor: i === 0 ? "transparent" : r.renk === ADIM.sirada.renk ? ADIM.sirada.renk : "#b9d58a" }]} />
                <View style={[s.adimNokta, { backgroundColor: r.renk }, a.durum === "bekliyor" && s.adimNoktaBekliyor]}>
                  {a.durum === "tamam" ? <Text style={s.adimIsaret}>✓</Text> : a.durum === "red" ? <Text style={s.adimIsaret}>✕</Text> : null}
                </View>
                <View style={[s.adimCizgi, { backgroundColor: i === adimlar.length - 1 ? "transparent" : ADIM.sirada.renk }]} />
              </View>
              <Text style={[s.adimAd, a.durum === "bekliyor" && { color: ADIM.bekliyor.renk, fontWeight: "800" }]} numberOfLines={1}>
                {kisaAdim(a.ad)}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={s.surecDurumSatir}>
        <Text style={s.surecDurum} numberOfLines={2}>
          {t.durumAdi}
          {t.rol ? <Text style={{ color: renk.pasif, fontWeight: "600" }}>{`  ·  ${t.rol}`}</Text> : null}
        </Text>
        {t.bende ? (
          <View style={[s.hap, { backgroundColor: "#fff1e6" }]}>
            <Text style={[s.hapYazi, { color: "#c2410c" }]}>Sizde</Text>
          </View>
        ) : null}
      </View>

      {acik ? (
        <View style={s.adimListe}>
          {adimlar.map((a, i) => {
            const r = ADIM[a.durum] ?? ADIM.sirada;
            const ilk = i === 0;
            return (
              <View key={i} style={s.adimSatir}>
                <View style={[s.adimSatirNokta, { backgroundColor: r.renk }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.adimSatirAd}>
                    {a.ad}
                    {!ilk ? <Text style={{ color: r.renk }}>{`  ·  ${r.ad}`}</Text> : null}
                  </Text>
                  {a.kim || a.tarih ? (
                    <Text style={s.adimSatirAlt}>
                      {[a.kim, a.tarih ? tarihYaz(a.tarih) : null].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                  {a.not ? <Text style={s.adimSatirNot}>{a.not}</Text> : null}
                </View>
              </View>
            );
          })}
          {t.aciklama ? <Text style={s.adimSatirNot}>Açıklama: {t.aciklama}</Text> : null}

          {/* 26.10.2026: karar verildikten sonra da imzalı form / rapor / evraklar */}
          {t.formYolu && !(t.evraklar ?? []).length ? (
            <TouchableOpacity
              style={[s.formGor, t.rapor && { borderColor: "#d9c6f7", backgroundColor: "#f8f3ff" }]}
              onPress={() => Linking.openURL(oturumluAdres(t.formYolu)).catch(() => Alert.alert("Açılamadı", "Belge açılamadı; bağlantınızı kontrol edin."))}
              activeOpacity={0.8}
            >
              <Simge ad="belge" boyut={16} renkli={t.rapor ? renk.mor : renk.yesilKoyu} />
              <Text style={[s.formGorYazi, t.rapor && { color: renk.mor }]}>{t.rapor ? "Raporu gör" : "İmzalı formu gör"}</Text>
            </TouchableOpacity>
          ) : null}
          <EvrakListesi evraklar={t.evraklar} />
        </View>
      ) : (
        <Text style={s.ayrintiIpucu}>
          {(t.evraklar ?? []).length > 0 || t.formYolu ? "Ayrıntı ve evraklar için dokunun" : "Ayrıntı için dokunun"}
        </Text>
      )}
    </TouchableOpacity>
  );
}

/* ========================================================================== */

export default function IzinOnay({ route, navigation }) {
  const [talepler, setTalepler] = useState([]);

  /* Organizasyon şemasına göre onay bekleyen yıllık izin, fazla mesai ve
     avans (aynı uç; tip alanıyla ayrılıyor) */
  const [yillik, setYillik] = useState([]);
  const [rotasyonSay, setRotasyonSay] = useState(0);

  /* 1.9: ekip araçları (devamsızlık girişi, ekip değerlendirmesi) bu
     modülün içinde; yetkisi olan görür */
  const [araclar, setAraclar] = useState([]);
  useEffect(() => {
    modullerimAl()
      .then((d) => {
        const kodlar = (d?.moduller ?? []).map((m) => m.kod);
        setAraclar((onceki) => [
          ...[
            { kod: "devamsizlik", ad: "Devamsızlık girişi", alt: "Girişi olmayan ekip personeli", ekran: "Devamsizlik", simge: "uyari", renk: "#d4380d", zemin: "#fff1ec" },
            { kod: "ekipdegerlendirme", ad: "Ekip değerlendirmesi", alt: "3 aylık dönemsel değerlendirme", ekran: "EkipDegerlendirme", simge: "ekip", renk: "#5f8c10", zemin: "#f2f9e8" },
          ].filter((x) => kodlar.includes(x.kod)),
          ...onceki.filter((x) => x.kod === "denklestirme"),
        ]);
      })
      .catch(() => undefined);
    /* Denkleştirme onayı (23.10.2026): bekleyen varsa kutu çıkar */
    denklestirmeOnayAl()
      .then((d) => {
        const n = d?.kayitlar?.length ?? 0;
        if (n > 0)
          setAraclar((l) => [
            ...l.filter((x) => x.kod !== "denklestirme"),
            { kod: "denklestirme", ad: "Denkleştirme onayı", alt: `${n} form onay bekliyor`, ekran: "DenklestirmeOnay", simge: "saat", renk: "#b45309", zemin: "#fff6e5" },
          ]);
      })
      .catch(() => undefined);
  }, []);

  /* Süreç: yöneticinin dahil olduğu talepler (sunucu 12.10.2026) */
  const [surec, setSurec] = useState(null);
  const [surecHata, setSurecHata] = useState("");

  const [kategori, setKategori] = useState(route?.params?.kategori ?? null);
  const [suzgec, setSuzgec] = useState("hepsi");
  const [acikKart, setAcikKart] = useState(null);

  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  /* İşlenen talebin kimliği: aynı satıra iki kez basmak iki istek
     gönderiyordu ve ikincisi "talep bulunamadı" ile düşüyordu. */
  const [islenen, setIslenen] = useState(null);

  const [ret, setRet] = useState(null);
  const [sebep, setSebep] = useState("");

  /* Eksik bildir (26.10.2026): hangi talep, açıklama */
  const [eksik, setEksik] = useState(null);
  const [eksikAciklama, setEksikAciklama] = useState("");

  /* Bölge müdürü: formu açtığı talepler ("Onaylıyorum" ancak sonra) */
  const [gorulen, setGorulen] = useState({});

  /* Bildirimden gelindi: ilgili kategori */
  const istenen = route?.params?.kategori;
  const istekZamani = route?.params?.t;
  useEffect(() => {
    if (!istenen) return;
    const kod = istenen === "izintalep" ? "izin" : istenen;
    if (KATEGORILER.some((k) => k.kod === kod)) {
      setKategori(kod);
      setSuzgec("hepsi");
      setAcikKart(null);
    }
  }, [istenen, istekZamani]);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      const [c, y, sr] = await Promise.all([
        izinTalepleriAl().catch(() => ({ talepler: [] })),
        yillikIzinBekleyenlerAl(),
        yoneticiSurecAl(60).catch((e) => {
          setSurecHata(e?.message ?? "Süreç alınamadı.");
          return null;
        }),
      ]);

      setTalepler(c?.talepler ?? []);
      setYillik(y?.talepler ?? []);

      /* Alt menü rozeti de güncel kalsın (karar verildikten sonra) */
      onayRozeti.tazele?.();

      /* Rotasyon onayları ayrı uçtan; kategori rozeti için yalnızca sayı */
      rotasyonOnaylarAl()
        .then((r) => setRotasyonSay(r?.kayitlar?.length ?? 0))
        .catch(() => undefined);
      if (sr) {
        setSurec(sr);
        setSurecHata("");
      }

      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Talepler alınamadı.");
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

  const bekleyen = useMemo(
    () => ({
      izin: yillik.filter((t) => t.tip !== "fazlamesai" && t.tip !== "avans" && t.tip !== "gorevlendirme"),
      gorevlendirme: yillik.filter((t) => t.tip === "gorevlendirme"),
      fazlamesai: yillik.filter((t) => t.tip === "fazlamesai"),
      avans: yillik.filter((t) => t.tip === "avans"),
      haftalik: talepler,
    }),
    [yillik, talepler]
  );

  const sayi = (kod) => (kod === "rotasyon" ? rotasyonSay : bekleyen[kod]?.length ?? 0);

  const surecListesi = (kod) =>
    kod === "izin" ? surec?.izin ?? [] : kod === "fazlamesai" ? surec?.fazlaMesai ?? [] : kod === "avans" ? surec?.avans ?? [] : [];

  /* Haftalık gün ve rotasyon yalnızca bekleyen varsa (ya da o kategori açıksa) */
  const gorunenler = KATEGORILER.filter(
    (k) => !["haftalik", "rotasyon"].includes(k.kod) || sayi(k.kod) > 0 || kategori === k.kod
  );

  /* Kategori seçilmemişse: bekleyeni olan ilk kategori; yoksa süreci olan
     ilk kategori (fazla mesai giren ama onaylayıcı olmayan yönetici) */
  const secili =
    kategori ??
    (KATEGORILER.find((k) => sayi(k.kod) > 0)?.kod ||
      ["izin", "fazlamesai", "avans"].find((k) => surecListesi(k).length > 0) ||
      "izin");

  const karar = async (talep, onay, gerekce) => {
    setIslenen(talep.id);

    try {
      if (talep._yillik) await yillikIzinKarar(talep.id, onay, gerekce ?? null);
      else await izinTalebiOnayla(talep.id, onay, gerekce ?? null);

      /* Liste yeniden çekiliyor: başka bir yönetici aynı anda karar
         vermiş olabilir ve elimizdeki liste eskiyor. */
      await getir(true);

      setRet(null);
      setSebep("");
    } catch (e) {
      setHata(e?.message ?? "İşlem tamamlanamadı.");
    } finally {
      setIslenen(null);
    }
  };

  const eksikBildir = async () => {
    if (!eksik) return;
    setIslenen(eksik.id);

    try {
      const r = await yillikIzinEksikBildir(eksik.id, eksikAciklama.trim());
      await getir(true);
      setEksik(null);
      setEksikAciklama("");
      Alert.alert("Eksik bildirildi", r?.mesaj ?? "Personele bildirildi; tamamlayınca size haber gelir.");
    } catch (e) {
      Alert.alert("Gönderilemedi", e?.message ?? "Eksik bildirilemedi.");
    } finally {
      setIslenen(null);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

  const kat = KATEGORILER.find((k) => k.kod === secili) ?? KATEGORILER[0];
  const liste = surecListesi(secili);
  const say = {
    hepsi: liste.length,
    surecte: liste.filter((x) => x.durum === "surecte").length,
    onaylandi: liste.filter((x) => x.durum === "onaylandi").length,
    reddedildi: liste.filter((x) => x.durum === "reddedildi" || x.durum === "iptal").length,
    girdigim: liste.filter((x) => x.girdigim).length,
  };
  const suzulmus = liste.filter((x) =>
    suzgec === "hepsi"
      ? true
      : suzgec === "girdigim"
      ? x.girdigim
      : suzgec === "reddedildi"
      ? x.durum === "reddedildi" || x.durum === "iptal"
      : x.durum === suzgec
  );
  const toplamBekleyen = KATEGORILER.reduce((a, k) => a + sayi(k.kod), 0);

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <BarBaslik ad="Yönetici İşlemleri" acik kendi />

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />
        }
      >
        {hata ? <Hata metin={hata} /> : null}

        <Text style={s.ozetYazi}>
          {toplamBekleyen > 0 ? `${toplamBekleyen} talep onayınızı bekliyor` : "Onayınızı bekleyen talep yok"}
        </Text>

        {/* ------------------------------------------------ kategoriler */}
        <View style={s.katIzgara}>
          {gorunenler.map((k) => {
            const n = sayi(k.kod);
            const sec = k.kod === secili;
            return (
              <TouchableOpacity
                key={k.kod}
                style={[s.katKutu, sec && { borderColor: k.renk, borderWidth: 2, backgroundColor: k.zemin }]}
                activeOpacity={0.85}
                onPress={() => {
                  setKategori(k.kod);
                  setSuzgec("hepsi");
                  setAcikKart(null);
                }}
              >
                <View style={s.katUst}>
                  <View style={[s.katSimge, { backgroundColor: sec ? renk.beyaz : k.zemin }]}>
                    <Simge ad={k.simge} boyut={18} renkli={k.renk} dolgu />
                  </View>
                  {n > 0 ? (
                    <View style={s.katRozet}>
                      <Text style={s.katRozetYazi}>{n > 99 ? "99+" : n}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[s.katAd, sec && { color: k.renk }]} numberOfLines={1}>{k.ad}</Text>
                <Text style={[s.katAlt, n > 0 && { color: "#c2410c", fontWeight: "700" }]} numberOfLines={1}>
                  {n > 0 ? `${n} onay bekliyor` : "bekleyen yok"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {araclar.length > 0 ? (
          <View style={s.katIzgara}>
            {araclar.map((k) => (
              <TouchableOpacity key={k.kod} style={s.katKutu} activeOpacity={0.85} onPress={() => navigation?.navigate?.(k.ekran)}>
                <View style={s.katUst}>
                  <View style={[s.katSimge, { backgroundColor: k.zemin }]}>
                    <Simge ad={k.simge} boyut={18} renkli={k.renk} />
                  </View>
                  <Simge ad="ok" boyut={14} renkli="#b9bfb3" />
                </View>
                <Text style={s.katAd} numberOfLines={1}>{k.ad}</Text>
                <Text style={s.katAlt} numberOfLines={1}>{k.alt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* ---------------------------------------------------- içerik */}
        {secili === "rotasyon" ? (
          <RotasyonOnaylari degisti={yenileniyor} sayiBildir={setRotasyonSay} />
        ) : secili === "haftalik" ? (
          <HaftalikListe
            talepler={talepler}
            islenen={islenen}
            karar={karar}
            reddet={(t) => {
              setRet(t);
              setSebep("");
            }}
          />
        ) : (
          <>
            <Text style={s.bolum}>
              ONAYINIZI BEKLEYENLER{bekleyen[secili]?.length ? ` · ${bekleyen[secili].length}` : ""}
            </Text>

            {(bekleyen[secili] ?? []).length === 0 ? (
              <Bilgi>
                {secili === "fazlamesai"
                  ? "Onayınızı bekleyen fazla mesai yok."
                  : secili === "avans"
                  ? "Onayınızı bekleyen avans talebi yok."
                  : secili === "gorevlendirme"
                  ? "Onayınızı bekleyen görevlendirme yok."
                  : "Onayınızı bekleyen izin talebi yok. Talepler organizasyon şemasına göre sorumlu olduğunuz personelden gelir."}
              </Bilgi>
            ) : (
              bekleyen[secili].map((t) => (
                <BekleyenKart
                  key={`y${t.id}`}
                  t={t}
                  islenen={islenen}
                  gorulen={gorulen}
                  setGorulen={setGorulen}
                  karar={karar}
                  yenile={() => getir(true)}
                  reddet={() => {
                    setRet({ ...t, _yillik: true });
                    setSebep("");
                  }}
                  eksikBildir={
                    t.eksikBildirilebilir && t.tip !== "fazlamesai"
                      ? () => {
                          setEksik(t);
                          setEksikAciklama("");
                        }
                      : null
                  }
                />
              ))
            )}

            {secili === "fazlamesai" ? (
              <TouchableOpacity
                style={s.fmGir}
                activeOpacity={0.85}
                onPress={() => navigation?.navigate?.("Ekibim")}
              >
                <View style={[s.katSimge, { backgroundColor: "#eef4fb" }]}>
                  <Simge ad="arti" boyut={16} renkli="#1f4f82" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fmGirAd}>Fazla mesai gir</Text>
                  <Text style={s.fmGirAlt}>Ekibim'den personeli seçip "Fazla mesai gir"e dokunun</Text>
                </View>
                <Simge ad="ok" boyut={15} renkli="#b9bfb3" />
              </TouchableOpacity>
            ) : null}

            {/* ------------------------------------------------ süreç */}
            <Text style={s.bolum}>
              SÜREÇ · SON {surec?.gun ?? 60} GÜN
            </Text>

            {surecHata && !surec ? (
              <Bilgi>Süreç bilgisi alınamadı: {surecHata}</Bilgi>
            ) : liste.length === 0 ? (
              <Bilgi>
                {secili === "fazlamesai"
                  ? "Girdiğiniz ya da onayında bulunduğunuz fazla mesai yok."
                  : secili === "avans"
                  ? "Onay zincirinde bulunduğunuz avans talebi yok."
                  : "Sorumlu olduğunuz personelden izin talebi yok."}
              </Bilgi>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.suzgecler}>
                  {[
                    ["hepsi", "Tümü"],
                    ["surecte", "Süreçte"],
                    ["onaylandi", "Onaylanan"],
                    ["reddedildi", "Reddedilen"],
                    ...(secili === "fazlamesai" ? [["girdigim", "Girdiklerim"]] : []),
                  ].map(([k, a]) => (
                    <TouchableOpacity
                      key={k}
                      style={[s.cip, suzgec === k && { backgroundColor: kat.renk, borderColor: kat.renk }]}
                      onPress={() => setSuzgec(k)}
                    >
                      <Text style={[s.cipYazi, suzgec === k && { color: renk.beyaz }]}>
                        {a} {say[k]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {suzulmus.length === 0 ? (
                  <Text style={s.bosYazi}>Bu süzgeçte talep yok.</Text>
                ) : (
                  suzulmus.map((t) => {
                    const anahtar = `${t.tip}-${t.id}`;
                    return (
                      <SurecKarti
                        key={anahtar}
                        t={t}
                        acik={acikKart === anahtar}
                        ac={() => setAcikKart((o) => (o === anahtar ? null : anahtar))}
                      />
                    );
                  })
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Ret sebebi.

          Zorunlu: sebepsiz ret personele yalnızca "olmadı" diyor, hangi
          güne geçmesi gerektiğini bilmeden aynı günü yeniden seçiyordu. */}
      <AltSayfa gorunur={!!ret} kapat={() => setRet(null)} perdeStil={s.perde} sayfaStil={s.serit}>
        <View style={s.seritUst}>
          <Text style={s.seritBaslik}>Talebi reddet</Text>

          <TouchableOpacity onPress={() => setRet(null)} hitSlop={10}>
            <Text style={s.seritKapat}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.seritNot}>
          {ret?.tip === "avans"
            ? `${ret?.adSoyad} için ${lira(ret?.tutar)} avans talebini reddetme sebebini yazınız. Personel bu açıklamayı görür.`
            : ret?.tip === "fazlamesai"
            ? `${ret?.adSoyad} için fazla mesaiyi reddetme sebebini yazınız.`
            : ret?.tip === "gorevlendirme"
            ? `${ret?.adSoyad} için ${ret?.yer ?? ""} görevlendirmesini reddetme sebebini yazınız. Personel bu açıklamayı görür.`
            : ret?._yillik
            ? `${ret?.adSoyad} için ${tarihYaz(ret?.cikisTarihi)} – ${tarihYaz(ret?.donusTarihi)} izni uygun değilse sebebini yazınız. Personel bu açıklamayı görür.`
            : `${ret?.adSoyad} için ${ret?.talepGun} günü uygun değilse sebebini yazınız. Personel bu açıklamayı görüp yeniden gün seçer.`}
        </Text>

        {/* 1.8: hazır ret gerekçeleri (Yönetim › Avans kuralları) */}
        {Array.isArray(ret?.hazirRed) && ret.hazirRed.length > 0 ? (
          <View style={s.hazirlar}>
            {ret.hazirRed.map((g) => (
              <TouchableOpacity
                key={g}
                style={[s.hazir, sebep.includes(g) && s.hazirSecili]}
                activeOpacity={0.8}
                onPress={() => setSebep((o) => (o.trim() ? (o.includes(g) ? o : `${o.trim()} ${g}`) : g))}
              >
                <Text style={[s.hazirYazi, sebep.includes(g) && s.hazirYaziSecili]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <TextInput
          style={s.sebepGirdi}
          value={sebep}
          onChangeText={setSebep}
          placeholder="Örnek: O gün iki kişi izinli, perşembeye alabilir misiniz?"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          placeholderTextColor="#b9c0b5"
          multiline
        />

        <TouchableOpacity
          style={[s.kaydet, (sebep.trim().length < 5 || islenen === ret?.id) && { opacity: 0.5 }]}
          disabled={sebep.trim().length < 5 || islenen === ret?.id}
          activeOpacity={0.85}
          onPress={() => karar(ret, false, sebep.trim())}
        >
          <Text style={s.kaydetYazi}>{islenen === ret?.id ? "GÖNDERİLİYOR" : "REDDET VE GÖNDER"}</Text>
        </TouchableOpacity>
      </AltSayfa>

      {/* Eksik bildir (26.10.2026): talep reddedilmez; personel düzeltir,
          tamamlayınca yöneticiye bildirim gelir, talep aynı adımdan devam eder */}
      <AltSayfa gorunur={!!eksik} kapat={() => setEksik(null)} perdeStil={s.perde} sayfaStil={s.serit}>
        <View style={s.seritUst}>
          <Text style={s.seritBaslik}>Eksik bildir</Text>

          <TouchableOpacity onPress={() => setEksik(null)} hitSlop={10}>
            <Text style={s.seritKapat}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.seritNot}>
          {eksik?.tip === "avans"
            ? `${eksik?.adSoyad} için ${lira(eksik?.tutar)} avans talebinde neyin eksik ya da hatalı olduğunu yazınız.`
            : `${eksik?.adSoyad} için ${tarihYaz(eksik?.cikisTarihi)} – ${tarihYaz(eksik?.donusTarihi)} talebinde neyin eksik ya da hatalı olduğunu yazınız.`}
          {" "}Talep reddedilmez, onayınızda bekler; personel düzeltip size bildirir.
        </Text>

        <TextInput
          style={s.sebepGirdi}
          value={eksikAciklama}
          onChangeText={setEksikAciklama}
          placeholder="Örnek: Rapor fotoğrafı okunmuyor, yeniden yükleyin. / Dönüş tarihi yanlış girilmiş."
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          placeholderTextColor="#b9c0b5"
          multiline
          maxLength={600}
        />

        <TouchableOpacity
          style={[s.kaydet, { backgroundColor: "#c2410c" }, (eksikAciklama.trim().length < 5 || islenen === eksik?.id) && { opacity: 0.5 }]}
          disabled={eksikAciklama.trim().length < 5 || islenen === eksik?.id}
          activeOpacity={0.85}
          onPress={eksikBildir}
        >
          <Text style={s.kaydetYazi}>{islenen === eksik?.id ? "GÖNDERİLİYOR" : "EKSİĞİ BİLDİR"}</Text>
        </TouchableOpacity>
      </AltSayfa>
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Onay bekleyen kartları                                                     */
/* ========================================================================== */

/** İzin, fazla mesai ya da avans: organizasyon şemasına göre onay bekleyen */
function BekleyenKart({ t, islenen, gorulen, setGorulen, karar, yenile, reddet, eksikBildir }) {
  return (
    <Kart>
      {t.tip === "fazlamesai" ? (
        <FazlaMesaiOzet t={t} />
      ) : t.tip === "avans" ? (
        <AvansOzet t={t} />
      ) : (
        <>
          <View style={s.ust}>
            <View style={s.avatar}>
              <Text style={s.avatarYazi}>{basHarf(t.adSoyad)}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.ad} numberOfLines={1}>{t.adSoyad}</Text>
              <Text style={s.alt} numberOfLines={1}>
                {[t.gorev, t.subeAdi].filter(Boolean).join(" · ")}
              </Text>
            </View>

            <View style={s.sure}>
              <Text style={s.sureYazi}>
                {t.tip === "gorevlendirme" ? `${t.kapsamAdi ?? "Görev"} · ${t.etkinlikTuru ?? ""}` : t.altTur ? `${t.tur} · ${t.altTur}` : t.tur}
              </Text>
            </View>
          </View>

          <View style={s.gunSatir}>
            <View style={s.gunKutu}>
              <Text style={s.gunEtiket}>{t.rapor ? "RAPOR BAŞI" : t.tip === "gorevlendirme" ? "GİDİŞ" : "ÇIKIŞ"}</Text>
              <Text style={s.gunDeger}>{tarihYaz(t.cikisTarihi)}</Text>
            </View>

            <View style={[s.gunKutu, s.gunIstenen]}>
              <Text style={[s.gunEtiket, { color: renk.yesilKoyu }]}>GÜN</Text>
              <Text style={[s.gunDeger, { color: renk.yesilKoyu }]}>{String(t.gun).replace(".", ",")}</Text>
            </View>

            <View style={s.gunKutu}>
              <Text style={s.gunEtiket}>{t.rapor ? "RAPOR SONU" : "DÖNÜŞ"}</Text>
              <Text style={s.gunDeger}>{tarihYaz(t.donusTarihi)}</Text>
            </View>
          </View>

          {t.rapor && t.baslamaTarihi ? (
            <Text style={[s.tarih, { marginTop: 6 }]}>İşe başlama: {tarihYaz(t.baslamaTarihi)}</Text>
          ) : null}

          {t.tip === "gorevlendirme" ? (
            <View style={s.not}>
              <Text style={[s.notYazi, { fontWeight: "800" }]}>{t.yer} · {t.etkinlikAdi}</Text>
              {t.not ? <Text style={[s.notYazi, { marginTop: 4 }]}>{t.not}</Text> : null}
            </View>
          ) : t.aciklama ? (
            <View style={s.not}>
              <Text style={s.notYazi}>{t.aciklama}</Text>
            </View>
          ) : null}

          {/* Şube personeli (07.10.2026): imzalı form yüklenmeden onay yok */}
          {t.formBekleniyor ? (
            <View style={[s.not, { backgroundColor: "#fff4e6" }]}>
              <Text style={[s.notYazi, { color: "#9a3412", fontWeight: "700" }]}>
                İmzalı izin formu bekleniyor. Şube mailine gelen formu yazdırıp imzalatın; personel Biçen360'tan
                yükleyince onaylayabilirsiniz (size bildirim gelir).
              </Text>
            </View>
          ) : null}
        </>
      )}

      {/* İmzalı form: yükle (birim yöneticisi) ya da gör (bölge müdürü) */}
      <FormEylemi t={t} yuklendi={yenile} acildi={() => setGorulen((g) => ({ ...g, [t.id]: true }))} />

      {/* 26.10.2026: talebin bütün evrakları (form, rapor, mazeret belgesi, avans belgesi);
          formu/raporu buradan açmak da "görüldü" sayılır */}
      <EvrakListesi
        evraklar={(t.evraklar ?? []).filter((e) => !(t.formYolu && e.kalem === "form" && !t.rapor) && !(t.rapor && e.kalem === "destek"))}
        acildi={() => setGorulen((g) => ({ ...g, [t.id]: true }))}
      />

      {/* Yöneticinin eksik bildirimi: personel gördü mü, tamamladı mı */}
      <EksikSeridi eksik={t.eksik} />

      {/* Bölge kademesi mağazanın kararını görüyor: kim, ne zaman, hangi notla onayladı.
          Zincirli izinde (2.0, 26.10.2026) sunucu bir önceki onaylanan adımı gönderiyor
          ("Bölge Müdürü (Ad)"); GMY adımı bölge müdürünün kararını da görüyor. */}
      {t.magazaKisi ? (
        <Text style={s.tarih}>
          {t.tip === "avans" || t.sira ? "Önceki onay" : "Birim yöneticisi onayı"}: {t.magazaKisi}
          {t.magazaTarih ? ` · ${tarihYaz(t.magazaTarih)}` : ""}
          {t.magazaNot ? ` — ${t.magazaNot}` : ""}
        </Text>
      ) : (
        <Text style={s.tarih}>Talep tarihi: {tarihYaz(t.olusturma)}</Text>
      )}

      {/* Onay sırası (2.0): izin talebinde de avanstaki gibi adım şeridi;
          sıradaki adım (bu kişi) kalın. Eski sunucu sira göndermez. */}
      {(!t.tip || t.tip === "gorevlendirme") && Array.isArray(t.sira) && t.sira.length > 1 ? (
        <Text style={s.tarih}>
          {t.sira
            .map((x) => `${x.karar === "onay" ? "✓ " : x.karar === "atlandi" ? "– " : x.karar === "red" ? "✗ " : ""}${x.ad === t.adimAdi && !x.karar ? `[${x.ad}]` : x.ad}`)
            .join("  →  ")}
        </Text>
      ) : null}

      <View style={s.dugmeler}>
        <TouchableOpacity style={[s.dugme, s.reddet]} disabled={islenen === t.id} activeOpacity={0.85} onPress={reddet}>
          <Text style={s.reddetYazi}>Reddet</Text>
        </TouchableOpacity>

        {/* Eksik bildir (26.10.2026): reddetmeden düzeltme iste */}
        {eksikBildir ? (
          <TouchableOpacity style={[s.dugme, s.eksikDugme]} disabled={islenen === t.id} activeOpacity={0.85} onPress={eksikBildir}>
            <Text style={s.eksikDugmeYazi} numberOfLines={1}>{t.eksik && t.eksik.durum !== "tamamlandi" ? "Eksik bildirildi" : "Eksik bildir"}</Text>
          </TouchableOpacity>
        ) : null}

        {(() => {
          /* 09.10.2026: form yüklenmeden onay yok; bölge müdürü önce formu açar, sonra "Onaylıyorum" */
          const formYok = !!t.formBekleniyor || !!t.formYukle;
          /* Raporlu (1.9): her aşamada önce rapor açılır, sonra onay */
          const once = (t.asama === 2 || t.rapor) && t.formVar && !gorulen[t.id];
          return (
            <TouchableOpacity
              style={[s.dugme, s.onayla, eksikBildir && { flex: 1.35 }, (islenen === t.id || formYok) && { opacity: 0.5 }]}
              disabled={islenen === t.id || formYok}
              activeOpacity={0.85}
              onPress={() => {
                if (once) {
                  setGorulen((g) => ({ ...g, [t.id]: true }));
                  Linking.openURL(oturumluAdres(t.formYolu)).catch(() => {});
                  return;
                }
                karar({ ...t, _yillik: true }, true);
              }}
            >
              <Simge ad={once ? "belge" : "onay"} boyut={16} renkli={renk.beyaz} />
              <Text style={s.onaylaYazi} numberOfLines={1} adjustsFontSizeToFit>
                {islenen === t.id
                  ? "Kaydediliyor"
                  : formYok
                  ? "Önce formu yükleyin"
                  : once
                  ? t.rapor ? "Raporu aç" : "Formu aç"
                  : (t.asama === 2 || t.rapor) && t.formVar
                  ? "Onaylıyorum"
                  : "Onayla"}
              </Text>
            </TouchableOpacity>
          );
        })()}
      </View>
    </Kart>
  );
}

/** Haftalık izin günü talepleri (mağaza yöneticisi) */
function HaftalikListe({ talepler, islenen, karar, reddet }) {
  if (talepler.length === 0)
    return (
      <Bilgi>Onayınızı bekleyen izin günü talebi yok. Personel gün seçtiğinde burada görünür ve size bildirim gider.</Bilgi>
    );

  return (
    <>
      <Text style={s.bolum}>{talepler.length} TALEP ONAYINIZI BEKLİYOR</Text>

      {talepler.map((t) => {
        const gun = gunFarki(t.talepTarihi);

        return (
          <Kart key={t.id}>
            <View style={s.ust}>
              <View style={s.avatar}>
                <Text style={s.avatarYazi}>{basHarf(t.adSoyad)}</Text>
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.ad} numberOfLines={1}>{t.adSoyad}</Text>
                <Text style={s.alt} numberOfLines={1}>
                  {[t.pozisyon, t.personelKodu].filter(Boolean).join(" · ")}
                </Text>
              </View>

              {/* Bekleme süresi: üç gündür duran talep, bugün gelenle aynı görünmemeli. */}
              {gun !== null ? (
                <View style={[s.sure, gun >= 3 && { backgroundColor: renk.turuncuAcik }]}>
                  <Text style={[s.sureYazi, gun >= 3 && { color: renk.turuncu }]}>
                    {gun === 0 ? "bugün" : `${gun} gün`}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={s.gunSatir}>
              <View style={s.gunKutu}>
                <Text style={s.gunEtiket}>MEVCUT</Text>
                <Text style={s.gunDeger}>{t.mevcutGun ?? "—"}</Text>
              </View>

              <Simge ad="ok" boyut={17} renkli={renk.pasif} />

              <View style={[s.gunKutu, s.gunIstenen]}>
                <Text style={[s.gunEtiket, { color: renk.yesilKoyu }]}>İSTENEN</Text>
                <Text style={[s.gunDeger, { color: renk.yesilKoyu }]}>{t.talepGun}</Text>
              </View>
            </View>

            {t.talepNotu ? (
              <View style={s.not}>
                <Text style={s.notYazi}>{t.talepNotu}</Text>
              </View>
            ) : null}

            <Text style={s.tarih}>Talep tarihi: {tarihYaz(t.talepTarihi)}</Text>

            <View style={s.dugmeler}>
              <TouchableOpacity
                style={[s.dugme, s.reddet]}
                disabled={islenen === t.id}
                activeOpacity={0.85}
                onPress={() => reddet(t)}
              >
                <Text style={s.reddetYazi}>Reddet</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.dugme, s.onayla, islenen === t.id && { opacity: 0.5 }]}
                disabled={islenen === t.id}
                activeOpacity={0.85}
                onPress={() => karar(t, true)}
              >
                <Simge ad="onay" boyut={16} renkli={renk.beyaz} />
                <Text style={s.onaylaYazi}>{islenen === t.id ? "Kaydediliyor" : "Onayla"}</Text>
              </TouchableOpacity>
            </View>
          </Kart>
        );
      })}
    </>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  formKutu: { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: "#fff4e6", gap: 4 },
  formBaslik: { fontSize: 14, fontWeight: "800", color: "#9a3412" },
  formAlt: { fontSize: 12.5, color: "#9a3412", lineHeight: 17 },
  formDugme: {
    marginTop: 8,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#c2410c",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  formDugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
  formKaynaklar: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  formKaynak: { borderWidth: 1.5, borderColor: "#c2410c", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#fff" },
  formKaynakYazi: { color: "#9a3412", fontWeight: "800", fontSize: 13 },
  formGor: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 11,
    borderRadius: 12,
    backgroundColor: "#eef6e1",
  },
  formGorYazi: { fontSize: 14, fontWeight: "800", color: "#3f6108" },
  formGorAlt: { fontSize: 12, color: "#5f8c10", marginLeft: "auto" },

  sayfa: { flex: 1, backgroundColor: renk.zemin },
  /* Alt boşluk: yüzen alt menü son kartın üstüne binmesin */
  govde: { padding: olcu.bosluk, paddingBottom: 120, gap: 10 },

  sekmeler: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: olcu.bosluk,
    paddingTop: 10,
  },
  sekme: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  sekmeSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  sekmeYazi: { fontSize: 13, fontWeight: "700", color: renk.pasif },
  sekmeYaziSecili: { color: renk.beyaz },
  sekmeSay: {
    minWidth: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: renk.turuncu,
    alignItems: "center",
  },
  sekmeSaySecili: { backgroundColor: "rgba(255,255,255,.25)" },
  sekmeSayYazi: { fontSize: 11, fontWeight: "800", color: renk.beyaz },

  ustYazi: {
    fontSize: 11.5,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.5,
    marginTop: 2,
  },

  ust: { flexDirection: "row", alignItems: "center", gap: 11 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarYazi: { fontSize: 13, fontWeight: "800", color: renk.yesilKoyu },
  ad: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  alt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  sure: {
    backgroundColor: renk.zemin,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sureYazi: { fontSize: 11, fontWeight: "800", color: renk.pasif },

  gunSatir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 13,
  },
  gunKutu: {
    flex: 1,
    backgroundColor: renk.zemin,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  gunIstenen: { backgroundColor: renk.yesilAcik },
  gunEtiket: {
    fontSize: 9.5,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.5,
  },
  gunDeger: { fontSize: 15, fontWeight: "800", color: renk.metin, marginTop: 2 },

  not: {
    backgroundColor: renk.zemin,
    borderRadius: 11,
    padding: 11,
    marginTop: 11,
  },
  notYazi: { fontSize: 12.5, color: renk.metin, lineHeight: 18 },

  tarih: { fontSize: 11, color: renk.pasif, marginTop: 10 },

  dugmeler: { flexDirection: "row", gap: 9, marginTop: 13 },
  dugme: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    paddingVertical: 13,
  },
  reddet: {
    backgroundColor: renk.beyaz,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
  },
  reddetYazi: { fontSize: 13.5, fontWeight: "800", color: renk.kirmizi },
  eksikDugme: { backgroundColor: "#fff4e6", borderWidth: 1.5, borderColor: "#f3c7a6", paddingHorizontal: 4 },
  eksikDugmeYazi: { fontSize: 12.5, fontWeight: "800", color: "#c2410c" },
  onayla: { backgroundColor: renk.yesilKoyu },

  /* ---------------------------------------------------------- evraklar */
  evraklar: { marginTop: 10, gap: 6 },
  evrakBaslik: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.5 },
  evrak: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: renk.zemin,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  evrakAd: { flex: 1, fontSize: 13, fontWeight: "700", color: renk.metin },
  evrakTarih: { fontSize: 11, color: renk.pasif },
  onaylaYazi: { fontSize: 13.5, fontWeight: "800", color: renk.beyaz },

  /* --------------------------------------------------------- ret penceresi */
  perde: { flex: 1, backgroundColor: "rgba(20,24,18,.5)" },
  serit: {
    backgroundColor: renk.beyaz,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 20,
    paddingBottom: 30,
  },
  seritUst: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  seritBaslik: { fontSize: 17, fontWeight: "800", color: renk.metin },
  seritKapat: { fontSize: 20, color: renk.pasif, fontWeight: "600" },
  seritNot: { fontSize: 12.5, color: renk.pasif, lineHeight: 18, marginBottom: 14 },
  hazirlar: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  hazir: {
    borderWidth: 1,
    borderColor: "#dfe3db",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 13,
    backgroundColor: "#fff",
  },
  hazirSecili: { borderColor: renk.kirmizi, backgroundColor: "#fdf1f0" },
  hazirYazi: { fontSize: 13, color: renk.metin, fontWeight: "600" },
  hazirYaziSecili: { color: renk.kirmizi },
  sebepGirdi: {
    backgroundColor: renk.zemin,
    borderRadius: 13,
    padding: 13,
    fontSize: 14,
    color: renk.metin,
    minHeight: 96,
    textAlignVertical: "top",
  },
  kaydet: {
    backgroundColor: renk.kirmizi,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16,
  },
  kaydetYazi: {
    fontSize: 14,
    fontWeight: "800",
    color: renk.beyaz,
    letterSpacing: 0.4,
  },

  /* ------------------------------------------------ Yönetici İşlemleri */
  ozetYazi: { fontSize: 13, fontWeight: "700", color: renk.pasif, marginBottom: 2 },
  katIzgara: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  katKutu: {
    width: "48.6%",
    flexGrow: 1,
    gap: 3,
    padding: 11,
    borderRadius: 15,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  katUst: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  katSimge: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  katAd: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  katAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  katRozet: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: renk.turuncu,
    alignItems: "center",
    justifyContent: "center",
  },
  katRozetYazi: { fontSize: 11.5, fontWeight: "800", color: renk.beyaz },

  bolum: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, marginTop: 10 },
  bosYazi: { fontSize: 13, color: renk.pasif, textAlign: "center", paddingVertical: 16 },

  fmGir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#9fb7d6",
  },
  fmGirAd: { fontSize: 14, fontWeight: "800", color: "#1f4f82" },
  fmGirAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },

  suzgecler: { gap: 7, paddingVertical: 2 },
  cip: {
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: renk.beyaz,
  },
  cipYazi: { fontSize: 12.5, fontWeight: "700", color: renk.metin },

  surecKart: {
    backgroundColor: renk.beyaz,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: renk.cizgi,
    padding: 12,
    gap: 10,
  },
  avatarKucuk: { width: 32, height: 32, borderRadius: 16 },
  surecAd: { fontSize: 14, fontWeight: "800", color: renk.metin },
  surecAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  hap: { borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3 },
  hapYazi: { fontSize: 11, fontWeight: "800" },

  adimSerit: { flexDirection: "row" },
  adimHucre: { flex: 1, alignItems: "center", gap: 4, minWidth: 0 },
  adimCizgiSatir: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  adimCizgi: { flex: 1, height: 2 },
  adimNokta: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  adimNoktaBekliyor: { borderWidth: 3, borderColor: "#ffe7ba" },
  adimIsaret: { color: renk.beyaz, fontSize: 10.5, fontWeight: "900", lineHeight: 13 },
  adimAd: { fontSize: 10.5, fontWeight: "700", color: renk.pasif, paddingHorizontal: 2 },

  surecDurumSatir: { flexDirection: "row", alignItems: "center", gap: 8 },
  surecDurum: { flex: 1, fontSize: 12.5, fontWeight: "700", color: renk.metin },
  ayrintiIpucu: { fontSize: 11, color: "#a0a79c" },

  adimListe: { gap: 9, borderTopWidth: 1, borderTopColor: "#f0f2ee", paddingTop: 10 },
  adimSatir: { flexDirection: "row", gap: 10 },
  adimSatirNokta: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  adimSatirAd: { fontSize: 13, fontWeight: "800", color: renk.metin },
  adimSatirAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  adimSatirNot: { fontSize: 12, color: renk.metin, marginTop: 2, lineHeight: 17 },
});

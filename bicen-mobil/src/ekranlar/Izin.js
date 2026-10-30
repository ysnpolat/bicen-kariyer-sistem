/**
 * İzin Yönetimi (23.10.2026'ya kadar "Yıllık İzin")
 * ---------------------------------------------------------------------------
 * Bakiye, süreçteki talepler, planlı izinler ve geçmiş.
 *
 * <p>
 * Personelin sorduğu tek soru "kaç günüm kaldı": kalan gün halkanın
 * içinde büyük yazıyor, diğer sayılar altında küçük. "Yeni izin talebi"
 * bakiyenin hemen altında — eskiden geçmişin arkasında kalıyordu.
 * </p>
 *
 * <p>
 * Onay zinciri organizasyon şemasından: birim yöneticisi → üst yönetici
 * → İnsan Kaynakları. Mağazada da genel merkezde de aynı kural; bu yüzden
 * "mağaza müdürü" değil "birim yöneticisi" deniyor. Her talepte aşama
 * çizgisi var ve şu an kimde beklediği yazıyor.
 * </p>
 *
 * <p>
 * Talep formunda tek takvimle aralık seçiliyor; gün hesabı sunucudan
 * geliyor (resmî tatil ve haftalık izin günü düşülmüyor). Eski ekran
 * takvim günü sayıyordu.
 * </p>
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EvrakPenceresi, evrakTalebi, dosyaAl } from "../bilesenler/Gorevler";
import Simge from "../bilesenler/Simge";
import Takvim from "../bilesenler/Takvim";
import ModalAlani, { modalTamEkran } from "../bilesenler/ModalAlani";
import { useFocusEffect } from "@react-navigation/native";
import Svg, { Circle } from "react-native-svg";

import {
  izinAl,
  talepIptal,
  talepOlustur,
  taleplerimAl,
  talepTurleriAl,
  izinGunHesabi,
  izinCakisma,
  yerineBakacaklarAl,
  raporluTalepGonder,
  oturumluAdres,
  api,
  denklestirmeOzetAl,
  gorevlendirmeAl,
} from "../api";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import KartZemin, { YESIL } from "../bilesenler/KartZemin";

/* -------------------------------------------------------------------------- */

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
const AYK = ["OCA", "ŞUB", "MAR", "NİS", "MAY", "HAZ", "TEM", "AĞU", "EYL", "EKİ", "KAS", "ARA"];
const HAFTA = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];

/** Yerel tarihten "YYYY-MM-DD"; toISOString saat dilimi yüzünden bir gün kaydırıyordu */
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const gunOku = (s) => {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
};

const kisaTarih = (s) => {
  const d = gunOku(s);
  return d ? `${d.getDate()} ${AYLAR[d.getMonth()]}` : "";
};

const aralikYaz = (a, b) =>
  !b || String(a).slice(0, 10) === String(b).slice(0, 10)
    ? kisaTarih(a)
    : `${kisaTarih(a)} – ${kisaTarih(b)}`;

const sayi = (n) => {
  const x = Math.round(Number(n ?? 0) * 100) / 100;
  return String(x).replace(".", ",");
};

/* ========================================================================== */

export default function Izin({ navigation }) {
  /* Denkleştirme (23.10.2026): bakiyesi kartta; eski sunucuda kart çıkmaz */
  const [denk, setDenk] = useState(null);
  /* Görevlendirme (26.10.2026): modül kapalıysa ya da eski sunucuda kart çıkmaz */
  const [gorev, setGorev] = useState(null);
  const [veri, setVeri] = useState(null);
  const [talepVeri, setTalepVeri] = useState({ kayitlar: [] });
  const [turler, setTurler] = useState(["Yıllık İzin"]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const [formAcik, setFormAcik] = useState(false);
  const [detay, setDetay] = useState(null);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);

    try {
      const [izinler, tl, tr] = await Promise.all([
        izinAl(),
        taleplerimAl().catch(() => ({ kayitlar: [] })),
        talepTurleriAl().catch(() => ({ turler: ["Yıllık İzin"] })),
      ]);

      setVeri(izinler);
      setTalepVeri(tl ?? { kayitlar: [] });
      denklestirmeOzetAl()
        .then((d) => setDenk(d?.bakiye ?? null))
        .catch(() => setDenk(null));
      gorevlendirmeAl()
        .then((g) => setGorev(g?.acik ? g : null))
        .catch(() => setGorev(null));
      /* Tür kayıtları: süre biçimi ve bakiyeden düşüp düşmediği. Eski
         sunucuda yalnızca ad listesi dönüyor; o zaman yıllık izin
         varsayılıyor. */
      setTurler(
        tr?.turKayitlari?.length
          ? tr.turKayitlari
          : (tr?.turler?.length ? tr.turler : ["Yıllık İzin"]).map((ad) => ({
              ad,
              sureTuru: "tam",
              bakiyedenDuser: ad === "Yıllık İzin",
            }))
      );
      setHata("");
    } catch (h) {
      setHata(h.message);
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

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  const b = veri?.bakiye ?? {};
  const toplam = Number(b.hakedilen ?? 0) + Number(b.devir ?? 0);
  const kalan = Number(b.kalan ?? 0);
  const oran = toplam > 0 ? Math.max(0, Math.min(1, kalan / toplam)) : 0;

  const talepler = talepVeri?.kayitlar ?? [];
  const birimAdi = talepVeri?.birimYoneticisi || "Birim yöneticisi";
  /* Onay tablosunda ara aşama yoksa boş: çizgi üç adımlı çiziliyor */
  const ustAdi = talepVeri?.ustYonetici || null;

  const surecte = talepler.filter((t) => !["Onaylandı", "Reddedildi"].includes(t.durum));
  const sonuclanan = talepler.filter((t) => ["Onaylandı", "Reddedildi"].includes(t.durum)).slice(0, 5);

  /* Planlı: onaylanmış, ileri tarihli izinler. Sayı bakiyede zaten
     düşülmüş olarak geliyor; burada hangi günler olduğu görünsün. */
  const kayitlar = veri?.kayitlar ?? [];
  const planli = kayitlar.filter((k) => k.planliMi);
  const gecmis = kayitlar.filter((k) => !k.planliMi);

  const aylar = [];
  for (const k of gecmis) {
    const d = gunOku(k.cikisTarihi);
    const ay = d ? `${AYLAR[d.getMonth()]} ${d.getFullYear()}` : "";
    let grup = aylar.find((x) => x.ay === ay);
    if (!grup) aylar.push((grup = { ay, satirlar: [] }));
    grup.satirlar.push(k);
  }

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="İzin Yönetimi" acik kendi />

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />
        }
      >
        {/* ------------------------------------------------ bakiye kartı */}
        <KartZemin renkler={YESIL} yuvarlak={24} stil={s.bakiye}>
          <View style={s.bakiyeUst}>
            <Halka oran={oran} deger={sayi(kalan)} />

            <View style={{ flex: 1 }}>
              <Text style={s.bakiyeEtiket}>KULLANILABİLİR İZİN</Text>
              <Text style={s.bakiyeBuyuk}>{sayi(kalan)} gün izniniz var</Text>
              {b.sonrakiHakEdis ? (
                <Text style={s.bakiyeKucuk}>
                  Sonraki hak ediş{"\n"}
                  <Text style={{ fontWeight: "800" }}>
                    {kisaTarih(b.sonrakiHakEdis)} {gunOku(b.sonrakiHakEdis)?.getFullYear()}
                  </Text>
                  {b.kalanAy ? ` · ${b.kalanAy} ay kaldı` : ""}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={s.parcalar}>
            <Parca ad="Hak edilen" deger={b.hakedilen} />
            <Parca ad="Devir" deger={b.devir} />
            <Parca ad="Kullanılan" deger={b.kullanilan} />
            <Parca ad="Planlı" deger={b.planli} />
          </View>
        </KartZemin>

        <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={() => setFormAcik(true)}>
          <Text style={s.ctaArti}>＋</Text>
          <Text style={s.ctaYazi}>Yeni izin talebi</Text>
        </TouchableOpacity>

        {denk ? (
          <TouchableOpacity style={s.denk} activeOpacity={0.85} onPress={() => navigation?.navigate?.("Denklestirme")}>
            <View style={s.denkSimge}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: "#5f8c10" }}>±</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.denkAd}>Denkleştirme</Text>
              <Text style={s.denkAlt} numberOfLines={1}>
                Fazla / eksik çalışma ve denkleştirme izni
                {denk.bekleyen ? ` · ${denk.bekleyen} form süreçte` : ""}
              </Text>
            </View>
            <Text style={[s.denkSay, { color: denk.netDk < 0 ? "#c2410c" : "#4a6e0c" }]}>
              {denk.netDk > 0 ? "+" : denk.netDk < 0 ? "−" : ""}
              {(() => {
                const m = Math.abs(denk.netDk ?? 0);
                const h = Math.floor(m / 60);
                const d = m % 60;
                return h && d ? `${h} sa ${d} dk` : h ? `${h} sa` : `${d} dk`;
              })()}
            </Text>
          </TouchableOpacity>
        ) : null}

        {gorev ? (
          <TouchableOpacity style={s.denk} activeOpacity={0.85} onPress={() => navigation?.navigate?.("Gorevlendirme")}>
            <View style={[s.denkSimge, { backgroundColor: "#e6f6f9" }]}>
              <Simge ad="canta" boyut={18} renkli="#0e7490" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.denkAd}>Görevlendirme</Text>
              <Text style={s.denkAlt} numberOfLines={1}>
                Toplantı, seminer, eğitim, iş görüşmesi
                {(() => {
                  const b = (gorev.kayitlar ?? []).filter((k) => k.durum === "bekliyor").length;
                  return b ? ` · ${b} onay bekliyor` : "";
                })()}
              </Text>
            </View>
            <Text style={[s.denkSay, { color: "#0e7490" }]}>›</Text>
          </TouchableOpacity>
        ) : null}

        {/* ------------------------------------------- süreçteki talepler */}
        {surecte.length > 0 && (
          <>
            <Bolum ad="SÜREÇTEKİ TALEPLER" say={surecte.length} />
            {surecte.map((t) => (
              <TalepKarti key={t.id} t={t} birimAdi={birimAdi} ustAdi={ustAdi} onPress={() => setDetay(t)} />
            ))}
          </>
        )}

        {/* ------------------------------------------------ planlı izinler */}
        {planli.length > 0 && (
          <>
            <Bolum ad="PLANLI İZİNLER" say={planli.length} />
            <View style={s.kart}>
              {planli.map((k, i) => {
                const d = gunOku(k.cikisTarihi);
                const kalanGun = d ? Math.ceil((d - new Date(new Date().toDateString())) / 86400000) : null;

                return (
                  <View key={i} style={[s.satir, i === 0 && { borderTopWidth: 0 }]}>
                    <View style={[s.tarihKutu, { backgroundColor: renk.maviAcik }]}>
                      <Text style={[s.tarihGun, { color: renk.mavi }]}>{d?.getDate()}</Text>
                      <Text style={[s.tarihAy, { color: renk.mavi }]}>{d ? AYK[d.getMonth()] : ""}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.satirB}>{aralikYaz(k.cikisTarihi, k.donusTarihi)}</Text>
                      <Text style={s.satirA}>
                        {k.tur} · {k.baslangicSaat ? `${k.baslangicSaat}–${k.bitisSaat}` : `${sayi(k.gun)} gün`}
                      </Text>
                    </View>
                    {kalanGun !== null && (
                      <View style={[s.rozet, { backgroundColor: renk.maviAcik }]}>
                        <Text style={[s.rozetYazi, { color: renk.mavi }]}>
                          {kalanGun <= 0 ? "bugün" : kalanGun === 1 ? "yarın" : `${kalanGun} gün sonra`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ------------------------------------------------ sonuçlanan */}
        {sonuclanan.length > 0 && (
          <>
            <Bolum ad="SONUÇLANAN TALEPLER" />
            {sonuclanan.map((t) => (
              <TalepKarti key={t.id} t={t} birimAdi={birimAdi} ustAdi={ustAdi} onPress={() => setDetay(t)} />
            ))}
          </>
        )}

        {/* --------------------------------------------------- geçmiş */}
        <Bolum ad="İZİN GEÇMİŞİ" />
        <View style={s.kart}>
          {aylar.length === 0 ? (
            <Text style={s.bos}>Henüz kullanılmış izniniz yok.</Text>
          ) : (
            aylar.map((g) => (
              <View key={g.ay}>
                <Text style={s.ayBaslik}>{g.ay.toLocaleUpperCase("tr")}</Text>
                {g.satirlar.map((k, i) => (
                  <View key={i} style={[s.satir, i === 0 && { borderTopWidth: 0 }]}>
                    <View style={[s.serit, { backgroundColor: turRengi(k.tur) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.satirB}>{aralikYaz(k.cikisTarihi, k.donusTarihi)}</Text>
                      <Text style={s.satirA}>{k.tur}</Text>
                    </View>
                    <View style={[s.rozet, { backgroundColor: renk.zemin }]}>
                      <Text style={s.rozetYazi}>
                        {k.baslangicSaat ? `${sayi(k.saat)} saat` : `${sayi(k.gun)} gün`}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>

        <Text style={s.altBilgi}>
          Onay sırası: {birimAdi} → {ustAdi ? `${ustAdi} → ` : ""}İnsan Kaynakları. Her aşamada
          bildirim alırsınız.
        </Text>
      </ScrollView>

      {formAcik && (
        <TalepFormu
          turler={turler}
          kalan={kalan}
          birimAdi={birimAdi}
          ustAdi={ustAdi}
          kapat={() => setFormAcik(false)}
          gonderildi={() => {
            setFormAcik(false);
            getir();
          }}
        />
      )}

      {detay && (
        <TalepDetay
          t={detay}
          birimAdi={birimAdi}
          ustAdi={ustAdi}
          kapat={() => setDetay(null)}
          evrakDegisti={() => {
            setDetay(null);
            getir();
          }}
          iptalEdildi={() => {
            setDetay(null);
            getir();
          }}
          yenidenTalep={() => {
            setDetay(null);
            setFormAcik(true);
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ========================================================================== */
/* Parçalar                                                                   */
/* ========================================================================== */

/**
 * Kalan gün halkası.
 *
 * Çember arka planda mutlak konumlu, yazı normal akışta ortalanıyor.
 * Tersi (yazıyı mutlak konumla halkanın üstüne bindirmek) iOS'ta yazıyı
 * halkanın altına, parça kutularının üstüne kaydırıyordu.
 */
function Halka({ oran, deger }) {
  const r = 44;
  const c = 2 * Math.PI * r;

  return (
    <View style={s.halka}>
      <Svg
        width={104}
        height={104}
        viewBox="0 0 100 100"
        style={{ position: "absolute", top: 0, left: 0, transform: [{ rotate: "-90deg" }] }}
      >
        <Circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="9" />
        <Circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - oran)}
        />
      </Svg>
      <Text style={s.halkaSayi}>{deger}</Text>
      <Text style={s.halkaGun}>GÜN KALDI</Text>
    </View>
  );
}

function Parca({ ad, deger }) {
  return (
    <View style={s.parca}>
      <Text style={s.parcaDeger}>{sayi(deger)}</Text>
      <Text style={s.parcaAd}>{ad}</Text>
    </View>
  );
}

function Bolum({ ad, say }) {
  return (
    <View style={s.bolum}>
      <Text style={s.bolumAd}>{ad}</Text>
      {say ? (
        <View style={s.bolumSay}>
          <Text style={s.bolumSayYazi}>{say}</Text>
        </View>
      ) : null}
    </View>
  );
}

const turRengi = (tur) =>
  /rapor/i.test(tur ?? "") ? renk.mor
  : /saat/i.test(tur ?? "") ? renk.mavi
  : /mazeret|ücretsiz/i.test(tur ?? "") ? renk.turuncu
  : renk.yesil;

/**
 * Talebin aşamaları: 0 talep, 1 birim yöneticisi, 2 üst yönetici, 3 İK.
 * "Atlandı" aşaması tamamlanmış sayılıyor: şemada o seviyede yönetici
 * yoksa talep bir sonrakine geçiyor.
 */
function asamaDurumu(t) {
  const karar = [t.magazaKarar, t.bolgeKarar, t.ikKarar];
  const red = karar.findIndex((k) => k === "Reddedildi" || k === "Red");

  if (t.durum === "Reddedildi")
    return { red: true, redAsama: red >= 0 ? red + 1 : 1, tamam: red >= 0 ? red : 0 };

  if (t.durum === "Onaylandı") return { red: false, tamam: 3 };

  let tamam = 0;
  for (let i = 0; i < 3; i++) {
    if (karar[i] && karar[i] !== "Reddedildi") tamam = i + 1;
    else break;
  }

  return { red: false, tamam };
}

/**
 * Onay tablosunda ara aşama yoksa (üst yönetici adı gelmiyorsa) çizgi üç
 * adımlı: Talep → 1. onay → İK. Dört adım çizilince 1. onaydan sonra
 * "üst yönetici onayında" yazıyordu; oysa o aşama atlanıyor.
 */
function asamalar(t, birimAdi, ustAdi) {
  /* Zincirli talep (2.0, 26.10.2026): adımlar sunucudan (`sira`), atlananlar gizli */
  if (Array.isArray(t.sira) && t.sira.length > 0) {
    const adimlar = t.sira.filter((x) => x.karar !== "atlandi");
    const redIdx = adimlar.findIndex((x) => x.karar === "red");
    let tamam = 0;
    while (tamam < adimlar.length && adimlar[tamam].karar === "onay") tamam += 1;
    return {
      a: { red: redIdx >= 0, tamam: redIdx >= 0 ? redIdx : tamam, redAsama: redIdx >= 0 ? redIdx + 1 : undefined },
      adlar: ["Talep", ...adimlar.map((x) => (x.ad === "İnsan Kaynakları" ? "İK" : kisalt(x.ad)))],
      son: adimlar.length,
    };
  }

  const a = asamaDurumu(t);

  /* Aşama adı pozisyon değil, genel "Yönetici": talep mağazada müdüre,
     genel merkezde birim müdürüne, mağaza müdüründe bölge müdürüne
     gidiyor; hepsinde personelin gördüğü aynı. Kim olduğu altta,
     "Şu an bekleyen" satırında. */
  if (ustAdi) return { a, adlar: ["Talep", "Yönetici", "Üst yönetici", "İK"], son: 3 };

  const cevir = (x) => (x >= 3 ? 2 : x >= 1 ? 1 : 0);

  return {
    a: {
      red: a.red,
      tamam: cevir(a.tamam),
      redAsama: a.red ? (a.redAsama >= 3 ? 2 : 1) : undefined,
    },
    adlar: ["Talep", "Yönetici", "İK"],
    son: 2,
  };
}

function TalepKarti({ t, birimAdi, ustAdi, onPress }) {
  const { a, adlar, son } = asamalar(t, birimAdi, ustAdi);
  const d = gunOku(t.cikisTarihi);

  const rozet = a.red
    ? { yazi: "Reddedildi", zemin: "#fdecec", renk: renk.kirmizi }
    : a.tamam >= son
    ? { yazi: "Onaylandı", zemin: renk.yesilAcik, renk: renk.yesilKoyu }
    : { yazi: `${adlar[a.tamam + 1]} onayı bekleniyor`, zemin: "#fff8e6", renk: "#b7791f" };

  const redNotu = a.red ? t.ikNot || t.bolgeNot || t.magazaNot : null;

  return (
    <TouchableOpacity style={s.kart} activeOpacity={0.85} onPress={onPress}>
      <View style={s.talepUst}>
        <View style={s.tarihKutu}>
          <Text style={s.tarihGun}>{d?.getDate()}</Text>
          <Text style={s.tarihAy}>{d ? AYK[d.getMonth()] : ""}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.satirB} numberOfLines={1}>
            {t.tur}
          </Text>
          <Text style={s.satirA} numberOfLines={1}>
            {aralikYaz(t.cikisTarihi, t.donusTarihi)} ·{" "}
            {t.baslangicSaat ? `${t.baslangicSaat}–${t.bitisSaat}` : `${sayi(t.gun)} gün`}
            {t.rapor && t.baslamaTarihi ? ` · işe ${kisaTarih(t.baslamaTarihi)}` : ""}
          </Text>
        </View>
        <View style={[s.rozet, { backgroundColor: rozet.zemin }]}>
          <Text style={[s.rozetYazi, { color: rozet.renk }]} numberOfLines={1}>
            {rozet.yazi}
          </Text>
        </View>
      </View>

      <View style={s.asamalar}>
        {adlar.map((ad, i) => {
          const tamam = !a.red ? i <= a.tamam : i < a.redAsama;
          const red = a.red && i === a.redAsama;
          const simdi = !a.red && a.tamam < son && i === a.tamam + 1;

          return (
            <View key={i} style={s.asamaSarmal}>
              {i > 0 && <View style={[s.asamaCizgi, tamam && { backgroundColor: renk.yesil }]} />}
              <View style={s.asama}>
                <View
                  style={[
                    s.nokta,
                    tamam && s.noktaTamam,
                    simdi && s.noktaSimdi,
                    red && s.noktaRed,
                  ]}
                >
                  <Text style={[s.noktaYazi, (tamam || red) && { color: "#fff" }, simdi && { color: renk.turuncu }]}>
                    {red ? "✕" : tamam ? "✓" : i + 1}
                  </Text>
                </View>
                <Text style={s.asamaAd} numberOfLines={1}>
                  {ad}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {t.bekleyen && !a.red && a.tamam < son ? (
        <Text style={s.bekleyen}>Şu an bekleyen: {t.bekleyen}</Text>
      ) : null}

      {redNotu ? (
        <View style={s.redNot}>
          <Text style={s.redNotYazi}>
            <Text style={{ fontWeight: "800" }}>Sebep: </Text>
            {redNotu}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/** Uzun ünvanlar aşama çizgisinde sığmıyordu: "Mağaza Müdürü" → "Mağaza Müd." */
const kisalt = (ad) => {
  const a = String(ad ?? "").trim();
  if (a.length <= 9) return a;
  return a.replace(/Müdürü$/i, "Müd.").replace(/Yöneticisi$/i, "Yön.").slice(0, 11);
};

/* ========================================================================== */
/* Talep detayı                                                               */
/* ========================================================================== */

function TalepDetay({ t, birimAdi, ustAdi, kapat, iptalEdildi, yenidenTalep, evrakDegisti }) {
  const a = asamaDurumu(t);
  const [isleniyor, setIsleniyor] = useState(false);
  const [evrakAcik, setEvrakAcik] = useState(false);
  const ev = t.evrak;

  const zaman = (x) => {
    if (!x) return "";
    const d = new Date(x);
    return Number.isNaN(d.getTime())
      ? ""
      : `${d.getDate()} ${AYLAR[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(
          d.getMinutes()
        ).padStart(2, "0")}`;
  };

  /* Zincirli talep (2.0, 26.10.2026): sunucu adımları `sira` ile gönderiyor
     (Birim yöneticisi → GMY → İK gibi); eski talepte üç sabit aşama kolonlardan. */
  const zincirAdimlari = Array.isArray(t.sira) && t.sira.length > 0
    ? t.sira.map((x) => ({
        ad: x.ad,
        karar: x.karar === "onay" ? "Onaylandı" : x.karar === "red" ? "Reddedildi" : x.karar === "atlandi" ? "Atlandı" : null,
        kisi: x.kim,
        tarih: x.tarih,
        not: x.not,
      }))
    : null;

  const adimlar = [
    { ad: "Talep oluşturuldu", alt: zaman(t.olusturma), durum: "tamam" },
    ...(zincirAdimlari ?? [
      { ad: birimAdi || "Yönetici", karar: t.magazaKarar, kisi: t.magazaKisi, tarih: t.magazaTarih, not: t.magazaNot },
      /* Ara aşama yalnızca tabloda varsa ya da gerçekten karar verilmişse */
      ...(ustAdi || (t.bolgeKarar && t.bolgeKarar !== "Atlandı")
        ? [{ ad: ustAdi || "Üst yönetici", karar: t.bolgeKarar, kisi: t.bolgeKisi, tarih: t.bolgeTarih, not: t.bolgeNot }]
        : []),
      { ad: "İnsan Kaynakları", karar: t.ikKarar, kisi: t.ikKisi, tarih: t.ikTarih, not: t.ikNot },
    ]),
  ].map((x, i, dizi) => {
    if (i === 0) return x;

    const red = x.karar === "Reddedildi" || x.karar === "Red";
    const atlandi = x.karar === "Atlandı";

    /* Şu an beklenen adım: kararı olmayan ilk adım */
    const ilkBos = dizi.findIndex((y, j) => j > 0 && !y.karar);

    return {
      ...x,
      durum: red ? "red" : x.karar ? "tamam" : !a.red && ilkBos === i ? "simdi" : "bekliyor",
      baslik: red
        ? `${x.ad} reddetti`
        : atlandi
        ? `${x.ad} · aşama atlandı`
        : x.karar
        ? `${x.ad} onayladı`
        : `${x.ad} onayı`,
      alt: x.karar
        ? [x.kisi, zaman(x.tarih)].filter(Boolean).join(" · ")
        : !a.red && ilkBos === i
        ? t.bekleyen
          ? `şu an burada · ${t.bekleyen}`
          : "şu an burada"
        : "bekleniyor",
    };
  });

  const iptalSor = () =>
    Alert.alert("Talep iptal edilsin mi?", "Onay sürecinden çıkarılır.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "İptal et",
        style: "destructive",
        onPress: async () => {
          setIsleniyor(true);
          try {
            await talepIptal(t.id);
            iptalEdildi();
          } catch (h) {
            Alert.alert("İptal edilemedi", h.message);
          } finally {
            setIsleniyor(false);
          }
        },
      },
    ]);

  const sonuclandi = ["Onaylandı", "Reddedildi"].includes(t.durum);

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.beyaz }]} edges={["top", "bottom"]}>
        <View style={s.sayfaUst}>
          <Text style={s.sayfaBaslik}>{t.altTur ? `${t.tur} · ${t.altTur}` : t.tur}</Text>
          <TouchableOpacity onPress={kapat} hitSlop={12}>
            <Text style={s.sayfaKapat}>Kapat</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }}>
          <View style={s.detayOzet}>
            <Text style={s.detayTarih}>{aralikYaz(t.cikisTarihi, t.donusTarihi)}</Text>
            <Text style={s.satirA}>
              {t.baslangicSaat ? `${t.baslangicSaat}–${t.bitisSaat}` : `${sayi(t.gun)} gün`} ·{" "}
              {t.durum.toLocaleLowerCase("tr")}
            </Text>
            {t.aciklama ? <Text style={[s.satirA, { marginTop: 8 }]}>“{t.aciklama}”</Text> : null}
            {t.yerineAd ? <Text style={[s.satirA, { marginTop: 6 }]}>Yerine bakacak: {t.yerineAd}</Text> : null}
            {t.rapor && t.baslamaTarihi ? (
              <Text style={[s.satirA, { marginTop: 6 }]}>İşe başlama: {kisaTarih(t.baslamaTarihi)}</Text>
            ) : null}
            {t.rapor ? (
              <TouchableOpacity
                style={[s.evrakDugme, { backgroundColor: renk.mor }]}
                onPress={() => Linking.openURL(oturumluAdres(`/api/IzinTalep/${t.id}/Rapor`)).catch(() => Alert.alert("Açılamadı", "Rapor açılamadı."))}
              >
                <Text style={s.evrakDugmeYazi}>Raporu gör</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {ev ? (
            <>
              <Text style={s.fBaslik}>EVRAK</Text>
              <View style={s.evrakKutu}>
                {(ev.gerekenler ?? []).map((g) => (
                  <Text key={g.kalem} style={[s.evrakSatir, g.yuklendi && { color: renk.yesilKoyu }]}>
                    {g.yuklendi ? "✓" : "○"} {g.ad}
                  </Text>
                ))}
                <Text style={[s.evrakSatir, ev.asilGonderim && { color: renk.yesilKoyu }]}>
                  {ev.asilGonderim ? "✓" : "○"} Aslı İnsan Kaynakları'na gönderildi
                </Text>
                <Text style={[s.evrakSatir, ev.ikVar && { color: renk.yesilKoyu }]}>
                  {ev.ikVar ? "✓" : "○"} İK ıslak imzalı evrakı aldı
                </Text>
                {!ev.personelTamam && ev.son ? (
                  <Text style={[s.zAlt, { marginTop: 6 }, ev.gecikti && { color: renk.turuncu }]}>
                    {ev.gecikti ? "Yükleme süresi doldu" : `Son yükleme: ${new Date(ev.son).toLocaleDateString("tr-TR")}`}
                  </Text>
                ) : null}
                {!(ev.personelTamam && ev.asilGonderim) ? (
                  <TouchableOpacity style={s.evrakDugme} onPress={() => setEvrakAcik(true)}>
                    <Text style={s.evrakDugmeYazi}>{ev.personelTamam ? "Aslını gönderdiğimi bildir" : "Evrakı yükle"}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : null}

          <Text style={s.fBaslik}>SÜREÇ</Text>

          <View style={s.zaman}>
            {adimlar.map((x, i) => (
              <View key={i} style={s.z}>
                <View
                  style={[
                    s.zNokta,
                    x.durum === "tamam" && { backgroundColor: renk.yesil, borderColor: renk.yesil },
                    x.durum === "red" && { backgroundColor: renk.kirmizi, borderColor: renk.kirmizi },
                    x.durum === "simdi" && { borderColor: renk.turuncu },
                  ]}
                />
                {i < adimlar.length - 1 && <View style={s.zCizgi} />}
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      s.zBaslik,
                      x.durum === "simdi" && { color: renk.turuncu },
                      x.durum === "bekliyor" && { color: renk.pasif },
                    ]}
                  >
                    {x.baslik ?? x.ad}
                  </Text>
                  {x.alt ? <Text style={s.zAlt}>{x.alt}</Text> : null}
                  {x.not && x.karar && x.karar !== "Atlandı" ? (
                    <Text style={[s.zAlt, { color: renk.metin, marginTop: 3 }]}>“{x.not}”</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={s.sayfaAlt}>
          {t.durum === "Reddedildi" ? (
            <TouchableOpacity style={s.gonder} onPress={yenidenTalep}>
              <Text style={s.gonderYazi}>Başka tarihle yeniden talep et</Text>
            </TouchableOpacity>
          ) : !sonuclandi ? (
            <TouchableOpacity
              style={[s.gonder, s.iptalDugme]}
              disabled={isleniyor}
              onPress={iptalSor}
            >
              <Text style={[s.gonderYazi, { color: renk.kirmizi }]}>
                {isleniyor ? "İptal ediliyor" : "Talebi iptal et"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {evrakAcik ? (
          <EvrakPenceresi
            talep={evrakTalebi(t)}
            kapat={() => setEvrakAcik(false)}
            tamam={() => {
              setEvrakAcik(false);
              evrakDegisti?.();
            }}
          />
        ) : null}
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */
/* Talep formu (23.10.2026, 1.9)                                              */
/* ========================================================================== */

/*
 * Önce tür seçiliyor (dört büyük kart), form türe göre değişiyor:
 *   - Yıllık / ücretsiz izin: takvimde aralık, canlı özet, yerine bakacak.
 *   - Saatlik izin: gün şeridi, çıkış saati ızgarası ve süre (en fazla
 *     3 saat). Daha uzunu için yıllık ya da ücretsiz izne yönlendiriyor.
 *   - Raporlu: "Raporunuz var mı?" Yoksa yıllık / ücretsiz izne
 *     yönlendiriyor; varsa rapor belgesi + başlangıç, bitiş ve işe başlama
 *     tarihi. Form ve mail yok; onaylayanlar raporu görüp onaylıyor.
 * Mazeret ve yarım gün izni kaldırıldı (sunucu artık göndermiyor).
 */

const TUR_GORUNUM = [
  { test: /y[ıi]ll[ıi]k/i, simge: "takvim", renk: "#3f6f0c", zemin: "#eef6e2" },
  { test: /[üu]cretsiz/i, simge: "canta", renk: "#ad4e00", zemin: "#fff2e8" },
  { test: /saat/i, simge: "saat", renk: "#1a4d80", zemin: "#eef4fb" },
  { test: /rapor/i, simge: "kalp", renk: "#722ed1", zemin: "#f6efff" },
];

const turGorunum = (ad) =>
  TUR_GORUNUM.find((x) => x.test.test(ad ?? "")) ?? { simge: "belge", renk: renk.yesilKoyu, zemin: renk.yesilAcik };

const turSirasi = (ad) => {
  const i = TUR_GORUNUM.findIndex((x) => x.test.test(ad ?? ""));
  return i < 0 ? 9 : i;
};

const turAlti = (t, kalan) => {
  if (t.rapor || /rapor/i.test(t.ad)) return "Doktor raporuyla";
  if (t.sureTuru === "saat") return `En fazla ${sayi(t.enFazlaSaat ?? 3)} saat`;
  if (t.bakiyedenDuser) return `${sayi(kalan)} gün hakkınız var`;
  if (/[üu]cretsiz/i.test(t.ad)) return "Bakiyeden düşmez";
  return t.aciklama || "Bakiyeden düşmez";
};

const GUN_ADI = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** Saatlik izin: 08:00–19:30 arası yarım saatte bir */
const CIKIS_SAATLERI = Array.from({ length: 24 }, (_v, i) => {
  const dk = 8 * 60 + i * 30;
  return `${String(Math.floor(dk / 60)).padStart(2, "0")}:${String(dk % 60).padStart(2, "0")}`;
});

const saatEkle = (saat, sure) => {
  const [a, b] = saat.split(":").map(Number);
  const dk = a * 60 + b + Math.round(sure * 60);
  return `${String(Math.floor(dk / 60) % 24).padStart(2, "0")}:${String(dk % 60).padStart(2, "0")}`;
};

const gunEkle = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const uzunTarih = (d) => (d ? `${d.getDate()} ${AYLAR[d.getMonth()]} ${GUN_ADI[d.getDay()]}` : "Seçin");

function TalepFormu({ turler, kalan, birimAdi, ustAdi, kapat, gonderildi }) {
  const bugun = useMemo(() => new Date(new Date().toDateString()), []);

  const liste = useMemo(
    () => [...turler].sort((a, b) => turSirasi(a.ad) - turSirasi(b.ad)),
    [turler]
  );

  const [tur, setTur] = useState(liste.length === 1 ? liste[0].ad : null);
  const turKaydi = liste.find((t) => t.ad === tur) ?? null;
  const sure = turKaydi?.sureTuru ?? "tam";
  const rapor = !!turKaydi && (turKaydi.rapor || /rapor/i.test(turKaydi.ad));
  const saatlik = !!turKaydi && !rapor && sure === "saat";
  const tamGun = !!turKaydi && !rapor && !saatlik;
  const enFazlaSaat = Number(turKaydi?.enFazlaSaat ?? 3);

  const kaydirma = useRef(null);

  const turSec = (ad) => {
    setTur(ad);
    setIlk(null);
    setSon(null);
    setRaporVar(null);
    requestAnimationFrame(() => kaydirma.current?.scrollTo({ y: 0, animated: true }));
  };

  /** Türü adındaki kelimeyle seçer: yönlendirme düğmeleri için */
  const turaGec = (desen) => {
    const t = liste.find((x) => desen.test(x.ad));
    if (t) turSec(t.ad);
    else Alert.alert("İzin türü", "Bu izin türü şu anda talep edilemiyor.");
  };

  /* ------------------------------------------------- ortak alanlar */
  const [ay, setAy] = useState(new Date(bugun.getFullYear(), bugun.getMonth(), 1));
  const [ilk, setIlk] = useState(null);
  const [son, setSon] = useState(null);
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  /* Yerine bakacak kişi (isteğe bağlı): şubeden ya da departmandan */
  const [adaylar, setAdaylar] = useState(null);
  const [yerineKaynak, setYerineKaynak] = useState("sube");
  const [yerine, setYerine] = useState(null);
  const [yerineAcik, setYerineAcik] = useState(false);
  const [yerineAra, setYerineAra] = useState("");
  const [yerineHata, setYerineHata] = useState("");

  useEffect(() => {
    let iptal = false;
    yerineBakacaklarAl()
      .then((c) => {
        if (iptal) return;
        setAdaylar(c?.kisiler ?? []);
        setYerineKaynak(c?.kaynak ?? "sube");
      })
      .catch((h) => {
        if (iptal) return;
        setAdaylar([]);
        setYerineHata(h?.message ?? "Liste alınamadı.");
      });
    return () => {
      iptal = true;
    };
  }, []);

  const yerineListe = useMemo(() => {
    const q = yerineAra.trim().toLocaleLowerCase("tr");
    return (adaylar ?? []).filter(
      (k) => !q || `${k.adSoyad} ${k.pozisyon ?? ""}`.toLocaleLowerCase("tr").includes(q)
    );
  }, [adaylar, yerineAra]);

  /* İzin kontenjanı: şubenin önümüzdeki aylardaki boş günü */
  const [kontenjan, setKontenjan] = useState(null);

  useEffect(() => {
    let iptal = false;
    api
      .al("/api/IzinRapor/Mobil/Kontenjan")
      .then((c) => !iptal && setKontenjan(c?.acik ? c : null))
      .catch(() => !iptal && setKontenjan(null));
    return () => {
      iptal = true;
    };
  }, []);

  /* ------------------------------------------------- tam gün */
  const [hesap, setHesap] = useState(null);
  const [hesaplaniyor, setHesaplaniyor] = useState(false);
  const [cakisma, setCakisma] = useState(0);
  const bitis = son ?? ilk;

  useEffect(() => {
    let iptal = false;
    if (!ilk || !tamGun) {
      setHesap(null);
      return;
    }
    setHesaplaniyor(true);
    izinGunHesabi(iso(ilk), iso(bitis))
      .then((c) => !iptal && setHesap(c))
      .catch(() => !iptal && setHesap(null))
      .finally(() => !iptal && setHesaplaniyor(false));
    return () => {
      iptal = true;
    };
  }, [ilk, son, tamGun]);

  useEffect(() => {
    let iptal = false;
    if (!ilk || rapor) {
      setCakisma(0);
      return;
    }
    izinCakisma(iso(ilk), iso(bitis))
      .then((c) => !iptal && setCakisma(Number(c?.sayi ?? 0)))
      .catch(() => !iptal && setCakisma(0));
    return () => {
      iptal = true;
    };
  }, [ilk, son, rapor]);

  const dusulmeyen = useMemo(() => {
    const m = new Map();
    for (const x of hesap?.dusulmeyenler ?? []) {
      const [t, ...neden] = String(x).split(" · ");
      const [g, a, y] = t.split(".");
      if (y) m.set(`${y}-${a}-${g}`, neden.join(" · "));
    }
    return m;
  }, [hesap]);

  const gunSec = (d) => {
    if (d < bugun) return;
    if (!ilk || son || d < ilk) {
      setIlk(d);
      setSon(null);
    } else {
      setSon(d);
    }
  };

  /* ------------------------------------------------- saatlik */
  const [saatGunu, setSaatGunu] = useState(bugun);
  const [cikisSaati, setCikisSaati] = useState(null);
  const [saatSure, setSaatSure] = useState(null);
  const sureler = useMemo(() => {
    const l = [];
    for (let x = 0.5; x <= enFazlaSaat + 0.001; x += 0.5) l.push(Math.round(x * 10) / 10);
    return l;
  }, [enFazlaSaat]);
  const donusSaati = cikisSaati && saatSure ? saatEkle(cikisSaati, saatSure) : null;
  const gunSeridi = useMemo(() => Array.from({ length: 21 }, (_v, i) => gunEkle(bugun, i)), [bugun]);

  /* ------------------------------------------------- raporlu */
  const [raporVar, setRaporVar] = useState(null);
  const [belge, setBelge] = useState(null);
  const [belgeSecim, setBelgeSecim] = useState(false);
  const [rBas, setRBas] = useState(bugun);
  const [rBit, setRBit] = useState(null);
  const [rDonus, setRDonus] = useState(null);
  const [acikTarih, setAcikTarih] = useState(null);

  const belgeAl = async (kaynak) => {
    setBelgeSecim(false);
    try {
      const d = await dosyaAl(kaynak);
      if (d) setBelge(d);
    } catch (h) {
      Alert.alert("Belge seçilemedi", h?.message ?? "Tekrar deneyiniz.");
    }
  };

  const raporGun = rBas && rBit ? Math.round((rBit - rBas) / 86400000) + 1 : null;

  const tarihDegis = (alan, d) => {
    setAcikTarih(null);
    if (alan === "bas") {
      setRBas(d);
      if (rBit && rBit < d) {
        setRBit(null);
        setRDonus(null);
      }
    } else if (alan === "bit") {
      setRBit(d);
      if (!rDonus || rDonus <= d) setRDonus(gunEkle(d, 1));
    } else {
      setRDonus(d);
    }
  };

  /* ------------------------------------------------- hesaplar */
  const gun = saatlik
    ? saatSure
      ? Math.max(0.5, Math.round((saatSure / 8) * 100) / 100)
      : null
    : hesap?.gun != null
    ? Number(hesap.gun)
    : null;

  const yillik = !!turKaydi?.bakiyedenDuser;
  const ucretsiz = /[üu]cretsiz/i.test(tur ?? "");
  const sonraKalan = yillik && gun != null ? kalan - gun : null;
  const asim = sonraKalan != null && sonraKalan < 0;
  const tarihYaz = (d) =>
    d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "…";

  const eksik = !turKaydi
    ? "İzin türünü seçin"
    : rapor
    ? raporVar !== true
      ? "Raporunuz var mı?"
      : !belge
      ? "Rapor belgesini ekleyin"
      : !rBit
      ? "Rapor bitiş tarihini seçin"
      : !rDonus
      ? "İşe başlama tarihini seçin"
      : null
    : saatlik
    ? !cikisSaati
      ? "Çıkış saatini seçin"
      : !saatSure
      ? "Süreyi seçin"
      : null
    : !ilk
    ? "Tarih seçin"
    : gun == null
    ? "Gün hesaplanıyor"
    : ucretsiz && !aciklama.trim()
    ? "Ücretsiz izin sebebini yazın"
    : null;

  const akis = `${birimAdi || "Yönetici"} → ${ustAdi ? `${ustAdi} → ` : ""}İnsan Kaynakları`;

  /* ------------------------------------------------- gönder */
  const gonder = async () => {
    if (eksik || gonderiliyor) return;
    setGonderiliyor(true);

    try {
      if (rapor) {
        const c = await raporluTalepGonder({
          baslangic: iso(rBas),
          bitis: iso(rBit),
          iseBaslama: iso(rDonus),
          aciklama: aciklama.trim(),
          dosya: belge,
        });
        Alert.alert("Raporunuz gönderildi", c?.mesaj ?? `${akis} onayına gönderildi.`);
        gonderildi();
        return;
      }

      const c = await talepOlustur({
        tur,
        cikisTarihi: iso(saatlik ? saatGunu : ilk),
        donusTarihi: iso(saatlik ? saatGunu : bitis),
        gun,
        baslangicSaat: saatlik ? cikisSaati : null,
        bitisSaat: saatlik ? donusSaati : null,
        saat: saatlik ? saatSure : null,
        aciklama: aciklama.trim() || null,
        yerineKodu: yerine?.sicil ?? null,
      });

      Alert.alert(
        "Talebiniz gönderildi",
        [c?.uyari ? `${c.uyari}\n\nTalebiniz yine de onaya sunuldu.` : `${akis} onayına sunuldu.`, c?.evrak ?? null]
          .filter(Boolean)
          .join("\n\n")
      );
      gonderildi();
    } catch (h) {
      Alert.alert("Gönderilemedi", h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  /* ------------------------------------------------- takvim (aralık) */
  const y = ay.getFullYear();
  const m = ay.getMonth();
  const gunSayisi = new Date(y, m + 1, 0).getDate();
  const bosluk = (new Date(y, m, 1).getDay() + 6) % 7;
  const hucreler = [];
  for (let i = 0; i < bosluk; i++) hucreler.push(null);
  for (let g = 1; g <= gunSayisi; g++) hucreler.push(new Date(y, m, g));
  const ilkIso = ilk ? iso(ilk) : null;
  const bitisIso = bitis ? iso(bitis) : null;

  const yerineAlani = (
    <>
      <Text style={s.fBaslik}>YERİNE BAKACAK KİŞİ · isteğe bağlı</Text>
      <TouchableOpacity style={[s.yerineKutu, yerine && s.yerineSecili]} activeOpacity={0.8} onPress={() => setYerineAcik(!yerineAcik)}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.yerineAd, !yerine && { color: renk.pasif, fontWeight: "600" }]} numberOfLines={1}>
            {yerine ? yerine.adSoyad : "Seçmek için dokunun"}
          </Text>
          <Text style={s.yerineAlt} numberOfLines={1}>
            {yerine ? yerine.pozisyon ?? "" : yerineKaynak === "departman" ? "Departmanınızdaki biri" : "Şubenizdeki biri"}
          </Text>
        </View>
        {yerine ? (
          <TouchableOpacity hitSlop={12} onPress={() => { setYerine(null); setYerineAcik(false); }}>
            <Text style={s.yerineTemizle}>Kaldır</Text>
          </TouchableOpacity>
        ) : (
          <Text style={s.yerineOk}>{yerineAcik ? "▴" : "▾"}</Text>
        )}
      </TouchableOpacity>
      {yerineAcik ? (
        <View style={s.yerineListe}>
          {adaylar == null ? (
            <ActivityIndicator color={renk.yesilKoyu} style={{ margin: 12 }} />
          ) : adaylar.length === 0 ? (
            <Text style={s.yerineBos}>
              {yerineHata
                ? `Liste alınamadı: ${yerineHata}`
                : `${yerineKaynak === "departman" ? "Departmanınızda" : "Şubenizde"} seçilebilecek kimse bulunamadı.`}
            </Text>
          ) : (
            <>
              {adaylar.length > 6 ? (
                <TextInput style={s.yerineArama} value={yerineAra} onChangeText={setYerineAra} placeholder="İsim ara" placeholderTextColor="#a3a9a0" returnKeyType="done" />
              ) : null}
              <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {yerineListe.map((k) => (
                  <TouchableOpacity
                    key={k.sicil}
                    style={[s.yerineSatir, yerine?.sicil === k.sicil && { backgroundColor: "#f2f9e8" }]}
                    onPress={() => { setYerine(k); setYerineAcik(false); setYerineAra(""); }}
                  >
                    <Text style={s.yerineSatirAd}>{k.adSoyad}</Text>
                    <Text style={s.yerineAlt}>{k.pozisyon ?? ""}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      ) : null}
    </>
  );

  const aciklamaAlani = (zorunlu, baslik, ornek) => (
    <>
      <Text style={s.fBaslik}>
        {baslik} {zorunlu ? <Text style={{ color: renk.turuncu }}>· zorunlu</Text> : "· isteğe bağlı"}
      </Text>
      <TextInput
        style={[s.aciklama, zorunlu && aciklama.trim() && { borderColor: renk.yesilKoyu }]}
        multiline
        value={aciklama}
        onChangeText={setAciklama}
        placeholder={ornek}
        placeholderTextColor="#a3a9a0"
      />
    </>
  );

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.zemin }]} edges={["top", "bottom"]}>
        <View style={[s.sayfaUst, { backgroundColor: renk.beyaz }]}>
          <TouchableOpacity onPress={kapat} hitSlop={12} style={s.geri}>
            <Text style={s.geriOk}>‹</Text>
          </TouchableOpacity>
          <Text style={s.sayfaBaslik}>Yeni izin talebi</Text>
        </View>

        <ScrollView ref={kaydirma} contentContainerStyle={{ padding: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
          {/* --------------------------------------------- tür kartları */}
          <Text style={[s.fBaslik, { marginTop: 4 }]}>NE TÜR İZİN?</Text>
          <View style={s.turIzgara}>
            {liste.map((t) => {
              const g = turGorunum(t.ad);
              const secili = tur === t.ad;
              return (
                <TouchableOpacity
                  key={t.ad}
                  style={[s.turKart, secili && { borderColor: g.renk, backgroundColor: g.zemin }]}
                  activeOpacity={0.85}
                  onPress={() => turSec(t.ad)}
                >
                  <View style={[s.turSimge, { backgroundColor: secili ? g.renk : g.zemin }]}>
                    <Simge ad={g.simge} boyut={19} renkli={secili ? "#fff" : g.renk} />
                  </View>
                  <Text style={[s.turAd, secili && { color: g.renk }]} numberOfLines={1}>{t.ad}</Text>
                  <Text style={s.turAlt} numberOfLines={1}>{turAlti(t, kalan)}</Text>
                  {secili ? <View style={[s.turTik, { backgroundColor: g.renk }]}><Text style={s.turTikYazi}>✓</Text></View> : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {!turKaydi ? (
            <Text style={s.ipucu}>Talep etmek istediğiniz izin türüne dokunun.</Text>
          ) : null}

          {/* ============================================ RAPORLU */}
          {rapor ? (
            <View style={s.panel}>
              <Text style={s.panelBaslik}>Doktor raporunuz var mı?</Text>
              <Text style={s.panelAlt}>Raporlu izin yalnızca rapor belgesiyle talep edilir.</Text>
              <View style={s.ikiDugme}>
                <TouchableOpacity style={[s.secDugme, raporVar === true && s.secDugmeSecili]} onPress={() => setRaporVar(true)} activeOpacity={0.85}>
                  <Text style={[s.secDugmeYazi, raporVar === true && { color: "#fff" }]}>Evet, raporum var</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.secDugme, raporVar === false && s.secDugmeHayir]} onPress={() => setRaporVar(false)} activeOpacity={0.85}>
                  <Text style={[s.secDugmeYazi, raporVar === false && { color: "#fff" }]}>Hayır</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {rapor && raporVar === false ? (
            <View style={[s.panel, s.yonlendir]}>
              <Text style={s.yonlendirBaslik}>Raporunuz yoksa raporlu izin alamazsınız</Text>
              <Text style={s.yonlendirAlt}>Bunun yerine yıllık izin ya da ücretsiz izin talep edebilirsiniz.</Text>
              <View style={s.ikiDugme}>
                <TouchableOpacity style={s.yonDugme} onPress={() => turaGec(/y[ıi]ll[ıi]k/i)} activeOpacity={0.85}>
                  <Text style={s.yonDugmeYazi}>Yıllık izin</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.yonDugme} onPress={() => turaGec(/[üu]cretsiz/i)} activeOpacity={0.85}>
                  <Text style={s.yonDugmeYazi}>Ücretsiz izin</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {rapor && raporVar === true ? (
            <>
              <Text style={s.fBaslik}>RAPOR BELGESİ</Text>
              {belge ? (
                <View style={s.belgeKart}>
                  {/image/i.test(belge.tip ?? "") ? (
                    <Image source={{ uri: belge.uri }} style={s.belgeResim} />
                  ) : (
                    <View style={[s.belgeResim, s.belgePdf]}><Text style={s.belgePdfYazi}>PDF</Text></View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.belgeAd} numberOfLines={1}>{belge.ad}</Text>
                    <Text style={s.belgeAlt}>✓ Eklendi</Text>
                  </View>
                  <TouchableOpacity onPress={() => setBelgeSecim(true)} hitSlop={10}>
                    <Text style={s.yerineTemizle}>Değiştir</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={s.belgeBos} onPress={() => setBelgeSecim(true)} activeOpacity={0.85}>
                  <Simge ad="foto" boyut={26} renkli={renk.mor} />
                  <Text style={s.belgeBosYazi}>Raporun fotoğrafını ekleyin</Text>
                  <Text style={s.belgeBosAlt}>Fotoğraf çekin, galeriden seçin ya da PDF ekleyin</Text>
                </TouchableOpacity>
              )}
              {belgeSecim ? (
                <View style={s.kaynaklar}>
                  {[["kamera", "Fotoğraf çek"], ["galeri", "Galeriden"], ["dosya", "PDF"]].map(([k, ad]) => (
                    <TouchableOpacity key={k} style={s.kaynak} onPress={() => belgeAl(k)} activeOpacity={0.85}>
                      <Text style={s.kaynakYazi}>{ad}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <Text style={s.fBaslik}>RAPOR TARİHLERİ</Text>
              <View style={s.tarihKart}>
                {[
                  ["bas", "Rapor başlangıcı", rBas, gunEkle(bugun, -30), gunEkle(bugun, 30)],
                  ["bit", "Rapor bitişi", rBit, rBas, gunEkle(rBas, 180)],
                  ["donus", "İşe başlama", rDonus, rBit ? gunEkle(rBit, 1) : null, rBit ? gunEkle(rBit, 15) : null],
                ].map(([k, ad, deger, enAz, enCok], i) => (
                  <View key={k}>
                    <TouchableOpacity
                      style={[s.tarihSatir, i > 0 && s.tarihSatirCizgi]}
                      activeOpacity={0.8}
                      disabled={k === "donus" && !rBit}
                      onPress={() => setAcikTarih(acikTarih === k ? null : k)}
                    >
                      <Text style={s.tarihEt}>{ad}</Text>
                      <Text style={[s.tarihDeger, !deger && { color: renk.pasif, fontWeight: "600" }]}>
                        {k === "donus" && !rBit ? "Önce bitişi seçin" : uzunTarih(deger)}
                      </Text>
                      <Text style={s.yerineOk}>{acikTarih === k ? "▴" : "▾"}</Text>
                    </TouchableOpacity>
                    {acikTarih === k ? (
                      <View style={s.tarihTakvim}>
                        <Takvim deger={deger ?? enAz ?? bugun} enAz={enAz} enCok={enCok} onSec={(d) => tarihDegis(k, d)} />
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>

              {raporGun ? (
                <View style={[s.ozet, { backgroundColor: renk.morAcik, borderColor: "#e3d3fb" }]}>
                  <View style={s.ozetUst}>
                    <Text style={s.ozetBuyuk}>{raporGun} gün rapor</Text>
                    <Text style={s.ozetTarih}>{aralikYaz(iso(rBas), iso(rBit))}</Text>
                  </View>
                  {rDonus ? <Text style={[s.ozetEt, { marginTop: 6 }]}>İşe başlama: {uzunTarih(rDonus)}</Text> : null}
                  <Text style={[s.ozetNot, { marginTop: 6 }]}>Yıllık izin bakiyenizden düşmez. Form ya da imza gerekmez.</Text>
                </View>
              ) : null}

              {aciklamaAlani(false, "NOT", "Yöneticinizin bilmesi gereken bir şey varsa yazınız")}
            </>
          ) : null}

          {/* ============================================ SAATLİK */}
          {saatlik ? (
            <>
              <Text style={s.fBaslik}>HANGİ GÜN</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingBottom: 2 }}>
                {gunSeridi.map((d, i) => {
                  const secili = iso(d) === iso(saatGunu);
                  return (
                    <TouchableOpacity key={i} style={[s.gunCip, secili && s.gunCipSecili]} onPress={() => setSaatGunu(d)} activeOpacity={0.85}>
                      <Text style={[s.gunCipUst, secili && { color: "rgba(255,255,255,0.85)" }]}>
                        {i === 0 ? "Bugün" : i === 1 ? "Yarın" : GUN_ADI[d.getDay()]}
                      </Text>
                      <Text style={[s.gunCipSayi, secili && { color: "#fff" }]}>{d.getDate()}</Text>
                      <Text style={[s.gunCipAy, secili && { color: "rgba(255,255,255,0.85)" }]}>{AYK[d.getMonth()]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={s.fBaslik}>ÇIKIŞ SAATİ</Text>
              <View style={s.saatIzgara}>
                {CIKIS_SAATLERI.map((x) => (
                  <TouchableOpacity key={x} style={[s.saatHucre, cikisSaati === x && s.saatHucreSecili]} onPress={() => setCikisSaati(x)} activeOpacity={0.85}>
                    <Text style={[s.saatYazi, cikisSaati === x && { color: "#fff" }]}>{x}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.fBaslik}>NE KADAR SÜRE</Text>
              <View style={s.sureSatir}>
                {sureler.map((x) => (
                  <TouchableOpacity key={x} style={[s.sureHucre, saatSure === x && s.saatHucreSecili]} onPress={() => setSaatSure(x)} activeOpacity={0.85}>
                    <Text style={[s.sureSayi, saatSure === x && { color: "#fff" }]}>{x < 1 ? "30" : sayi(x)}</Text>
                    <Text style={[s.sureBirim, saatSure === x && { color: "rgba(255,255,255,0.85)" }]}>{x < 1 ? "dk" : "saat"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.uzunKutu}>
                <Text style={s.uzunYazi}>
                  {sayi(enFazlaSaat)} saatten uzun mu? Saatlik izin en fazla {sayi(enFazlaSaat)} saat; daha uzunu için:
                </Text>
                <View style={[s.ikiDugme, { marginTop: 8 }]}>
                  <TouchableOpacity style={s.yonDugme} onPress={() => turaGec(/y[ıi]ll[ıi]k/i)}>
                    <Text style={s.yonDugmeYazi}>Yıllık izin</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.yonDugme} onPress={() => turaGec(/[üu]cretsiz/i)}>
                    <Text style={s.yonDugmeYazi}>Ücretsiz izin</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {cikisSaati && saatSure ? (
                <View style={[s.ozet, { backgroundColor: renk.maviAcik, borderColor: "#d3e3f5" }]}>
                  <View style={s.ozetUst}>
                    <Text style={s.ozetBuyuk}>{cikisSaati} – {donusSaati}</Text>
                    <Text style={s.ozetTarih}>{uzunTarih(saatGunu)}</Text>
                  </View>
                  <Text style={[s.ozetEt, { marginTop: 6 }]}>
                    {saatSure < 1 ? "30 dakika" : `${sayi(saatSure)} saat`} · yıllık izin bakiyenizden düşmez
                  </Text>
                </View>
              ) : null}

              {yerineAlani}
              {aciklamaAlani(false, "AÇIKLAMA", "Örn. hastane randevusu, banka işlemi")}
            </>
          ) : null}

          {/* ============================================ TAM GÜN */}
          {tamGun ? (
            <>
              {kontenjan && yillik && (kontenjan.aylar ?? []).length > 0 ? (
                <>
                  <Text style={s.fBaslik}>ŞUBENİZDE BOŞ GÜNLER</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                    {kontenjan.aylar.map((k) => {
                      const dolu = k.kapali || k.bos <= 0;
                      const secili = ay.getFullYear() === k.yil && ay.getMonth() === k.ay - 1;
                      return (
                        <TouchableOpacity key={`${k.yil}-${k.ay}`} style={[s.kontAy, secili && s.kontAySecili]} activeOpacity={0.8} onPress={() => setAy(new Date(k.yil, k.ay - 1, 1))}>
                          <Text style={s.kontAyAd}>{k.ad}</Text>
                          <Text style={[s.kontAyBos, { color: dolu ? "#b42318" : k.bos < 5 ? "#9a3412" : "#3f6108" }]}>
                            {k.kapali ? "Kapalı" : dolu ? "Dolu" : `${Math.floor(k.bos)} gün boş`}
                          </Text>
                          {k.kisiKalan != null ? <Text style={s.kontAyAlt}>siz: en çok {Math.floor(k.kisiKalan)} gün</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <Text style={s.kontNot}>
                    Ay doluysa talep gönderilemez; boş günü olan bir ay seçin.
                    {kontenjan.kisiBasiGun > 0 ? ` Bir ayda en çok ${kontenjan.kisiBasiGun} gün yıllık izin alınabilir.` : ""}
                  </Text>
                </>
              ) : null}

              <Text style={s.fBaslik}>TARİH</Text>
              <View style={[s.takvim, { backgroundColor: renk.beyaz }]}>
                <Text style={s.takvimIpucu}>
                  {!ilk ? "İlk izin gününüze dokunun" : !son ? "Şimdi son izin gününüze dokunun (tek günse geçin)" : "Değiştirmek için yeni ilk güne dokunun"}
                </Text>
                <View style={s.takvimUst}>
                  <TouchableOpacity hitSlop={12} onPress={() => setAy(new Date(y, m - 1, 1))}>
                    <Text style={s.takvimOk}>‹</Text>
                  </TouchableOpacity>
                  <Text style={s.takvimAy}>{AYLAR[m]} {y}</Text>
                  <TouchableOpacity hitSlop={12} onPress={() => setAy(new Date(y, m + 1, 1))}>
                    <Text style={s.takvimOk}>›</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.hafta}>
                  {HAFTA.map((h) => <Text key={h} style={s.haftaGun}>{h}</Text>)}
                </View>
                <View style={s.hucreler}>
                  {hucreler.map((d, i) => {
                    if (!d) return <View key={i} style={s.hucre} />;
                    const t = iso(d);
                    const gecmis = d < bugun;
                    const aralik = ilkIso && t >= ilkIso && t <= bitisIso;
                    const bas = t === ilkIso;
                    const bit = t === bitisIso;
                    const dusmeyen = dusulmeyen.has(t);
                    const tatil = dusmeyen && dusulmeyen.get(t) !== "haftalık izin";
                    return (
                      <TouchableOpacity key={i} style={s.hucre} disabled={gecmis} activeOpacity={0.7} onPress={() => gunSec(d)}>
                        <View style={[s.hucreIc, aralik && s.hucreAralik, aralik && bas && s.hucreBas, aralik && bit && s.hucreSon, (bas || bit) && s.hucreUc, t === iso(bugun) && !aralik && s.hucreBugun]}>
                          <Text style={[s.hucreYazi, dusmeyen && { color: "#b0b5ad" }, gecmis && { color: "#d3d6cf" }, (bas || bit) && { color: "#fff", fontWeight: "800" }]}>
                            {d.getDate()}
                          </Text>
                          {tatil && !(bas || bit) ? <View style={s.tatilNokta} /> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={s.lejant}>Soluk günler bakiyeden düşmez: resmî tatil ve haftalık izin gününüz.</Text>
              </View>

              {ilk ? (
                <View style={[s.ozet, asim && s.ozetAsim]}>
                  <View style={s.ozetUst}>
                    <Text style={s.ozetBuyuk}>{hesaplaniyor ? "…" : gun != null ? `${sayi(gun)} gün` : "—"}</Text>
                    <Text style={s.ozetTarih}>{aralikYaz(iso(ilk), iso(bitis))}</Text>
                  </View>
                  {yillik ? (
                    <>
                      <View style={s.ozetSatir}>
                        <Text style={s.ozetEt}>Bakiyeden düşecek</Text>
                        <Text style={s.ozetDeger}>{gun != null ? `${sayi(gun)} gün` : "—"}</Text>
                      </View>
                      <View style={s.ozetSatir}>
                        <Text style={s.ozetEt}>Talepten sonra kalan</Text>
                        <Text style={[s.ozetDeger, { color: asim ? renk.turuncu : renk.yesilKoyu }]}>
                          {sonraKalan != null ? `${sayi(sonraKalan)} gün` : "—"}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <Text style={[s.ozetEt, { marginTop: 6 }]}>Bu izin türü yıllık izin bakiyenizden düşmez.</Text>
                  )}
                  {hesap && Number(hesap.takvimGunu) > Number(hesap.gun) ? (
                    <Text style={s.ozetNot}>
                      {sayi(Number(hesap.takvimGunu) - Number(hesap.gun))} gün tatil ya da haftalık izin gününüz olduğu için düşülmedi.
                    </Text>
                  ) : null}
                  {asim ? <Text style={s.uyari}>Bakiyenizi aşıyor. Talep yine gönderilebilir; avans izin kararı İnsan Kaynakları'nındır.</Text> : null}
                  {cakisma > 0 ? (
                    <View style={s.cakisma}>
                      <Text style={s.cakismaYazi}>
                        Bu tarihlerde biriminizden <Text style={{ fontWeight: "800" }}>{cakisma} kişi</Text> izinli. Yöneticiniz yoğunluk nedeniyle kaydırmanızı isteyebilir.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {yerineAlani}
              {ucretsiz
                ? aciklamaAlani(true, "ÜCRETSİZ İZİN SEBEBİ", "Örn. aile ziyareti, taşınma, özel işlerim")
                : aciklamaAlani(false, "AÇIKLAMA", "Yöneticinizin bilmesi gereken bir şey varsa yazınız")}

              {ucretsiz ? (
                <>
                  <Text style={s.fBaslik}>FORMDA ŞÖYLE GÖRÜNECEK</Text>
                  <View style={s.formOnizle}>
                    <Text style={s.formOnizleYazi}>
                      <Text style={s.formDolu}>{aciklama.trim() || "…"}</Text> dolayı <Text style={s.formDolu}>{tarihYaz(ilk)}</Text> tarihinden{" "}
                      <Text style={s.formDolu}>{tarihYaz(bitis)}</Text> tarihine kadar <Text style={s.formDolu}>{gun != null ? sayi(gun) : "…"}</Text> gün süreyle ücretsiz izne ayrılmak istiyorum.
                    </Text>
                    <Text style={[s.formOnizleYazi, { fontWeight: "800", marginTop: 4 }]}>Gereğini arz ederim.</Text>
                  </View>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>

        <View style={[s.sayfaAlt, { backgroundColor: renk.beyaz }]}>
          <TouchableOpacity
            style={[s.gonder, rapor && { backgroundColor: renk.mor }, (eksik || gonderiliyor) && { backgroundColor: "#c5c9c0" }]}
            disabled={!!eksik || gonderiliyor}
            onPress={gonder}
          >
            <Text style={s.gonderYazi}>{gonderiliyor ? "Gönderiliyor" : eksik ?? (rapor ? "Raporu gönder" : "Onaya gönder")}</Text>
          </TouchableOpacity>
          <Text style={s.akis}>Onay sırası: {akis}</Text>
        </View>
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  bar: { flexDirection: "row", alignItems: "center", paddingRight: 16 },
  barYil: {
    fontSize: 12.5,
    fontWeight: "700",
    color: renk.pasif,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },
  govde: { padding: 16, paddingBottom: 120 },

  /* ------------------------------------------------------------ bakiye */
  bakiye: { borderRadius: 24, padding: 18, overflow: "hidden" },
  bakiyeUst: { flexDirection: "row", alignItems: "center", gap: 16 },
  halka: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  halkaSayi: { fontSize: 30, fontWeight: "800", color: "#fff", letterSpacing: -1 },
  halkaGun: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  bakiyeEtiket: { fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.8)", letterSpacing: 0.4 },
  bakiyeBuyuk: { fontSize: 17, fontWeight: "800", color: "#fff", marginTop: 3, marginBottom: 8 },
  bakiyeKucuk: { fontSize: 12, color: "rgba(255,255,255,0.88)", lineHeight: 17 },
  parcalar: { flexDirection: "row", gap: 6, marginTop: 16 },
  parca: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  parcaDeger: { fontSize: 16, fontWeight: "800", color: "#fff" },
  parcaAd: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.85)", marginTop: 1 },

  cta: {
    marginTop: 14,
    backgroundColor: renk.turuncu,
    borderRadius: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: renk.turuncu,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaArti: { color: "#fff", fontSize: 18, fontWeight: "800" },
  denk: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9e3",
  },
  denkSimge: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#eef5e1", alignItems: "center", justifyContent: "center" },
  denkAd: { fontSize: 14.5, fontWeight: "800", color: "#1f2933" },
  denkAlt: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  denkSay: { fontSize: 14.5, fontWeight: "800" },
  ctaYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },

  bolum: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22, marginBottom: 10 },
  bolumAd: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.8 },
  bolumSay: { backgroundColor: renk.cizgi, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8 },
  bolumSayYazi: { fontSize: 11, fontWeight: "800", color: renk.pasif },

  kart: {
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
    marginBottom: 10,
  },

  talepUst: { flexDirection: "row", alignItems: "center", gap: 10 },
  tarihKutu: {
    width: 48,
    borderRadius: 12,
    backgroundColor: renk.zemin,
    paddingVertical: 6,
    alignItems: "center",
  },
  tarihGun: { fontSize: 18, fontWeight: "800", color: renk.metin },
  tarihAy: { fontSize: 10, fontWeight: "800", color: renk.pasif, letterSpacing: 0.3 },
  satirB: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  satirA: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  rozet: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9, maxWidth: 175 },
  rozetYazi: { fontSize: 11, fontWeight: "800", color: renk.metin },

  asamalar: { flexDirection: "row", alignItems: "flex-start", marginTop: 14 },
  asamaSarmal: { flex: 1, flexDirection: "row", alignItems: "flex-start" },
  asamaCizgi: {
    position: "absolute",
    left: "-50%",
    right: "50%",
    top: 11,
    height: 3,
    borderRadius: 2,
    backgroundColor: renk.cizgi,
  },
  asama: { flex: 1, alignItems: "center", gap: 5 },
  nokta: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
    alignItems: "center",
    justifyContent: "center",
  },
  noktaTamam: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  noktaSimdi: { borderColor: renk.turuncu },
  noktaRed: { backgroundColor: renk.kirmizi, borderColor: renk.kirmizi },
  noktaYazi: { fontSize: 11, fontWeight: "800", color: renk.pasif },
  asamaAd: { fontSize: 10, fontWeight: "700", color: renk.pasif },
  bekleyen: { fontSize: 11.5, color: renk.pasif, marginTop: 10 },

  redNot: { marginTop: 12, backgroundColor: "#fdecec", borderRadius: 12, padding: 10 },
  redNotYazi: { fontSize: 12.5, color: "#7a1a1a", lineHeight: 18 },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },
  serit: { width: 4, height: 34, borderRadius: 2 },
  ayBaslik: { fontSize: 11, fontWeight: "800", color: renk.pasif, marginTop: 10, marginBottom: 2, letterSpacing: 0.4 },
  bos: { fontSize: 13, color: renk.pasif, textAlign: "center", paddingVertical: 10 },
  altBilgi: { fontSize: 12, color: renk.pasif, textAlign: "center", lineHeight: 18, marginTop: 16, paddingHorizontal: 8 },

  /* ------------------------------------------------------------ sayfa */
  sayfaUst: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
  },
  sayfaBaslik: { flex: 1, fontSize: 18, fontWeight: "800", color: renk.metin },
  sayfaKapat: { fontSize: 14, fontWeight: "700", color: renk.pasif },
  geri: { width: 34, height: 34, borderRadius: 17, backgroundColor: renk.zemin, alignItems: "center", justifyContent: "center", marginRight: 10 },
  geriOk: { fontSize: 24, lineHeight: 26, color: renk.metin, fontWeight: "600", marginTop: -2 },

  /* ---------------------------------------------- 1.9 talep formu */
  turIzgara: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  turKart: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
    padding: 13,
    minHeight: 104,
    shadowColor: "#1d2126",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  turSimge: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  turAd: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  turAlt: { fontSize: 11.5, color: renk.pasif, marginTop: 2 },
  turTik: { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  turTikYazi: { color: "#fff", fontSize: 11, fontWeight: "900" },

  panel: { marginTop: 16, backgroundColor: renk.beyaz, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: renk.cizgi },
  panelBaslik: { fontSize: 16, fontWeight: "800", color: renk.metin },
  panelAlt: { fontSize: 12.5, color: renk.pasif, marginTop: 3 },
  ikiDugme: { flexDirection: "row", gap: 8, marginTop: 12 },
  secDugme: { flex: 1, height: 46, borderRadius: 13, borderWidth: 1.5, borderColor: renk.cizgi, alignItems: "center", justifyContent: "center", backgroundColor: renk.beyaz },
  secDugmeSecili: { backgroundColor: renk.mor, borderColor: renk.mor },
  secDugmeHayir: { backgroundColor: renk.pasif, borderColor: renk.pasif },
  secDugmeYazi: { fontSize: 14, fontWeight: "800", color: renk.metin },
  yonlendir: { backgroundColor: "#fff8f1", borderColor: "#ffdcc4" },
  yonlendirBaslik: { fontSize: 14.5, fontWeight: "800", color: "#9a3412" },
  yonlendirAlt: { fontSize: 12.5, color: "#7c4a26", marginTop: 3, lineHeight: 18 },
  yonDugme: { flex: 1, height: 42, borderRadius: 12, backgroundColor: renk.beyaz, borderWidth: 1.5, borderColor: renk.yesilKoyu, alignItems: "center", justifyContent: "center" },
  yonDugmeYazi: { fontSize: 13.5, fontWeight: "800", color: renk.yesilKoyu },

  belgeBos: { backgroundColor: renk.beyaz, borderRadius: 18, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#cdb6f2", paddingVertical: 22, alignItems: "center", gap: 6 },
  belgeBosYazi: { fontSize: 14.5, fontWeight: "800", color: renk.mor },
  belgeBosAlt: { fontSize: 12, color: renk.pasif },
  belgeKart: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: renk.beyaz, borderRadius: 16, padding: 10, borderWidth: 1, borderColor: renk.cizgi },
  belgeResim: { width: 54, height: 54, borderRadius: 10, backgroundColor: renk.zemin },
  belgePdf: { alignItems: "center", justifyContent: "center", backgroundColor: "#fdecec" },
  belgePdfYazi: { fontSize: 12, fontWeight: "900", color: renk.kirmizi },
  belgeAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  belgeAlt: { fontSize: 12, fontWeight: "700", color: renk.yesilKoyu, marginTop: 2 },
  kaynaklar: { flexDirection: "row", gap: 8, marginTop: 8 },
  kaynak: { flex: 1, height: 42, borderRadius: 12, backgroundColor: renk.mor, alignItems: "center", justifyContent: "center" },
  kaynakYazi: { color: "#fff", fontSize: 13.5, fontWeight: "800" },

  tarihKart: { backgroundColor: renk.beyaz, borderRadius: 16, borderWidth: 1, borderColor: renk.cizgi, overflow: "hidden" },
  tarihSatir: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 52 },
  tarihSatirCizgi: { borderTopWidth: 1, borderTopColor: renk.cizgi },
  tarihEt: { flex: 1, fontSize: 13.5, color: renk.pasif, fontWeight: "600" },
  tarihDeger: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  tarihTakvim: { paddingHorizontal: 12, paddingBottom: 12 },

  gunCip: { width: 58, paddingVertical: 8, borderRadius: 14, backgroundColor: renk.beyaz, borderWidth: 1.5, borderColor: renk.cizgi, alignItems: "center" },
  gunCipSecili: { backgroundColor: renk.mavi, borderColor: renk.mavi },
  gunCipUst: { fontSize: 10.5, fontWeight: "700", color: renk.pasif },
  gunCipSayi: { fontSize: 19, fontWeight: "800", color: renk.metin, marginTop: 1 },
  gunCipAy: { fontSize: 10, fontWeight: "800", color: renk.pasif },
  saatIzgara: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  saatHucre: { width: "22.6%", flexGrow: 1, height: 40, borderRadius: 11, backgroundColor: renk.beyaz, borderWidth: 1.5, borderColor: renk.cizgi, alignItems: "center", justifyContent: "center" },
  saatHucreSecili: { backgroundColor: renk.mavi, borderColor: renk.mavi },
  saatYazi: { fontSize: 14, fontWeight: "700", color: renk.metin },
  sureSatir: { flexDirection: "row", gap: 7 },
  sureHucre: { flex: 1, height: 54, borderRadius: 13, backgroundColor: renk.beyaz, borderWidth: 1.5, borderColor: renk.cizgi, alignItems: "center", justifyContent: "center" },
  sureSayi: { fontSize: 17, fontWeight: "800", color: renk.metin },
  sureBirim: { fontSize: 10.5, fontWeight: "700", color: renk.pasif },
  uzunKutu: { marginTop: 12, backgroundColor: "#f7f8f5", borderRadius: 14, padding: 12 },
  uzunYazi: { fontSize: 12.5, color: renk.pasif, lineHeight: 18 },
  takvimIpucu: { fontSize: 12, fontWeight: "700", color: renk.yesilKoyu, textAlign: "center", marginBottom: 6 },
  sayfaAlt: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: renk.cizgi },
  gonder: { backgroundColor: renk.yesilKoyu, borderRadius: 16, paddingVertical: 16, alignItems: "center" },
  gonderYazi: { color: "#fff", fontSize: 15, fontWeight: "800" },
  iptalDugme: { backgroundColor: renk.beyaz, borderWidth: 1.5, borderColor: "#f3c2c2" },
  akis: { fontSize: 11.5, color: renk.pasif, textAlign: "center", marginTop: 8 },

  fBaslik: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.7, marginTop: 18, marginBottom: 8 },
  turBilgi: {
    backgroundColor: renk.zemin,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 4,
  },
  turBilgiYazi: { fontSize: 12.5, fontWeight: "700", color: renk.pasif },

  cipler: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  cip: {
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: renk.beyaz,
  },
  cipSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  cipYazi: { fontSize: 13, fontWeight: "700", color: renk.metin },
  seg: { flexDirection: "row", backgroundColor: renk.zemin, borderRadius: 13, padding: 3 },
  segDugme: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  segSecili: { backgroundColor: renk.beyaz },
  segYazi: { fontSize: 13, fontWeight: "700", color: renk.pasif },

  takvim: { borderWidth: 1, borderColor: renk.cizgi, borderRadius: 16, padding: 10 },
  takvimUst: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6, marginBottom: 6 },
  takvimOk: { fontSize: 22, color: renk.pasif, paddingHorizontal: 8 },
  takvimAy: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  hafta: { flexDirection: "row" },
  haftaGun: { flex: 1, textAlign: "center", fontSize: 10.5, fontWeight: "800", color: renk.pasif, paddingVertical: 4 },
  hucreler: { flexDirection: "row", flexWrap: "wrap" },
  hucre: { width: "14.28%" /* 100/7 yuvarlanınca bazı Android ekranlarda 7. gün alt satıra düşüyordu */, height: 40, justifyContent: "center" },
  hucreIc: { height: 36, alignItems: "center", justifyContent: "center" },
  hucreAralik: { backgroundColor: "#dcefc2" },
  hucreBas: { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  hucreSon: { borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  hucreUc: { backgroundColor: renk.yesilKoyu },
  hucreBugun: { borderWidth: 1.5, borderColor: renk.yesil, borderRadius: 10 },
  hucreYazi: { fontSize: 13.5, fontWeight: "600", color: renk.metin },
  tatilNokta: { position: "absolute", bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: renk.kirmizi },
  lejant: { fontSize: 11, color: renk.pasif, marginTop: 8, paddingHorizontal: 4 },

  ozet: { marginTop: 16, borderRadius: 16, padding: 14, backgroundColor: renk.yesilAcik, borderWidth: 1, borderColor: "#d7ebbd" },
  ozetAsim: { backgroundColor: renk.turuncuAcik, borderColor: "#ffd6c2" },
  ozetUst: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  ozetBuyuk: { fontSize: 22, fontWeight: "800", color: renk.metin },
  ozetTarih: { fontSize: 12, fontWeight: "700", color: renk.pasif },
  ozetSatir: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  ozetEt: { fontSize: 13, color: renk.metin },
  ozetDeger: { fontSize: 13, fontWeight: "800", color: renk.metin },
  ozetNot: { fontSize: 12, color: renk.pasif, marginTop: 8, lineHeight: 17 },
  uyari: { fontSize: 12, color: "#9a3412", marginTop: 8, lineHeight: 17 },
  kontAy: { borderWidth: 1.5, borderColor: "#e3e7df", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fff", minWidth: 118 },
  kontAySecili: { borderColor: "#7cb518", backgroundColor: "#f2f9e8" },
  kontAyAd: { fontSize: 13.5, fontWeight: "800", color: "#1f2933" },
  kontAyBos: { fontSize: 12.5, fontWeight: "700", marginTop: 2 },
  kontAyAlt: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  kontNot: { fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 17 },
  cakisma: { marginTop: 10, backgroundColor: "#fff8e6", borderRadius: 12, padding: 10 },
  cakismaYazi: { fontSize: 12.5, color: "#7a5a00", lineHeight: 18 },
  ipucu: { fontSize: 12.5, color: renk.pasif, textAlign: "center", marginTop: 14 },
  yerineKutu: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 52,
  },
  yerineSecili: { borderColor: renk.yesilKoyu, backgroundColor: "#f7faf2" },
  yerineAd: { fontSize: 14.5, fontWeight: "800", color: renk.metin },
  yerineAlt: { fontSize: 12, color: renk.pasif, marginTop: 1 },
  yerineOk: { fontSize: 16, color: renk.pasif },
  yerineTemizle: { fontSize: 13, fontWeight: "700", color: renk.turuncu },
  yerineListe: { borderWidth: 1, borderColor: renk.cizgi, borderRadius: 14, marginTop: 8, overflow: "hidden" },
  yerineArama: {
    borderBottomWidth: 1,
    borderColor: renk.cizgi,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: renk.metin,
  },
  yerineSatir: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: "#f0f2ee", minHeight: 44 },
  yerineSatirAd: { fontSize: 14, fontWeight: "700", color: renk.metin },
  yerineBos: { fontSize: 13, color: renk.pasif, padding: 14, textAlign: "center" },

  evrakKutu: { borderWidth: 1, borderColor: renk.cizgi, borderRadius: 14, padding: 12, gap: 4 },
  evrakSatir: { fontSize: 13.5, color: renk.metin, fontWeight: "600" },
  evrakDugme: { marginTop: 10, alignSelf: "flex-start", height: 38, paddingHorizontal: 16, borderRadius: 11, backgroundColor: "#4f7a0b", alignItems: "center", justifyContent: "center" },
  evrakDugmeYazi: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
  formOnizle: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#b8c2ad",
    borderRadius: 14,
    padding: 14,
  },
  formOnizleYazi: { fontSize: 14, lineHeight: 24, color: renk.metin },
  formDolu: { backgroundColor: "#eef5e2", fontWeight: "800", color: "#2c4705" },
  aciklama: {
    borderWidth: 1.5,
    borderColor: renk.cizgi,
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
    minHeight: 76,
    textAlignVertical: "top",
    color: renk.metin,
  },

  /* ------------------------------------------------------------ detay */
  detayOzet: { backgroundColor: "#f7faf2", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#e3ecd6" },
  detayTarih: { fontSize: 21, fontWeight: "800", color: renk.metin },
  zaman: { marginTop: 4 },
  z: { flexDirection: "row", gap: 12, paddingBottom: 16 },
  zNokta: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
    marginTop: 1,
  },
  zCizgi: { position: "absolute", left: 8, top: 20, bottom: 0, width: 2, backgroundColor: renk.cizgi },
  zBaslik: { fontSize: 13.5, fontWeight: "800", color: renk.metin },
  zAlt: { fontSize: 12, color: renk.pasif, marginTop: 2 },
});

/**
 * Performansım
 * ---------------------------------------------------------------------------
 * Toplam puan, ölçütler ve aylık seyir.
 *
 * <p>
 * Her ölçütte durum tek bakışta: solda renk şeridi (yeşil aldı, kırmızı
 * alamadı), sağda alınan / olası puan. Değer ve eşik biliniyorsa bir
 * çizgide gösteriliyor ve geçmek için ne gerektiği sayıyla yazıyor: eski
 * sistemdeki "şirket ortalamasının altında kaldığınız için puan
 * alamadınız" personel için bir şey söylemiyordu, ne kadar uzakta
 * olduğunu bilmiyordu.
 * </p>
 *
 * <p>
 * Alınamayan ölçütler kaçırılan puana göre en üstte; üst kartta en
 * büyük fırsat. Durum değişince (puan kazanma, kaybetme, az kalma)
 * bildirim gidiyor — PerformansBildirimGorevi.
 * </p>
 */

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran } from "../bilesenler/ModalAlani";
import { useFocusEffect } from "@react-navigation/native";
import Svg, { Circle } from "react-native-svg";

import { performansAl } from "../api";
import { renk, AYLAR } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata, Bilgi } from "../bilesenler/Ortak";
import KartZemin, { YESIL } from "../bilesenler/KartZemin";

/* -------------------------------------------------------------------------- */

const s0 = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  const basamak = Math.abs(x) < 1 ? 4 : 2;
  return x.toLocaleString("tr-TR", { maximumFractionDigits: basamak, minimumFractionDigits: 0 });
};

const puanYaz = (n) => String(Math.round(Number(n ?? 0) * 10) / 10).replace(".", ",");

const degerVar = (o) => o.deger != null && o.esik != null;

/** Geçmek için ne gerektiği: düz cümle */
function mesaj(o) {
  if (o.aldi) {
    if (o.sinirda && degerVar(o))
      return {
        tur: "sinir",
        metin: `${puanYaz(o.puan)} puan aldınız ama eşiğin hemen ${o.yon < 0 ? "altındasınız" : "üstündesiniz"} (fark ${s0(Math.abs(o.deger - o.esik))}). Küçük bir değişiklik puanı kaybettirir.`,
      };

    return {
      tur: "ok",
      metin: degerVar(o)
        ? `${puanYaz(o.puan)} puan aldınız. ${o.esikAd ?? "Eşik"} ${s0(o.esik)}, sizin değeriniz ${s0(o.deger)}.`
        : `${puanYaz(o.puan)} puan aldınız.`,
    };
  }

  const kazanc = o.referans ? ` Geçerseniz ${puanYaz(o.referans)} puan kazanırsınız.` : "";

  if (!degerVar(o))
    return { tur: "no", metin: o.neden ? `${o.neden}${kazanc}` : `Bu ölçütten puan alamadınız.${kazanc}` };

  const fark = Math.abs(o.esik - o.deger);
  const oran = o.deger !== 0 ? Math.round((fark / Math.abs(o.deger)) * 100) : null;
  const hedef = o.esikAd === "Sınır" ? "sınırına" : "şirket ortalamasına";

  /* Ortalamanın üstünde kalıp puan alamayınca sunucu gerekçeyi yazıyor (24.10.2026) */
  const gerekce = o.neden ? `${o.neden} ` : "";

  return {
    tur: o.azKaldi ? "yakin" : "no",
    metin: gerekce +
      (o.yon > 0
        ? `Puan almak için ${s0(o.deger)} → ${s0(o.esik)} çıkarmanız gerekiyor${oran != null ? ` (+%${oran})` : ""}.${kazanc}`
        : `Puan almak için ${s0(o.deger)} → ${s0(o.esik)} ${o.esikAd === "Şirket ort." || o.esikAd === "Sınır" ? hedef : "değerine"} düşürmeniz gerekiyor (−${s0(fark)}).${kazanc}`),
  };
}

/* ========================================================================== */

export default function Performans() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [donem, setDonem] = useState(null);
  const [suzgec, setSuzgec] = useState("hepsi");
  const [acik, setAcik] = useState(null);

  const getir = useCallback(async (yenile = false, secim = null) => {
    if (yenile) setYenileniyor(true);

    try {
      setVeri(await performansAl(secim?.yil, secim?.ay));
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
      getir(false, donem);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getir])
  );

  const olcutler = veri?.olcutler ?? [];

  const ozet = useMemo(() => {
    const alinan = olcutler.reduce((a, o) => a + (o.aldi ? Number(o.puan) : 0), 0);
    const olasi = olcutler.reduce((a, o) => a + Number(o.referans ?? (o.aldi ? o.puan : 0)), 0);
    const kacan = olcutler.filter((o) => !o.aldi).reduce((a, o) => a + Number(o.referans ?? 0), 0);

    const kalan = olcutler.filter((o) => !o.aldi).sort((a, b) => (b.referans ?? 0) - (a.referans ?? 0));

    return {
      alinan,
      olasi,
      kacan,
      kalan,
      aldigi: olcutler.filter((o) => o.aldi).length,
      sinirda: olcutler.filter((o) => o.sinirda || o.azKaldi).length,
    };
  }, [olcutler]);

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  if (!veri?.puan && veri?.puan !== 0)
    return (
      <SafeAreaView style={s.tam} edges={["top"]}>
        <BarBaslik ad="Performansım" acik kendi />
        <View style={s.govde}>
          <Bilgi>
            Bu dönem için performans değerlendirmeniz henüz yapılmadı. Değerlendirme tamamlandığında
            burada görünecek.
          </Bilgi>
        </View>
      </SafeAreaView>
    );

  /* Geçen aya göre değişim: aylık listeden */
  const aylik = veri.aylik ?? [];
  const buAyIndeks = aylik.findIndex((x) => x.buAy);
  const oncekiPuan = buAyIndeks > 0 ? aylik[buAyIndeks - 1]?.puan : null;
  const degisim = oncekiPuan != null ? veri.puan - oncekiPuan : null;
  const enYuksek = Math.max(...aylik.map((x) => x.puan ?? 0), 1);

  const oran = ozet.olasi > 0 ? Math.min(1, ozet.alinan / ozet.olasi) : 0;

  const liste = olcutler
    .slice()
    .sort((a, b) => (a.aldi === b.aldi ? (b.referans ?? 0) - (a.referans ?? 0) : a.aldi ? 1 : -1))
    .filter((o) => suzgec === "hepsi" || (suzgec === "no" ? !o.aldi : o.aldi));

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="Performansım" acik kendi />

      {/* Dönem seçici */}
      {(veri.donemler ?? []).length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.donemler}
          contentContainerStyle={{ paddingHorizontal: 14, gap: 7 }}
        >
          {veri.donemler.map((d, i) => {
            const secili = d.yil === veri.yil && d.ay === veri.ay;
            return (
              <TouchableOpacity
                key={i}
                style={[s.donem, secili && s.donemSecili]}
                onPress={() => {
                  setDonem(d);
                  getir(false, d);
                }}
              >
                <Text style={[s.donemYazi, secili && { color: "#fff" }]}>
                  {AYLAR[d.ay - 1]?.slice(0, 3)} {String(d.yil).slice(2)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true, donem)} tintColor={renk.yesil} />
        }
      >
        {/* ------------------------------------------------ skor kartı */}
        <KartZemin renkler={YESIL} yuvarlak={24} stil={s.skor}>
          <View style={s.skorUst}>
            <Halka oran={oran} deger={veri.puan} />
            <View style={{ flex: 1 }}>
              <Text style={s.skorEt}>
                {AYLAR[veri.ay - 1]?.toLocaleUpperCase("tr")} {veri.yil} · MAĞAZA PERFORMANSI
              </Text>
              <Text style={s.skorBuyuk}>
                {ozet.aldigi}/{olcutler.length} ölçütte puan aldınız
              </Text>
              <Text style={s.skorKucuk}>
                {veri.gorevSirasi ? `${veri.gorevAdi ?? "Görev"} içinde ${veri.gorevSirasi}.` : ""}
                {veri.sirketSirasi ? ` · şirkette ${veri.sirketSirasi}.` : ""}
                {degisim != null ? `\nGeçen aya göre ${degisim >= 0 ? "+" : ""}${degisim} puan` : ""}
              </Text>
            </View>
          </View>

          <View style={s.parcalar}>
            <Parca ad="Alınan" deger={puanYaz(ozet.alinan)} />
            <Parca ad="Kaçırılan" deger={puanYaz(ozet.kacan)} />
            <Parca ad="Sınırda" deger={ozet.sinirda} />
          </View>
        </KartZemin>

        {/* ------------------------------------------------ en büyük fırsat */}
        {ozet.kalan.length > 0 && (
          <View style={s.firsat}>
            <View style={s.firsatSimge}>
              <Text style={{ fontSize: 20 }}>🎯</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.firsatBaslik}>
                En büyük fırsat: {ozet.kalan[0].ad}
                {ozet.kalan[0].referans ? ` · ${puanYaz(ozet.kalan[0].referans)} puan` : ""}
              </Text>
              <Text style={s.firsatAlt}>
                {ozet.kalan.map((o) => o.ad).join(", ")} ölçütlerinde toplam {puanYaz(ozet.kacan)} puan
                alınabilir.
              </Text>
            </View>
          </View>
        )}

        {/* ------------------------------------------------ süzgeç */}
        <View style={s.seg}>
          {[
            ["hepsi", "Tümü"],
            ["no", "Alınamayan"],
            ["ok", "Alınan"],
          ].map(([k, a]) => (
            <TouchableOpacity key={k} style={[s.segDugme, suzgec === k && s.segSecili]} onPress={() => setSuzgec(k)}>
              <Text style={[s.segYazi, suzgec === k && { color: renk.metin }]}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.bolum}>ÖLÇÜTLER · {liste.length}</Text>

        {liste.map((o) => (
          <OlcutKarti key={o.kod ?? o.ad} o={o} onPress={() => setAcik(o)} />
        ))}

        {/* ------------------------------------------------ aylık seyir */}
        {aylik.length > 1 && (
          <>
            <Text style={s.bolum}>{veri.yil} AYLIK PUAN</Text>
            <View style={s.kart}>
              <View style={s.grafik}>
                {aylik.map((x) => (
                  <View key={x.ay} style={s.sutunSarmal}>
                    <Text style={s.sutunDeger}>{x.puan}</Text>
                    <View
                      style={[
                        s.sutun,
                        { height: `${Math.max(4, (x.puan / enYuksek) * 100)}%` },
                        x.buAy && { backgroundColor: renk.yesilKoyu },
                      ]}
                    />
                    <Text style={s.sutunAy}>{AYLAR[x.ay - 1]?.slice(0, 3)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        <Text style={s.altBilgi}>
          Bir ölçütte durumunuz değişince — puan kazandığınızda, kaybettiğinizde ya da eşiğe çok
          yaklaştığınızda — bildirim alırsınız.
        </Text>
      </ScrollView>

      {acik && <OlcutAyrinti o={acik} kapat={() => setAcik(null)} />}
    </SafeAreaView>
  );
}

/* ========================================================================== */

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
      <Text style={s.halkaEt}>PUAN</Text>
    </View>
  );
}

function Parca({ ad, deger }) {
  return (
    <View style={s.parca}>
      <Text style={s.parcaDeger}>{deger}</Text>
      <Text style={s.parcaAd}>{ad}</Text>
    </View>
  );
}

/** Değer ve eşik çizgisi: eşik bir işaret, sizin değeriniz bir nokta */
function Olcek({ o }) {
  if (!degerVar(o)) return null;

  /* Şirket ortalaması eşikten farklıysa (gerçek puan sınırı gösteriliyorsa) ikinci işaret */
  const ort = o.sirketOrt != null && Number(o.sirketOrt) !== Number(o.esik) ? Number(o.sirketOrt) : null;
  const min = Math.min(o.deger, o.esik, ort ?? o.esik);
  const max = Math.max(o.deger, o.esik, ort ?? o.esik);
  const pay = (max - min) * 1.4 || Math.abs(o.esik) * 0.1 || 1;
  const a = min - pay;
  const b = max + pay;
  const x = (v) => `${((v - a) / (b - a)) * 100}%`;

  return (
    <View style={{ marginTop: 18 }}>
      <View style={s.olcek}>
        <View style={[s.hat, { backgroundColor: o.yon > 0 ? "#f4f0e2" : "#f4f0e2" }]}>
          <View style={[s.hatUc, { left: 0, backgroundColor: o.yon > 0 ? "#fdecec" : "#eef7df" }]} />
          <View style={[s.hatUc, { right: 0, backgroundColor: o.yon > 0 ? "#eef7df" : "#fdecec" }]} />
        </View>

        <View style={[s.isaret, { left: x(o.esik) }]}>
          <Text style={s.isaretYazi} numberOfLines={1}>
            {o.esikAd ?? "Eşik"} {s0(o.esik)}
          </Text>
        </View>

        {ort != null ? (
          <View style={[s.isaret, { left: x(ort), opacity: 0.55 }]}>
            <Text style={[s.isaretYazi, { top: 26, fontWeight: "700" }]} numberOfLines={1}>ort. {s0(ort)}</Text>
          </View>
        ) : null}

        <View style={[s.nokta, { left: x(o.deger), backgroundColor: o.aldi ? renk.yesilKoyu : renk.kirmizi }]} />
      </View>

      <View style={[s.olcekAlt, ort != null && { marginTop: 18 }]}>
        <Text style={s.olcekUc}>{o.yon > 0 ? "düşük" : "iyi"}</Text>
        <Text style={s.olcekSen}>
          Siz: <Text style={{ fontWeight: "800", color: renk.metin }}>{s0(o.deger)}</Text>
        </Text>
        <Text style={s.olcekUc}>{o.yon > 0 ? "iyi" : "yüksek"}</Text>
      </View>
    </View>
  );
}

const TON = {
  ok: { serit: renk.yesil, zemin: "#eef7df", yazi: "#3a5709" },
  sinir: { serit: "#e0a100", zemin: "#fff8e6", yazi: "#7a5a00" },
  yakin: { serit: "#e0a100", zemin: "#fff8e6", yazi: "#7a5a00" },
  no: { serit: renk.kirmizi, zemin: "#fdecec", yazi: "#7a1a1a" },
};

function OlcutKarti({ o, onPress }) {
  const m = mesaj(o);
  const t = TON[m.tur];

  return (
    <TouchableOpacity style={s.olcut} activeOpacity={0.88} onPress={onPress}>
      <View style={[s.serit, { backgroundColor: t.serit }]} />

      <View style={s.olcutUst}>
        <View style={{ flex: 1 }}>
          <Text style={s.olcutAd}>{o.ad}</Text>
          <Text style={s.olcutYon}>
            {o.yon > 0 ? "↑ yüksek iyi" : "↓ düşük iyi"}
            {m.tur === "sinir" ? "  ·  sınırda" : m.tur === "yakin" ? "  ·  az kaldı" : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.olcutPuan, { color: o.aldi ? renk.yesilKoyu : renk.kirmizi }]}>
            {puanYaz(o.aldi ? o.puan : 0)}
          </Text>
          {o.referans != null ? <Text style={s.olcutRef}>/ {puanYaz(o.referans)} puan</Text> : null}
        </View>
      </View>

      <Olcek o={o} />

      <View style={[s.mesaj, { backgroundColor: t.zemin }]}>
        <Text style={[s.mesajYazi, { color: t.yazi }]}>{m.metin}</Text>
      </View>
    </TouchableOpacity>
  );
}

function OlcutAyrinti({ o, kapat }) {
  const m = mesaj(o);
  const t = TON[m.tur];

  return (
    <Modal {...modalTamEkran} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <ModalAlani style={[s.tam, { backgroundColor: renk.beyaz }]} edges={["top", "bottom"]}>
        <View style={s.sayfaUst}>
          <Text style={s.sayfaBaslik}>{o.ad}</Text>
          <TouchableOpacity onPress={kapat} hitSlop={12}>
            <Text style={s.kapat}>Kapat</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <View style={s.ayrintiKutular}>
            <View style={s.ayrintiKutu}>
              <Text style={[s.ayrintiDeger, { color: o.aldi ? renk.yesilKoyu : renk.kirmizi }]}>
                {puanYaz(o.aldi ? o.puan : 0)}
              </Text>
              <Text style={s.ayrintiEt}>alınan puan</Text>
            </View>
            <View style={s.ayrintiKutu}>
              <Text style={s.ayrintiDeger}>{o.referans != null ? puanYaz(o.referans) : "—"}</Text>
              <Text style={s.ayrintiEt}>olası puan</Text>
            </View>
          </View>

          {degerVar(o) && (
            <View style={s.ayrintiKutular}>
              <View style={s.ayrintiKutu}>
                <Text style={s.ayrintiDeger}>{s0(o.deger)}</Text>
                <Text style={s.ayrintiEt}>sizin değeriniz</Text>
              </View>
              <View style={s.ayrintiKutu}>
                <Text style={s.ayrintiDeger}>{s0(o.esik)}</Text>
                <Text style={s.ayrintiEt}>{(o.esikAd ?? "eşik").toLocaleLowerCase("tr")}</Text>
              </View>
            </View>
          )}

          {o.sirketOrt != null || o.puanAlan != null ? (
            <View style={s.ayrintiKutular}>
              <View style={s.ayrintiKutu}>
                <Text style={s.ayrintiDeger}>{o.sirketOrt != null ? s0(o.sirketOrt) : "—"}</Text>
                <Text style={s.ayrintiEt}>şirket ortalaması</Text>
              </View>
              <View style={s.ayrintiKutu}>
                <Text style={s.ayrintiDeger}>{o.puanAlan != null ? `${o.puanAlan} / ${o.puanAlan + (o.puanAlamayan ?? 0)}` : "—"}</Text>
                <Text style={s.ayrintiEt}>puan alan mağaza</Text>
              </View>
            </View>
          ) : null}

          <Olcek o={o} />

          <View style={[s.mesaj, { backgroundColor: t.zemin, marginTop: 16 }]}>
            <Text style={[s.mesajYazi, { color: t.yazi }]}>{m.metin}</Text>
          </View>

          <Text style={s.ayrintiNot}>
            {o.yon > 0
              ? "Bu ölçütte yüksek değer iyidir. Ortalamanın üstü çoğu ay yeterlidir; yetmediği aylarda sınır, o ay puan alan mağazaların en düşük değeridir."
              : "Bu ölçütte düşük değer iyidir: sınırın ya da şirket ortalamasının altına inince puan alırsınız; yetmediği aylarda puan alan mağazaların değeri esas alınır."}
          </Text>

          <Text style={s.ayrintiNot}>
            🔔 Bu ölçütte durumunuz değişirse (puan kazanır ya da kaybederseniz) bildirim alırsınız.
          </Text>
        </ScrollView>
      </ModalAlani>
    </Modal>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 120 },

  donemler: { flexGrow: 0, paddingVertical: 10 },
  donem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  donemSecili: { backgroundColor: renk.yesilKoyu, borderColor: renk.yesilKoyu },
  donemYazi: { fontSize: 12.5, fontWeight: "700", color: renk.metin },

  skor: { borderRadius: 24, padding: 18, overflow: "hidden" },
  skorUst: { flexDirection: "row", alignItems: "center", gap: 16 },
  halka: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  halkaSayi: { fontSize: 32, fontWeight: "800", color: "#fff", letterSpacing: -1 },
  halkaEt: { fontSize: 10.5, fontWeight: "800", color: "rgba(255,255,255,0.85)" },
  skorEt: { fontSize: 10.5, fontWeight: "800", color: "rgba(255,255,255,0.8)", letterSpacing: 0.4 },
  skorBuyuk: { fontSize: 16.5, fontWeight: "800", color: "#fff", marginTop: 3, marginBottom: 6 },
  skorKucuk: { fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 17 },
  parcalar: { flexDirection: "row", gap: 6, marginTop: 14 },
  parca: { flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, paddingVertical: 8, alignItems: "center" },
  parcaDeger: { fontSize: 16, fontWeight: "800", color: "#fff" },
  parcaAd: { fontSize: 10.5, fontWeight: "700", color: "rgba(255,255,255,0.85)" },

  firsat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  firsatSimge: { width: 40, height: 40, borderRadius: 12, backgroundColor: renk.turuncuAcik, alignItems: "center", justifyContent: "center" },
  firsatBaslik: { fontSize: 14, fontWeight: "800", color: renk.metin },
  firsatAlt: { fontSize: 12, color: renk.pasif, marginTop: 2, lineHeight: 17 },

  seg: { flexDirection: "row", backgroundColor: renk.beyaz, borderRadius: 13, padding: 3, borderWidth: 1, borderColor: renk.cizgi, marginTop: 14 },
  segDugme: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  segSecili: { backgroundColor: renk.zemin },
  segYazi: { fontSize: 12.5, fontWeight: "700", color: renk.pasif },

  bolum: { fontSize: 10.5, fontWeight: "800", color: renk.pasif, letterSpacing: 0.8, marginTop: 20, marginBottom: 10 },

  olcut: {
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    padding: 14,
    paddingLeft: 18,
    borderWidth: 1,
    borderColor: renk.cizgi,
    marginBottom: 10,
    overflow: "hidden",
  },
  serit: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  olcutUst: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  olcutAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  olcutYon: { fontSize: 11, fontWeight: "700", color: renk.pasif, marginTop: 1 },
  olcutPuan: { fontSize: 20, fontWeight: "800" },
  olcutRef: { fontSize: 11, fontWeight: "700", color: renk.pasif },

  olcek: { height: 26, justifyContent: "center", marginHorizontal: 4 },
  hat: { height: 6, borderRadius: 3, overflow: "hidden" },
  hatUc: { position: "absolute", top: 0, bottom: 0, width: "40%" },
  isaret: { position: "absolute", top: 0, width: 2, height: 24, backgroundColor: "#9aa3ad" },
  isaretYazi: {
    position: "absolute",
    top: -15,
    left: -60,
    width: 120,
    textAlign: "center",
    fontSize: 9.5,
    fontWeight: "800",
    color: renk.pasif,
  },
  nokta: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  olcekAlt: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  olcekUc: { fontSize: 11, color: renk.pasif },
  olcekSen: { fontSize: 12, color: renk.pasif },

  mesaj: { marginTop: 10, borderRadius: 12, padding: 10 },
  mesajYazi: { fontSize: 12.5, lineHeight: 18 },

  kart: { backgroundColor: renk.beyaz, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: renk.cizgi },
  grafik: { flexDirection: "row", alignItems: "flex-end", height: 130, gap: 6 },
  sutunSarmal: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  sutun: { width: "70%", borderRadius: 6, backgroundColor: "#cfe3aa" },
  sutunDeger: { fontSize: 10, fontWeight: "800", color: renk.pasif, marginBottom: 2 },
  sutunAy: { fontSize: 10, fontWeight: "700", color: renk.pasif, marginTop: 4 },

  altBilgi: { fontSize: 12, color: renk.pasif, textAlign: "center", lineHeight: 18, marginTop: 16, paddingHorizontal: 8 },

  sayfaUst: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  sayfaBaslik: { flex: 1, fontSize: 18, fontWeight: "800", color: renk.metin },
  kapat: { fontSize: 14, fontWeight: "700", color: renk.pasif },
  ayrintiKutular: { flexDirection: "row", gap: 10, marginBottom: 10 },
  ayrintiKutu: {
    flex: 1,
    backgroundColor: renk.zemin,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  ayrintiDeger: { fontSize: 22, fontWeight: "800", color: renk.metin },
  ayrintiEt: { fontSize: 11.5, fontWeight: "700", color: renk.pasif, marginTop: 2 },
  ayrintiNot: { fontSize: 12.5, color: renk.pasif, lineHeight: 18, marginTop: 14 },
});

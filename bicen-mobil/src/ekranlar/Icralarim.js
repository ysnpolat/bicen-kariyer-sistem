/**
 * İcralarım (1.11 · 30.10.2026)
 * ---------------------------------------------------------------------------
 * Personelin KENDİ icra / nafaka dosyaları: sıra, alacaklı, icra dairesi,
 * toplam / ödenen / kalan borç, bu ayki kesinti ve geçmiş kesintiler.
 *
 * Sunucu sicili jetondan alır; ekran sicil göndermez. Net maaş, icra
 * dairesinin hesap bilgisi ve İK notları burada gösterilmez. Modül yalnız
 * icra dosyası olan personelde kendiliğinden görünür; portaldan grup ya da
 * kişiye açılıp kapatılabilir ("icralarim").
 */

import { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { icralarimAl } from "../api";
import { renk } from "../tema";
import BarBaslik from "../bilesenler/BarBaslik";
import { Yukleniyor, Hata, Rozet, Bilgi } from "../bilesenler/Ortak";

const lira = (v) => `₺${Number(v ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tarihYaz = (t) => {
  if (!t) return "—";
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

const DURUM = {
  acik: ["yesil", "Devam ediyor"], askida: ["turuncu", "Askıda"], kapandi: ["gri", "Kapandı"], feragat: ["mor", "Feragat"], iptal: ["gri", "İptal"],
};

function Dosya({ d }) {
  const [tur, ad] = DURUM[d.durum] ?? ["gri", d.durumAdi];
  const nafaka = d.tur === "nafaka";
  const yuzde = !nafaka && d.toplamBorc > 0 ? Math.min(100, Math.round((d.odenen / d.toplamBorc) * 100)) : 0;
  const acik = d.durum === "acik";
  return (
    <View style={[s.kart, acik && d.sira === 1 && !nafaka && s.kartOn, nafaka && acik && s.kartNafaka]}>
      <View style={s.kartUst}>
        <View style={[s.sira, nafaka ? s.siraNafaka : acik && d.sira === 1 ? s.siraOn : null]}>
          <Text style={[s.siraYazi, (nafaka || (acik && d.sira === 1)) && { color: "#fff" }]}>{nafaka ? "N" : acik ? d.sira || "—" : "—"}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kartBaslik} numberOfLines={1}>{d.alacakli || d.turAdi}</Text>
          <Text style={s.kucuk} numberOfLines={1}>{[d.icraDairesi, d.esasNo].filter(Boolean).join(" · ") || d.dosyaNo}</Text>
        </View>
        <Rozet metin={ad} tur={tur} />
      </View>

      <Text style={s.siraNot}>
        {nafaka ? "Nafaka · öncelikli; aylık tutarın tamamı kesilir"
          : !acik ? `${d.durumAdi}`
          : d.sira === 1 ? "1. sıra · kesinti bu dosyaya yapılıyor"
          : `${d.sira}. sıra · önceki dosyalar bitince kesinti bu dosyaya geçer`}
      </Text>

      {nafaka ? (
        <View style={s.uclu}>
          <View style={s.uc}><Text style={s.ucE}>Aylık</Text><Text style={s.ucD}>{lira(d.aylikTutar)}</Text></View>
          <View style={s.uc}><Text style={s.ucE}>Toplam kesilen</Text><Text style={s.ucD}>{lira(d.kesilen)}</Text></View>
          <View style={s.uc}><Text style={s.ucE}>Tebliğ</Text><Text style={s.ucD}>{tarihYaz(d.tebligTarihi)}</Text></View>
        </View>
      ) : (
        <>
          <View style={s.uclu}>
            <View style={s.uc}><Text style={s.ucE}>Toplam borç</Text><Text style={s.ucD}>{lira(d.toplamBorc)}</Text></View>
            <View style={s.uc}><Text style={s.ucE}>Ödenen</Text><Text style={[s.ucD, { color: renk.yesilKoyu }]}>{lira(d.odenen)}</Text></View>
            <View style={s.uc}><Text style={s.ucE}>Kalan</Text><Text style={[s.ucD, { color: renk.turuncuKoyu }]}>{lira(d.kalan)}</Text></View>
          </View>
          <View style={s.cubuk}><View style={[s.cubukDolu, { width: `${yuzde}%` }]} /></View>
          <Text style={s.kucuk}>%{yuzde} ödendi · tebliğ {tarihYaz(d.tebligTarihi)}{d.buAy != null ? ` · bu ay ${lira(d.buAy)}` : ""}</Text>
        </>
      )}
    </View>
  );
}

export default function Icralarim() {
  const [veri, setVeri] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await icralarimAl());
      setHata("");
    } catch (h) {
      setHata(h.message);
    } finally {
      setYukleniyor(false);
      setYenileniyor(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { getir(); }, [getir]));

  if (yukleniyor) return <Yukleniyor />;
  if (hata && !veri) return <Hata metin={hata} />;

  const dosyalar = veri?.dosyalar ?? [];
  const acik = dosyalar.filter((d) => d.durum === "acik");
  const kapanan = dosyalar.filter((d) => d.durum !== "acik");
  const buAy = veri?.buAy ?? { nafaka: 0, icra: 0, toplam: 0 };
  const gecmis = veri?.gecmis ?? [];

  return (
    <SafeAreaView style={s.tam} edges={["top"]}>
      <BarBaslik ad="İcralarım" acik kendi />
      <ScrollView contentContainerStyle={s.govde}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}>

        {dosyalar.length === 0 ? (
          <View style={s.bos}>
            <Text style={s.bosBaslik}>İcra dosyanız yok</Text>
            <Text style={s.bosMetin}>Adınıza gelen bir maaş haczi ya da nafaka kesintisi bulunmuyor.</Text>
          </View>
        ) : (
          <>
            {/* ------------------------------------------------ bu ay */}
            <View style={s.koyu}>
              <Text style={s.koyuEt}>{(veri?.donemAdi ?? "BU AY").toLocaleUpperCase("tr")} KESİNTİSİ</Text>
              <Text style={s.koyuTutar}>{lira(buAy.toplam)}</Text>
              <Text style={s.koyuAlt}>
                {buAy.nafaka > 0 ? `Nafaka ${lira(buAy.nafaka)} · ` : ""}İcra {lira(buAy.icra)}{buAy.kesin ? "" : " · tahmini"}
              </Text>
              <Text style={s.koyuAlt2}>
                {acik.filter((d) => d.tur === "icra").length} icra · {acik.filter((d) => d.tur === "nafaka").length} nafaka dosyası açık · oran %{veri?.oranYuzde ?? 25}
              </Text>
            </View>

            {/* ------------------------------------------------ dosyalar */}
            <Text style={s.baslik}>Açık dosyalar</Text>
            {acik.length === 0 ? <Text style={s.kucuk}>Açık dosya yok.</Text> : acik.map((d) => <Dosya key={d.id} d={d} />)}

            {kapanan.length > 0 ? (
              <>
                <Text style={s.baslik}>Kapanan dosyalar</Text>
                {kapanan.map((d) => <Dosya key={d.id} d={d} />)}
              </>
            ) : null}

            {/* ------------------------------------------------ geçmiş */}
            {gecmis.length > 0 ? (
              <>
                <Text style={s.baslik}>Kesinti geçmişi</Text>
                <View style={s.liste}>
                  {gecmis.map((k, i) => (
                    <View key={i} style={[s.satir, i === gecmis.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.satirBaslik}>{k.donemAdi}</Text>
                        <Text style={s.kucuk} numberOfLines={1}>{k.turAdi} · {k.alacakli || k.dosyaNo}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={s.satirTutar}>{lira(k.tutar)}</Text>
                        <Text style={[s.kucuk, k.odendi && { color: renk.yesilKoyu }]}>{k.odendi ? `ödendi ${tarihYaz(k.odemeTarihi)}` : "kesildi"}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <Bilgi>{veri?.aciklama ?? "Sorularınız için İnsan Kaynakları'na başvurabilirsiniz."}</Bilgi>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tam: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 14, gap: 12, paddingBottom: 40 },
  bos: { alignItems: "center", padding: 40, gap: 8 },
  bosBaslik: { fontSize: 18, fontWeight: "700", color: renk.metin },
  bosMetin: { fontSize: 13, color: renk.pasif, textAlign: "center" },
  koyu: { backgroundColor: renk.siyah, borderRadius: 18, padding: 18 },
  koyuEt: { color: "#9aa3ad", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  koyuTutar: { color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 6 },
  koyuAlt: { color: "#d7dbe0", fontSize: 13, marginTop: 4 },
  koyuAlt2: { color: "#9aa3ad", fontSize: 12, marginTop: 8 },
  baslik: { fontSize: 13, fontWeight: "800", color: renk.pasif, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6, marginLeft: 2 },
  kart: { backgroundColor: renk.beyaz, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: renk.cizgi },
  kartOn: { borderColor: renk.yesil },
  kartNafaka: { borderColor: renk.turuncu },
  kartUst: { flexDirection: "row", gap: 10, alignItems: "center" },
  sira: { width: 36, height: 36, borderRadius: 11, backgroundColor: renk.zemin, alignItems: "center", justifyContent: "center" },
  siraOn: { backgroundColor: renk.yesil },
  siraNafaka: { backgroundColor: renk.turuncu },
  siraYazi: { fontSize: 17, fontWeight: "800", color: renk.metin },
  kartBaslik: { fontSize: 15, fontWeight: "700", color: renk.metin },
  siraNot: { fontSize: 12.5, color: renk.metin, backgroundColor: renk.zemin, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  uclu: { flexDirection: "row", gap: 8 },
  uc: { flex: 1 },
  ucE: { fontSize: 10.5, color: renk.pasif, fontWeight: "700", textTransform: "uppercase" },
  ucD: { fontSize: 14, fontWeight: "800", color: renk.metin, marginTop: 2 },
  cubuk: { height: 6, borderRadius: 3, backgroundColor: renk.zemin, overflow: "hidden" },
  cubukDolu: { height: "100%", backgroundColor: renk.yesil, borderRadius: 3 },
  kucuk: { fontSize: 12, color: renk.pasif },
  liste: { backgroundColor: renk.beyaz, borderRadius: 16, borderWidth: 1, borderColor: renk.cizgi, paddingHorizontal: 14 },
  satir: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: renk.cizgi },
  satirBaslik: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  satirTutar: { fontSize: 14, fontWeight: "800", color: renk.metin },
});

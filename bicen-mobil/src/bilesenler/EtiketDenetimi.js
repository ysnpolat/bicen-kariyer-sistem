/**
 * Raf etiketi denetimi (26.10.2026)
 * ---------------------------------------------------------------------------
 * Fiyat Kontrol'de etiketin karekodu okununca: etiket kimliğiyle
 * (ETIKET_KAYIT) basıldığı andaki bilgi güncel bilgiyle karşılaştırılır.
 * Değişen alanlar eski → yeni gösterilir; yeni etiketi basılmamışsa
 * personel "etiketi değiştirin" diye uyarılır. SKT kutusu: etikette ya da
 * SKT kontrolünde girilmiş tarih, yaklaşmışsa / geçmişse uyarı.
 */
import { View, Text, StyleSheet } from "react-native";
import { renk } from "../tema";
import Simge from "./Simge";

const tarih = (t, saat = false) => {
  if (!t) return "—";
  const s = String(t);
  const g = `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  return saat && s.length >= 16 ? `${g} ${s.slice(11, 16)}` : g;
};
const para = (d) =>
  d == null ? "—" : `${Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;

const DURUM = {
  guncel: { zemin: renk.yesilAcik, cizgi: "#cfe5a6", yazi: renk.yesilKoyu, baslik: "Etiket güncel", simge: "onay" },
  degisti: { zemin: "#fff1f0", cizgi: "#ffc9c2", yazi: renk.kirmizi, baslik: "Etiketi değiştirin", simge: "uyari" },
  "yenisi-var": { zemin: "#fff7e6", cizgi: "#ffd591", yazi: "#ad4e00", baslik: "Yeni etiketi basılmış", simge: "uyari" },
  iptal: { zemin: "#fff1f0", cizgi: "#ffc9c2", yazi: renk.kirmizi, baslik: "Etiket iptal edilmiş", simge: "uyari" },
};

/** Etiket kaydı karşılaştırması */
export function EtiketKaydiKart({ k }) {
  if (!k) return null;
  const d = DURUM[k.durum] ?? DURUM.guncel;
  const e = k.etiket ?? {};

  return (
    <View style={[s.kart, { backgroundColor: d.zemin, borderColor: d.cizgi }]}>
      <View style={s.ust}>
        <Simge ad={d.simge} boyut={18} renkli={d.yazi} />
        <Text style={[s.baslik, { color: d.yazi }]}>{d.baslik}</Text>
        <Text style={s.no}>#{k.id}</Text>
      </View>

      {k.uyari ? <Text style={[s.uyari, { color: d.yazi }]}>{k.uyari}</Text> : null}

      {(k.degisenler ?? []).length > 0 ? (
        <View style={s.tablo}>
          {k.degisenler.map((x) => (
            <View key={x.alan} style={s.satir}>
              <Text style={s.alanAd}>{x.ad}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.eski}>Etikette: {x.eski}</Text>
                <Text style={s.yeni}>Şimdi: {x.yeni}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {k.yeniEtiket ? (
        <Text style={s.alt}>
          Yeni etiket #{k.yeniEtiket.id} · {tarih(k.yeniEtiket.basim, true)}
          {k.yeniEtiket.basan ? ` · ${k.yeniEtiket.basan}` : ""}
        </Text>
      ) : null}

      {k.sonradanFiyatDegisikligi ? (
        <Text style={s.alt}>Etiketten sonra fiyat değişikliği girilmiş ama fiyat aynı kalmış.</Text>
      ) : null}

      {/* Etiketteki bilgiler */}
      <View style={s.bilgiler}>
        <Bilgi ad="Etiketteki ad" deger={e.urunAdi} genis />
        <Bilgi ad="Fiyat" deger={para(e.fiyat)} />
        <Bilgi ad={e.indirimTuru === "kampanya" ? "Kampanya" : "İndirimli"} deger={e.indirimliFiyat != null ? para(e.indirimliFiyat) : "—"} />
        <Bilgi ad="Menşei" deger={e.mensei} />
        <Bilgi ad="Fiyat değişim" deger={tarih(e.fiyatDegisimTarihi)} />
        {e.skt ? <Bilgi ad="SKT" deger={tarih(e.skt)} /> : null}
        {e.kampanyaBitis ? <Bilgi ad="Kampanya bitiş" deger={tarih(e.kampanyaBitis)} /> : null}
        <Bilgi ad="Basım" deger={`${tarih(k.basim, true)}${k.basan ? ` · ${k.basan}` : ""}`} genis />
      </View>
    </View>
  );
}

function Bilgi({ ad, deger, genis }) {
  return (
    <View style={[s.bilgi, genis && { width: "100%" }]}>
      <Text style={s.bilgiAd}>{ad}</Text>
      <Text style={s.bilgiDeger} numberOfLines={2}>
        {deger || "—"}
      </Text>
    </View>
  );
}

/** SKT kutusu */
export function SktKutu({ skt }) {
  if (!skt) return null;
  const [z, c, y] =
    skt.durum === "gecti"
      ? ["#fff1f0", "#ffc9c2", renk.kirmizi]
      : skt.durum === "yakin"
      ? ["#fff7e6", "#ffd591", "#ad4e00"]
      : [renk.yesilAcik, "#cfe5a6", renk.yesilKoyu];

  return (
    <View style={[s.kart, { backgroundColor: z, borderColor: c }]}>
      <View style={s.ust}>
        <Simge ad={skt.durum === "normal" ? "takvim" : "uyari"} boyut={18} renkli={y} />
        <Text style={[s.baslik, { color: y }]}>SKT {tarih(skt.enYakin)}</Text>
        <Text style={[s.no, { color: y, fontWeight: "800" }]}>
          {skt.kalanGun < 0 ? `${-skt.kalanGun} gün geçti` : skt.kalanGun === 0 ? "bugün" : `${skt.kalanGun} gün kaldı`}
        </Text>
      </View>
      {skt.uyari ? <Text style={[s.uyari, { color: y }]}>{skt.uyari}</Text> : null}
      {skt.etiketSkt ? <Text style={s.alt}>Etikette basılı SKT: {tarih(skt.etiketSkt)}</Text> : null}
      {(skt.partiler ?? []).length > 0 ? (
        <Text style={s.alt}>
          SKT kontrolünde girilen: {skt.partiler.map((p) => `${tarih(p.skt)} (${p.adet} adet)`).join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  kart: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10, gap: 6 },
  ust: { flexDirection: "row", alignItems: "center", gap: 8 },
  baslik: { fontSize: 14.5, fontWeight: "800", flex: 1 },
  no: { fontSize: 11.5, color: renk.pasif, fontWeight: "600" },
  uyari: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  tablo: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  satir: { flexDirection: "row", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#f1f2ee" },
  alanAd: { width: 92, fontSize: 12.5, fontWeight: "800", color: renk.metin },
  eski: { fontSize: 12.5, color: renk.pasif, textDecorationLine: "line-through" },
  yeni: { fontSize: 13, color: renk.metin, fontWeight: "800", marginTop: 1 },
  alt: { fontSize: 12, color: "#475467" },
  bilgiler: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  bilgi: { width: "48.5%", backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  bilgiAd: { fontSize: 10.5, color: renk.pasif, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  bilgiDeger: { fontSize: 13, color: renk.metin, fontWeight: "700", marginTop: 1 },
});

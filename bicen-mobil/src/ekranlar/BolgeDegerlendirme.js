/**
 * Dönemsel değerlendirme · bölge müdürü görünümü (26.10.2026)
 * ---------------------------------------------------------------------------
 * Bölge müdürü sorumlu olduğu şubelerde yapılan değerlendirmeleri görür:
 * şubeler → şubenin personeli → kişinin değerlendirmesi (cevaplarıyla).
 * Yalnız açık (ya da en son) dönem; önceki dönemler İK panelinde.
 * Ekranın gezinmesi EkipDegerlendirme'deki başlık geri düğmesiyle yapılır.
 */

import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from "react-native";

import { bolgeDegerlendirmeAl, bolgeSubeDegerlendirmeAl, bolgeKisiDegerlendirmeAl } from "../api";
import { renk, tarihYaz } from "../tema";
import Simge from "../bilesenler/Simge";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";

const AVATAR = [
  ["#e8f4fb", "#1d8cc9"],
  ["#f2f9e8", "#5f8c10"],
  ["#fdeee8", "#e8481c"],
  ["#fff6dc", "#8a6500"],
  ["#f3edfb", "#7c4dbe"],
  ["#e6f6f3", "#0f766e"],
];

const basHarf = (ad) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

const puanRengi = (p) => (p == null ? renk.pasif : p >= 8 ? renk.yesilKoyu : p >= 6.5 ? renk.yesil : p >= 5 ? "#c8930a" : renk.turuncu);
const sayi = (x) => (x == null ? "—" : String(x).replace(".", ","));

/** Veriyi getirir; aşağı çekince yeniler. */
function useVeri(getir, bag) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setYenileniyor(true);
      try {
        setVeri(await getir());
        setHata("");
      } catch (h) {
        setHata(h.message);
      } finally {
        setYenileniyor(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    bag
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  return { veri, hata, yenileniyor, yenile: () => yukle(true) };
}

/* ========================================================================== */
/* Şubeler                                                                    */
/* ========================================================================== */

export function BolgeSubeler({ sec }) {
  const { veri, hata, yenileniyor, yenile } = useVeri(() => bolgeDegerlendirmeAl(), []);

  if (!veri && hata) return <Hata metin={hata} />;
  if (!veri) return <Yukleniyor />;

  const g = veri.genel ?? {};
  const yuzde = g.kadro ? Math.round((g.yapilan / g.kadro) * 100) : 0;

  return (
    <ScrollView
      contentContainerStyle={s.govde}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor={renk.yesil} />}
    >
      <View style={s.bant}>
        <Text style={s.bantEtiket}>
          {veri.donem ? `${(veri.donem.ad ?? "").toLocaleUpperCase("tr")} DÖNEMİ · BÖLGEM` : "BÖLGEM"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Text style={s.bantBaslik}>
            {g.yapilan ?? 0}
            {g.kadro ? ` / ${g.kadro}` : ""} değerlendirme
          </Text>
          {g.ortalama != null ? (
            <Text style={s.bantPuan}>
              {sayi(g.ortalama)}
              <Text style={s.bantPuanAlt}> /10 ort.</Text>
            </Text>
          ) : null}
        </View>
        {g.kadro ? (
          <View style={s.ilerleme}>
            <View style={[s.ilerlemeDolu, { width: `${yuzde}%` }]} />
          </View>
        ) : null}
        {veri.donem && !veri.donem.acik ? <Text style={s.bantAlt}>Dönem kapandı; son dönemin sonuçları gösteriliyor.</Text> : null}
      </View>

      <Text style={s.grup}>Şubeler · {veri.subeler?.length ?? 0}</Text>
      {(veri.subeler ?? []).map((x) => {
        const y = x.kadro ? Math.round((x.yapilan / x.kadro) * 100) : x.yapilan ? 100 : 0;
        return (
          <TouchableOpacity key={x.sube} style={s.satir} activeOpacity={0.8} onPress={() => sec(x.sube)}>
            <View style={[s.avatar, { backgroundColor: renk.yesilAcik }]}>
              <Simge ad="magaza" renkli={renk.yesilKoyu} boyut={18} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <Text style={s.ad} numberOfLines={1}>
                {x.sube}
              </Text>
              <View style={s.cubuk}>
                <View style={[s.cubukDolu, { width: `${y}%` }]} />
              </View>
              <Text style={s.alt}>
                {x.yapilan}
                {x.kadro ? ` / ${x.kadro}` : ""} değerlendirildi
                {x.enDusuk != null ? ` · en düşük ${x.enDusuk}` : ""}
              </Text>
            </View>
            <Text style={[s.puan, { color: puanRengi(x.ortalama) }]}>{sayi(x.ortalama)}</Text>
            <Simge ad="ok" renkli="#b6bcb0" boyut={16} />
          </TouchableOpacity>
        );
      })}

      {(veri.subeler ?? []).length === 0 ? <Text style={s.bos}>Bölgenizde şube bulunamadı.</Text> : null}
      <Text style={s.dipNot}>Önceki dönemlerin sonuçlarını İnsan Kaynakları görür.</Text>
    </ScrollView>
  );
}

/* ========================================================================== */
/* Şube personeli                                                             */
/* ========================================================================== */

export function BolgeSube({ sube, sec }) {
  const { veri, hata, yenileniyor, yenile } = useVeri(() => bolgeSubeDegerlendirmeAl(sube), [sube]);

  if (!veri && hata) return <Hata metin={hata} />;
  if (!veri) return <Yukleniyor />;

  const kisiler = veri.kisiler ?? [];
  const biten = kisiler.filter((x) => x.durum === "tamam");
  const bekleyen = kisiler.filter((x) => x.durum !== "tamam");

  const Satir = ({ k }) => {
    const [z, r] = AVATAR[kisiler.indexOf(k) % AVATAR.length];
    return (
      /* 27.10.2026: bölge müdürü yalnız puanı görür; personele dokunulmaz, detay açılmaz */
      <View style={s.satir}>
        <View style={[s.avatar, { backgroundColor: z }]}>
          <Text style={[s.avatarYazi, { color: r }]}>{basHarf(k.adSoyad)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.ad} numberOfLines={1}>
            {k.adSoyad}
          </Text>
          <Text style={s.alt} numberOfLines={1}>
            {k.pozisyon}
            {k.kapsam && k.kapsam !== "sube" ? ` · ${k.kapsamAdi}` : ""}
          </Text>
        </View>
        {k.durum === "tamam" ? (
          <Text style={[s.puan, { color: puanRengi(k.puan) }]}>{k.puan}/10</Text>
        ) : (
          <View style={s.rozet}>
            <Text style={s.rozetYazi}>Bekliyor</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={s.govde}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor={renk.yesil} />}
    >
      <View style={s.ozet}>
        <View style={s.ozetKutu}>
          <Text style={s.ozetSayi}>{biten.length}</Text>
          <Text style={s.ozetEtiket}>değerlendirildi</Text>
        </View>
        <View style={s.ozetKutu}>
          <Text style={[s.ozetSayi, bekleyen.length ? { color: renk.turuncu } : null]}>{bekleyen.length}</Text>
          <Text style={s.ozetEtiket}>bekliyor</Text>
        </View>
        <View style={s.ozetKutu}>
          <Text style={s.ozetSayi}>
            {biten.length ? sayi(Math.round((biten.reduce((a, x) => a + (x.puan ?? 0), 0) / biten.length) * 10) / 10) : "—"}
          </Text>
          <Text style={s.ozetEtiket}>ortalama</Text>
        </View>
      </View>

      {biten.length > 0 ? <Text style={s.grup}>Değerlendirilenler · {biten.length}</Text> : null}
      {biten.map((k) => (
        <Satir key={k.kod} k={k} />
      ))}
      {bekleyen.length > 0 ? <Text style={s.grup}>Bekleyenler · {bekleyen.length}</Text> : null}
      {bekleyen.map((k) => (
        <Satir key={k.kod} k={k} />
      ))}
      {kisiler.length === 0 ? <Text style={s.bos}>Bu şubede değerlendirme yok.</Text> : null}
    </ScrollView>
  );
}

/* ========================================================================== */
/* Kişi                                                                       */
/* ========================================================================== */

export function BolgeKisi({ kod }) {
  const { veri, hata } = useVeri(() => bolgeKisiDegerlendirmeAl(kod), [kod]);

  if (!veri && hata) return <Hata metin={hata} />;
  if (!veri) return <Yukleniyor />;

  const k = veri.kisi ?? {};
  const d = veri.degerlendirme;
  const etiket = veri.olcekEtiketleri ?? ["Hiçbir zaman", "Nadiren", "Bazen", "Çoğunlukla", "Her zaman"];

  return (
    <ScrollView contentContainerStyle={s.govde}>
      <View style={s.kart}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[s.avatar, { backgroundColor: renk.yesilAcik, width: 48, height: 48 }]}>
            <Text style={[s.avatarYazi, { color: renk.yesilKoyu }]}>{basHarf(k.adSoyad)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.ad, { fontSize: 16.5 }]}>{k.adSoyad}</Text>
            <Text style={s.alt}>
              {k.pozisyon} · {k.sube}
              {k.girisTarihi ? ` · ${tarihYaz(k.girisTarihi)}'den beri` : ""}
            </Text>
          </View>
        </View>
      </View>

      {!d ? (
        <View style={[s.kart, { alignItems: "center", paddingVertical: 26 }]}>
          <Simge ad="saat" renkli={renk.turuncu} boyut={28} />
          <Text style={[s.ad, { marginTop: 6 }]}>Henüz değerlendirilmedi</Text>
          <Text style={[s.alt, { textAlign: "center" }]}>{veri.donem?.ad} döneminde mağaza müdürü değerlendirince burada görünür.</Text>
        </View>
      ) : (
        <>
          <View style={s.puanKart}>
            <View style={{ flex: 1 }}>
              <Text style={s.bantEtiket}>{(veri.donem?.ad ?? "").toLocaleUpperCase("tr")} · GENEL PUAN</Text>
              <Text style={s.puanBuyuk}>
                {d.genelPuan}
                <Text style={s.bantPuanAlt}> /10</Text>
              </Text>
              {d.soruOrt != null ? <Text style={s.bantAlt}>Soru ortalaması {sayi(d.soruOrt)} / 5</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end", maxWidth: "48%" }}>
              <Text style={s.bantAlt}>Değerlendiren</Text>
              <Text style={[s.bantAlt, { color: "#fff", fontWeight: "800" }]} numberOfLines={2}>
                {d.degerlendiren}
              </Text>
              {d.degerlendirenGorev ? <Text style={s.bantAlt}>{d.degerlendirenGorev}</Text> : null}
              <Text style={s.bantAlt}>{tarihYaz(d.tarih)}</Text>
            </View>
          </View>

          {d.genelAciklama ? (
            <View style={s.kart}>
              <Text style={s.soruBaslik}>Puanın açıklaması</Text>
              <Text style={s.yanit}>{d.genelAciklama}</Text>
            </View>
          ) : null}

          <Text style={s.grup}>Sorular</Text>
          {(d.cevaplar ?? []).map((c, i) =>
            c.tur === "olcek" ? (
              <View key={i} style={s.kart}>
                <Text style={s.soruBaslik}>{c.soru}</Text>
                <View style={{ flexDirection: "row", gap: 5 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <View key={n} style={[s.nokta, n <= (c.puan ?? 0) && { backgroundColor: puanRengi((c.puan ?? 0) * 2) }]} />
                  ))}
                </View>
                <Text style={[s.alt, { color: puanRengi((c.puan ?? 0) * 2), fontWeight: "800" }]}>
                  {c.puan ?? "—"} · {etiket[(c.puan ?? 0) - 1] ?? ""}
                </Text>
              </View>
            ) : (
              <View key={i} style={s.kart}>
                <Text style={s.soruBaslik}>{c.soru}</Text>
                <Text style={s.yanit}>{c.metin || "—"}</Text>
              </View>
            )
          )}
        </>
      )}
      <Text style={s.dipNot}>Değerlendirmeler personelle paylaşılmaz.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  govde: { padding: 14, paddingBottom: 120, gap: 10 },
  bant: { backgroundColor: "#3d5e12", borderRadius: 18, padding: 16, gap: 8, marginBottom: 4 },
  bantEtiket: { color: "#d9ecb8", fontSize: 11.5, fontWeight: "800", letterSpacing: 0.6 },
  bantBaslik: { color: "#fff", fontSize: 18, fontWeight: "800" },
  bantPuan: { color: "#d7f59c", fontSize: 24, fontWeight: "900" },
  bantPuanAlt: { fontSize: 13, fontWeight: "700", color: "#d9ecb8" },
  bantAlt: { color: "#e3ead9", fontSize: 12.5 },
  ilerleme: { height: 8, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  ilerlemeDolu: { height: "100%", borderRadius: 99, backgroundColor: "#d7f59c" },
  grup: { fontSize: 12, fontWeight: "800", color: renk.pasif, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 6, marginLeft: 2 },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef0ea",
  },
  avatar: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avatarYazi: { fontWeight: "800", fontSize: 14 },
  ad: { fontSize: 15, fontWeight: "800", color: renk.metin },
  alt: { fontSize: 12.5, color: renk.pasif, marginTop: 1 },
  puan: { fontSize: 16, fontWeight: "900", minWidth: 34, textAlign: "right" },
  cubuk: { height: 5, borderRadius: 99, backgroundColor: "#eef0ea", overflow: "hidden" },
  cubukDolu: { height: "100%", borderRadius: 99, backgroundColor: renk.yesil },
  rozet: { backgroundColor: "#fdeee8", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  rozetYazi: { color: renk.turuncu, fontSize: 11.5, fontWeight: "800" },

  ozet: { flexDirection: "row", gap: 8 },
  ozetKutu: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#eef0ea", alignItems: "center" },
  ozetSayi: { fontSize: 20, fontWeight: "900", color: renk.metin },
  ozetEtiket: { fontSize: 11.5, color: renk.pasif },

  kart: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#eef0ea", gap: 8 },
  puanKart: { backgroundColor: "#3d5e12", borderRadius: 18, padding: 16, flexDirection: "row", gap: 10 },
  puanBuyuk: { color: "#fff", fontSize: 34, fontWeight: "900", marginVertical: 2 },
  soruBaslik: { fontSize: 14, fontWeight: "800", color: renk.metin, lineHeight: 19 },
  yanit: { fontSize: 14, color: "#344054", lineHeight: 20 },
  nokta: { flex: 1, height: 8, borderRadius: 99, backgroundColor: "#eef0ea" },

  bos: { color: renk.pasif, textAlign: "center", fontSize: 14, marginTop: 20 },
  dipNot: { color: renk.pasif, fontSize: 12, textAlign: "center", marginTop: 10 },
});

/**
 * Fiyat Kontrol › Kampanyalar (26.10.2026; önce "İnsert ürünleri")
 * ---------------------------------------------------------------------------
 * Panelde onaylanmış insert kampanyalarının (Normal İnsert, Haftanın Ürünü,
 * Tamamla Kazan, Pazar Delisi…) şubedeki ürünleri. Fiyatlar, başlangıç ve
 * bitiş tarihleriyle listelenir; seçilen ürünler etiket listesi olarak
 * doğrudan biŞube'ye (Mobilden) gönderilir. Basılı fiyat insert fiyatı,
 * çizili fiyat raf fiyatıdır.
 * Veri: GET /api/FiyatKontrol/Insert (panelin PANEL_INSERT_URUNLERI tablosu)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, RefreshControl, ActivityIndicator } from "react-native";
/* Modal kendi penceresinde açılıyor; dıştaki SafeAreaProvider'ın ölçüleri
   içeri geçmiyor ve iPhone'da başlık durum çubuğunun altında kalıyordu
   (geri düğmesine basılamıyordu). Modal kendi sağlayıcısıyla sarılıyor. */
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";

import { api360 } from "../api360";
import { renk } from "../tema";
import Simge from "../bilesenler/Simge";
import Pencere from "../bilesenler/Pencere";

const para = (d) =>
  d == null ? "—" : `${Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const gunAy = (t) => (t ? `${String(t).slice(8, 10)}.${String(t).slice(5, 7)}` : "");
const aralik = (k) => `${gunAy(k.baslangic)}–${gunAy(k.bitis)}`;

const DURUM = {
  Sürüyor: { zemin: renk.yesilAcik, yazi: renk.yesilKoyu },
  Planlı: { zemin: renk.maviAcik, yazi: renk.mavi },
  "Onay bekliyor": { zemin: "#fff7e6", yazi: "#ad4e00" },
};
const TUR_RENK = {
  "Haftanın Ürünü": "#7c4dbe",
  "Tamamla Kazan": "#0f766e",
  "Pazar Delisi": "#c2410c",
  "Normal İnsert": "#1a4d80",
  "Mağaza Özel İnsert": "#1d8cc9",
  "İndirim Broşürü": "#b4361a",
  "Mağaza İçi Aktivite": "#8a6500",
  Diğer: "#6b7280",
};
const anahtar = (k, u) => `${k.kampanyaNo}|${u.stokKod}`;

export default function InsertUrunleri({ acik, kapat, subeKodu, eposta, gonderildi }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [yenileniyor, setYenileniyor] = useState(false);
  const [suzgec, setSuzgec] = useState("aktif"); // aktif | onay | hepsi
  const [secili, setSecili] = useState({});
  const [acikKampanya, setAcikKampanya] = useState({});
  const [pencere, setPencere] = useState(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const getir = useCallback(async (yenile = false) => {
    if (yenile) setYenileniyor(true);
    try {
      setVeri(await api360.al("/api/FiyatKontrol/Insert"));
      setHata("");
    } catch (e) {
      setHata(e?.message ?? "Kampanyalar alınamadı.");
    } finally {
      setYenileniyor(false);
    }
  }, []);

  useEffect(() => {
    if (acik) getir();
  }, [acik, getir]);

  const kampanyalar = useMemo(() => {
    const l = veri?.kampanyalar ?? [];
    if (suzgec === "aktif") return l.filter((k) => k.durum === "Sürüyor" || k.durum === "Planlı");
    if (suzgec === "onay") return l.filter((k) => k.durum === "Onay bekliyor");
    return l;
  }, [veri, suzgec]);

  const tum = veri?.kampanyalar ?? [];
  const secilenler = tum.flatMap((k) => k.urunler.filter((u) => secili[anahtar(k, u)]).map((u) => ({ k, u })));
  const onayBekleyen = secilenler.some((x) => x.k.durum === "Onay bekliyor");
  const sorunlu = secilenler.filter((x) => x.u.sorunlu).length;

  const degistir = (k, u) => setSecili((o) => ({ ...o, [anahtar(k, u)]: !o[anahtar(k, u)] }));
  const tumunuSec = (k) => {
    const hepsi = k.urunler.every((u) => secili[anahtar(k, u)]);
    setSecili((o) => {
      const n = { ...o };
      k.urunler.forEach((u) => (n[anahtar(k, u)] = !hepsi));
      return n;
    });
  };

  const gonder = async () => {
    setPencere(null);
    setGonderiliyor(true);
    try {
      const c = await api360.gonder("/api/FiyatKontrol/ListeGonder", {
        adres: eposta ?? "",
        subeKodu,
        tur: "insert",
        not: [...new Set(secilenler.map((x) => x.k.kampanyaAdi))].join(", ").slice(0, 380),
        urunler: secilenler.map(({ k, u }) => ({
          barkod: u.barkod,
          stokKod: u.stokKod,
          urunAdi: u.urunAdi,
          rafFiyati: u.rafFiyati,
          insertFiyati: u.insertFiyati,
          indirimYuzde: u.indirimYuzde,
          baslangic: k.baslangic,
          bitis: k.bitis,
          kampanyaNo: k.kampanyaNo,
          kampanyaAdi: k.kampanyaAdi,
          kampanyaTuru: k.kampanyaTuru,
          grupAdi: u.grupAdi,
          kare: u.kare,
          adet: 1,
        })),
      });
      setSecili({});
      gonderildi?.(c, secilenler.length);
    } catch (e) {
      setPencere({ tur: "hata", baslik: "Gönderilemedi", metin: e?.message ?? "Liste gönderilemedi." });
    } finally {
      setGonderiliyor(false);
    }
  };

  const gonderSor = () => {
    const uyarilar = [];
    if (onayBekleyen) uyarilar.push("Bu kampanya henüz tamamlanmadı, fiyatlar değişebilir.");
    if (sorunlu) uyarilar.push(`${sorunlu} üründe raf fiyatı yok ya da insert fiyatı raf fiyatından düşük değil.`);
    setPencere({
      tur: uyarilar.length ? "uyari" : "bilgi",
      baslik: `${secilenler.length} ürün biŞube'ye gönderilsin mi?`,
      metin: `${veri?.sube?.subeAdi ?? ""} şubesinin etiket programına (Mobilden) gidecek. Etikette insert fiyatı basılı, raf fiyatı çizili olur.`,
      satirlar: uyarilar,
      dugmeler: [
        { ad: "Vazgeç", bas: () => setPencere(null), ikincil: true },
        { ad: "Gönder", bas: gonder },
      ],
    });
  };

  return (
    <Modal visible={!!acik} animationType="slide" onRequestClose={kapat} presentationStyle="fullScreen">
      <SafeAreaProvider>
      <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
        <View style={s.bar}>
          <TouchableOpacity onPress={kapat} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} style={s.geri}>
            <Text style={s.kapat}>‹ Geri</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.barBaslik}>Kampanyalar</Text>
            {veri?.sube?.subeAdi ? <Text style={s.barAlt}>{veri.sube.subeAdi}</Text> : null}
          </View>
        </View>

        <View style={s.suzgecler}>
          {[
            ["aktif", "Sürüyor · Planlı"],
            ["onay", "Onay bekliyor"],
            ["hepsi", "Tümü"],
          ].map(([k, ad]) => (
            <TouchableOpacity key={k} style={[s.suzgec, suzgec === k && s.suzgecSecili]} onPress={() => setSuzgec(k)}>
              <Text style={[s.suzgecYazi, suzgec === k && s.suzgecYaziSecili]}>{ad}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={s.govde}
          refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={() => getir(true)} tintColor={renk.yesil} />}
        >
          {!veri && !hata ? <ActivityIndicator color={renk.yesil} style={{ marginTop: 40 }} /> : null}
          {hata ? <Text style={s.hata}>{hata}</Text> : null}
          {veri && !veri.hazir ? <Text style={s.bos}>{veri.mesaj}</Text> : null}
          {veri?.hazir && kampanyalar.length === 0 ? (
            <Text style={s.bos}>{suzgec === "onay" ? "Onay bekleyen kampanya yok." : "Şu an şubenizde kampanya yok."}</Text>
          ) : null}

          {kampanyalar.map((k) => {
            const d = DURUM[k.durum] ?? DURUM.Planlı;
            const acikMi = acikKampanya[k.kampanyaNo] ?? kampanyalar.length <= 3;
            const kSecili = k.urunler.filter((u) => secili[anahtar(k, u)]).length;
            const hepsi = kSecili === k.urunler.length;
            let sonGrup = null;
            return (
              <View key={k.kampanyaNo} style={s.kampanya}>
                <TouchableOpacity
                  style={s.kampanyaUst}
                  activeOpacity={0.8}
                  onPress={() => setAcikKampanya((o) => ({ ...o, [k.kampanyaNo]: !acikMi }))}
                >
                  <View style={[s.turSerit, { backgroundColor: TUR_RENK[k.kampanyaTuru] ?? TUR_RENK.Diğer }]} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={[s.tur, { color: TUR_RENK[k.kampanyaTuru] ?? TUR_RENK.Diğer }]}>{k.kampanyaTuru}</Text>
                    <Text style={s.kampanyaAd}>{k.kampanyaAdi}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <View style={[s.cip, { backgroundColor: d.zemin }]}>
                        <Text style={[s.cipYazi, { color: d.yazi }]}>{k.durum}</Text>
                      </View>
                      <Text style={s.tarih}>{aralik(k)}</Text>
                      <Text style={s.tarih}>· {k.urunler.length} ürün</Text>
                    </View>
                  </View>
                  <Text style={s.ok}>{acikMi ? "▾" : "▸"}</Text>
                </TouchableOpacity>

                {k.durum === "Onay bekliyor" && acikMi ? (
                  <Text style={s.onayUyari}>Kampanya henüz tamamlanmadı; ürün ve fiyatlar değişebilir.</Text>
                ) : null}

                {acikMi ? (
                  <>
                    <TouchableOpacity style={s.tumu} onPress={() => tumunuSec(k)}>
                      <View style={[s.kutu, hepsi && s.kutuSecili]}>{hepsi ? <Text style={s.tik}>✓</Text> : null}</View>
                      <Text style={s.tumuYazi}>{hepsi ? "Seçimi kaldır" : "Tümünü seç"}</Text>
                      {kSecili > 0 && !hepsi ? <Text style={s.tarih}>{kSecili} seçili</Text> : null}
                    </TouchableOpacity>

                    {k.urunler.map((u) => {
                      const sec = !!secili[anahtar(k, u)];
                      const grupBasligi = u.grupAdi && u.grupAdi !== sonGrup ? u.grupAdi : null;
                      sonGrup = u.grupAdi || null;
                      return (
                        <View key={u.stokKod}>
                          {grupBasligi ? <Text style={s.grup}>{grupBasligi}</Text> : null}
                          <TouchableOpacity
                            style={[s.urun, u.sorunlu && s.urunSorunlu, sec && s.urunSecili]}
                            activeOpacity={0.8}
                            onPress={() => degistir(k, u)}
                          >
                            <View style={[s.kutu, sec && s.kutuSecili]}>{sec ? <Text style={s.tik}>✓</Text> : null}</View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={s.urunAd} numberOfLines={2}>
                                {u.kare ? <Text style={s.kare}>{u.kare}. </Text> : null}
                                {u.urunAdi}
                              </Text>
                              <Text style={s.barkod}>{u.barkod || u.stokKod}</Text>
                              {u.sorunlu ? <Text style={s.sorun}>Raf fiyatı yok ya da insert fiyatı raftan düşük değil</Text> : null}
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={s.raf}>{para(u.rafFiyati)}</Text>
                              <Text style={s.insert}>{para(u.insertFiyati)}</Text>
                              {u.indirimYuzde != null ? (
                                <View style={s.yuzde}>
                                  <Text style={s.yuzdeYazi}>%{u.indirimYuzde}</Text>
                                </View>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        {secilenler.length > 0 ? (
          <View style={s.alt}>
            <TouchableOpacity style={[s.gonder, gonderiliyor && { opacity: 0.6 }]} onPress={gonderSor} disabled={gonderiliyor}>
              <Simge ad="gonder" boyut={17} renkli="#fff" />
              <Text style={s.gonderYazi}>
                {gonderiliyor ? "Gönderiliyor…" : `biŞube'ye gönder · ${secilenler.length} ürün`}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Pencere veri={pencere} kapat={() => setPencere(null)} />
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },
  bar: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: renk.cizgi },
  geri: { paddingVertical: 6, paddingRight: 4 },
  kapat: { fontSize: 15, fontWeight: "700", color: renk.yesilKoyu },
  barBaslik: { fontSize: 17, fontWeight: "800", color: renk.metin },
  barAlt: { fontSize: 12, color: renk.pasif },
  suzgecler: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingTop: 10 },
  suzgec: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: "#fff", borderWidth: 1, borderColor: renk.cizgi },
  suzgecSecili: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  suzgecYazi: { fontSize: 12.5, fontWeight: "700", color: renk.pasif },
  suzgecYaziSecili: { color: "#fff" },
  govde: { padding: 14, paddingBottom: 110, gap: 10 },
  hata: { color: renk.kirmizi, textAlign: "center", marginTop: 20 },
  bos: { color: renk.pasif, textAlign: "center", marginTop: 30, fontSize: 14 },

  kampanya: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#eef0ea", overflow: "hidden" },
  kampanyaUst: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  turSerit: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  tur: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  kampanyaAd: { fontSize: 15, fontWeight: "800", color: renk.metin },
  cip: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  cipYazi: { fontSize: 11, fontWeight: "800" },
  tarih: { fontSize: 12, color: renk.pasif, fontWeight: "600" },
  ok: { fontSize: 16, color: renk.pasif, paddingHorizontal: 4 },
  onayUyari: { marginHorizontal: 12, marginBottom: 8, backgroundColor: "#fff7e6", color: "#ad4e00", fontSize: 12.5, fontWeight: "600", padding: 8, borderRadius: 8 },

  tumu: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f2ee" },
  tumuYazi: { fontSize: 13, fontWeight: "700", color: renk.yesilKoyu, flex: 1 },
  grup: { fontSize: 11.5, fontWeight: "800", color: renk.pasif, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2, letterSpacing: 0.3 },
  urun: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f2ee" },
  urunSecili: { backgroundColor: "#f7fbef" },
  urunSorunlu: { backgroundColor: "#fff6f4" },
  kutu: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.8, borderColor: "#c8ccc4", alignItems: "center", justifyContent: "center" },
  kutuSecili: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  tik: { color: "#fff", fontWeight: "900", fontSize: 13, lineHeight: 15 },
  urunAd: { fontSize: 13.5, fontWeight: "700", color: renk.metin },
  kare: { color: renk.pasif, fontWeight: "800" },
  barkod: { fontSize: 11.5, color: renk.pasif, marginTop: 1 },
  sorun: { fontSize: 11.5, color: renk.kirmizi, fontWeight: "700", marginTop: 2 },
  raf: { fontSize: 12, color: renk.pasif, textDecorationLine: "line-through" },
  insert: { fontSize: 16, fontWeight: "900", color: renk.metin },
  yuzde: { backgroundColor: "#fdeee8", borderRadius: 6, paddingHorizontal: 5, marginTop: 2 },
  yuzdeYazi: { color: renk.turuncu, fontSize: 11, fontWeight: "800" },

  alt: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, paddingBottom: 24, backgroundColor: "rgba(244,246,242,0.96)" },
  gonder: { height: 52, borderRadius: 15, backgroundColor: renk.yesil, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  gonderYazi: { color: "#fff", fontSize: 15.5, fontWeight: "800" },
});

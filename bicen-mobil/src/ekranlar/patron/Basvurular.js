/**
 * Patron · Başvurular
 * ---------------------------------------------------------------------------
 * kariyer.bicen.com.tr başvuruları: süreç hunisi (dokununca o aşamaya
 * süzülür), son 14 gün, aday listesi ve aday kartı. Patron adaya karar
 * vermiyor; İK'ya not bırakabiliyor (panelde başvurunun notlarında
 * görünür).
 *
 * Süzgeç ve arama sunucuya gidiyor (liste en çok 100 satır, hepsi
 * gelmiyor). Beklerken eldeki liste istemcide süzülüyor: yazarken sonuç
 * hemen daralıyor, sunucunun cevabı gelince kesinleşiyor.
 *
 * Tarih aralığı (1.6): sayılar, huni, grafik ve liste başvuru tarihine
 * göre o aralıkta gelenler; işe alınanlar işe giriş tarihine göre.
 * "3+ gündür işlemsiz" sayısı şu an.
 */

import { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

import { patronRenk as P } from "../../tema";
import { usePatron, aralikliUc, useAralikVerisi } from "../../patronApi";
import { usePatron360 } from "../../bilesenler/patron/Baglam";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni, seriAdi } from "../../bilesenler/patron/aralik";
import { CubukGrafik } from "../../bilesenler/patron/Grafikler";
import Ikon from "../../bilesenler/patron/Ikon";
import {
  Sayfa,
  AcikUst,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart,
  KartBas,
  Kpi,
  AltYazi,
  Izgara,
  AraKutu,
  Satir,
  Avatar,
  DurumEtiket,
  MiniEtiket,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { sayi, ondalik, kucult, basvuruTon, HUNI_RENK } from "../../bilesenler/patron/bicim";

export default function Basvurular({ route }) {
  const { adayAc } = usePatron360();

  const [durum, setDurum] = useState(null);
  const [ara, setAra] = useState("");
  const [araSunucu, setAraSunucu] = useState("");

  /* Özetten ("23 başvuru işlemsiz") ya da şube detayından ("bu şubeye
     başvurular") gelindiğinde süzgeç parametreden kuruluyor. */
  useEffect(() => {
    const p = route.params;
    if (!p?.t) return;

    setDurum(p.durum ?? null);
    setAra(p.ara ?? "");
    setAraSunucu(p.ara ?? "");
  }, [route.params?.t]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Yazarken her harfte istek gitmesin */
  useEffect(() => {
    const z = setTimeout(() => setAraSunucu(ara.trim().length >= 2 ? ara.trim() : ""), 400);
    return () => clearTimeout(z);
  }, [ara]);

  const aralik = useTarihAraligi();
  const d = usePatron(aralikliUc("Basvurular", { durum, ara: araSunucu }, aralik));

  /* Süzgeç değişince önceki liste kalıyor (istemcide süzülüyor); aralık
     değişince önceki aralığın sayıları soluk */
  const { v, eski: eskiVeri } = useAralikVerisi(d.veri);
  const ar = !!v?.aralik;
  const veriAraligi = v?.aralik ? `${v.aralik.bas}|${v.aralik.bit}` : "-";
  const eski = eskiVeri && veriAraligi !== (aralik.canli ? "-" : `${aralik.bas}|${aralik.bit}`);
  const degisim = ar && v.onceki ? Math.round(((v.toplam - v.onceki) / v.onceki) * 100) : null;

  /* Sunucu cevabı gelene kadar eldeki liste süzülüyor */
  const liste = useMemo(() => {
    const q = kucult(ara.trim());

    return (v?.liste ?? []).filter(
      (b) =>
        (!durum || durum === "islemsiz" || b.durum === durum) &&
        (!q || kucult(`${b.ad} ${b.sube} ${b.poz}`).includes(q))
    );
  }, [v, ara, durum]);

  const huni = v?.huni ?? [];
  const enCok = Math.max(1, ...huni.map((h) => h.adet || 0));

  const son14 = ar ? v.seri ?? [] : (v?.son14 ?? []).map((x) => [x.gun, x.adet]);

  return (
    <Sayfa
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          geri
          baslik="Başvurular"
          alt={v ? (ar ? `kariyer.bicen.com.tr · ${sayi(v.toplam)} başvuru` : `kariyer.bicen.com.tr · ${sayi(v.bugun)} bugün`) : null}
          aralik={aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
        />
      }
    >
      <TarihFiltresi />

      {!v ? (
        d.ilkYukleme ? <IlkYukleme /> : <HataKutu metin={d.hata} yenile={d.yenile} />
      ) : (
        <AralikIcerik eski={eski}>
          {ar ? (
            <Izgara sutun={3}>
              <Kpi
                kucuk
                baslik={v.aralik.ad}
                deger={sayi(v.toplam)}
                alt={
                  degisim === null ? (
                    "başvuru"
                  ) : (
                    <AltYazi parcalar={[[`${degisim >= 0 ? "▲" : "▼"} %${Math.abs(degisim)}`, degisim >= 0 ? "yukari" : "asagi"], " önceki"]} />
                  )
                }
              />
              <Kpi kucuk baslik="İşe alım süresi" deger={v.ortSureGun !== null && v.ortSureGun !== undefined ? `${ondalik(v.ortSureGun)} g` : "—"} alt="ortalama" />
              <Kpi kucuk baslik="İşe alınan" deger={sayi(v.alinan)} alt="işe giriş" />
            </Izgara>
          ) : (
            <Izgara sutun={3}>
              <Kpi kucuk baslik="Bugün" deger={sayi(v.bugun)} alt="başvuru" />
              <Kpi kucuk baslik="İşe alım süresi" deger={v.ortSureGun !== null && v.ortSureGun !== undefined ? `${ondalik(v.ortSureGun)} g` : "—"} alt="ortalama" />
              <Kpi kucuk baslik="Bu ay alınan" deger={sayi(v.buAyAlinan)} alt="işe giriş" />
            </Izgara>
          )}

          {huni.length ? (
            <Kart>
              <KartBas
                baslik={ar ? "Süreç · bu aralıkta gelenler" : "Süreç"}
                bag={durum && durum !== "islemsiz" ? "Temizle" : null}
                bagBas={() => setDurum(null)}
              />
              <View style={s.huni}>
                {huni.map((h, i) => {
                  const aktif = durum === h.durum;
                  const soluk = durum && durum !== "islemsiz" && !aktif;

                  return (
                    <TouchableOpacity
                      key={h.durum}
                      style={s.huniSatir}
                      onPress={() => setDurum(aktif ? null : h.durum)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.huniAd, aktif && s.huniAdAktif]} numberOfLines={1}>
                        {h.durum}
                      </Text>
                      <View style={s.huniBar}>
                        <View
                          style={{
                            width: `${((h.adet || 0) / enCok) * 100}%`,
                            height: "100%",
                            borderRadius: 7,
                            backgroundColor: HUNI_RENK[i % HUNI_RENK.length],
                            opacity: soluk ? 0.35 : 1,
                          }}
                        />
                      </View>
                      <Text style={s.huniSayi}>{sayi(h.adet)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Kart>
          ) : null}

          {son14.length ? (
            <Kart>
              <KartBas baslik={ar ? `Başvurular · ${seriAdi(v.seriBirim)}` : "Son 14 gün"} />
              <CubukGrafik
                veri={son14}
                yuk={120}
                renkli={P.mavi}
                vurgu={!ar || v.aralik?.bugunDahil ? son14.length - 1 : -1}
              />
            </Kart>
          ) : null}

          <AraKutu deger={ara} degistir={setAra} yer="Aday, şube ya da pozisyon" />

          {durum === "islemsiz" ? (
            <TouchableOpacity style={s.suzgec} onPress={() => setDurum(null)} activeOpacity={0.7}>
              <Ikon ad="saat" boyut={15} renkli={P.sari} />
              <Text style={s.suzgecYazi}>{ar ? "3+ gündür işlemsiz · bu aralıkta gelenler" : "3+ gündür işlemsiz olanlar"}</Text>
              <Ikon ad="carpi" boyut={14} renkli={P.ikincil} />
            </TouchableOpacity>
          ) : null}

          <Kart stil={{ paddingVertical: 8 }}>
            {liste.length ? (
              liste.map((b, i) => {
                const tonAd = basvuruTon(b.durum);

                return (
                  <Satir
                    key={b.id}
                    ilk={i === 0}
                    bas={() => adayAc(b.id)}
                    sol={<Avatar fotoUrl={b.fotoUrl} ad={b.ad} tonAd={tonAd} />}
                    baslik={b.ad}
                    ekBaslik={b.eskiCalisan ? <MiniEtiket metin="eski çalışan" tonAd="mor" /> : null}
                    alt={[b.poz, b.sube, b.gun === 0 ? "bugün" : b.gun !== null && b.gun !== undefined ? `${b.gun} gün önce` : null]
                      .filter(Boolean)
                      .join(" · ")}
                    sag={<DurumEtiket metin={b.durum} tonAd={tonAd} />}
                  />
                );
              })
            ) : (
              <BosDurum ikon="kisiEkle" metin={d.guncelleniyor ? "Aranıyor…" : ar ? "Bu aralıkta eşleşen başvuru yok" : "Eşleşen başvuru yok"} />
            )}
          </Kart>
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

const s = StyleSheet.create({
  huni: { gap: 6 },
  huniSatir: { flexDirection: "row", alignItems: "center", gap: 8 },
  huniAd: { width: 112, fontSize: 12.5, color: P.ikincil },
  huniAdAktif: { color: P.metin, fontWeight: "700" },
  huniBar: { flex: 1, height: 22, borderRadius: 7, backgroundColor: P.cizgi2, overflow: "hidden" },
  huniSayi: { width: 36, textAlign: "right", fontSize: 12.5, fontWeight: "700", color: P.metin },
  suzgec: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: P.sariAcik,
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  suzgecYazi: { fontSize: 12.5, fontWeight: "600", color: P.metin },
});

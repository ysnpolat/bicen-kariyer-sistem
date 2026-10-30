/**
 * Patron · Norm kadro
 * ---------------------------------------------------------------------------
 * Norm / mevcut / eksik / fazla, pozisyon bazında eksikler, en uzun
 * süredir doldurulamayan kadrolar ve şubeler. Bölge çipi sunucuya
 * gidiyor (sayılar bölgeye göre yeniden hesaplanıyor).
 *
 * Tarih aralığı (1.6): kadro sayıları şu an (norm ve mevcut bir anın
 * fotoğrafı); aralıkta işe giren ve ayrılanlar ayrı bir kartta, şube
 * satırlarındaki okutma aralığın.
 */

import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";

import { patronRenk as P } from "../../tema";
import { usePatron, useSonVeri, aralikliUc } from "../../patronApi";
import TarihFiltresi from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni } from "../../bilesenler/patron/aralik";
import { OranHalka } from "../../bilesenler/patron/Grafikler";
import {
  Sayfa,
  AcikUst,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart,
  KartBas,
  Cipler,
  SiraSatiri,
  SubeSatiri,
  BolumBaslik,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { sayi, dolulukYuzde, dolulukMetni } from "../../bilesenler/patron/bicim";

export default function Norm({ navigation }) {
  const [bolge, setBolge] = useState(null);

  const aralik = useTarihAraligi();
  const d = usePatron(aralikliUc("Norm", { bolge }, aralik));
  const v = useSonVeri(d.veri);

  /* Bölge listesi Şubeler yanıtından (Özet açılınca önceden yükleniyor) */
  const sb = usePatron(aralikliUc("Subeler", null, aralik));
  const bolgeler = (sb.veri?.bolgeler ?? []).filter(Boolean);

  /* (norm − eksik) ÷ norm: fazlalar başka pozisyonun eksiğini kapatmaz */
  const doluluk = (dolulukYuzde(v) ?? 0) / 100;

  const satirlar = v
    ? [
        ["Norm", v.norm, P.mor],
        ["Mevcut", v.mevcut, P.yesil],
        ["Eksik", v.eksik, P.turuncu],
        ["Fazla", v.fazla, P.mavi],
        ["Raporlu", v.raporlu, P.erik],
      ].filter(([, d2]) => d2 !== null && d2 !== undefined)
    : [];

  const git = (ad) => navigation.navigate("SubeDetay", { ad });

  return (
    <Sayfa
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          geri
          baslik="Norm kadro"
          alt="Mevcut / norm · Mikro'dan · şu an"
          aralik={aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
        />
      }
    >
      <TarihFiltresi />

      {!v ? (
        d.ilkYukleme ? <IlkYukleme /> : <HataKutu metin={d.hata} yenile={d.yenile} />
      ) : (
        <>
          {bolgeler.length ? (
            <Cipler
              secili={bolge}
              sec={setBolge}
              ogeler={[{ anahtar: null, ad: "Tümü" }, ...bolgeler.map((b) => ({ anahtar: b, ad: b }))]}
            />
          ) : null}

          <Kart>
            <View style={s.ozet}>
              <OranHalka oran={doluluk} renkli={P.mor}>
                <Text style={s.halkaDeger}>{dolulukMetni(v)}</Text>
                <Text style={s.halkaAlt}>doluluk</Text>
              </OranHalka>

              <View style={s.liste}>
                {satirlar.map(([ad, deger, r]) => (
                  <View key={ad} style={s.satir}>
                    <View style={[s.kare, { backgroundColor: r }]} />
                    <Text style={s.ad}>{ad}</Text>
                    <Text style={s.deger}>{sayi(deger)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Kart>

          {v.donem && !aralik.canli ? (
            <Kart>
              <KartBas baslik={`Giriş / çıkış · ${v.aralik?.ad ?? aralik.ad}`} />
              <View style={s.donem}>
                <View style={s.donemKutu}>
                  <Text style={[s.donemSayi, { color: P.yesilKoyu }]}>{sayi(v.donem.giris)}</Text>
                  <Text style={s.donemAd}>işe giren</Text>
                </View>
                <View style={s.donemKutu}>
                  <Text style={[s.donemSayi, { color: P.turuncu }]}>{sayi(v.donem.cikis)}</Text>
                  <Text style={s.donemAd}>ayrılan</Text>
                </View>
                <View style={s.donemKutu}>
                  <Text style={s.donemSayi}>
                    {v.donem.giris - v.donem.cikis > 0 ? "+" : ""}
                    {sayi(v.donem.giris - v.donem.cikis)}
                  </Text>
                  <Text style={s.donemAd}>net</Text>
                </View>
              </View>
              {(v.donem.subeler ?? []).map((x, i) => (
                <SiraSatiri
                  key={x.ad}
                  ilk={i === 0}
                  ad={x.ad}
                  alt={`${sayi(x.giris)} giriş · ${sayi(x.cikis)} çıkış`}
                  deger={`${x.giris - x.cikis > 0 ? "+" : ""}${sayi(x.giris - x.cikis)}`}
                  degerRenk={x.giris - x.cikis < 0 ? P.turuncu : x.giris - x.cikis > 0 ? P.yesilKoyu : P.metin}
                  bas={() => git(x.ad)}
                />
              ))}
            </Kart>
          ) : null}

          <Kart>
            <KartBas baslik="Pozisyon bazında eksik" />
            {(v.pozisyonlar ?? []).length ? (
              [...v.pozisyonlar]
                .sort((a, b) => (b.adet || 0) - (a.adet || 0))
                .map((x, i) => {
                  const sb2 = x.subeler ?? [];

                  return (
                    <SiraSatiri
                      key={x.poz}
                      ilk={i === 0}
                      ad={x.poz}
                      alt={`${sb2.slice(0, 3).join(", ")}${sb2.length > 3 ? ` +${sb2.length - 3}` : ""}`}
                      deger={sayi(x.adet)}
                      degerRenk={P.turuncu}
                    />
                  );
                })
            ) : (
              <BosDurum ikon="tik" metin="Eksik pozisyon yok" />
            )}
          </Kart>

          {(v.fazlaPozisyonlar ?? []).length ? (
            <Kart>
              <KartBas baslik="Pozisyon bazında fazla" />
              {[...v.fazlaPozisyonlar]
                .sort((a, b) => (b.adet || 0) - (a.adet || 0))
                .map((x, i) => {
                  const sb2 = x.subeler ?? [];

                  return (
                    <SiraSatiri
                      key={x.poz}
                      ilk={i === 0}
                      ad={x.poz}
                      alt={`${sb2.slice(0, 3).join(", ")}${sb2.length > 3 ? ` +${sb2.length - 3}` : ""}`}
                      deger={`+${sayi(x.adet)}`}
                      degerRenk={P.mavi}
                    />
                  );
                })}
            </Kart>
          ) : null}

          {(v.uzunBos ?? []).length ? (
            <Kart>
              <KartBas baslik="En uzun süredir boş" />
              {v.uzunBos.map((x, i) => {
                const g = Number(x.gun) || 0;

                return (
                  <SiraSatiri
                    key={`${x.sube}-${x.poz}-${i}`}
                    ilk={i === 0}
                    ad={`${x.sube} · ${x.poz}`}
                    alt={`${sayi(x.adet)} kişi`}
                    oran={Math.min(100, g * 3)}
                    cubukRenk={g > 20 ? P.turuncu : g > 10 ? P.sari : P.yesil}
                    deger={x.gun !== null && x.gun !== undefined ? `${g} g` : "—"}
                    degerRenk={g > 20 ? P.turuncu : P.metin}
                    bas={() => git(x.sube)}
                  />
                );
              })}
            </Kart>
          ) : null}

          {(v.subeler ?? []).length ? (
            <>
              <BolumBaslik>Şubeler</BolumBaslik>
              {[...v.subeler]
                .sort((a, b) => (b.eksik || 0) - (a.eksik || 0))
                .map((x) => (
                  <SubeSatiri key={x.ad} sube={x} bas={() => git(x.ad)} />
                ))}
            </>
          ) : null}
        </>
      )}
    </Sayfa>
  );
}

const s = StyleSheet.create({
  ozet: { flexDirection: "row", alignItems: "center", gap: 16 },
  halkaDeger: { fontSize: 26, fontWeight: "800", color: P.metin, letterSpacing: -0.6 },
  halkaAlt: { fontSize: 11, color: P.soluk, marginTop: 2 },
  liste: { flex: 1, gap: 7 },
  satir: { flexDirection: "row", alignItems: "center", gap: 8 },
  kare: { width: 9, height: 9, borderRadius: 3 },
  ad: { flex: 1, fontSize: 13, color: P.ikincil },
  deger: { fontSize: 13, fontWeight: "700", color: P.metin },

  donem: { flexDirection: "row", gap: 8, marginBottom: 6 },
  donemKutu: { flex: 1, backgroundColor: P.zemin, borderRadius: 13, paddingVertical: 9, paddingHorizontal: 11 },
  donemSayi: { fontSize: 19, fontWeight: "800", color: P.metin },
  donemAd: { fontSize: 11, color: P.soluk },
});

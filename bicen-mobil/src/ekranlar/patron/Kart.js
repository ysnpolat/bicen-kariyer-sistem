/**
 * Patron · Biçen Kart
 * ---------------------------------------------------------------------------
 * Personel puan kartı: toplam bakiye, bugünkü ve aylık harcama, puan
 * yükleme onayı, ayrılan personele gönderilen kart bağlantıları, en çok
 * harcanan şubeler ve son işlemler. Panelde karşılığı olmayan alan
 * (null) gelirse o kart çizilmiyor.
 *
 * Tarih aralığı (1.6): yükleme, harcama, grafik, şubeler ve son işlemler
 * seçilen aralığın; toplam bakiye, aktif kart, uygulama oranı, bağlantılar
 * ve bekleyen puan onayı şu an.
 */

import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect, Circle } from "react-native-svg";

import { patronRenk as P } from "../../tema";
import { usePatron, aralikliUc, useAralikVerisi } from "../../patronApi";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni, seriAdi } from "../../bilesenler/patron/aralik";
import { CubukGrafik, Lejant } from "../../bilesenler/patron/Grafikler";
import Ikon from "../../bilesenler/patron/Ikon";
import {
  Sayfa,
  AcikUst,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart as KartKutu,
  KartBas,
  Kpi,
  Izgara,
  BilgiIzgara,
  SiraSatiri,
  Satir,
  SimgeKutu,
  SagDeger,
} from "../../bilesenler/patron/Parcalar";
import { sayi, kisa, lira } from "../../bilesenler/patron/bicim";

const yok = (x) => x === null || x === undefined;

export default function Kart({ navigation }) {
  const aralik = useTarihAraligi();
  const d = usePatron(aralikliUc("Kart", null, aralik));
  const { v, eski } = useAralikVerisi(d.veri);
  const ar = !!v?.aralik;
  const ad = v?.aralik?.ad ?? "";

  return (
    <Sayfa
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          baslik="Biçen Kart"
          alt="Personel puan kartı"
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
          <Kahraman v={v} />

          {v.puanOnay?.adet ? (
            <TouchableOpacity
              style={s.serit}
              onPress={() => navigation.navigate("Onaylar", { tur: "puan", t: Date.now() })}
              activeOpacity={0.8}
            >
              <View style={s.seritSayi}>
                <Ikon ad="kart" boyut={20} renkli="#fff" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.seritBaslik}>Puan yüklemesi onay bekliyor</Text>
                {v.puanOnay.aciklama ? (
                  <Text style={s.seritAlt} numberOfLines={1}>
                    {v.puanOnay.aciklama}
                  </Text>
                ) : null}
              </View>
              <Ikon ad="ok" boyut={18} renkli={P.erik} />
            </TouchableOpacity>
          ) : null}

          {ar ? (
            <Izgara>
              <Kpi ikon="giris" tonAd="yesil" baslik={`Yüklenen · ${ad}`} deger={kisa(v.yuklenen)} alt="puan" />
              <Kpi
                ikon="cikis"
                tonAd="turuncu"
                baslik={`Harcanan · ${ad}`}
                deger={kisa(v.harcanan)}
                alt={`₺ · ${sayi(v.islem)} işlem`}
              />
            </Izgara>
          ) : null}

          {ar && v.seri?.length ? (
            <KartKutu>
              <KartBas baslik={`Harcama · ${seriAdi(v.seriBirim)}`} />
              <CubukGrafik
                veri={v.seri.map(([e, t]) => [e, Math.round((Number(t) || 0) / 1000)])}
                yuk={130}
                renkli={P.erik}
                vurgu={v.aralik?.bugunDahil ? v.seri.length - 1 : -1}
              />
              <Lejant ogeler={[[P.erik, v.aralik?.bugunDahil ? "bin ₺ · bugün sürüyor" : "bin ₺"]]} />
            </KartKutu>
          ) : null}

          {!ar && (!yok(v.ayYuklenen) || !yok(v.ayHarcanan)) ? (
            <Izgara>
              {!yok(v.ayYuklenen) ? (
                <Kpi ikon="giris" tonAd="yesil" baslik="Bu ay yüklenen" deger={kisa(v.ayYuklenen)} alt="puan" />
              ) : null}
              {!yok(v.ayHarcanan) ? (
                <Kpi ikon="cikis" tonAd="turuncu" baslik="Bu ay harcanan" deger={kisa(v.ayHarcanan)} alt="₺ · mağaza kasalarında" />
              ) : null}
            </Izgara>
          ) : null}

          {!ar && v.gunluk?.length ? (
            <KartKutu>
              <KartBas baslik={`Günlük harcama · ${v.gunluk.length} gün`} />
              <CubukGrafik
                veri={v.gunluk.map((x) => [x.gun, Math.round((Number(x.tutar) || 0) / 1000)])}
                yuk={130}
                renkli={P.erik}
                vurgu={v.gunluk.length - 1}
              />
              <Lejant ogeler={[[P.erik, "bin ₺ · bugün sürüyor"]]} />
            </KartKutu>
          ) : null}

          {v.baglanti ? (
            <KartKutu>
              <KartBas baslik="Kart bağlantıları" sag={<Text style={s.soluk}>SMS ile gönderilen</Text>} />
              <BilgiIzgara
                sutun={3}
                ogeler={[
                  ["Gönderildi", sayi(v.baglanti.gonderildi)],
                  ["Kullandı", sayi(v.baglanti.kullandi), P.yesilKoyu],
                  ["Süresi doldu", sayi(v.baglanti.suresiDoldu), P.turuncu],
                ]}
              />
              <Text style={s.not}>Ayrılan personele 30 gün geçerli kart bağlantısı gönderilir.</Text>
            </KartKutu>
          ) : null}

          {v.subeler?.length ? (
            <KartKutu>
              <KartBas baslik={`En çok harcanan şubeler · ${ar ? ad : "bugün"}`} />
              {v.subeler.slice(0, 5).map((x, i, l) => {
                const enCok = Math.max(1, ...l.map((y) => Number(y.tutar) || 0));

                return (
                  <SiraSatiri
                    key={x.ad}
                    ilk={i === 0}
                    no={i + 1}
                    ad={x.ad}
                    oran={((Number(x.tutar) || 0) / enCok) * 100}
                    cubukRenk={P.erik}
                    deger={lira(x.tutar)}
                    bas={() => navigation.navigate("SubeDetay", { ad: x.ad })}
                  />
                );
              })}
            </KartKutu>
          ) : null}

          {v.sonIslemler?.length ? (
            <KartKutu>
              <KartBas baslik="Son işlemler" />
              {v.sonIslemler.map((x, i) => (
                <Satir
                  key={`${x.ad}-${x.saat}-${i}`}
                  ilk={i === 0}
                  sol={<SimgeKutu ikon="kart" tonAd="erik" />}
                  baslik={x.ad}
                  alt={[x.sube ? `${x.sube} kasası` : null, x.kartSon4 ? `•••• ${x.kartSon4}` : null].filter(Boolean).join(" · ")}
                  sag={<SagDeger ust={`−${lira(x.tutar)}`} alt={[x.tarih, x.saat].filter(Boolean).join(" ")} />}
                />
              ))}
            </KartKutu>
          ) : null}
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

/** Koyu yeşil bakiye kartı (tasarımdaki gibi geçişli zemin ve halka) */
function Kahraman({ v }) {
  const [olcu, setOlcu] = useState({ g: 0, y: 0 });

  /* Aralıkta (1.6) üçüncü sayı aralığın harcaması */
  const ar = !!v.aralik;
  const harcama = ar ? v.harcanan : v.bugunHarcama;

  if (yok(v.toplamBakiye) && yok(v.aktifKart) && yok(harcama)) return null;

  return (
    <View style={s.kahraman} onLayout={(e) => setOlcu({ g: e.nativeEvent.layout.width, y: e.nativeEvent.layout.height })}>
      {olcu.g > 0 ? (
        <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width={olcu.g} height={olcu.y}>
          <Defs>
            <LinearGradient id="kartZemin" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#1c2a12" />
              <Stop offset="1" stopColor="#3f6507" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={olcu.g} height={olcu.y} rx="20" fill="url(#kartZemin)" />
          <Circle cx={olcu.g + 40} cy={40} r={70} fill="rgba(164,214,74,0.18)" />
        </Svg>
      ) : null}

      <Text style={s.kahramanAlt}>Personeldeki toplam bakiye{ar ? " · şu an" : ""}</Text>
      <Text style={s.kahramanDeger}>{lira(v.toplamBakiye)}</Text>

      <View style={s.kahramanSira}>
        {[
          [sayi(v.aktifKart), "aktif kart", v.aktifKart],
          [`%${sayi(v.uygulamaOrani)}`, "uygulamadan", v.uygulamaOrani],
          [ar ? kisa(harcama) + " ₺" : lira(harcama), ar ? `harcanan · ${(v.aralik.ad ?? "").toLocaleLowerCase("tr-TR")}` : "bugün harcanan", harcama],
        ]
          .filter(([, , ham]) => !yok(ham))
          .map(([deger, ad]) => (
            <View key={ad}>
              <Text style={s.kahramanSayi}>{deger}</Text>
              <Text style={s.kahramanAd}>{ad}</Text>
            </View>
          ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  kahraman: { borderRadius: 20, padding: 16, marginBottom: 12, overflow: "hidden", backgroundColor: "#2b4a0d" },
  kahramanAlt: { color: "rgba(255,255,255,0.7)", fontSize: 12.5 },
  kahramanDeger: { color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.6, marginTop: 2, marginBottom: 10 },
  kahramanSira: { flexDirection: "row", gap: 18, flexWrap: "wrap" },
  kahramanSayi: { color: "#fff", fontSize: 16, fontWeight: "800" },
  kahramanAd: { color: "rgba(255,255,255,0.85)", fontSize: 12.5 },

  serit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: P.erikAcik,
    borderWidth: 1,
    borderColor: "#f1c6e2",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  seritSayi: { width: 42, height: 42, borderRadius: 13, backgroundColor: P.erik, alignItems: "center", justifyContent: "center" },
  seritBaslik: { fontSize: 14.5, fontWeight: "700", color: P.metin },
  seritAlt: { fontSize: 12, color: P.ikincil },

  soluk: { fontSize: 11.5, color: P.soluk },
  not: { fontSize: 12, color: P.soluk, marginTop: 2 },
});

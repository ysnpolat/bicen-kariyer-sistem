/**
 * Patron · Şube detayı
 * ---------------------------------------------------------------------------
 * Bir şubenin bugünü (saat saat okutma, kim içeride, kim okutmadı),
 * pozisyon bazında kadrosu ve ekibi. Müdür tek dokunuşla aranabiliyor
 * ya da mesaj atılabiliyor.
 *
 * Ekran sekme gezgininde tek örnek: farklı şubeye geçildiğinde iç durum
 * (seçili sekme) sıfırlansın diye içerik şube adıyla anahtarlanıyor.
 *
 * Tarih aralığı (1.6): "Bugün" sekmesi "Dönem" oluyor — aralıkta okutan /
 * hiç okutmayan, gün gün okutan, saat saat ilk giriş (günlük ortalama) ve
 * ekibin aralıkta kaç gün okuttuğu. Kadro şu an.
 */

import { useState } from "react";
import { Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { patronRenk as P } from "../../tema";
import { usePatron, aralikliUc, useAralikVerisi } from "../../patronApi";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni, seriAdi } from "../../bilesenler/patron/aralik";
import { usePatron360, iletisim } from "../../bilesenler/patron/Baglam";
import { CubukGrafik } from "../../bilesenler/patron/Grafikler";
import {
  Sayfa,
  AcikUst,
  UstDugme,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart,
  Kpi,
  AltYazi,
  Izgara,
  Sekmeler,
  SiraSatiri,
  KisiSatiri,
  UyariKutu,
  Dugme,
  Dugmeler,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { sayi, oranRenk, ilkAd } from "../../bilesenler/patron/bicim";

/* Bugün sekmesinde okutmayanlar önce: patronun bakmak istediği onlar */
const DURUM_SIRA = { yok: 0, magaza: 1, cikti: 2, okuttu: 2, izin: 3, rapor: 4 };

export default function SubeDetay({ route }) {
  const ad = route.params?.ad ?? null;

  return <Icerik key={ad ?? "-"} ad={ad} />;
}

function Icerik({ ad }) {
  /* Anahtarlı iç bileşen: gezgin prop olarak gelmiyor, kancayla alınıyor */
  const navigation = useNavigation();
  const { tost, personelAc } = usePatron360();
  const aralik = useTarihAraligi();
  const d = usePatron(ad ? aralikliUc("Sube", { ad }, aralik) : null);
  const [sekme, setSekme] = useState("bugun");

  const { v, eski } = useAralikVerisi(d.veri);
  const ar = !!v?.aralik;
  const cokGun = ar && (v.aralik?.gun ?? 1) > 1;
  const ekip = v?.ekip ?? [];
  const okutmayan = ekip.filter((x) => x.durum === "yok").length;
  const sirali = [...ekip].sort((a, b) => (DURUM_SIRA[a.durum] ?? 9) - (DURUM_SIRA[b.durum] ?? 9));

  const ara = () => iletisim("tel", v?.mudurTel, tost);
  const mesaj = () => iletisim("sms", v?.mudurTel, tost);

  return (
    <Sayfa
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          geri
          baslik={v?.ad ?? ad ?? "Şube"}
          alt={v ? [v.bolge, v.mudur ? `Md. ${v.mudur}` : null].filter(Boolean).join(" · ") : null}
          aralik={aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
          sag={v?.mudurTel ? <UstDugme ikon="telefon" etiket="Müdürü ara" bas={ara} /> : null}
        />
      }
    >
      <TarihFiltresi />

      {!v ? (
        d.ilkYukleme ? <IlkYukleme /> : <HataKutu metin={d.hata} yenile={d.yenile} />
      ) : (
        <AralikIcerik eski={eski}>
          <Izgara sutun={3}>
            {ar ? (
              <Kpi
                kucuk
                baslik="Okuttu"
                deger={sayi(v.okutan)}
                degerRenk={oranRenk(v.oran)}
                alt={`%${sayi(v.oran)} okutma`}
              />
            ) : (
              <Kpi
                kucuk
                baslik="İçeride"
                deger={sayi(v.iceride)}
                degerRenk={oranRenk(v.oran)}
                alt={`%${sayi(v.oran)} okutma`}
              />
            )}
            <Kpi
              kucuk
              baslik="Kadro"
              deger={`${sayi(v.mevcut)}/${sayi(v.norm)}`}
              alt={v.eksik ? <AltYazi parcalar={[[`${v.eksik} eksik`, "asagi"]]} /> : "tam"}
            />
            <Kpi
              kucuk
              baslik={ar ? "Hiç okutmadı" : "Okutmadı"}
              deger={sayi(ar ? v.okutmadi : Math.max(0, (v.beklenen ?? 0) - (v.iceride ?? 0)))}
              degerRenk={P.turuncu}
              alt={`${sayi(v.beklenen)} beklenen`}
            />
          </Izgara>

          <Kart>
            <Sekmeler
              secili={sekme}
              sec={setSekme}
              ogeler={[
                { anahtar: "bugun", ad: ar ? "Dönem" : "Bugün" },
                { anahtar: "kadro", ad: "Kadro" },
                { anahtar: "ekip", ad: `Ekip · ${ekip.length}` },
              ]}
            />

            {sekme === "bugun" ? (
              <>
                {cokGun && v.seri?.length ? (
                  <>
                    <CubukGrafik veri={v.seri} yuk={120} vurgu={v.aralik?.bugunDahil ? v.seri.length - 1 : -1} />
                    <Text style={s.not}>
                      Okutan kişi · {seriAdi(v.seriBirim)}
                      {v.seriBirim !== "gün" ? " (günlük ortalama)" : ""} · günde ort. {sayi(v.gunlukOrt)}
                      {v.iceride !== null && v.iceride !== undefined ? ` · şu an ${sayi(v.iceride)} içeride` : ""}
                    </Text>
                  </>
                ) : null}

                {v.saatlik?.length ? (
                  <>
                    <CubukGrafik veri={v.saatlik} yuk={120} />
                    <Text style={s.not}>{cokGun ? "Saat saat ilk giriş · günlük ortalama" : "Saat saat okutma (giriş)"}</Text>
                  </>
                ) : null}

                {sirali.slice(0, 8).map((x, i) => (
                  <KisiSatiri key={x.kod ?? `${x.ad}-${i}`} kisi={x} ilk={i === 0} altYazi={x.poz} bas={() => personelAc(x.kod)} />
                ))}

                {ekip.length > 8 ? (
                  <Text style={s.tumu} onPress={() => setSekme("ekip")}>
                    Tüm ekip ({ekip.length}) ›
                  </Text>
                ) : null}

                {okutmayan ? (
                  <UyariKutu
                    metin={
                      ar
                        ? `${okutmayan} kişi bu aralıkta hiç okutmadı`
                        : `${okutmayan} kişi vardiyası başladığı hâlde okutmadı`
                    }
                    stil={{ marginTop: 10 }}
                  />
                ) : null}

                <Dugmeler stil={{ marginTop: 10 }}>
                  <Dugme yazi={v.mudur ? `${ilkAd(v.mudur)} Md. ara` : "Müdürü ara"} ikon="telefon" tur="ikincil" bas={ara} />
                  <Dugme yazi="Mesaj" ikon="mesaj" tur="ikincil" bas={mesaj} />
                </Dugmeler>
              </>
            ) : sekme === "kadro" ? (
              <>
                {(v.kadro ?? []).length ? (
                  v.kadro.map((k, i) => (
                    <SiraSatiri
                      key={`${k.poz}-${i}`}
                      ilk={i === 0}
                      ad={k.poz}
                      alt={
                        k.eksik > 0
                          ? `${k.eksik} eksik${k.gun !== null && k.gun !== undefined ? ` · ${k.gun} gündür` : ""}`
                          : k.mevcut > k.norm
                          ? `+${k.mevcut - k.norm} fazla`
                          : "tam"
                      }
                      oran={k.norm ? Math.min(100, (k.mevcut / k.norm) * 100) : 100}
                      cubukRenk={k.eksik > 0 ? P.turuncu : P.yesil}
                      deger={`${sayi(k.mevcut)}/${sayi(k.norm)}`}
                    />
                  ))
                ) : (
                  <BosDurum ikon="kadro" metin="Norm kadro tanımı yok" />
                )}

                <Dugme
                  yazi="Bu şubeye başvurular"
                  ikon="kisiEkle"
                  tur="ikincil"
                  stil={{ flex: 0, marginTop: 12 }}
                  bas={() => navigation.navigate("Basvurular", { ara: v.ad, durum: null, t: Date.now() })}
                />
              </>
            ) : ekip.length ? (
              ekip.map((x, i) => (
                <KisiSatiri key={x.kod ?? `${x.ad}-${i}`} kisi={x} ilk={i === 0} altYazi={x.poz} bas={() => personelAc(x.kod)} />
              ))
            ) : (
              <BosDurum ikon="ekip" metin="Ekip listesi boş" />
            )}
          </Kart>
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

const s = StyleSheet.create({
  not: { fontSize: 11.5, color: P.soluk, marginTop: 2, marginBottom: 10 },
  tumu: { fontSize: 12.5, fontWeight: "600", color: P.yesilKoyu, textAlign: "center", paddingVertical: 8 },
});

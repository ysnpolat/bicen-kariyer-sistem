/**
 * Patron · Şubeler
 * ---------------------------------------------------------------------------
 * Bütün birimler: okutma oranı, kadro doluluğu, içerideki / izinli
 * personel. Arama, "kadro eksik" / "okutma düşük" süzgeci ve bölge
 * çipleri istemcide çalışıyor: liste en çok 34–40 satır, her dokunuşta
 * sunucuya gitmek gereksiz bekleme olurdu.
 *
 * Tarih aralığı (1.6) sunucuya gidiyor: kadro şu an, okutma oranı ve
 * izin/rapor sayıları seçilen aralık için ("okutma düşük" de ona göre).
 */

import { useMemo, useState } from "react";

import { usePatron, aralikliUc, useAralikVerisi } from "../../patronApi";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni } from "../../bilesenler/patron/aralik";
import {
  Sayfa,
  AcikUst,
  UstDugme,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  AraKutu,
  Segment,
  Cipler,
  SubeSatiri,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { sayi, kucult } from "../../bilesenler/patron/bicim";

/** Okutma oranı bunun altındaki şubeler "okutma düşük" süzgecinde */
const OKUTMA_SINIRI = 85;

export default function Subeler({ navigation }) {
  const aralik = useTarihAraligi();
  const d = usePatron(aralikliUc("Subeler", null, aralik));
  const { v, eski } = useAralikVerisi(d.veri);

  const [ara, setAra] = useState("");
  const [filtre, setFiltre] = useState("hepsi");
  const [bolge, setBolge] = useState(null);

  const subeler = v?.subeler ?? [];
  const bolgeler = (v?.bolgeler ?? []).filter(Boolean);

  const liste = useMemo(() => {
    const q = kucult(ara.trim());

    let l = subeler.filter(
      (x) =>
        (!bolge || x.bolge === bolge) &&
        (!q || kucult(x.ad).includes(q) || kucult(x.mudur).includes(q))
    );

    if (filtre === "eksik") l = l.filter((x) => x.eksik > 0).sort((a, b) => b.eksik - a.eksik);
    if (filtre === "okutma") l = l.filter((x) => x.oran < OKUTMA_SINIRI).sort((a, b) => a.oran - b.oran);

    return l;
  }, [subeler, ara, filtre, bolge]);

  const calisan = subeler.reduce((t, x) => t + (Number(x.mevcut) || 0), 0);

  return (
    <Sayfa
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          baslik="Şubeler"
          alt={v ? `${subeler.length} birim · ${sayi(calisan)} çalışan` : null}
          aralik={aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
          sag={<UstDugme ikon="ara" etiket="Ara" bas={() => navigation.navigate("Ara")} />}
        />
      }
    >
      <TarihFiltresi />

      {!v ? (
        d.ilkYukleme ? <IlkYukleme /> : <HataKutu metin={d.hata} yenile={d.yenile} />
      ) : (
        <AralikIcerik eski={eski}>
          <AraKutu deger={ara} degistir={setAra} yer="Şube ya da müdür ara" />

          <Segment
            secili={filtre}
            sec={setFiltre}
            ogeler={[
              { anahtar: "hepsi", ad: "Tümü" },
              { anahtar: "eksik", ad: "Kadro eksik", sayi: subeler.filter((x) => x.eksik > 0).length },
              { anahtar: "okutma", ad: "Okutma düşük", sayi: subeler.filter((x) => x.oran < OKUTMA_SINIRI).length },
            ]}
          />

          {bolgeler.length ? (
            <Cipler
              secili={bolge}
              sec={setBolge}
              ogeler={[{ anahtar: null, ad: "Tüm bölgeler" }, ...bolgeler.map((b) => ({ anahtar: b, ad: b }))]}
            />
          ) : null}

          {liste.length ? (
            liste.map((x) => (
              <SubeSatiri key={x.ad} sube={x} bas={() => navigation.navigate("SubeDetay", { ad: x.ad })} />
            ))
          ) : (
            <BosDurum ikon="magaza" metin="Eşleşen şube yok" />
          )}
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

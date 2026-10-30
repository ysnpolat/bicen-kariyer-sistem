/**
 * Patron · Ara
 * ---------------------------------------------------------------------------
 * Personel, şube ve aday araması tek kutuda. Sunucu her gruptan en çok
 * 15 sonuç dönüyor; iki harften kısa aramada istek atılmıyor (bütün
 * şirket listelenirdi).
 */

import { useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";

import { usePatron, useSonVeri, sorgu } from "../../patronApi";
import { usePatron360 } from "../../bilesenler/patron/Baglam";
import {
  Sayfa,
  AcikUst,
  GuncelBilgi,
  AraKutu,
  Kart,
  BolumBaslik,
  SubeSatiri,
  KisiSatiri,
  Satir,
  Avatar,
  DurumEtiket,
  BosDurum,
  IlkYukleme,
} from "../../bilesenler/patron/Parcalar";
import { basvuruTon } from "../../bilesenler/patron/bicim";

export default function Ara() {
  const navigation = useNavigation();
  const { personelAc, adayAc } = usePatron360();

  const [q, setQ] = useState("");
  const [aranan, setAranan] = useState("");

  useEffect(() => {
    const z = setTimeout(() => setAranan(q.trim().length >= 2 ? q.trim() : ""), 300);
    return () => clearTimeout(z);
  }, [q]);

  const d = usePatron(aranan ? `Ara${sorgu({ q: aranan })}` : null, { tazeSure: 60_000 });
  const son = useSonVeri(d.veri);
  const v = aranan ? son : null;

  const subeler = v?.subeler ?? [];
  const personel = v?.personel ?? [];
  const adaylar = v?.adaylar ?? [];
  const bos = v && !subeler.length && !personel.length && !adaylar.length;

  return (
    <Sayfa
      yenile={aranan ? d.yenile : undefined}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          geri
          baslik="Ara"
          alt="Personel, şube ya da aday"
          guncel={aranan ? <GuncelBilgi guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} /> : null}
        />
      }
    >
      <AraKutu deger={q} degistir={setQ} yer="İsim, şube ya da pozisyon yazın" otomatikOdak />

      {!aranan ? (
        <BosDurum ikon="ara" metin="Aramak için en az iki harf yazın" />
      ) : !v ? (
        d.ilkYukleme ? <IlkYukleme /> : <BosDurum ikon="uyari" metin={d.hata || "Arama yapılamadı"} />
      ) : bos ? (
        <BosDurum ikon="ara" metin={`"${aranan}" için sonuç yok`} />
      ) : (
        <>
          {subeler.length ? (
            <>
              <BolumBaslik>Şubeler</BolumBaslik>
              {subeler.map((x) => (
                <SubeSatiri key={x.ad} sube={x} bas={() => navigation.navigate("SubeDetay", { ad: x.ad })} />
              ))}
            </>
          ) : null}

          {personel.length ? (
            <>
              <BolumBaslik>Personel</BolumBaslik>
              <Kart stil={{ paddingVertical: 8 }}>
                {personel.map((x, i) => (
                  <KisiSatiri key={x.kod ?? `${x.ad}-${i}`} ilk={i === 0} kisi={x} bas={() => personelAc(x.kod)} />
                ))}
              </Kart>
            </>
          ) : null}

          {adaylar.length ? (
            <>
              <BolumBaslik>Adaylar</BolumBaslik>
              <Kart stil={{ paddingVertical: 8 }}>
                {adaylar.map((b, i) => {
                  const tonAd = basvuruTon(b.durum);

                  return (
                    <Satir
                      key={b.id}
                      ilk={i === 0}
                      bas={() => adayAc(b.id)}
                      sol={<Avatar fotoUrl={b.fotoUrl} ad={b.ad} tonAd={tonAd} />}
                      baslik={b.ad}
                      alt={[b.poz, b.sube].filter(Boolean).join(" · ")}
                      sag={<DurumEtiket metin={b.durum} tonAd={tonAd} />}
                    />
                  );
                })}
              </Kart>
            </>
          ) : null}
        </>
      )}
    </Sayfa>
  );
}

/**
 * Patron · Geçiş & okutma
 * ---------------------------------------------------------------------------
 * Bugünün okutmaları: içeride / okutmadı / geç kalan, saat saat giriş,
 * canlı akış, okutmayanlar ve şubelerin okutma sıralaması.
 *
 * Ekran açıkken 30 saniyede bir kendiliğinden tazeleniyor (sunucu da
 * aynı süreyle önbelleğe alıyor; daha sık sormak yeni bir şey
 * getirmez). Ekrandan çıkınca duruyor: arka planda pil ve veri harcamasın.
 *
 * Tarih aralığı (1.6): "Bugün" dışında bir aralıkta sayılar o aralık için
 * — en az bir gün okutan, hiç okutmayan, geç kalınan gün, saat saat ilk
 * giriş (günlük ortalama), gün gün okutan ve aralıktaki son okutmalar.
 * "İçeride" yalnızca aralık bugünü kapsıyorsa (şu an). Geçmiş aralık
 * değişmediği için kendiliğinden tazelenmiyor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { patronRenk as P } from "../../tema";
import { usePatron, aralikliUc, useAralikVerisi } from "../../patronApi";
import { usePatron360 } from "../../bilesenler/patron/Baglam";
import { CubukGrafik } from "../../bilesenler/patron/Grafikler";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni, seriAdi } from "../../bilesenler/patron/aralik";
import {
  Sayfa,
  AcikUst,
  UstDugme,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart,
  KartBas,
  Kpi,
  Izgara,
  Segment,
  Satir,
  SimgeKutu,
  Avatar,
  AvatarRozet,
  SagDeger,
  KisiSatiri,
  SiraSatiri,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { sayi, oranRenk } from "../../bilesenler/patron/bicim";

const TAZELEME_MS = 30_000;

const akisAnahtari = (a) => `${a.ad}|${a.tarih ?? ""}|${a.saat}|${a.giris ? 1 : 0}|${a.sube}`;

export default function Gecis({ navigation, route }) {
  const { personelAc } = usePatron360();
  const aralik = useTarihAraligi();

  /* Aralık bugünü kapsıyorsa canlı ekran gibi tazeleniyor */
  const canliMi = aralik.canli || aralik.bugunDahil;

  const d = usePatron(aralikliUc("Gecis", null, aralik), { tazeSure: canliMi ? 25_000 : 120_000 });
  const sb = usePatron(aralikliUc("Subeler", null, aralik));

  const [segment, setSegment] = useState("akis");

  useEffect(() => {
    const p = route.params?.segment;
    if (p === "okutmadi" || p === "sube" || p === "akis") setSegment(p);
  }, [route.params?.segment, route.params?.t]);

  /* Ekran açıkken otomatik tazeleme */
  const { yenile } = d;
  const sbYenile = sb.yenile;

  useFocusEffect(
    useCallback(() => {
      if (!canliMi) return undefined;

      const z = setInterval(() => {
        yenile();
        sbYenile();
      }, TAZELEME_MS);

      return () => clearInterval(z);
    }, [yenile, sbYenile, canliMi])
  );

  const { v, eski } = useAralikVerisi(d.veri);

  /* Yanıt aralıklı mı (önceki aralığın soluk verisi de olabilir) */
  const ar = !!v?.aralik;

  /* Yeni gelen akış satırları kısa süre yeşil zeminle gösteriliyor:
     tazelemeden sonra neyin yeni olduğu başka türlü anlaşılmıyordu. */
  const gorulen = useRef(null);
  const gorulenAralik = useRef(null);
  const [yeniler, setYeniler] = useState(() => new Set());

  useEffect(() => {
    /* Veri gelmeden "görülenler" kurulmuyor: yoksa ilk yüklemede bütün
       satırlar yeni sayılıp yeşil yanıyordu. */
    if (!v?.akis) return undefined;

    const anahtarlar = v.akis.map(akisAnahtari);

    /* Tarih aralığı değişince liste baştan değişiyor; bu "yeni okutma" değil */
    const aralikAnahtari = v.aralik ? `${v.aralik.bas}|${v.aralik.bit}` : "-";

    if (gorulenAralik.current !== aralikAnahtari) {
      gorulenAralik.current = aralikAnahtari;
      gorulen.current = new Set(anahtarlar);
      setYeniler(new Set());
      return undefined;
    }

    if (gorulen.current) {
      const yeni = new Set(anahtarlar.filter((k) => !gorulen.current.has(k)));

      if (yeni.size) {
        setYeniler(yeni);
        const z = setTimeout(() => setYeniler(new Set()), 2500);
        gorulen.current = new Set(anahtarlar);
        return () => clearTimeout(z);
      }
    }

    gorulen.current = new Set(anahtarlar);
    return undefined;
  }, [v]);

  const beklenen = Number(v?.beklenen) || 0;
  const yuzde = ar ? v.oran ?? 0 : beklenen ? Math.round((v.iceride / beklenen) * 100) : 0;
  const okutmayan = v?.okutmayanlar ?? [];
  const cokGun = ar && (v.aralik?.gun ?? 1) > 1;

  const subeler = [...(sb.veri?.subeler ?? [])].filter((x) => x.beklenen > 0).sort((a, b) => a.oran - b.oran);

  return (
    <Sayfa
      yenile={(c) => {
        d.yenile(c);
        sb.yenile();
      }}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          geri
          baslik="Geçiş & okutma"
          alt="Karekod ve iCard"
          aralik={aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
          sag={
            <UstDugme
              ikon="yenile"
              etiket="Yenile"
              bas={() => {
                d.yenile();
                sb.yenile();
              }}
            />
          }
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
                baslik="Okuttu"
                deger={sayi(v.okutan)}
                degerRenk={P.yesilKoyu}
                alt={`%${yuzde} · ${sayi(beklenen)} bekl.`}
              />
              <Kpi kucuk baslik="Hiç okutmadı" deger={sayi(v.okutmadi)} degerRenk={P.turuncu} alt="bu aralıkta" />
              <Kpi
                kucuk
                baslik="Geç kaldı"
                deger={sayi(v.gecKalan)}
                degerRenk={P.sari}
                alt={cokGun ? "kişi·gün, 5 dk+" : "vardiyaya 5 dk+"}
              />
            </Izgara>
          ) : (
            <Izgara sutun={3}>
              <Kpi kucuk baslik="İçeride" deger={sayi(v.iceride)} degerRenk={P.yesilKoyu} alt={`%${yuzde} · ${sayi(beklenen)} bekl.`} />
              <Kpi kucuk baslik="Okutmadı" deger={sayi(v.okutmadi)} degerRenk={P.turuncu} alt="vardiyası başladı" />
              <Kpi kucuk baslik="Geç kaldı" deger={sayi(v.gecKalan)} degerRenk={P.sari} alt="vardiyaya 5 dk+" />
            </Izgara>
          )}

          {ar && v.iceride !== null && v.iceride !== undefined ? (
            <Text style={s.not}>Şu an mağazada {sayi(v.iceride)} kişi · günde ortalama {sayi(v.gunlukOrt)} kişi okuttu</Text>
          ) : ar && cokGun ? (
            <Text style={s.not}>Günde ortalama {sayi(v.gunlukOrt)} kişi okuttu</Text>
          ) : null}

          {cokGun && v.seri?.length ? (
            <Kart>
              <KartBas baslik="Okutan kişi" sag={<Text style={s.etiket}>{seriAdi(v.seriBirim)} · günlük ort.</Text>} />
              <CubukGrafik veri={v.seri} yuk={130} vurgu={v.aralik?.bugunDahil ? v.seri.length - 1 : -1} />
            </Kart>
          ) : null}

          {v.saatlik?.length ? (
            <Kart>
              <KartBas baslik="Saat saat giriş" sag={<Text style={s.etiket}>{cokGun ? "günlük ortalama" : ar ? v.aralik?.ad?.toLocaleLowerCase("tr-TR") : "bugün"}</Text>} />
              <CubukGrafik veri={v.saatlik} yuk={130} />
            </Kart>
          ) : null}

          <Segment
            secili={segment}
            sec={setSegment}
            ogeler={[
              { anahtar: "akis", ad: ar && !v.aralik?.bugunDahil ? "Son okutmalar" : "Canlı akış" },
              { anahtar: "okutmadi", ad: "Okutmadı", sayi: okutmayan.length },
              { anahtar: "sube", ad: "Şubeye göre" },
            ]}
          />

          <Kart stil={{ paddingVertical: 8 }}>
            {segment === "akis" ? (
              (v.akis ?? []).length ? (
                v.akis.map((a, i) => {
                  const k = akisAnahtari(a);

                  return (
                    <Satir
                      key={`${k}-${i}`}
                      ilk={i === 0}
                      /* Fotoğraf varsa kişi, köşede giriş/çıkış; yoksa eskisi gibi yön simgesi */
                      sol={
                        <Avatar
                          fotoUrl={a.fotoUrl}
                          ad={a.ad}
                          yedek={<SimgeKutu ikon={a.giris ? "giris" : "cikis"} tonAd={a.giris ? "yesil" : "gri"} />}
                          rozet={<AvatarRozet ikon={a.giris ? "giris" : "cikis"} tonAd={a.giris ? "yesil" : "gri"} />}
                        />
                      }
                      baslik={a.ad}
                      alt={[a.sube, a.poz, a.kaynak].filter(Boolean).join(" · ")}
                      sag={<SagDeger ust={a.saat} alt={`${a.tarih ? `${a.tarih} · ` : ""}${a.giris ? "giriş" : "çıkış"}`} />}
                      vurgulu={yeniler.has(k)}
                    />
                  );
                })
              ) : (
                <BosDurum ikon="qr" metin={ar ? "Bu aralıkta okutma yok" : "Bugün henüz okutma yok"} />
              )
            ) : segment === "okutmadi" ? (
              okutmayan.length ? (
                okutmayan.map((x, i) => (
                  <KisiSatiri
                    key={x.kod ?? `${x.ad}-${i}`}
                    ilk={i === 0}
                    kisi={{ ...x, durum: "yok" }}
                    bas={() => personelAc(x.kod)}
                  />
                ))
              ) : (
                <BosDurum ikon="tik" metin={ar ? "Bu aralıkta herkes en az bir kez okuttu" : "Vardiyası başlayan herkes okuttu"} />
              )
            ) : subeler.length ? (
              subeler.map((x, i) => (
                <SiraSatiri
                  key={x.ad}
                  ilk={i === 0}
                  no={i + 1}
                  ad={x.ad}
                  alt={[
                    ar ? `${sayi(x.okutan)}/${sayi(x.beklenen)} okuttu` : `${sayi(x.iceride)}/${sayi(x.beklenen)} içeride`,
                    x.bolge,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  oran={x.oran}
                  deger={`%${x.oran}`}
                  degerRenk={oranRenk(x.oran)}
                  bas={() => navigation.navigate("SubeDetay", { ad: x.ad })}
                />
              ))
            ) : (
              <BosDurum ikon="magaza" metin={sb.ilkYukleme ? "Yükleniyor…" : "Şube verisi yok"} />
            )}
          </Kart>
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

const s = StyleSheet.create({
  etiket: { fontSize: 11.5, color: P.soluk },
  not: { fontSize: 12, color: P.ikincil, marginTop: -4, marginBottom: 12, marginHorizontal: 4 },
});

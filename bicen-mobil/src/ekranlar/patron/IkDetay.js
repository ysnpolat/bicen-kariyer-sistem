/**
 * Patron · İK ayrıntıları
 * ---------------------------------------------------------------------------
 * İzin & rapor, sirkülasyon, performans ve etik hat. Dördü de İK ucunun
 * tek yanıtından (önbellekte) çiziliyor: ayrı ayrı istek atmak, merkezden
 * ayrıntıya her geçişte bekleme demekti. Hangi bölümün gösterileceğini
 * rota parametresi söylüyor.
 *
 * Tarih aralığı (1.6): izin/rapor alanlar, gün gün izinli, sirkülasyon
 * (giriş, çıkış, devir, nedenler, ilk 90 gün) ve dönemde gelen etik
 * bildirimleri seçilen aralığın; performans aralığın bittiği ayın.
 * "Önümüzdeki 7 gün" planı ve açık etik bildirimleri şu an.
 */

import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";

import { patronRenk as P } from "../../tema";
import { usePatron, aralikliUc, useAralikVerisi } from "../../patronApi";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni, seriAdi } from "../../bilesenler/patron/aralik";
import { usePatron360 } from "../../bilesenler/patron/Baglam";
import { CubukGrafik, CizgiGrafik, OranHalka, Lejant } from "../../bilesenler/patron/Grafikler";
import { Satirlar } from "../../bilesenler/Grafik";
import {
  Sayfa,
  AcikUst,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart,
  KartBas,
  Kpi,
  Izgara,
  Segment,
  KisiSatiri,
  SiraSatiri,
  Satir,
  DurumEtiket,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { sayi, ondalik, buAy, oranRenk, kisaTarihSaat } from "../../bilesenler/patron/bicim";
import { etikTon } from "./Ik";

const BASLIK = {
  izin: ["İzin & rapor", "Bugün ve önümüzdeki 7 gün"],
  sirkulasyon: ["Sirkülasyon", "Giriş, çıkış ve devir oranı"],
  performans: ["Performans", "Şube puanları"],
  etik: ["Etik hat", "Yalnızca başlık, durum ve tarih"],
};

export default function IkDetay({ route, navigation }) {
  const bolum = BASLIK[route.params?.bolum] ? route.params.bolum : "izin";
  const aralik = useTarihAraligi();
  const d = usePatron(aralikliUc("Ik", null, aralik));
  const { v, eski } = useAralikVerisi(d.veri);

  const [baslik, alt] = BASLIK[bolum];

  /* Dört bölüm aynı ekran örneğini kullanıyor: anahtar, bölüm değişince
     kaydırma konumunun da sıfırlanması için (sirkülasyonun altından
     izin & rapora geçince sayfa ortadan açılıyordu). */
  return (
    <Sayfa
      key={bolum}
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          geri
          baslik={bolum === "performans" && v?.performans?.donem ? `Performans · ${v.performans.donem}` : baslik}
          alt={v?.aralik ? ARALIK_ALT[bolum] : alt}
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
          {bolum === "izin" ? (
            <IzinRapor v={v} sekmeParam={route.params?.sekme} t={route.params?.t} />
          ) : bolum === "sirkulasyon" ? (
            <Sirkulasyon s={v.sirkulasyon} aralik={v.aralik} />
          ) : bolum === "performans" ? (
            <Performans p={v.performans} git={(ad) => navigation.navigate("SubeDetay", { ad })} />
          ) : (
            <Etik e={v.etik} aralik={v.aralik} />
          )}
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

/** Aralıkta bölümlerin alt başlığı */
const ARALIK_ALT = {
  izin: "Aralıkta izin ve rapor alanlar",
  sirkulasyon: "Aralıkta giriş, çıkış ve devir oranı",
  performans: "Aralığın bittiği ayın puanları",
  etik: "Aralıkta gelen bildirimler",
};

/* -------------------------------------------------------------------------- */

function IzinRapor({ v, sekmeParam, t }) {
  const { personelAc } = usePatron360();
  const [sekme, setSekme] = useState(sekmeParam === "rapor" ? "rapor" : "izin");

  useEffect(() => {
    if (sekmeParam) setSekme(sekmeParam === "rapor" ? "rapor" : "izin");
  }, [sekmeParam, t]);

  const izinli = v.izinli ?? [];
  const raporlu = v.raporlu ?? [];
  const yedi = v.yediGunIzin ?? [];
  const yediToplam = yedi.reduce((top, x) => top + (Number(x?.[1]) || 0), 0);
  const liste = sekme === "izin" ? izinli : raporlu;
  const ar = !!v.aralik;

  if (ar) {
    const izSayi = v.izinliSayi ?? izinli.length;
    const rpSayi = v.raporluSayi ?? raporlu.length;
    const seri = v.izinSeri ?? [];
    const ort = seri.length ? seri.reduce((t2, x) => t2 + (Number(x?.[1]) || 0), 0) / seri.length : null;

    return (
      <>
        <Izgara sutun={3}>
          <Kpi kucuk baslik="İzin alan" deger={sayi(izSayi)} degerRenk={P.mavi} alt="kişi" />
          <Kpi kucuk baslik="Rapor alan" deger={sayi(rpSayi)} degerRenk={P.erik} alt="kişi" />
          <Kpi kucuk baslik="Günde izinli" deger={ort === null ? "—" : ondalik(ort)} alt="ortalama" />
        </Izgara>

        {seri.length > 1 ? (
          <Kart>
            <KartBas baslik={`İzinli kişi · ${seriAdi(v.seriBirim)}`} />
            <CubukGrafik veri={seri} yuk={120} renkli={P.mavi} />
          </Kart>
        ) : null}

        <Segment
          secili={sekme}
          sec={setSekme}
          ogeler={[
            { anahtar: "izin", ad: `İzin alanlar · ${izSayi}` },
            { anahtar: "rapor", ad: `Rapor alanlar · ${rpSayi}` },
          ]}
        />

        <Kart stil={{ paddingVertical: 8 }}>
          {liste.length ? (
            liste.map((x, i) => (
              <KisiSatiri
                key={x.kod ?? `${x.ad}-${i}`}
                ilk={i === 0}
                kisi={{ ...x, durum: x.durum ?? sekme }}
                altYazi={[x.poz, x.sube, x.gun ? `${x.gun} gün` : null].filter(Boolean).join(" · ")}
                bas={() => personelAc(x.kod)}
              />
            ))
          ) : (
            <BosDurum ikon="takvim" metin={sekme === "izin" ? "Bu aralıkta izin alan yok" : "Bu aralıkta rapor alan yok"} />
          )}
        </Kart>

        {liste.length >= 100 ? <Text style={st.dipnot}>En çok gün izinli/raporlu olan 100 kişi gösteriliyor.</Text> : null}
      </>
    );
  }

  return (
    <>
      <Izgara sutun={3}>
        <Kpi kucuk baslik="İzinli" deger={sayi(izinli.length)} degerRenk={P.mavi} alt="bugün" />
        <Kpi kucuk baslik="Raporlu" deger={sayi(raporlu.length)} degerRenk={P.erik} alt="bugün" />
        <Kpi kucuk baslik="7 gün içinde" deger={yedi.length ? sayi(yediToplam) : "—"} alt="planlı izin" />
      </Izgara>

      {yedi.length ? (
        <Kart>
          <KartBas baslik="Önümüzdeki 7 gün" />
          <CubukGrafik veri={yedi} yuk={120} renkli={P.mavi} />
        </Kart>
      ) : null}

      <Segment
        secili={sekme}
        sec={setSekme}
        ogeler={[
          { anahtar: "izin", ad: `İzinliler · ${izinli.length}` },
          { anahtar: "rapor", ad: `Raporlular · ${raporlu.length}` },
        ]}
      />

      <Kart stil={{ paddingVertical: 8 }}>
        {liste.length ? (
          liste.map((x, i) => (
            <KisiSatiri key={x.kod ?? `${x.ad}-${i}`} ilk={i === 0} kisi={{ ...x, durum: x.durum ?? sekme }} bas={() => personelAc(x.kod)} />
          ))
        ) : (
          <BosDurum ikon="takvim" metin={sekme === "izin" ? "Bugün izinli kimse yok" : "Bugün raporlu kimse yok"} />
        )}
      </Kart>
    </>
  );
}

function Sirkulasyon({ s: v, aralik }) {
  if (!v) return <BosDurum ikon="rotasyon" metin="Sirkülasyon verisi alınamadı" />;

  /* Aralıkta (1.6) seri aralığın dilimleri, sayılar aralığın */
  const ar = !!aralik;
  const ad = aralik?.ad ?? "";
  const son12 = ar ? (v.seri ?? []).map((x) => ({ ay: x.etiket, giris: x.giris, cikis: x.cikis })) : v.son12 ?? [];
  const nedenler = (v.nedenler ?? []).map((n) => ({ ad: n.neden, deger: Number(n.adet) || 0 }));

  return (
    <>
      {ar ? (
        <Izgara sutun={3}>
          <Kpi kucuk baslik="Giriş" deger={sayi(v.giris)} degerRenk={P.yesilKoyu} alt="işe başlayan" />
          <Kpi kucuk baslik="Çıkış" deger={sayi(v.cikis)} degerRenk={P.turuncu} alt="ayrılan" />
          <Kpi kucuk baslik="Devir oranı" deger={`%${ondalik(v.oran)}`} alt={`yıllık %${ondalik(v.yillikOran)}`} />
        </Izgara>
      ) : (
        <Izgara sutun={3}>
          <Kpi kucuk baslik={`${buAy()} giriş`} deger={sayi(v.ayGiris)} degerRenk={P.yesilKoyu} alt="işe başlayan" />
          <Kpi kucuk baslik={`${buAy()} çıkış`} deger={sayi(v.ayCikis)} degerRenk={P.turuncu} alt="ayrılan" />
          <Kpi kucuk baslik="12 ay devir" deger={`%${ondalik(v.yillikOran)}`} alt="yıllık oran" />
        </Izgara>
      )}

      {son12.length > 1 ? (
        <Kart>
          <KartBas baslik={ar ? `Giriş / çıkış · ${ad}` : "Son 12 ay"} />
          <CizgiGrafik
            seriler={[
              { v: son12.map((x) => x.giris), renk: P.yesil },
              { v: son12.map((x) => x.cikis), renk: P.turuncu },
            ]}
            etiketler={son12.map((x) => x.ay)}
          />
          <Lejant ogeler={[[P.yesil, "Giriş"], [P.turuncu, "Çıkış"]]} />
        </Kart>
      ) : null}

      {nedenler.length ? (
        <Kart>
          <KartBas baslik={ar ? `Çıkış nedenleri · ${ad}` : "Çıkış nedenleri · 12 ay"} />
          <Satirlar kayitlar={nedenler} renkli={P.turuncu} biciml={sayi} />
        </Kart>
      ) : null}

      {v.ilk90Orani !== null && v.ilk90Orani !== undefined ? (
        <Kart>
          <KartBas baslik="İlk 90 günde ayrılanlar" />
          <View style={st.ilk90}>
            <OranHalka oran={v.ilk90Orani / 100} renkli={P.turuncu}>
              <Text style={st.halkaDeger}>%{ondalik(v.ilk90Orani, 0)}</Text>
              <Text style={st.halkaAlt}>çıkışların</Text>
            </OranHalka>
            {/* Sayıya ek getirilmiyor (%31'i / %40'ı): ek sayıya göre
                değişiyor, yanlış ek göze batıyordu. */}
            <Text style={st.aciklama}>
              {ar ? "Bu aralıkta" : "Son 12 ayda"} ayrılanlar içinde, işe girişinin{" "}
              <Text style={st.kalin}>ilk üç ayını doldurmadan</Text> ayrılanların payı. Oryantasyon ve ilk ay takibi bu
              oranı doğrudan etkiliyor.
            </Text>
          </View>
        </Kart>
      ) : null}
    </>
  );
}

function Performans({ p, git }) {
  if (!p) return <BosDurum ikon="grafik" metin="Bu dönem için performans verisi yok" />;

  const subeler = [...(p.subeler ?? [])].sort((a, b) => (b.puan || 0) - (a.puan || 0));

  return (
    <>
      <Kart>
        <View style={st.perfUst}>
          <View style={{ flex: 1 }}>
            <Text style={st.perfBaslik}>Şirket ortalaması</Text>
            <Text style={st.perfAlt}>{p.donem}</Text>
          </View>
          <Text style={[st.perfDeger, { color: oranRenk(p.ortalama) }]}>{ondalik(p.ortalama)}</Text>
        </View>
      </Kart>

      {subeler.length ? (
        <Kart>
          <KartBas baslik="Şube sıralaması" />
          {subeler.map((x, i) => (
            <SiraSatiri
              key={x.ad}
              ilk={i === 0}
              no={i + 1}
              ad={x.ad}
              oran={x.puan}
              deger={sayi(x.puan)}
              degerRenk={oranRenk(x.puan)}
              bas={() => git(x.ad)}
            />
          ))}
        </Kart>
      ) : null}
    </>
  );
}

function Etik({ e, aralik }) {
  if (!e) return <BosDurum ikon="kalkan" metin="Etik hat verisi alınamadı" />;

  const ar = !!aralik;

  return (
    <>
      <Izgara sutun={ar ? 3 : 2}>
        {ar ? <Kpi kucuk baslik={aralik.ad} deger={sayi(e.donem)} alt="gelen bildirim" /> : null}
        <Kpi kucuk baslik="Yeni" deger={sayi(e.yeni)} degerRenk={e.yeni ? P.turuncu : P.metin} alt={ar ? "şu an bekleyen" : "incelenmeyi bekliyor"} />
        <Kpi kucuk baslik="Açık" deger={sayi(e.acik)} alt={ar ? "şu an süren" : "süren bildirim"} />
      </Izgara>

      <Kart stil={{ paddingVertical: 8 }}>
        {(e.son ?? []).length ? (
          e.son.map((x, i) => (
            <Satir
              key={`${x.baslik}-${i}`}
              ilk={i === 0}
              baslik={x.baslik}
              alt={kisaTarihSaat(x.tarih)}
              sag={<DurumEtiket metin={x.durum} tonAd={etikTon(x.durum)} />}
            />
          ))
        ) : (
          <BosDurum ikon="kalkan" metin={ar ? "Bu aralıkta bildirim yok" : "Açık bildirim yok"} />
        )}
      </Kart>

      <Text style={st.dipnot}>
        Bildirimlerin içeriği ve bildirenin kimliği burada gösterilmez; Etik Kurul panelden inceler.
      </Text>
    </>
  );
}

const st = StyleSheet.create({
  ilk90: { flexDirection: "row", alignItems: "center", gap: 14 },
  halkaDeger: { fontSize: 24, fontWeight: "800", color: P.metin },
  halkaAlt: { fontSize: 11, color: P.soluk, marginTop: 2 },
  aciklama: { flex: 1, fontSize: 13, color: P.ikincil, lineHeight: 19 },
  kalin: { fontWeight: "700", color: P.metin },

  perfUst: { flexDirection: "row", alignItems: "center" },
  perfBaslik: { fontSize: 15, fontWeight: "700", color: P.metin },
  perfAlt: { fontSize: 12, color: P.soluk, marginTop: 2 },
  perfDeger: { fontSize: 34, fontWeight: "800", letterSpacing: -0.8 },

  dipnot: { fontSize: 11.5, color: P.soluk, marginHorizontal: 4, lineHeight: 17 },
});

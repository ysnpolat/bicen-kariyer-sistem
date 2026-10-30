/**
 * Patron · İnsan Kaynakları
 * ---------------------------------------------------------------------------
 * Paneldeki İK verisinin özeti: başvurular, norm kadro, okutma, izin &
 * rapor, sirkülasyon, performans ve etik hat. Kutular ayrıntı ekranına
 * götürüyor.
 *
 * Başvuru, norm ve okutma sayıları Özet yanıtından okunuyor (zaten
 * önbellekte); izin, sirkülasyon, performans ve etik bu ekranın kendi
 * ucundan. Sunucu bir bölümü veremezse (null) o kutu çizilmiyor.
 *
 * Tarih aralığı (1.6): iki uç da seçilen aralıkla isteniyor; başvuru,
 * okutma, izin/rapor, sirkülasyon ve etik hattaki yeni bildirimler o
 * aralığın, performans aralığın bittiği ayın. Norm ve açık etik
 * bildirimleri şu an.
 */

import { Text, StyleSheet } from "react-native";

import { patronRenk as P } from "../../tema";
import { usePatron, sayfalariSec, aralikliUc, useAralikVerisi } from "../../patronApi";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni } from "../../bilesenler/patron/aralik";
import { ikonAdi } from "../../bilesenler/patron/Ikon";
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
  AraDugme,
  IkonSatir,
  Satir,
  DurumEtiket,
} from "../../bilesenler/patron/Parcalar";
import { sayi, ondalik, buAy, kisaTarihSaat, kucult } from "../../bilesenler/patron/bicim";

/** Etik bildirimi durumu → ton */
export const etikTon = (durum) => {
  const d = kucult(durum);
  if (d.includes("yeni")) return "turuncu";
  if (d.includes("kapan") || d.includes("çözül")) return "yesil";
  return "sari";
};

export default function Ik({ navigation }) {
  const aralik = useTarihAraligi();
  const d = usePatron(aralikliUc("Ik", null, aralik));
  /* Özet zaten önbellekte; eskiyse burada da tazelensin */
  const oz = usePatron(aralikliUc("Ozet", null, aralik), { tazeSure: 60_000 });

  const { v, eski: eskiIk } = useAralikVerisi(d.veri);
  const { v: o, eski: eskiOzet } = useAralikVerisi(oz.veri);
  const eski = eskiIk || eskiOzet;
  const ar = !!v?.aralik;
  const ad = v?.aralik?.ad ?? o?.aralik?.ad ?? "";

  const git = (bolum) => navigation.navigate("IkDetay", { bolum, t: Date.now() });

  const kutular = [];

  if (o?.basvuru)
    kutular.push(
      o.aralik ? (
        <Kpi
          key="bv"
          ikon="kisiEkle"
          tonAd="mavi"
          baslik={`Başvurular · ${ad}`}
          deger={sayi(o.basvuru.toplam)}
          alt={`${sayi(o.basvuru.alinan)} işe alındı · ${sayi(o.basvuru.islemsiz)} işlemsiz`}
          bas={() => navigation.navigate("Basvurular", { durum: null, t: Date.now() })}
        />
      ) : (
        <Kpi
          key="bv"
          ikon="kisiEkle"
          tonAd="mavi"
          baslik="Başvurular"
          deger={sayi(o.basvuru.bugun)}
          degerEk="bugün"
          alt={`${sayi(o.basvuru.hafta)} bu hafta · ${sayi(o.basvuru.islemsiz)} işlemsiz`}
          bas={() => navigation.navigate("Basvurular", { durum: null, t: Date.now() })}
        />
      )
    );

  if (o?.norm)
    kutular.push(
      <Kpi
        key="norm"
        ikon="kadro"
        tonAd="mor"
        baslik={o.aralik ? "Norm kadro · şu an" : "Norm kadro"}
        deger={`${sayi(o.norm.eksik)} eksik`}
        alt={`${sayi(o.norm.eksikSube)} şubede · ${sayi(o.norm.fazla)} fazla`}
        bas={() => navigation.navigate("Norm")}
      />
    );

  if (o?.okutma)
    kutular.push(
      <Kpi
        key="gecis"
        ikon="qr"
        tonAd="yesil"
        baslik={`Geçiş & okutma · ${ad}`}
        deger={o.okutma.oran !== null && o.okutma.oran !== undefined ? `%${o.okutma.oran}` : "—"}
        alt={
          (o.aralik?.gun ?? 1) > 1
            ? `${sayi(o.okutma.okutmadi)} hiç okutmadı · günde ${sayi(Math.round(o.okutma.gunlukOrt ?? 0))} kişi`
            : `${sayi(o.okutma.okutmadi)} okutmadı · ${sayi(o.okutma.gecKalan)} geç`
        }
        bas={() => navigation.navigate("Gecis", { segment: "akis", t: Date.now() })}
      />
    );

  if (o?.canli)
    kutular.push(
      <Kpi
        key="gecis"
        ikon="qr"
        tonAd="yesil"
        baslik="Geçiş & okutma"
        deger={o.canli.beklenen ? `%${Math.round((o.canli.iceride / o.canli.beklenen) * 100)}` : "—"}
        alt={`${sayi(o.canli.okutmadi)} okutmadı · ${sayi(o.canli.gecKalan)} geç`}
        bas={() => navigation.navigate("Gecis", { segment: "akis", t: Date.now() })}
      />
    );

  if (v && (v.izinli || v.raporlu)) {
    /* Aralıkta liste en çok 100 kişi; sayılar ayrıca geliyor */
    const iz = ar ? v.izinliSayi ?? v.izinli?.length ?? 0 : v.izinli?.length ?? 0;
    const rp = ar ? v.raporluSayi ?? v.raporlu?.length ?? 0 : v.raporlu?.length ?? 0;

    kutular.push(
      <Kpi
        key="izin"
        ikon="takvim"
        tonAd="sari"
        baslik={ar ? `İzin & rapor · ${ad}` : "İzin & rapor"}
        deger={sayi(iz + rp)}
        degerEk={ar ? "kişi" : "bugün"}
        alt={`${sayi(iz)} izinli · ${sayi(rp)} raporlu`}
        bas={() => git("izin")}
      />
    );
  }

  if (v?.sirkulasyon && ar)
    kutular.push(
      <Kpi
        key="sirk"
        ikon="rotasyon"
        tonAd="turuncu"
        baslik={`Sirkülasyon · ${ad}`}
        deger={`%${ondalik(v.sirkulasyon.oran)}`}
        alt={`${sayi(v.sirkulasyon.giris)} giriş · ${sayi(v.sirkulasyon.cikis)} çıkış`}
        bas={() => git("sirkulasyon")}
      />
    );

  if (v?.sirkulasyon && !ar)
    kutular.push(
      <Kpi
        key="sirk"
        ikon="rotasyon"
        tonAd="turuncu"
        baslik="Sirkülasyon"
        deger={o?.sirkulasyon?.oran !== undefined && o?.sirkulasyon?.oran !== null ? `%${ondalik(o.sirkulasyon.oran)}` : `${sayi(v.sirkulasyon.ayCikis)} çıkış`}
        alt={<AltYazi parcalar={[`${buAy()} · 12 ay `, [`%${ondalik(v.sirkulasyon.yillikOran)}`, "asagi"]]} />}
        bas={() => git("sirkulasyon")}
      />
    );

  if (v?.performans)
    kutular.push(
      <Kpi
        key="perf"
        ikon="grafik"
        tonAd="erik"
        baslik="Performans"
        deger={ondalik(v.performans.ortalama)}
        alt={`${v.performans.donem ?? ""} şirket ort.`.trim()}
        bas={() => git("performans")}
      />
    );

  return (
    <Sayfa
      yenile={(c) => {
        d.yenile(c);
        oz.yenile();
      }}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          baslik="İnsan Kaynakları"
          alt="Panelde ne varsa, özetiyle"
          aralik={aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
        />
      }
    >
      <AraDugme yazi="Personel, şube ya da aday ara" bas={() => navigation.navigate("Ara")} />

      <TarihFiltresi />

      {!v && !o ? (
        d.ilkYukleme ? <IlkYukleme /> : <HataKutu metin={d.hata} yenile={d.yenile} />
      ) : (
        <AralikIcerik eski={eski}>
          {kutular.length ? <Izgara>{kutular}</Izgara> : null}

          {!v && d.ilkYukleme ? <IlkYukleme /> : null}
          {!v && !d.ilkYukleme && d.hata ? <HataKutu metin={d.hata} yenile={d.yenile} /> : null}

          {v?.etik ? (
            <Kart>
              <KartBas
                baslik="Etik hat"
                sag={
                  v.etik.yeni ? (
                    <DurumEtiket metin={`${v.etik.yeni} yeni`} tonAd="turuncu" />
                  ) : (
                    <Text style={s.soluk}>{sayi(v.etik.acik)} açık</Text>
                  )
                }
              />
              {(v.etik.son ?? []).slice(0, 3).map((e, i) => (
                <Satir
                  key={`${e.baslik}-${i}`}
                  ilk={i === 0}
                  baslik={e.baslik}
                  alt={kisaTarihSaat(e.tarih)}
                  sag={<DurumEtiket metin={e.durum} tonAd={etikTon(e.durum)} />}
                  bas={() => git("etik")}
                />
              ))}
              {!(v.etik.son ?? []).length ? (
                <Text style={s.soluk}>{ar ? "Bu aralıkta bildirim yok." : "Açık bildirim yok."}</Text>
              ) : null}
              <Text style={s.dipnot}>
                {ar ? `${ad}: ${sayi(v.etik.donem)} bildirim · yeni/açık sayısı şu an. ` : ""}
                Yalnızca başlık ve durum gösterilir; içerik ve bildiren panelde.
              </Text>
            </Kart>
          ) : null}

          <Kart>
            <IkonSatir ilk ikon="ara" tonAd="gri" baslik="Personel ara" alt="Ad, şube ya da pozisyonla" bas={() => navigation.navigate("Ara")} />
            <IkonSatir
              ikon="takvim"
              tonAd="sari"
              baslik="İzin & rapor"
              alt={ar ? `${ad} izin ve rapor alanlar` : "Bugün izinli ve raporlu olanlar"}
              bas={() => git("izin")}
            />
            <IkonSatir ikon="rotasyon" tonAd="turuncu" baslik="Sirkülasyon" alt="Giriş, çıkış ve nedenleri" bas={() => git("sirkulasyon")} />
            <IkonSatir ikon="grafik" tonAd="erik" baslik="Performans" alt="Şube puanları" bas={() => git("performans")} />

            {/* Sunucu tanımlı sayfalar (yer: "ik"): çıkış mülakatları, duyuru,
                bildirim ayarları… Yenisi eklendiğinde uygulama güncellenmeden
                burada görünüyor. */}
            {sayfalariSec(o, "ik").map((x) => (
              <IkonSatir
                key={`sayfa-${x.kod}`}
                ikon={ikonAdi(x.ikon)}
                tonAd={x.ton || "gri"}
                baslik={x.baslik || x.kod}
                alt={x.alt || null}
                rozet={x.rozet}
                bas={() => navigation.navigate("WebSayfa", { kod: x.kod, baslik: x.baslik ?? null, t: Date.now() })}
              />
            ))}
          </Kart>
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

const s = StyleSheet.create({
  soluk: { fontSize: 12, color: P.soluk },
  dipnot: { fontSize: 11.5, color: P.soluk, marginTop: 8 },
});

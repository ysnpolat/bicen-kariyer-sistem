/**
 * Patron · Onaylar
 * ---------------------------------------------------------------------------
 * Onayınızı bekleyen işlemler: işe alım, rotasyon, norm kadro, Biçen Kart
 * puan yüklemesi, üst düzey izin.
 *
 * Akış (onaylanan tasarım):
 *   - Uyarısı olmayan kart "Onayla" ile doğrudan onaylanır: rutin
 *     onaylarda her seferinde not penceresi açmak işi uzatıyordu.
 *   - Uyarı varsa (ücret skalanın üstünde gibi) önce uyarı ve not
 *     penceresi açılır; patron neyi onayladığını görmüş olmalı.
 *   - Red her zaman gerekçe ister; gerekçe İK'ya iletilir.
 *   - Karar verilen kart yana kayarak çıkar (onay sağa, red sola) ve
 *     "Verdiklerim"e eklenir.
 *
 * Sonuç panelde GMY onayıyla aynı: sunucu aynı servisi çağırıyor.
 *
 * Tarih aralığı (1.6): bekleyenler talep tarihine, "Verdiklerim" karar
 * tarihine göre süzülüyor. Aralığın dışında kalan bekleyen onay unutulmasın
 * diye sayısı gösteriliyor; "Tümünü göster" bu sayfada süzgeci kaldırıyor
 * (diğer sayfaların aralığı değişmiyor).
 */

import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Platform, TouchableOpacity } from "react-native";

import { patronRenk as P } from "../../tema";
import { usePatron, onayVer, aralikliUc, useAralikVerisi } from "../../patronApi";
import { usePatron360 } from "../../bilesenler/patron/Baglam";
import TarihFiltresi, { AralikIcerik } from "../../bilesenler/patron/TarihFiltresi";
import { useTarihAraligi, aralikMetni } from "../../bilesenler/patron/aralik";
import Ikon from "../../bilesenler/patron/Ikon";
import {
  Sayfa,
  AcikUst,
  GuncelBilgi,
  IlkYukleme,
  HataKutu,
  Kart,
  Cipler,
  SimgeKutu,
  Avatar,
  AvatarRozet,
  BilgiIzgara,
  UyariKutu,
  NotKutu,
  Dugme,
  Dugmeler,
  Satir,
  BosDurum,
} from "../../bilesenler/patron/Parcalar";
import { onayTur, saatDk, ton } from "../../bilesenler/patron/bicim";

/* Kartın çıkış animasyonu; sunucu daha hızlı yanıt verse de kart bu
   süre dolmadan listeden düşmüyor (yarıda kesilmiş animasyon, kartın
   "yok olduğu" hissini veriyordu). */
const CIKIS_MS = 380;

/* Kartı bir kişiye ait olan onay türleri (fotoğraf gösterilir) */
const KISI_TURLERI = new Set(["ise", "rot"]);

const bekle = (ms) => new Promise((z) => setTimeout(z, ms));

export default function Onaylar({ route }) {
  const { tost, adayAc, kararAc, sayfaKapat } = usePatron360();
  const aralik = useTarihAraligi();

  /* "Tümünü göster": yalnızca bu sayfada aralığı yok sayar; aralık
     değişince yeniden süzülür */
  const [hepsi, setHepsi] = useState(false);
  const aralikAnahtari = aralik.canli ? "-" : `${aralik.bas}|${aralik.bit}`;

  useEffect(() => setHepsi(false), [aralikAnahtari]);

  const d = usePatron(hepsi ? "Onaylar" : aralikliUc("Onaylar", null, aralik));
  const { v: veri, eski } = useAralikVerisi(d.veri);

  const [sekme, setSekme] = useState("hepsi");

  /* id → "onay" | "red": karar verilmiş, kart çıkıyor */
  const [gidenler, setGidenler] = useState({});

  /* Sunucu kabul etti; tazelenmiş liste gelene kadar gizli kalsın */
  const [bitenler, setBitenler] = useState(() => new Set());

  /* Verdiklerim listesine hemen eklenenler (sunucu listesi gelince ayıklanır) */
  const [yerelVerilen, setYerelVerilen] = useState([]);

  /* Özetten / Biçen Kart'tan belirli bir türle gelinirse o çip seçilir */
  useEffect(() => {
    const t = route.params?.tur;
    if (t) setSekme(t);
  }, [route.params?.tur, route.params?.t]);

  const tumu = (veri?.onaylar ?? []).filter((o) => !bitenler.has(o.id));
  const turler = [...new Set(tumu.map((o) => o.tur))];

  const sunucuVerilen = veri?.verilenler ?? [];
  const disarida = veri?.aralik ? Number(veri.disarida) || 0 : 0;
  const verilenler = [
    ...yerelVerilen.filter((y) => !sunucuVerilen.some((v) => v.id === y.id && v.tur === y.tur)),
    ...sunucuVerilen,
  ];

  /* Seçili tür kalmadıysa (hepsi onaylandı) Tümü'ne dönülür */
  const aktif = sekme === "hepsi" || sekme === "gecmis" || turler.includes(sekme) ? sekme : "hepsi";
  const liste = aktif === "hepsi" ? tumu : tumu.filter((o) => o.tur === aktif);

  const kararVer = async (o, sonuc, not) => {
    setGidenler((g) => ({ ...g, [o.id]: sonuc }));

    try {
      await Promise.all([onayVer(o.id, sonuc === "onay", not), bekle(CIKIS_MS)]);

      setBitenler((b) => new Set(b).add(o.id));
      setYerelVerilen((v) => [
        { id: o.id, tur: o.tur, baslik: o.baslik, sonuc, not: not || null, saat: saatDk(new Date()) },
        ...v,
      ]);

      tost(
        sonuc === "onay"
          ? `${o.baslik} onaylandı · İK'ya bildirildi`
          : `${o.baslik} reddedildi · gerekçe İK'ya iletildi`
      );
    } catch (e) {
      /* Kart geri kayar; sebep tostta */
      tost(e?.message ?? "İşlem tamamlanamadı.", "hata");
    } finally {
      setGidenler((g) => {
        const k = { ...g };
        delete k[o.id];
        return k;
      });
    }
  };

  /* Onayla / Reddet düğmesi: uyarısız onay doğrudan, diğerleri pencereyle */
  const karar = (o, sonuc) => {
    if (gidenler[o.id]) return;

    if (sonuc === "onay" && !o.uyari) {
      sayfaKapat();
      kararVer(o, "onay", "");
      return;
    }

    kararAc(o, sonuc, (not) => kararVer(o, sonuc, not));
  };

  const detay = (o) => adayAc(o.basvuruId ?? null, { onay: o, karar: (sonuc) => karar(o, sonuc) });

  return (
    <Sayfa
      yenile={d.yenile}
      yenileniyor={d.yenileniyor}
      ust={
        <AcikUst
          baslik="Onaylar"
          alt={
            veri
              ? veri.aralik
                ? `${tumu.length} bekleyen bu aralıkta · toplam ${veri.toplamBekleyen ?? tumu.length}`
                : tumu.length
                ? `${tumu.length} işlem onayınızı bekliyor`
                : "Bekleyen işlem yok"
              : null
          }
          aralik={hepsi ? "Tüm bekleyenler · talep tarihi süzülmedi" : aralikMetni(aralik)}
          guncel={<GuncelBilgi zaman={d.zaman} guncelleniyor={d.guncelleniyor} hata={d.hata} yenile={d.yenile} />}
        />
      }
    >
      <TarihFiltresi />

      {!veri ? (
        d.ilkYukleme ? <IlkYukleme /> : <HataKutu metin={d.hata} yenile={d.yenile} />
      ) : (
        <AralikIcerik eski={eski}>
          {disarida > 0 ? (
            <TouchableOpacity style={s.disarida} onPress={() => setHepsi(true)} activeOpacity={0.75}>
              <Ikon ad="saat" boyut={16} renkli={P.sari} />
              <Text style={s.disaridaYazi}>
                Bu aralığın dışında <Text style={{ fontWeight: "800" }}>{disarida}</Text> bekleyen onay daha var
              </Text>
              <Text style={s.disaridaBag}>Tümünü göster</Text>
            </TouchableOpacity>
          ) : hepsi && !aralik.canli ? (
            <TouchableOpacity style={s.disarida} onPress={() => setHepsi(false)} activeOpacity={0.75}>
              <Ikon ad="takvim" boyut={16} renkli={P.yesilKoyu} />
              <Text style={s.disaridaYazi}>Bütün bekleyen onaylar gösteriliyor</Text>
              <Text style={s.disaridaBag}>Aralığa dön</Text>
            </TouchableOpacity>
          ) : null}

          <Cipler
            secili={aktif}
            sec={setSekme}
            ogeler={[
              { anahtar: "hepsi", ad: `Tümü · ${tumu.length}` },
              ...turler.map((t) => ({ anahtar: t, ad: `${onayTur(t).ad} · ${tumu.filter((o) => o.tur === t).length}` })),
              { anahtar: "gecmis", ad: `Verdiklerim · ${verilenler.length}` },
            ]}
          />

          {aktif === "gecmis" ? (
            verilenler.length ? (
              <Kart>
                {verilenler.map((v, i) => (
                  <Satir
                    key={`${v.tur}-${v.id}-${i}`}
                    ilk={i === 0}
                    sol={
                      <SimgeKutu
                        ikon={v.sonuc === "onay" ? "tik" : "carpi"}
                        tonAd={v.sonuc === "onay" ? "yesil" : "turuncu"}
                      />
                    }
                    baslik={v.baslik}
                    alt={`${onayTur(v.tur).ad} · ${v.sonuc === "onay" ? "onaylandı" : "reddedildi"}${v.not ? ` · ${v.not}` : ""}`}
                    sag={<Text style={s.saat}>{v.saat}</Text>}
                  />
                ))}
              </Kart>
            ) : (
              <BosDurum ikon="onay" metin={veri.aralik ? "Bu aralıkta karar vermediniz" : "Henüz karar vermediniz"} />
            )
          ) : liste.length ? (
            liste.map((o) => (
              <OnayKarti
                key={`${o.tur}-${o.id}`}
                o={o}
                gidiyor={gidenler[o.id] ?? null}
                karar={(sonuc) => karar(o, sonuc)}
                detay={o.tur === "ise" && o.basvuruId ? () => detay(o) : null}
              />
            ))
          ) : (
            <BosDurum
              ikon="tik"
              metin={veri.aralik ? "Bu aralıkta talep edilmiş bekleyen onay yok." : "Tümü tamam. Bekleyen onay yok."}
            />
          )}
        </AralikIcerik>
      )}
    </Sayfa>
  );
}

/* ========================================================================== */

function OnayKarti({ o, gidiyor, karar, detay }) {
  const t = onayTur(o.tur);
  const [, yaziRengi] = ton(t.ton);

  const a = useRef(new Animated.Value(0)).current;
  const yukseklik = useRef(0);
  const [yon, setYon] = useState(1);

  useEffect(() => {
    if (gidiyor) setYon(gidiyor === "red" ? -1 : 1);

    /* Yükseklik de daraldığı için yerel sürücü kullanılamıyor */
    Animated.timing(a, {
      toValue: gidiyor ? 1 : 0,
      duration: gidiyor ? CIKIS_MS : 260,
      useNativeDriver: false,
    }).start();
  }, [gidiyor, a]);

  const kayma = {
    opacity: a.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, yon * 420] }) }],
    ...(gidiyor && yukseklik.current
      ? {
          height: a.interpolate({ inputRange: [0, 1], outputRange: [yukseklik.current, 0] }),
          marginBottom: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
        }
      : null),
  };

  return (
    <Animated.View
      /* Taşma yalnızca daralırken kesiliyor: sürekli kesmek kartın
         gölgesini de kesiyordu. */
      style={[s.kartKap, gidiyor && { overflow: "hidden" }, kayma]}
      onLayout={(e) => {
        if (!gidiyor) yukseklik.current = e.nativeEvent.layout.height;
      }}
      pointerEvents={gidiyor ? "none" : "auto"}
    >
      <View style={s.kart}>
        <View style={s.ust}>
          {KISI_TURLERI.has(o.tur) ? (
            /* İşe alım ve rotasyonda kişi: fotoğraf (yoksa baş harfler),
               köşede onay türü */
            <Avatar
              fotoUrl={o.fotoUrl}
              ad={o.baslik}
              tonAd={t.ton}
              boyut={40}
              yuvarlak={13}
              rozet={<AvatarRozet ikon={t.ikon} tonAd={t.ton} />}
              rozetHep
            />
          ) : (
            <SimgeKutu ikon={t.ikon} tonAd={t.ton} boyut={40} yuvarlak={13} ikonBoyut={19} />
          )}

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.tur, { color: yaziRengi }]}>{t.ad.toLocaleUpperCase("tr-TR")}</Text>
            <Text style={s.baslik}>{o.baslik}</Text>
            {o.alt ? <Text style={s.alt}>{o.alt}</Text> : null}
          </View>

          {o.sure ? <Text style={s.sure}>{o.sure}</Text> : null}
        </View>

        {o.bilgi?.length ? (
          <View style={{ marginTop: 12 }}>
            <BilgiIzgara ogeler={o.bilgi.filter((b) => Array.isArray(b) && b.length >= 2)} />
          </View>
        ) : (
          <View style={{ height: 12 }} />
        )}

        {o.uyari ? <UyariKutu metin={o.uyari} /> : null}
        {o.not ? <NotKutu metin={o.not} /> : null}

        <Dugmeler>
          <Dugme yazi="Reddet" ikon="carpi" tur="red" bas={() => karar("red")} />
          {detay ? <Dugme ikon="belge" tur="ikincil" bas={detay} stil={{ flex: 0.6 }} yazi={null} /> : null}
          <Dugme yazi="Onayla" ikon="tik" bas={() => karar("onay")} />
        </Dugmeler>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  kartKap: { marginBottom: 10, borderRadius: 20 },
  kart: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    ...Platform.select({
      ios: { shadowColor: "#14200a", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12 },
      android: { elevation: 2 },
      default: {},
    }),
  },
  ust: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  tur: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5 },
  baslik: { fontSize: 15, fontWeight: "700", color: P.metin, marginTop: 1 },
  alt: { fontSize: 12, color: P.soluk },
  sure: { fontSize: 11, color: P.soluk },
  saat: { fontSize: 12, color: P.soluk },

  disarida: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: P.sariAcik,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  disaridaYazi: { flex: 1, fontSize: 12.5, color: P.metin },
  disaridaBag: { fontSize: 12.5, fontWeight: "700", color: P.yesilKoyu },
});

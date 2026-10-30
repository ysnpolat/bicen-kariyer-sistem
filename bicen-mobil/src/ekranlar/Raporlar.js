/**
 * Raporlar (mobil)
 * ---------------------------------------------------------------------------
 * Portaldaki rapor sayfasının telefon sürümü: arıza, maliyet, rakip fiyat
 * ve künye özetleri; halka ve çubuk grafiklerle.
 *
 * Kapsam sunucuda belirleniyor. "Tüm departmanlar" yetkisi olan kişi
 * süzgeçten departman seçebiliyor; olmayan yalnızca temsilcisi olduğu
 * departmanı görüyor ve süzgeç hiç çıkmıyor.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { api } from "../api";
import { api360 } from "../api360";
import { renk, olcu } from "../tema";
import { Yukleniyor, Hata } from "../bilesenler/Ortak";
import BarBaslik from "../bilesenler/BarBaslik";
import { Halka, Cubuk, Satirlar, SayiKutu } from "../bilesenler/Grafik";

/* -------------------------------------------------------------------------- */

/** 2026-09-15 → 15.09 */
const tarihYaz = (d) => {
  const [y, a, g] = String(d).split("-");
  return `${g}.${a}`;
};

/** Bugünden geriye n gün, YYYY-AA-GG */
const gunGeri = (n) => {
  const t = new Date();
  t.setDate(t.getDate() - n);

  const iki = (x) => String(x).padStart(2, "0");

  return `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())}`;
};

const paraYaz = (d) =>
  Number(d || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";

const SEKMELER = [
  { kod: "ariza", ad: "Arıza" },
  { kod: "maliyet", ad: "Maliyet" },
  { kod: "rakip", ad: "Rakip Fiyat" },
  { kod: "kunye", ad: "Künye" },
];

/* İK sekmesi yalnızca yetkili kullanıcıda listeye ekleniyor */
const IK_SEKMESI = { kod: "ik", ad: "İK" };

/* ========================================================================== */

export default function Raporlar() {
  const [veri, setVeri] = useState(null);

  /* İK raporu ayrı serviste ve ayrı yetkide.

     Portal raporlarıyla birlikte çekilmiyor: İK yetkisi olmayan kişide
     403 dönüyor ve tek istekte toplansaydı bütün rapor ekranı hata
     verirdi. Yetki yoksa sekme hiç görünmüyor. */
  const [ik, setIk] = useState(null);
  const [ikYetkisi, setIkYetkisi] = useState(false);
  const [ikHatasi, setIkHatasi] = useState("");

  /* Kırılım ayrıntısı: bir satıra dokunulunca o satırı oluşturan
     kayıtlar listeleniyor. Sayıyı görmek yetmiyordu. */
  const [ayrinti, setAyrinti] = useState(null);
  const [gun, setGun] = useState(30);

  /* Serbest tarih aralığı: hazır 7/30/90 gün seçenekleri geçmiş bir
     dönemi incelemeye yetmiyordu. Seçilince gün sayısı yok sayılıyor. */
  const [aralik, setAralik] = useState(null);
  const [aralikAcik, setAralikAcik] = useState(false);
  const [departmanId, setDepartmanId] = useState(null);
  const [sekme, setSekme] = useState("ariza");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState("");

  const getir = useCallback(
    async (yenile = false) => {
      if (yenile) setYenileniyor(true);

      try {
        const sorgu = new URLSearchParams({ gun: String(gun) });

        if (aralik) {
          sorgu.set("bas", aralik.bas);
          sorgu.set("bit", aralik.bit);
        }

        if (departmanId) sorgu.set("departmanId", String(departmanId));

        setVeri(await api360.al(`/api/Mobil/Rapor?${sorgu}`));
        setHata("");

        /* İK raporu: yetki yoksa sessizce atlanıyor */
        try {
          const ikSorgu = new URLSearchParams({ gun: String(gun) });

          if (aralik) {
            ikSorgu.set("bas", aralik.bas);
            ikSorgu.set("bit", aralik.bit);
          }

          const c = await api.al(`/api/Mobil/IKRapor?${ikSorgu}`);

          setIk(c);
          setIkYetkisi(true);
        } catch (e) {
          /* Sebep saklanıyor: sekme sessizce kaybolunca yetki verilmiş
             olmasına rağmen neden görünmediği anlaşılmıyordu. */
          setIk(null);
          setIkYetkisi(false);
          setIkHatasi(e?.message ?? "İK raporu alınamadı.");
        }
      } catch (e) {
        setHata(e?.message ?? "Rapor alınamadı.");
      } finally {
        setYukleniyor(false);
        setYenileniyor(false);
      }
    },
    [gun, aralik, departmanId]
  );

  useFocusEffect(
    useCallback(() => {
      getir();
    }, [getir])
  );

  /** Kırılım satırına dokunulunca ayrıntı penceresini açar */
  /**
   * Kırılım ayrıntısını açar.
   *
   * `ikMi` doğruysa istek Kariyer servisine gidiyor: İK verileri orada.
   */
  const kirilimAc = async (bolum, alan, baslik, k, ikMi = false) => {
    setAyrinti({ baslik: `${baslik} · ${k.ad}`, yukleniyor: true, kayitlar: [] });

    try {
      const sorgu = new URLSearchParams({
        bolum,
        alan,
        deger: k.ad,
        gun: String(gun),
      });

      if (aralik) {
        sorgu.set("bas", aralik.bas);
        sorgu.set("bit", aralik.bit);
      }

      if (departmanId) sorgu.set("departmanId", String(departmanId));

      const c = ikMi
        ? await api.al(`/api/Mobil/IKRaporKirilim?${sorgu}`)
        : await api360.al(`/api/Mobil/RaporKirilim?${sorgu}`);

      setAyrinti({
        baslik: `${baslik} · ${k.ad}`,
        yukleniyor: false,
        kayitlar: c?.kayitlar ?? [],
      });
    } catch (e) {
      setAyrinti({
        baslik: `${baslik} · ${k.ad}`,
        yukleniyor: false,
        kayitlar: [],
        hata: e?.message ?? "Ayrıntı alınamadı.",
      });
    }
  };

  const a = veri?.ariza ?? {};
  const m = veri?.maliyet ?? {};
  const r = veri?.rakip ?? {};
  const k = veri?.kunye ?? {};

  return (
    <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
      <BarBaslik ad="Raporlar" acik kendi />

      {/* -------------------------------------------------- süzgeçler */}
      <View style={s.ustBar}>
        <View style={s.gunSerit}>
          {[7, 30, 90].map((g) => (
            <TouchableOpacity
              key={g}
              style={[s.gunDugme, !aralik && gun === g && s.gunSecili]}
              onPress={() => {
                setAralik(null);
                setGun(g);
              }}
            >
              <Text style={[s.gunYazi, !aralik && gun === g && s.gunYaziSecili]}>
                {g} gün
              </Text>
            </TouchableOpacity>
          ))}

          {/* Serbest aralık: hazır seçenekler geçmiş bir dönemi
              incelemeye yetmiyordu. */}
          <TouchableOpacity
            style={[s.gunDugme, aralik && s.gunSecili, { flex: 1.5 }]}
            onPress={() => setAralikAcik(true)}
          >
            <Text style={[s.gunYazi, aralik && s.gunYaziSecili]} numberOfLines={1}>
              {aralik
                ? `${tarihYaz(aralik.bas)} – ${tarihYaz(aralik.bit)}`
                : "Tarih aralığı"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Departman süzgeci yalnızca birden çok departmana yetkisi
            olanda: tek departmanı olan kişiye seçenek sunmak gereksiz. */}
        {(veri?.departmanlar ?? []).length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.depSerit}
          >
            <TouchableOpacity
              style={[s.depDugme, !departmanId && s.depSecili]}
              onPress={() => setDepartmanId(null)}
            >
              <Text style={[s.depYazi, !departmanId && s.depYaziSecili]}>
                {veri?.tumunuGorur ? "Tümü" : "Departmanlarım"}
              </Text>
            </TouchableOpacity>

            {veri.departmanlar.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={[s.depDugme, departmanId === d.id && s.depSecili]}
                onPress={() => setDepartmanId(departmanId === d.id ? null : d.id)}
              >
                <Text style={[s.depYazi, departmanId === d.id && s.depYaziSecili]}>
                  {d.ad}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {!ikYetkisi && ikHatasi ? (
          <Text style={s.ikNotu} numberOfLines={3}>
            İK raporları: {ikHatasi}
          </Text>
        ) : null}

        <View style={s.sekmeler}>
          {[...SEKMELER, ...(ikYetkisi ? [IK_SEKMESI] : [])].map((x) => (
            <TouchableOpacity
              key={x.kod}
              style={[s.sekme, sekme === x.kod && s.sekmeSecili]}
              onPress={() => setSekme(x.kod)}
            >
              <Text style={[s.sekmeYazi, sekme === x.kod && s.sekmeYaziSecili]}>
                {x.ad}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.govde}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            onRefresh={() => getir(true)}
            tintColor={renk.yesil}
          />
        }
      >
        {yukleniyor ? (
          <Yukleniyor />
        ) : hata ? (
          <Hata metin={hata} />
        ) : sekme === "ariza" ? (
          <>
            <View style={s.kutular}>
              <SayiKutu ad="Toplam kayıt" deger={a.toplam ?? 0} />
              <SayiKutu
                ad="Açık"
                deger={(a.acik ?? 0) + (a.islemde ?? 0) + (a.beklemede ?? 0)}
                renkli="#e8481c"
              />
              <SayiKutu ad="Çözülen" deger={(a.cozuldu ?? 0) + (a.kapandi ?? 0)} renkli={renk.yesilKoyu} />
              <SayiKutu ad="Geciken" deger={a.geciken ?? 0} renkli="#cf1322" />
              <SayiKutu ad="Ort. çözüm" deger={a.ortalamaSaat ? `${a.ortalamaSaat} sa` : "—"} renkli="#1a4d80" />
              <SayiKutu ad="Maliyet" deger={paraYaz(a.maliyet)} renkli="#722ed1" />
            </View>

            <Kart baslik="Günlük açılan kayıt">
              <Cubuk kayitlar={a.gunluk ?? []} />
            </Kart>

            <Kart baslik="Durum dağılımı">
              {/* Dilim adı ekrandaki etiket, kod veritabanındaki değer.
                  Ada göre süzmek eşleşmiyordu. */}
              <Halka
                bas={(d) =>
                  d.kod && kirilimAc("ariza", "durum", "Durum", { ad: d.kod })
                }
                dilimler={[
                  { ad: "Açık", kod: "acik", deger: a.acik ?? 0, renk: "#e8481c" },
                  { ad: "İşlemde", kod: "islemde", deger: a.islemde ?? 0, renk: "#1a4d80" },
                  { ad: "Beklemede", kod: "beklemede", deger: a.beklemede ?? 0, renk: "#d48806" },
                  { ad: "Çözüldü", kod: "cozuldu", deger: a.cozuldu ?? 0, renk: "#7cb518" },
                  { ad: "Kapandı", kod: "kapandi", deger: a.kapandi ?? 0, renk: "#9aa3af" },
                ]}
              />
            </Kart>

            <Kart baslik="Öncelik">
              <Halka
                dilimler={[
                  { ad: "Yüksek", deger: a.oncelik?.yuksek ?? 0, renk: "#cf1322" },
                  { ad: "Orta", deger: a.oncelik?.orta ?? 0, renk: "#d48806" },
                  { ad: "Düşük", deger: a.oncelik?.dusuk ?? 0, renk: "#7cb518" },
                ]}
              />
            </Kart>

            <Kart baslik="Departmanlara göre">
              <Satirlar
                kayitlar={a.departmanlar ?? []}
                renkli="#1a4d80"
                bas={(k) => kirilimAc("ariza", "departman", "Departman", k)}
              />
            </Kart>

            <Kart baslik="Şubelere göre">
              <Satirlar
                kayitlar={a.subeler ?? []}
                bas={(k) => kirilimAc("ariza", "sube", "Şube", k)}
              />
            </Kart>

            <Kart baslik="Cihaz türüne göre">
              <Satirlar
                kayitlar={a.cihazlar ?? []}
                renkli="#722ed1"
                bas={(k) => kirilimAc("ariza", "cihaz", "Cihaz türü", k)}
              />
            </Kart>
          </>
        ) : sekme === "maliyet" ? (
          <>
            <View style={s.kutular}>
              <SayiKutu ad="Servis kaydı" deger={m.adet ?? 0} />
              <SayiKutu ad="Toplam" deger={paraYaz(m.toplam)} renkli="#722ed1" />
              <SayiKutu ad="Parça" deger={paraYaz(m.parca)} renkli="#1a4d80" />
              <SayiKutu ad="İşçilik" deger={paraYaz(m.iscilik)} renkli={renk.yesilKoyu} />
            </View>

            <Kart baslik="Parça / işçilik">
              <Halka
                etiket="₺"
                dilimler={[
                  { ad: "Parça", deger: Math.round(Number(m.parca ?? 0)), renk: "#1a4d80" },
                  { ad: "İşçilik", deger: Math.round(Number(m.iscilik ?? 0)), renk: "#7cb518" },
                ]}
              />
            </Kart>

            <Kart baslik="Müdahale biçimi">
              <Halka
                dilimler={[
                  { ad: "Uzaktan", deger: m.mudahale?.uzaktan ?? 0, renk: "#7cb518" },
                  { ad: "Yerinde", deger: m.mudahale?.yerinde ?? 0, renk: "#1a4d80" },
                  { ad: "Merkezde", deger: m.mudahale?.merkezde ?? 0, renk: "#d48806" },
                ]}
              />
            </Kart>

            <Kart baslik="Şubelere göre maliyet">
              <Satirlar
                kayitlar={m.subeler ?? []}
                renkli="#722ed1"
                biciml={paraYaz}
                bas={(k) => kirilimAc("maliyet", "sube", "Şube", k)}
              />
            </Kart>

            <Kart baslik="Departmanlara göre">
              <Satirlar
                kayitlar={m.departmanlar ?? []}
                renkli="#1a4d80"
                biciml={paraYaz}
                bas={(k) => kirilimAc("maliyet", "departman", "Departman", k)}
              />
            </Kart>
          </>
        ) : sekme === "rakip" ? (
          <>
            <View style={s.kutular}>
              <SayiKutu ad="Karşılaştırma" deger={r.adet ?? 0} />
              <SayiKutu ad="Bizde pahalı" deger={r.pahali ?? 0} renkli="#cf1322" />
              <SayiKutu ad="Bizde ucuz" deger={r.ucuz ?? 0} renkli={renk.yesilKoyu} />
              <SayiKutu
                ad="Pahalı oranı"
                deger={r.adet ? `%${Math.round(((r.pahali ?? 0) / r.adet) * 100)}` : "—"}
                renkli="#d48806"
              />
            </View>

            <Kart baslik="Fiyat konumu">
              <Halka
                dilimler={[
                  { ad: "Bizde pahalı", deger: r.pahali ?? 0, renk: "#cf1322" },
                  { ad: "Bizde ucuz", deger: r.ucuz ?? 0, renk: "#7cb518" },
                  {
                    ad: "Eşit",
                    deger: Math.max((r.adet ?? 0) - (r.pahali ?? 0) - (r.ucuz ?? 0), 0),
                    renk: "#9aa3af",
                  },
                ]}
              />
            </Kart>

            <Kart baslik="Rakiplere göre">
              <Satirlar
                kayitlar={r.rakipler ?? []}
                renkli="#1a4d80"
                bas={(k) => kirilimAc("rakip", "rakip", "Rakip", k)}
              />
            </Kart>

            <Kart baslik="Şubelere göre">
              <Satirlar
                kayitlar={r.subeler ?? []}
                bas={(k) => kirilimAc("rakip", "sube", "Şube", k)}
              />
            </Kart>
          </>
        ) : sekme === "ik" ? (
          <>
            <Text style={s.bolumBaslik}>Başvurular</Text>

            <View style={s.kutular}>
              <SayiKutu ad="Toplam başvuru" deger={ik?.basvuru?.toplam ?? 0} />
              <SayiKutu ad="Yeni / değerlendirmede" deger={ik?.basvuru?.yeni ?? 0} renkli="#1a4d80" />
              <SayiKutu ad="Görüşme talebi" deger={ik?.basvuru?.gorusme ?? 0} renkli="#d48806" />
              <SayiKutu ad="İşe alınan" deger={ik?.basvuru?.iseAlinan ?? 0} renkli={renk.yesilKoyu} />
            </View>

            <Kart baslik="Günlük başvuru">
              <Cubuk kayitlar={ik?.basvuru?.gunluk ?? []} />
            </Kart>

            <Kart baslik="Başvuru durumu">
              <Halka
                etiket="başvuru"
                bas={(d) =>
                  d.kod && kirilimAc("basvuru", "durum", "Durum", { ad: d.kod }, true)
                }
                dilimler={[
                  /* Yeni ve Olumlu birden çok durumu topluyor; tek koda
                     indirgenemediği için dokunma kapalı. Diğerleri tek
                     durum, doğrudan süzülebiliyor. */
                  { ad: "Yeni", deger: ik?.basvuru?.yeni ?? 0, renk: "#1a4d80" },
                  { ad: "Görüşme", kod: "Görüşme Talebi",
                    deger: ik?.basvuru?.gorusme ?? 0, renk: "#d48806" },
                  { ad: "Olumlu", deger: ik?.basvuru?.olumlu ?? 0, renk: "#7cb518" },
                  { ad: "İşe alındı", kod: "İşe Alındı",
                    deger: ik?.basvuru?.iseAlinan ?? 0, renk: "#5f8c10" },
                  { ad: "Olumsuz", kod: "Olumsuz",
                    deger: ik?.basvuru?.olumsuz ?? 0, renk: "#9aa3af" },
                ]}
              />
            </Kart>

            <Kart baslik="Şubelere göre başvuru">
              <Satirlar
                kayitlar={ik?.basvuru?.subeler ?? []}
                bas={(k) => kirilimAc("basvuru", "sube", "Şube", k, true)}
              />
            </Kart>

            <Kart baslik="Adaylar bizi nereden duydu">
              <Satirlar
                kayitlar={ik?.basvuru?.kaynaklar ?? []}
                renkli="#722ed1"
                bas={(k) => kirilimAc("basvuru", "kaynak", "Kaynak", k, true)}
              />
            </Kart>

            <Text style={s.bolumBaslik}>Personel hareketleri</Text>

            <View style={s.kutular}>
              <SayiKutu ad="Yeni giren" deger={ik?.hareket?.yeniGiren ?? 0} renkli={renk.yesilKoyu} />
              <SayiKutu ad="Ayrılan" deger={ik?.hareket?.ayrilan ?? 0} renkli="#cf1322" />
              <SayiKutu
                ad="Net"
                deger={(ik?.hareket?.yeniGiren ?? 0) - (ik?.hareket?.ayrilan ?? 0)}
                renkli="#1a4d80"
              />
            </View>

            <Text style={s.bolumBaslik}>Vardiya okutmaları</Text>

            <View style={s.kutular}>
              <SayiKutu ad="Toplam okutma" deger={ik?.vardiya?.toplam ?? 0} />
              <SayiKutu ad="Giriş" deger={ik?.vardiya?.giris ?? 0} renkli={renk.yesilKoyu} />
              <SayiKutu ad="Çıkış" deger={ik?.vardiya?.cikis ?? 0} renkli="#1a4d80" />
              <SayiKutu ad="Konumsuz" deger={ik?.vardiya?.konumsuz ?? 0} renkli="#d48806" />
            </View>

            <Kart baslik="Şubelere göre okutma">
              <Satirlar
                kayitlar={ik?.vardiya?.subeler ?? []}
                renkli="#1a4d80"
                bas={(k) => kirilimAc("vardiya", "sube", "Şube", k, true)}
              />
            </Kart>

            <Text style={s.bolumBaslik}>Oryantasyon anketleri</Text>

            <View style={s.kutular}>
              <SayiKutu ad="Gönderilen" deger={ik?.uyumOzet?.gonderilen ?? 0} />
              <SayiKutu ad="Dolduruldu" deger={ik?.uyumOzet?.dolduruldu ?? 0} renkli={renk.yesilKoyu} />
              <SayiKutu ad="Bekleyen" deger={ik?.uyumOzet?.bekleyen ?? 0} renkli="#d48806" />
            </View>

            <Kart baslik="Doldurma oranı">
              <Halka
                etiket="anket"
                dilimler={[
                  { ad: "Dolduruldu", deger: ik?.uyumOzet?.dolduruldu ?? 0, renk: "#7cb518" },
                  { ad: "Bekleyen", deger: ik?.uyumOzet?.bekleyen ?? 0, renk: "#d48806" },
                ]}
              />
            </Kart>
          </>
        ) : (
          <>
            <View style={s.kutular}>
              <SayiKutu ad="Künye sorgusu" deger={k.adet ?? 0} />
              <SayiKutu ad="Rakip ucuz almış" deger={k.pahali ?? 0} renkli="#cf1322" />
              <SayiKutu ad="Biz ucuz almışız" deger={k.ucuz ?? 0} renkli={renk.yesilKoyu} />
            </View>

            <Kart baslik="Şubelere göre">
              <Satirlar
                kayitlar={k.subeler ?? []}
                bas={(x) => kirilimAc("kunye", "sube", "Şube", x)}
              />
            </Kart>

            <Kart baslik="Sorgulayan personel">
              <Satirlar
                kayitlar={k.sorgulayanlar ?? []}
                renkli="#722ed1"
                bas={(x) => kirilimAc("kunye", "sorgulayan", "Sorgulayan", x)}
              />
            </Kart>

            <Kart baslik="Rakip işletmeler">
              <Satirlar
                kayitlar={k.rakipler ?? []}
                renkli="#1a4d80"
                bas={(x) => kirilimAc("kunye", "rakip", "Rakip işletme", x)}
              />
            </Kart>

            <Kart baslik="Alış fiyatı konumu">
              <Halka
                dilimler={[
                  { ad: "Rakip ucuz", deger: k.pahali ?? 0, renk: "#cf1322" },
                  { ad: "Biz ucuz", deger: k.ucuz ?? 0, renk: "#7cb518" },
                  {
                    ad: "Karşılaştırılamadı",
                    deger: Math.max((k.adet ?? 0) - (k.pahali ?? 0) - (k.ucuz ?? 0), 0),
                    renk: "#9aa3af",
                  },
                ]}
              />
            </Kart>
          </>
        )}
      </ScrollView>
      {/* Tarih aralığı seçimi.

          Takvim bileşeni yerine hazır aralıklar: sahada gün gün seçmek
          yerine "geçen ay", "bu yıl" gibi kullanımlar isteniyor ve
          telefonda takvimden iki tarih seçmek yavaş. */}
      <Modal visible={aralikAcik} transparent animationType="fade">
        <View style={s.aralikZemin}>
          <View style={s.aralikKutu}>
            <Text style={s.aralikBaslik}>Tarih aralığı</Text>

            {[
              { ad: "Son 7 gün", bas: gunGeri(6) },
              { ad: "Son 30 gün", bas: gunGeri(29) },
              { ad: "Son 90 gün", bas: gunGeri(89) },
              { ad: "Son 6 ay", bas: gunGeri(179) },
              { ad: "Son 1 yıl", bas: gunGeri(364) },
            ].map((x) => (
              <TouchableOpacity
                key={x.ad}
                style={s.aralikSecenek}
                onPress={() => {
                  setAralik({ bas: x.bas, bit: gunGeri(0) });
                  setAralikAcik(false);
                }}
              >
                <Text style={s.aralikYazi}>{x.ad}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[s.aralikSecenek, s.aralikSon]}
              onPress={() => {
                setAralik(null);
                setAralikAcik(false);
              }}
            >
              <Text style={[s.aralikYazi, { color: renk.pasif }]}>
                Aralığı kaldır
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Kırılım ayrıntısı */}
      <Modal
        visible={!!ayrinti}
        animationType="slide"
        onRequestClose={() => setAyrinti(null)}
      >
        {/* Sağlayıcı pencere içinde yeniden kuruluyor: RN Modal'ı güvenli
            alan değerlerini içeri geçirmiyor ve başlık iOS'ta dinamik
            adanın altında kalıyordu. */}
        <SafeAreaProvider>
          <SafeAreaView style={s.sayfa} edges={["top", "bottom"]}>
          <View style={s.ayrintiUst}>
            <Text style={s.ayrintiBaslik} numberOfLines={2}>
              {ayrinti?.baslik}
            </Text>

            <TouchableOpacity onPress={() => setAyrinti(null)} hitSlop={12}>
              <Text style={s.ayrintiKapat}>Kapat</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.govde}>
            {ayrinti?.yukleniyor ? (
              <Yukleniyor />
            ) : ayrinti?.hata ? (
              <Hata metin={ayrinti.hata} />
            ) : (ayrinti?.kayitlar ?? []).length === 0 ? (
              <Text style={s.ikNotu}>Bu kırılımda kayıt bulunamadı.</Text>
            ) : (
              /* Kayıt türü bölüme göre değişiyor: arıza, servis formu,
                 rakip fiyat, künye, başvuru, vardiya ve anket aynı
                 pencerede gösteriliyor. Her biri için ayrı ekran açmak
                 yerine alanlar duruma göre seçiliyor. */
              ayrinti.kayitlar.map((k, i) => (
                <View key={k.id ?? i} style={s.kayitKart}>
                  <Text style={s.kayitBaslik} numberOfLines={2}>
                    {k.baslik ??
                      k.adSoyad ??
                      k.urunAdi ??
                      k.formNo ??
                      k.kunyeNo ??
                      "—"}
                  </Text>

                  <Text style={s.kayitAlt}>
                    {[k.departman, k.subeKodu, k.subeAdi, k.telefon, k.rakip]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>

                  {(k.marka || k.cihazTuru) && (
                    <Text style={s.kayitAlt}>
                      {[k.cihazTuru, k.marka, k.model].filter(Boolean).join(" ")}
                    </Text>
                  )}

                  {k.toplam != null && (
                    <Text style={s.kayitAlt}>
                      Parça {paraYaz(k.parcaTutari)} · İşçilik {paraYaz(k.iscilik)} ·
                      Toplam {paraYaz(k.toplam)}
                    </Text>
                  )}

                  {k.rakipFiyat != null && (
                    <Text style={s.kayitAlt}>
                      Bizim {paraYaz(k.bizimFiyat)} · Rakip {paraYaz(k.rakipFiyat)}
                    </Text>
                  )}

                  {k.bolumler && <Text style={s.kayitAlt}>{k.bolumler}</Text>}

                  <View style={s.kayitSatir}>
                    <Text style={s.kayitDurum}>
                      {k.durum ?? k.tur ?? k.asama ?? k.mudahale ?? "—"}
                    </Text>

                    <Text style={s.kayitAlt}>
                      {(() => {
                        const t = k.olusturma ?? k.gecis;
                        return t ? new Date(t).toLocaleDateString("tr-TR") : "";
                      })()}
                    </Text>
                  </View>
                </View>
              ))
            )}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */

function Kart({ baslik, children }) {
  return (
    <View style={s.kart}>
      <Text style={s.kartBaslik}>{baslik}</Text>
      {children}
    </View>
  );
}

/* ========================================================================== */

const s = StyleSheet.create({
  sayfa: { flex: 1, backgroundColor: renk.zemin },
  govde: { padding: 16, paddingBottom: 110 },

  ustBar: {
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
    paddingHorizontal: 16,
    paddingTop: 10,
  },

  gunSerit: { flexDirection: "row", gap: 6 },
  gunDugme: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: renk.zemin,
    alignItems: "center",
  },
  gunSecili: { backgroundColor: renk.yesilAcik },
  gunYazi: { fontSize: 12.5, color: renk.pasif, fontWeight: "600" },
  gunYaziSecili: { color: renk.yesilKoyu },

  depSerit: { gap: 6, paddingTop: 8 },
  depDugme: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: renk.cizgi,
  },
  depSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  depYazi: { fontSize: 12, color: renk.metin },
  depYaziSecili: { color: renk.yesilKoyu, fontWeight: "700" },

  ikNotu: {
    fontSize: 11,
    color: "#a3a9b0",
    marginTop: 8,
    lineHeight: 15,
  },

  sekmeler: { flexDirection: "row", marginTop: 10 },
  sekme: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  sekmeSecili: { borderBottomColor: renk.yesil },
  sekmeYazi: { fontSize: 13, color: renk.pasif, fontWeight: "600" },
  sekmeYaziSecili: { color: renk.yesilKoyu },

  bolumBaslik: {
    fontSize: 12,
    fontWeight: "800",
    color: renk.pasif,
    letterSpacing: 0.4,
    marginTop: 6,
    marginBottom: 8,
    textTransform: "uppercase",
  },

  kutular: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },

  aralikZemin: {
    flex: 1,
    backgroundColor: "rgba(20,24,18,.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  aralikKutu: {
    backgroundColor: renk.beyaz,
    borderRadius: 18,
    paddingVertical: 8,
    width: "100%",
    maxWidth: 320,
  },
  aralikBaslik: {
    fontSize: 15,
    fontWeight: "800",
    color: renk.metin,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  aralikSecenek: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: renk.cizgi,
  },
  aralikSon: { borderTopWidth: 1 },
  aralikYazi: { fontSize: 14.5, color: renk.metin },

  ayrintiUst: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: renk.beyaz,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },
  ayrintiBaslik: { flex: 1, fontSize: 15, fontWeight: "700", color: renk.metin },
  ayrintiKapat: { fontSize: 14, color: renk.yesilKoyu, fontWeight: "600" },

  kayitKart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 12,
    padding: 13,
    marginBottom: 9,
  },
  kayitBaslik: { fontSize: 14, fontWeight: "600", color: renk.metin },
  kayitAlt: { fontSize: 12, color: renk.pasif, marginTop: 3 },
  kayitSatir: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  kayitDurum: {
    fontSize: 11.5,
    fontWeight: "700",
    color: renk.yesilKoyu,
    backgroundColor: renk.yesilAcik,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 7,
  },

  kart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: olcu.yuvarlak,
    padding: 14,
    marginBottom: 10,
  },
  kartBaslik: { fontSize: 13.5, fontWeight: "700", color: renk.metin, marginBottom: 10 },
});

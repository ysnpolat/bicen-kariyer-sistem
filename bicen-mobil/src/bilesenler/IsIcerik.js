/**
 * İş içeriği — mobil
 * ---------------------------------------------------------------------------
 * İşi atan kişinin panelde kurduğu blokları gösterir ve doldurtur.
 *
 * Panelde üç blok tipi var: biçimli metin, kontrol listesi ve tablo.
 * Burada aynı yapı okunuyor ama düzenleme yok — personel yalnızca kilitli
 * olmayan hücreleri değiştirebiliyor. Çizelgenin kendisini değiştirebilmesi
 * kilitlerin anlamını ortadan kaldırırdı.
 *
 * Tablolar telefonda dar kalıyor; sütunları yan yana sıkıştırmak yerine her
 * satır kendi kartında, alanlar alt alta gösteriliyor. Yatay kaydırmalı bir
 * tablo tek elle kullanılamıyordu.
 */

import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert} from "react-native";

import { renk } from "../tema";
import Simge from "./Simge";

/* -------------------------------------------------------------------------- */

/** İşaretlenen kutucukların yüzdesi; null ise işaretlenecek bir şey yok */
export function ilerlemeHesapla(bloklar, doldurma) {
  let toplam = 0;
  let isaretli = 0;

  (bloklar ?? []).forEach((b) => {
    if (b.tip === "liste") {
      (b.maddeler ?? []).forEach((m) => {
        toplam += 1;
        if (doldurma?.[`${b.id}:${m.id}`]) isaretli += 1;
      });
    }

    if (b.tip === "tablo") {
      const onaylar = (b.sutunlar ?? []).filter((x) => x.tur === "onay");

      (b.satirlar ?? []).forEach((sat) => {
        onaylar.forEach((sut) => {
          toplam += 1;
          if (doldurma?.[`${b.id}:${sat.id}:${sut.id}`]) isaretli += 1;
        });
      });
    }
  });

  return toplam === 0 ? null : Math.round((isaretli / toplam) * 100);
}

/* ========================================================================== */

function Kutucuk({ isaretli, kapali, bas }) {
  return (
    <TouchableOpacity
      style={[s.kutucuk, isaretli && s.kutucukDolu, kapali && s.soluk]}
      disabled={kapali}
      activeOpacity={0.7}
      onPress={bas}
    >
      {isaretli ? <Simge ad="onay" boyut={14} renkli={renk.beyaz} /> : null}
    </TouchableOpacity>
  );
}

/* ========================================================================== */

export default function IsIcerik({
  bloklar,
  doldurma,
  setDoldurma,
  duzenlenebilir,

  /* İş bittikten sonra yapılan düzenlemeler ayrıca işaretleniyor:
     kontrol eden kişi neyin sonradan değiştiğini görmeli. */
  bittiktenSonra = false,
}) {
  const yaz = (anahtar, deger) => {
    const onceki = doldurma?.[anahtar];
    const sonraki = { ...(doldurma ?? {}), [anahtar]: deger };

    /* Bitmiş işte yapılan değişiklik kaydediliyor: eski değer, yeni değer
       ve zaman. Kontrol eden kişi neyin sonradan düzeltildiğini görüyor.

       İz doldurma nesnesinin içinde tutuluyor; ayrı bir sütun açmak
       sunucu ve panel tarafında da değişiklik gerektiriyordu. */
    if (bittiktenSonra && onceki !== deger) {
      const izler = { ...(doldurma?.__duzenleme ?? {}) };

      izler[anahtar] = {
        eski: izler[anahtar]?.eski ?? (onceki ?? ""),
        yeni: deger,
        zaman: new Date().toISOString(),
      };

      sonraki.__duzenleme = izler;
    }

    setDoldurma?.(sonraki);
  };

  /** Bu alanda bitişten sonra düzenleme var mı */
  const izVar = (anahtar) => doldurma?.__duzenleme?.[anahtar];

  if (!bloklar?.length) return null;

  return (
    <View style={{ gap: 12 }}>
      {bloklar.map((b) => {
        if (b.tip === "metin") {
          const bicim = b.bicim ?? {};

          return (
            <Text
              key={b.id}
              style={{
                fontSize: bicim.boyut ?? 14,
                fontWeight: bicim.kalin ? "700" : "400",
                fontStyle: bicim.egik ? "italic" : "normal",
                color: bicim.renk ?? renk.metin,
                lineHeight: (bicim.boyut ?? 14) * 1.45,
              }}
            >
              {b.metin}
            </Text>
          );
        }

        if (b.tip === "liste") {
          return (
            <View key={b.id} style={s.kart}>
              {b.baslik ? <Text style={s.kartBaslik}>{b.baslik}</Text> : null}

              {(b.maddeler ?? []).map((m) => {
                const anahtar = `${b.id}:${m.id}`;
                const isaretli = !!doldurma?.[anahtar];

                return (
                  <TouchableOpacity
                    key={m.id}
                    style={s.madde}
                    activeOpacity={duzenlenebilir ? 0.7 : 1}
                    disabled={!duzenlenebilir}
                    onPress={() => yaz(anahtar, !isaretli)}
                  >
                    <Kutucuk
                      isaretli={isaretli}
                      kapali={!duzenlenebilir}
                      bas={() => yaz(anahtar, !isaretli)}
                    />

                    <Text style={[s.maddeYazi, isaretli && s.maddeBitti]}>
                      {m.metin}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        }

        /* Tablo: her satır kendi kartında, alanlar alt alta. Telefonda
           yatay kaydırmalı tablo tek elle kullanılamıyordu. */
        return (
          <View key={b.id} style={s.kart}>
            {b.baslik ? <Text style={s.kartBaslik}>{b.baslik}</Text> : null}

            {(b.satirlar ?? []).map((sat, sira) => (
              <View key={sat.id} style={s.satir}>
                <Text style={s.satirNo}>{sira + 1}</Text>

                <View style={{ flex: 1, gap: 7 }}>
                  {(b.sutunlar ?? []).map((sut) => {
                    const anahtar = `${b.id}:${sat.id}:${sut.id}`;
                    const kilit = !!sut.kilit || !!sat.kilit || !duzenlenebilir;
                    const onDeger = sat.hucreler?.[sut.id];

                    if (sut.tur === "onay")
                      return (
                        <View key={sut.id} style={s.alanSatir}>
                          <View style={s.alanBaslik}>
                            <Text style={s.alanAd}>{sut.ad}</Text>
                            <Iz iz={izVar(anahtar)} />
                          </View>

                          <Kutucuk
                            isaretli={!!doldurma?.[anahtar]}
                            kapali={kilit}
                            bas={() => yaz(anahtar, !doldurma?.[anahtar])}
                          />
                        </View>
                      );

                    /* Seçim sütunu: şıklar yan yana düğme olarak.

                       Açılır liste yerine düğme kullanılıyor; sahada tek
                       dokunuşla işaretlemek, listeyi açıp kaydırmaktan
                       hızlı ve eldivenle de çalışıyor. */
                    if (sut.tur === "secim" && !kilit) {
                      const secili = doldurma?.[anahtar] ?? onDeger ?? "";

                      return (
                        <View key={sut.id}>
                          <View style={s.alanBaslik}>
                            <Text style={s.alanAd}>{sut.ad}</Text>
                            <Iz iz={izVar(anahtar)} />
                          </View>

                          <View style={s.secenekler}>
                            {(sut.secenekler ?? []).map((x) => (
                              <TouchableOpacity
                                key={x}
                                style={[
                                  s.secenek,
                                  secili === x && s.secenekSecili,
                                ]}
                                onPress={() => yaz(anahtar, secili === x ? "" : x)}
                                activeOpacity={0.7}
                              >
                                <Text
                                  style={[
                                    s.secenekYazi,
                                    secili === x && s.secenekYaziSecili,
                                  ]}
                                >
                                  {x}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      );
                    }

                    /* Kilitli alan girdi değil metin: dokunulabilir
                       görünen ama yazılamayan bir kutu kafa karıştırıyor. */
                    if (kilit)
                      return (
                        <View key={sut.id} style={s.alanSatir}>
                          <Text style={s.alanAd}>{sut.ad}</Text>
                          <Text style={s.alanDeger}>
                            {doldurma?.[anahtar] ?? onDeger ?? "—"}
                          </Text>
                        </View>
                      );

                    return (
                      <View key={sut.id}>
                        <View style={s.alanBaslik}>
                          <Text style={s.alanAd}>{sut.ad}</Text>
                          <Iz iz={izVar(anahtar)} />
                        </View>

                        <TextInput
                          style={s.girdi}
                          value={String(doldurma?.[anahtar] ?? onDeger ?? "")}
                          keyboardType={sut.tur === "sayi" ? "numeric" : "default"}
                          onChangeText={(d) => yaz(anahtar, d)}
                          placeholder="Yazınız"
                          placeholderTextColor="#c8ccc4"
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* Yorum satırı: yalnızca işi yapan yazıyor */}
            {duzenlenebilir || doldurma?.[`${b.id}:yorum`] ? (
              <View style={s.yorum}>
                <Text style={s.alanAd}>Notunuz</Text>

                <TextInput
                  style={[s.girdi, s.uzunGirdi]}
                  value={doldurma?.[`${b.id}:yorum`] ?? ""}
                  multiline
                  editable={duzenlenebilir}
                  onChangeText={(d) => yaz(`${b.id}:yorum`, d)}
                  placeholder="Eklemek istediğiniz not"
                  placeholderTextColor="#c8ccc4"
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/* ========================================================================== */

/**
 * Düzenleme izi rozeti.
 *
 * İş bittikten sonra değiştirilen alanın yanında duruyor; dokununca eski
 * ve yeni değeri gösteriyor. Kontrol eden kişi "burada bir şey değişmiş"
 * demekle yetinmemeli, neyin değiştiğini de görmeli.
 */
function Iz({ iz }) {
  if (!iz) return null;

  const yaz = (d) =>
    d === true ? "işaretli" : d === false || d === "" ? "boş" : String(d);

  return (
    <TouchableOpacity
      onPress={() =>
        Alert.alert(
          "Bitişten sonra düzenlendi",
          `Önce: ${yaz(iz.eski)}\nSonra: ${yaz(iz.yeni)}\n\n` +
            new Date(iz.zaman).toLocaleString("tr-TR")
        )
      }
      hitSlop={8}
    >
      <Text style={s.izRozet}>düzenlendi</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  alanBaslik: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },

  /* Turuncu: bitmiş işte sonradan yapılan değişiklik dikkat çekmeli ama
     hata gibi de görünmemeli. */
  izRozet: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#e8481c",
    backgroundColor: "#fff1ed",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },

  secenekler: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 4 },
  secenek: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: renk.cizgi,
    backgroundColor: renk.beyaz,
  },
  secenekSecili: { borderColor: renk.yesil, backgroundColor: renk.yesilAcik },
  secenekYazi: { fontSize: 13, color: renk.metin },
  secenekYaziSecili: { color: renk.yesilKoyu, fontWeight: "700" },

  kart: {
    backgroundColor: renk.beyaz,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 13,
    padding: 13,
  },
  kartBaslik: {
    fontSize: 14.5,
    fontWeight: "700",
    color: renk.metin,
    marginBottom: 10,
  },

  madde: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  maddeYazi: { flex: 1, fontSize: 14, color: renk.metin, lineHeight: 20 },
  maddeBitti: { color: renk.pasif, textDecorationLine: "line-through" },

  kutucuk: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: renk.cizgi,
    alignItems: "center",
    justifyContent: "center",
  },
  kutucukDolu: { backgroundColor: renk.yesil, borderColor: renk.yesil },
  soluk: { opacity: 0.5 },

  satir: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: "#f2f4f0",
  },
  satirNo: {
    width: 22,
    fontSize: 12,
    fontWeight: "700",
    color: renk.pasif,
    marginTop: 2,
  },

  alanSatir: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  alanAd: { fontSize: 12, color: renk.pasif, marginBottom: 3 },
  alanDeger: { fontSize: 14, color: renk.metin, fontWeight: "500", flexShrink: 1 },

  girdi: {
    backgroundColor: renk.zemin,
    borderWidth: 1,
    borderColor: renk.cizgi,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
    color: renk.metin,
  },
  uzunGirdi: { height: 80, textAlignVertical: "top", paddingTop: 9 },

  yorum: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#f2f4f0", paddingTop: 11 },
});

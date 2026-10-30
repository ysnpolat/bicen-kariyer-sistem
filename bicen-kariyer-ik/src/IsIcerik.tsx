/**
 * ---------------------------------------------------------------------------
 * İş İçeriği
 * ---------------------------------------------------------------------------
 * İş emrinin gövdesi: biçimli metin, tablo ve kontrol listesi blokları.
 *
 * Açıklama düz metindi; bir işi maddelere bölmek, hangi maddenin
 * yapıldığını takip etmek ya da sütunlu bir çizelge vermek mümkün değildi.
 *
 * İki kip var. **Düzenleme** kipinde işi atan blokları kuruyor: sütun
 * ekliyor, satır ekliyor, hangilerinin kilitli olacağına karar veriyor.
 * **Doldurma** kipinde atanan kişi yalnızca kilitli olmayan hücreleri
 * değiştirebiliyor; çizelgenin kendisine dokunamıyor.
 *
 * Özgün içerik ile doldurulan değerler ayrı saklanıyor: iş atayan neyi
 * verdiğini, atanan neyi doldurduğunu ayrı görebilmeli.
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  ColorPicker,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Bold,
  ChevronDown,
  ChevronDown as ChevronDown2,
  ChevronUp,
  Heading,
  Italic,
  Lock,
  MessageSquare,
  Plus,
  Table2,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";

import { RENK } from "./sabitler";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */

export type Blok =
  | {
      tip: "metin";
      id: string;
      metin: string;
      bicim?: {
        kalin?: boolean;
        egik?: boolean;
        boyut?: number;
        renk?: string;
      };
    }
  | {
      tip: "liste";
      id: string;
      baslik?: string;
      maddeler: { id: string; metin: string }[];
    }
  | {
      tip: "tablo";
      id: string;
      baslik?: string;
      sutunlar: {
        id: string;
        ad: string;
        tur: "metin" | "onay" | "sayi" | "tarih" | "secim";

        /* Seçim sütununun şıkları. Sunucu ram kontrolü gibi işlerde
           "yapıldı / yapılmadı" yetmiyor; %10, %20 gibi kademeler ya da
           "temiz / kirli / arızalı" gibi durumlar gerekiyordu. */
        secenekler?: string[];
        kilit?: boolean;

        /* Genişlik ve hizalama: sayı sütunu sağa dayalı olmadığında
           rakamlar birbirini tutmuyor ve karşılaştırmak zorlaşıyordu. */
        genislik?: number;
        hizala?: "sol" | "orta" | "sag";
      }[];
      satirlar: {
        id: string;
        hucreler: Record<string, string>;
        kilit?: boolean;

        /* Başlık satırı: ara başlık vermek için. Uzun çizelgelerde
           bölümleri ayırmadan hangi satırın neyle ilgili olduğu
           kaybolıyordu. */
        baslikMi?: boolean;
        renk?: string;
      }[];
      yorumSutunu?: boolean;
    };

const kimlik = () => Math.random().toString(36).slice(2, 9);

/** Doldurma değerlerinden ilerleme yüzdesi */
export function ilerlemeHesapla(bloklar: Blok[], doldurma: Record<string, any>) {
  let toplam = 0;
  let isaretli = 0;

  bloklar.forEach((b) => {
    if (b.tip === "liste") {
      b.maddeler.forEach((m) => {
        toplam += 1;
        if (doldurma?.[`${b.id}:${m.id}`]) isaretli += 1;
      });
    }

    if (b.tip === "tablo") {
      const onaylar = b.sutunlar.filter((x) => x.tur === "onay");

      b.satirlar.forEach((sat) => {
        onaylar.forEach((sut) => {
          toplam += 1;
          if (doldurma?.[`${b.id}:${sat.id}:${sut.id}`]) isaretli += 1;
        });
      });
    }
  });

  /* İşaretlenecek hiçbir şey yoksa oran yok; sıfır göstermek işi hiç
     yapılmamış gibi gösteriyordu. */
  return toplam === 0 ? null : Math.round((isaretli / toplam) * 100);
}

/* ========================================================================== */

export default function IsIcerik({
  bloklar,
  setBloklar,
  doldurma,
  setDoldurma,
  kip,
}: {
  bloklar: Blok[];
  setBloklar?: (b: Blok[]) => void;
  doldurma: Record<string, any>;
  setDoldurma?: (d: Record<string, any>) => void;
  kip: "duzenle" | "doldur" | "goster";
}) {
  const duzenle = kip === "duzenle";
  const doldur = kip === "doldur";

  const guncelle = (id: string, yeni: Partial<Blok>) =>
    setBloklar?.(bloklar.map((b) => (b.id === id ? ({ ...b, ...yeni } as Blok) : b)));

  const sil = (id: string) => setBloklar?.(bloklar.filter((b) => b.id !== id));

  const ekle = (tip: string) => {
    const yeni: Blok =
      tip === "metin"
        ? { tip: "metin", id: kimlik(), metin: "", bicim: { boyut: 14 } }
        : tip === "liste"
        ? {
            tip: "liste",
            id: kimlik(),
            baslik: "",
            maddeler: [{ id: kimlik(), metin: "" }],
          }
        : {
            tip: "tablo",
            id: kimlik(),
            baslik: "",
            sutunlar: [
              { id: kimlik(), ad: "İş", tur: "metin", kilit: true },
              { id: kimlik(), ad: "Yapıldı", tur: "onay" },
            ],
            satirlar: [{ id: kimlik(), hucreler: {} }],
          };

    setBloklar?.([...bloklar, yeni]);
  };

  if (bloklar.length === 0 && !duzenle)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="İçerik yok." />;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {bloklar.map((b) =>
        b.tip === "metin" ? (
          <MetinBlok
            key={b.id}
            blok={b}
            duzenle={duzenle}
            guncelle={(y) => guncelle(b.id, y)}
            sil={() => sil(b.id)}
          />
        ) : b.tip === "liste" ? (
          <ListeBlok
            key={b.id}
            blok={b}
            duzenle={duzenle}
            doldur={doldur}
            doldurma={doldurma}
            setDoldurma={setDoldurma}
            guncelle={(y) => guncelle(b.id, y)}
            sil={() => sil(b.id)}
          />
        ) : (
          <TabloBlok
            key={b.id}
            blok={b}
            duzenle={duzenle}
            doldur={doldur}
            doldurma={doldurma}
            setDoldurma={setDoldurma}
            guncelle={(y) => guncelle(b.id, y)}
            sil={() => sil(b.id)}
          />
        )
      )}

      {duzenle && (
        <Dropdown
          menu={{
            items: [
              { key: "metin", label: "Metin", icon: <Type size={14} /> },
              {
                key: "liste",
                label: "Kontrol listesi",
                icon: <MessageSquare size={14} />,
              },
              { key: "tablo", label: "Tablo", icon: <Table2 size={14} /> },
            ],
            onClick: ({ key }) => ekle(key),
          }}
        >
          <Button block type="dashed" icon={<Plus size={15} strokeWidth={2} />}>
            Bölüm ekle <ChevronDown size={13} />
          </Button>
        </Dropdown>
      )}
    </Space>
  );
}

/* ========================================================================== */

function MetinBlok({ blok, duzenle, guncelle, sil }: any) {
  const bicim = blok.bicim ?? {};

  const stil = {
    fontWeight: bicim.kalin ? 700 : 400,
    fontStyle: bicim.egik ? "italic" : "normal",
    fontSize: bicim.boyut ?? 14,
    color: bicim.renk ?? RENK.metin,
    whiteSpace: "pre-wrap" as const,
    margin: 0,
  };

  if (!duzenle) return <div style={stil}>{blok.metin}</div>;

  return (
    <Card size="small" styles={{ body: { padding: 10 } }}>
      <Space style={{ marginBottom: 8 }} wrap>
        {/* Biçim düğmeleri: uzun bir işin başlığını kalın yazabilmek, işi
            okunur yapmanın en ucuz yolu. */}
        <Tooltip title="Kalın">
          <Button
            size="small"
            type={bicim.kalin ? "primary" : "default"}
            icon={<Bold size={14} strokeWidth={2.5} />}
            onClick={() => guncelle({ bicim: { ...bicim, kalin: !bicim.kalin } })}
          />
        </Tooltip>

        <Tooltip title="Eğik">
          <Button
            size="small"
            type={bicim.egik ? "primary" : "default"}
            icon={<Italic size={14} strokeWidth={2.5} />}
            onClick={() => guncelle({ bicim: { ...bicim, egik: !bicim.egik } })}
          />
        </Tooltip>

        <Select
          size="small"
          style={{ width: 92 }}
          value={bicim.boyut ?? 14}
          onChange={(d) => guncelle({ bicim: { ...bicim, boyut: d } })}
          options={[
            { value: 12, label: "Küçük" },
            { value: 14, label: "Normal" },
            { value: 17, label: "Büyük" },
            { value: 21, label: "Başlık" },
          ]}
        />

        <ColorPicker
          size="small"
          value={bicim.renk ?? RENK.metin}
          presets={[
            {
              label: "Sık kullanılan",
              colors: [RENK.metin, RENK.yesilKoyu, RENK.turuncu, "#cf1322", "#0958d9"],
            },
          ]}
          onChange={(d) => guncelle({ bicim: { ...bicim, renk: d.toHexString() } })}
        />

        <Button
          size="small"
          type="text"
          danger
          icon={<Trash2 size={14} strokeWidth={2} />}
          onClick={sil}
        />
      </Space>

      <Input.TextArea
        rows={3}
        value={blok.metin}
        onChange={(e) => guncelle({ metin: e.target.value })}
        placeholder="Açıklama yazınız"
        style={{ ...stil, resize: "vertical" }}
      />
    </Card>
  );
}

/* ========================================================================== */

function ListeBlok({
  blok,
  duzenle,
  doldur,
  doldurma,
  setDoldurma,
  guncelle,
  sil,
}: any) {
  const isaret = (maddeId: string, deger: boolean) =>
    setDoldurma?.({ ...doldurma, [`${blok.id}:${maddeId}`]: deger });

  return (
    <Card
      size="small"
      title={
        duzenle ? (
          <Input
            variant="borderless"
            placeholder="Kontrol listesi başlığı"
            value={blok.baslik}
            onChange={(e) => guncelle({ baslik: e.target.value })}
          />
        ) : (
          blok.baslik || "Kontrol listesi"
        )
      }
      extra={
        duzenle && (
          <Button
            size="small"
            type="text"
            danger
            icon={<Trash2 size={14} strokeWidth={2} />}
            onClick={sil}
          />
        )
      }
    >
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        {blok.maddeler.map((m: any) => (
          <Space key={m.id} align="start" style={{ width: "100%" }}>
            <Checkbox
              checked={!!doldurma?.[`${blok.id}:${m.id}`]}
              disabled={!doldur}
              onChange={(e) => isaret(m.id, e.target.checked)}
            />

            {duzenle ? (
              <>
                <Input
                  size="small"
                  style={{ width: 420 }}
                  value={m.metin}
                  placeholder="Madde"
                  onChange={(e) =>
                    guncelle({
                      maddeler: blok.maddeler.map((x: any) =>
                        x.id === m.id ? { ...x, metin: e.target.value } : x
                      ),
                    })
                  }
                />

                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<Trash2 size={13} strokeWidth={2} />}
                  onClick={() =>
                    guncelle({
                      maddeler: blok.maddeler.filter((x: any) => x.id !== m.id),
                    })
                  }
                />
              </>
            ) : (
              <Text
                delete={!!doldurma?.[`${blok.id}:${m.id}`]}
                type={doldurma?.[`${blok.id}:${m.id}`] ? "secondary" : undefined}
              >
                {m.metin}
              </Text>
            )}
          </Space>
        ))}

        {duzenle && (
          <Button
            size="small"
            type="dashed"
            icon={<Plus size={13} strokeWidth={2} />}
            onClick={() =>
              guncelle({
                maddeler: [...blok.maddeler, { id: kimlik(), metin: "" }],
              })
            }
          >
            Madde ekle
          </Button>
        )}
      </Space>
    </Card>
  );
}

/* ========================================================================== */

function TabloBlok({
  blok,
  duzenle,
  doldur,
  doldurma,
  setDoldurma,
  guncelle,
  sil,
}: any) {
  const deger = (satId: string, sutId: string) =>
    doldurma?.[`${blok.id}:${satId}:${sutId}`];

  /* Bitişten sonra yapılan düzenlemeler doldurma nesnesinin içinde
     __duzenleme anahtarında tutuluyor. Kontrol eden kişi neyin sonradan
     değiştiğini görmeli; "tamamlandı" damgası tek başına yetmiyor. */
  const iz = (satId: string, sutId: string) =>
    (doldurma as any)?.__duzenleme?.[`${blok.id}:${satId}:${sutId}`];

  const yaz = (satId: string, sutId: string, d: any) =>
    setDoldurma?.({ ...doldurma, [`${blok.id}:${satId}:${sutId}`]: d });

  /* Kilitli sütun ve satırlar atanan kişiye salt okunur geliyor: işi atan
     çizelgenin hangi kısmına dokunulmayacağını belirlemeli. */
  const kilitli = (sat: any, sut: any) => !!sut.kilit || !!sat.kilit;

  /** Satırı bir yukarı ya da aşağı taşır */
  const tasi = (sira: number, yon: number) => {
    const hedef = sira + yon;

    if (hedef < 0 || hedef >= blok.satirlar.length) return;

    const yeni = [...blok.satirlar];

    [yeni[sira], yeni[hedef]] = [yeni[hedef], yeni[sira]];

    guncelle({ satirlar: yeni });
  };

  return (
    <Card
      size="small"
      title={
        duzenle ? (
          <Input
            variant="borderless"
            placeholder="Tablo başlığı"
            value={blok.baslik}
            onChange={(e) => guncelle({ baslik: e.target.value })}
          />
        ) : (
          blok.baslik || "Tablo"
        )
      }
      extra={
        duzenle && (
          <Space size={4}>
            <Button
              size="small"
              onClick={() =>
                guncelle({
                  sutunlar: [
                    ...blok.sutunlar,
                    { id: kimlik(), ad: "Sütun", tur: "metin" },
                  ],
                })
              }
            >
              Sütun ekle
            </Button>

            <Button
              size="small"
              type="text"
              danger
              icon={<Trash2 size={14} strokeWidth={2} />}
              onClick={sil}
            />
          </Space>
        )
      }
      styles={{ body: { padding: 10, overflowX: "auto" } }}
    >
      <table className="is-tablo">
        <thead>
          <tr>
            {blok.sutunlar.map((sut: any) => (
              <th
                key={sut.id}
                style={{
                  width: sut.genislik ? `${sut.genislik}px` : undefined,
                  textAlign:
                    sut.hizala === "sag"
                      ? "right"
                      : sut.hizala === "orta"
                      ? "center"
                      : "left",
                }}
              >
                {duzenle ? (
                  <Space direction="vertical" size={3} style={{ width: "100%" }}>
                    <Input
                      size="small"
                      value={sut.ad}
                      onChange={(e) =>
                        guncelle({
                          sutunlar: blok.sutunlar.map((x: any) =>
                            x.id === sut.id ? { ...x, ad: e.target.value } : x
                          ),
                        })
                      }
                    />

                    <Space size={3}>
                      <Select
                        size="small"
                        style={{ width: 86 }}
                        value={sut.tur}
                        onChange={(d) =>
                          guncelle({
                            sutunlar: blok.sutunlar.map((x: any) =>
                              x.id === sut.id ? { ...x, tur: d } : x
                            ),
                          })
                        }
                        options={[
                          { value: "metin", label: "Metin" },
                          { value: "onay", label: "Onay" },
                          { value: "sayi", label: "Sayı" },
                          { value: "tarih", label: "Tarih" },
                          { value: "secim", label: "Seçim" },
                        ]}
                      />

                      {/* Seçim sütununun şıkları virgülle yazılıyor:
                          ayrı bir düzenleme ekranı açmak, iki şık için
                          gereksiz bir adım olurdu. */}
                      {sut.tur === "secim" && (
                        <Tooltip title="Şıkları virgülle ayırınız">
                          <Input
                            size="small"
                            style={{ width: 190 }}
                            placeholder="%10, %20, %30"
                            value={(sut.secenekler ?? []).join(", ")}
                            onChange={(e) =>
                              guncelle({
                                sutunlar: blok.sutunlar.map((x: any) =>
                                  x.id === sut.id
                                    ? {
                                        ...x,
                                        secenekler: e.target.value
                                          .split(",")
                                          .map((y) => y.trim())
                                          .filter(Boolean),
                                      }
                                    : x
                                ),
                              })
                            }
                          />
                        </Tooltip>
                      )}

                      <Tooltip title="Hizalama">
                        <Select
                          size="small"
                          style={{ width: 64 }}
                          value={sut.hizala ?? "sol"}
                          onChange={(d) =>
                            guncelle({
                              sutunlar: blok.sutunlar.map((x: any) =>
                                x.id === sut.id ? { ...x, hizala: d } : x
                              ),
                            })
                          }
                          options={[
                            { value: "sol", label: "◧" },
                            { value: "orta", label: "◫" },
                            { value: "sag", label: "◨" },
                          ]}
                        />
                      </Tooltip>

                      <Tooltip title="Sütun genişliği (boş bırakılırsa kendiliğinden)">
                        <InputNumber
                          size="small"
                          style={{ width: 68 }}
                          min={60}
                          max={600}
                          placeholder="px"
                          value={sut.genislik}
                          onChange={(d) =>
                            guncelle({
                              sutunlar: blok.sutunlar.map((x: any) =>
                                x.id === sut.id ? { ...x, genislik: d } : x
                              ),
                            })
                          }
                        />
                      </Tooltip>

                      <Tooltip
                        title={
                          sut.kilit
                            ? "Kilitli: atanan bu sütunu değiştiremez"
                            : "Açık: atanan doldurabilir"
                        }
                      >
                        <Button
                          size="small"
                          type={sut.kilit ? "primary" : "default"}
                          icon={
                            sut.kilit ? (
                              <Lock size={12} strokeWidth={2} />
                            ) : (
                              <Unlock size={12} strokeWidth={2} />
                            )
                          }
                          onClick={() =>
                            guncelle({
                              sutunlar: blok.sutunlar.map((x: any) =>
                                x.id === sut.id ? { ...x, kilit: !x.kilit } : x
                              ),
                            })
                          }
                        />
                      </Tooltip>

                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<Trash2 size={12} strokeWidth={2} />}
                        onClick={() =>
                          guncelle({
                            sutunlar: blok.sutunlar.filter((x: any) => x.id !== sut.id),
                          })
                        }
                      />
                    </Space>
                  </Space>
                ) : (
                  <Space size={4}>
                    {sut.ad}
                    {sut.kilit && (
                      <Tooltip title="Bu sütun düzenlenemez">
                        <Lock size={11} strokeWidth={2} />
                      </Tooltip>
                    )}
                  </Space>
                )}
              </th>
            ))}

            {duzenle && <th style={{ width: 40 }} />}
          </tr>
        </thead>

        <tbody>
          {blok.satirlar.map((sat: any, sira: number) => (
            <tr
              key={sat.id}
              className={[
                sat.kilit ? "is-satir-kilit" : "",
                sat.baslikMi ? "is-satir-baslik" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={sat.renk ? { background: sat.renk } : undefined}
            >
              {blok.sutunlar.map((sut: any) => (
                <td
                  key={sut.id}
                  style={{
                    textAlign:
                      sut.hizala === "sag"
                        ? "right"
                        : sut.hizala === "orta"
                        ? "center"
                        : "left",
                  }}
                >
                  {duzenle ? (
                    /* Düzenlemede hücre içeriği ön değer: işi atan hazır
                       metni yazıyor, atanan üzerine dolduruyor. */
                    sut.tur === "onay" ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        onay kutusu
                      </Text>
                    ) : (
                      <Input
                        size="small"
                        value={sat.hucreler?.[sut.id] ?? ""}
                        placeholder="Ön değer"
                        onChange={(e) =>
                          guncelle({
                            satirlar: blok.satirlar.map((x: any) =>
                              x.id === sat.id
                                ? {
                                    ...x,
                                    hucreler: {
                                      ...x.hucreler,
                                      [sut.id]: e.target.value,
                                    },
                                  }
                                : x
                            ),
                          })
                        }
                      />
                    )
                  ) : sut.tur === "onay" ? (
                    <Checkbox
                      checked={!!deger(sat.id, sut.id)}
                      disabled={!doldur || kilitli(sat, sut)}
                      onChange={(e) => yaz(sat.id, sut.id, e.target.checked)}
                    />
                  ) : kilitli(sat, sut) ? (
                    <Text>{sat.hucreler?.[sut.id] ?? "—"}</Text>
                  ) : sut.tur === "secim" ? (
                    /* Seçim sütunu: şıklar sütun tanımında. Boş
                       bırakılabiliyor, zorunlu değil. */
                    <Select
                      size="small"
                      allowClear
                      style={{ width: "100%", minWidth: 110 }}
                      placeholder="Seçiniz"
                      value={deger(sat.id, sut.id) ?? sat.hucreler?.[sut.id] ?? undefined}
                      disabled={!doldur}
                      onChange={(d) => yaz(sat.id, sut.id, d ?? "")}
                      options={(sut.secenekler ?? []).map((x: string) => ({
                        value: x,
                        label: x,
                      }))}
                    />
                  ) : sut.tur === "sayi" ? (
                    <InputNumber
                      size="small"
                      style={{ width: "100%" }}
                      value={deger(sat.id, sut.id) ?? sat.hucreler?.[sut.id]}
                      disabled={!doldur}
                      onChange={(d) => yaz(sat.id, sut.id, d)}
                    />
                  ) : (
                    <Input
                      size="small"
                      value={deger(sat.id, sut.id) ?? sat.hucreler?.[sut.id] ?? ""}
                      disabled={!doldur}
                      onChange={(e) => yaz(sat.id, sut.id, e.target.value)}
                    />
                  )}

                  {/* Bitişten sonra düzenlenmiş hücre işaretleniyor;
                      üzerine gelince eski ve yeni değer görünüyor. */}
                  {iz(sat.id, sut.id) && (
                    <Tooltip
                      title={
                        <>
                          Önce: {String(iz(sat.id, sut.id).eski || "boş")}
                          <br />
                          Sonra: {String(iz(sat.id, sut.id).yeni || "boş")}
                          <br />
                          {new Date(iz(sat.id, sut.id).zaman).toLocaleString("tr-TR")}
                        </>
                      }
                    >
                      <Tag color="orange" style={{ marginTop: 4, marginInlineEnd: 0 }}>
                        düzenlendi
                      </Tag>
                    </Tooltip>
                  )}
                </td>
              ))}

              {duzenle && (
                <td>
                  <Space size={2}>
                    {/* Satır taşıma: yeni madde her zaman sona ekleniyor
                        ve araya bir şey sokmak isteyen kullanıcı bütün
                        satırları yeniden yazmak zorunda kalıyordu. */}
                    <Tooltip title="Yukarı taşı">
                      <Button
                        size="small"
                        type="text"
                        disabled={sira === 0}
                        icon={<ChevronUp size={13} strokeWidth={2} />}
                        onClick={() => tasi(sira, -1)}
                      />
                    </Tooltip>

                    <Tooltip title="Aşağı taşı">
                      <Button
                        size="small"
                        type="text"
                        disabled={sira === blok.satirlar.length - 1}
                        icon={<ChevronDown2 size={13} strokeWidth={2} />}
                        onClick={() => tasi(sira, 1)}
                      />
                    </Tooltip>

                    <Tooltip title="Ara başlık satırı">
                      <Button
                        size="small"
                        type={sat.baslikMi ? "primary" : "text"}
                        icon={<Heading size={13} strokeWidth={2} />}
                        onClick={() =>
                          guncelle({
                            satirlar: blok.satirlar.map((x: any) =>
                              x.id === sat.id
                                ? { ...x, baslikMi: !x.baslikMi }
                                : x
                            ),
                          })
                        }
                      />
                    </Tooltip>

                    <Tooltip
                      title={
                        sat.kilit
                          ? "Kilitli satır: atanan değiştiremez"
                          : "Açık satır"
                      }
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={
                          sat.kilit ? (
                            <Lock size={12} strokeWidth={2} />
                          ) : (
                            <Unlock size={12} strokeWidth={2} />
                          )
                        }
                        onClick={() =>
                          guncelle({
                            satirlar: blok.satirlar.map((x: any) =>
                              x.id === sat.id ? { ...x, kilit: !x.kilit } : x
                            ),
                          })
                        }
                      />
                    </Tooltip>

                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<Trash2 size={12} strokeWidth={2} />}
                      onClick={() =>
                        guncelle({
                          satirlar: blok.satirlar.filter((x: any) => x.id !== sat.id),
                        })
                      }
                    />
                  </Space>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {duzenle && (
        <Button
          size="small"
          type="dashed"
          style={{ marginTop: 8 }}
          icon={<Plus size={13} strokeWidth={2} />}
          onClick={() =>
            guncelle({
              satirlar: [...blok.satirlar, { id: kimlik(), hucreler: {} }],
            })
          }
        >
          Satır ekle
        </Button>
      )}

      {/* Yorum satırı: yalnızca atanan yazabiliyor, işi atan boş bırakıyor */}
      {(duzenle || doldur || doldurma?.[`${blok.id}:yorum`]) && (
        <div style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Yorum — yalnızca işi yapan kişi yazar
          </Text>

          <Input.TextArea
            rows={2}
            value={doldurma?.[`${blok.id}:yorum`] ?? ""}
            disabled={!doldur}
            placeholder={
              duzenle
                ? "İşi yapan kişi buraya not yazabilecek"
                : "Eklemek istediğiniz not"
            }
            onChange={(e) =>
              setDoldurma?.({ ...doldurma, [`${blok.id}:yorum`]: e.target.value })
            }
          />
        </div>
      )}
    </Card>
  );
}

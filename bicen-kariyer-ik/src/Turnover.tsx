/**
 * Sirkülasyon › Turnover (30.10.2026).
 *
 * İK'nın elle tuttuğu "2025–2026 TURNOVER RAPORU" Excel'inin panel hâli:
 * seçilen yıl ve bir önceki yılın aylık tabloları, iki yılın
 * karşılaştırması, aylık giriş / çıkış sayıları; altında oran ve giriş /
 * çıkış grafikleri ve yıl içinde ayrılanlar için üç pasta grafik.
 *
 * Her sayı, grafik noktası, çubuk ve pasta dilimi tıklanabilir: arkasındaki
 * personel listesi açılır (Mikro kayıtlarından).
 *
 * Değerler elle girilebilir ("Düzenle"): 2025 İK tarafından elle girilir,
 * sonraki yıllar otomatik gelir ve gerektiğinde hücre hücre düzeltilir.
 * Elle girilen hücre mavi köşeyle işaretlidir; boşaltılan hücre otomatiğe
 * döner. Ortalama ve oranlar ekrandaki değerlerden hesaplanır:
 *   ortalama = (dönem başı + dönem sonu) / 2
 *   aylık oran = çıkış / ortalama
 *   yıllık oran = aylık oran × 12   (Excel'deki "Oran %" satırı)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { Check, Download, Info, Pencil, RefreshCw, X } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import { personelKartiAc, personelKartiAcilabilir } from "./personelKarti";

const AYLAR = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

type Alan = "subeSayisi" | "donemBasi" | "donemSonu" | "giris" | "cikis";
const ALANLAR: { k: Alan; ad: string }[] = [
  { k: "subeSayisi", ad: "ŞUBE SAYISI" },
  { k: "donemBasi", ad: "DÖNEM BAŞI ÇALIŞAN SAYISI" },
  { k: "donemSonu", ad: "DÖNEM SONU ÇALIŞAN SAYISI" },
  { k: "giris", ad: "GİRİŞ SAYISI" },
  { k: "cikis", ad: "ÇIKIŞ SAYISI" },
];

/** İK'nın 2025–2026 Turnover Raporu'ndaki 2025 değerleri (giriş raporda yok) */
const RAPOR_2025: Partial<Record<Alan, number[]>> = {
  subeSayisi: [33, 33, 33, 33, 33, 34, 34, 33, 34, 34, 34, 34],
  donemBasi: [789, 810, 809, 790, 795, 807, 859, 895, 856, 879, 883, 875],
  donemSonu: [810, 809, 790, 800, 819, 859, 895, 856, 879, 883, 875, 858],
  cikis: [79, 63, 53, 70, 61, 70, 113, 78, 105, 78, 70, 46],
};

interface Ay {
  ay: number;
  bos: boolean;
  devam?: boolean;
  subeSayisi?: number;
  donemBasi?: number;
  donemSonu?: number;
  giris?: number;
  cikis?: number;
  ortalama?: number;
  oran?: number;
  yillikOran?: number;
  oto?: Record<Alan, number>;
  elle?: Alan[];
  elleGuncelleyen?: string | null;
  elleTarih?: string | null;
}

interface Dilim {
  ad: string;
  adet: number;
  digerMi?: boolean;
}

interface YilVerisi {
  yil: number;
  aylar: Ay[];
  ortalamaYillikOran: number | null;
  toplamGiris: number;
  toplamCikis: number;
  sebepler: Dilim[];
  birimler: Dilim[];
  sureler: Dilim[];
}

interface Yanit {
  kapsam: string;
  duzenleyebilir: boolean;
  buYil: YilVerisi;
  gecenYil: YilVerisi;
}

/** Tıklanınca açılan liste isteği */
interface ListeIstegi {
  baslik: string;
  yil: number;
  ay?: number;
  tur: "cikis" | "giris" | "donemBasi" | "donemSonu";
  sebep?: string;
  birim?: string;
  sure?: string;
  haric?: string[];
  /** Ekrandaki sayı (elle girilmiş olabilir) */
  ekranSayisi?: number;
  elleMi?: boolean;
}

type ListeAc = (i: ListeIstegi) => void;

/* ------------------------------------------------------------------ biçim */

const sayi = (v?: number | null, ondalik = 0) =>
  v === null || v === undefined ? "" : v.toLocaleString("tr-TR", { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik });

const yuzde = (v?: number | null, ondalik = 0) => (v === null || v === undefined ? "" : `%${sayi(v, ondalik)}`);

const oranRengi = (v?: number | null): { bg: string; fg: string } => {
  if (v === null || v === undefined) return { bg: "transparent", fg: "inherit" };
  if (v < 85) return { bg: "#63be7b", fg: "#0b3d16" };
  if (v < 95) return { bg: "#b5d97f", fg: "#24400a" };
  if (v < 105) return { bg: "#ffeb84", fg: "#5c4a00" };
  if (v < 125) return { bg: "#fdbd6e", fg: "#5c3200" };
  return { bg: "#f8696b", fg: "#4d0000" };
};

const PASTA_RENK = ["#7cb518", "#e8481c", "#1a5fb4", "#d9a21b", "#722ed1", "#08979c", "#c41d7f", "#5b6875", "#a0d911"];
const BU_RENK = "#e8481c";
const GECEN_RENK = "#8a929b";

const hucre: CSSProperties = { border: "1px solid #c9cec4", padding: "4px 6px", textAlign: "center", whiteSpace: "nowrap" };
const etiket: CSSProperties = { ...hucre, textAlign: "left", fontWeight: 600, background: "#fafbf8" };
const tiklanir: CSSProperties = { cursor: "pointer" };

/** Elle girilmiş hücrenin köşe işareti */
const elleIsaret: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  width: 0,
  height: 0,
  borderTop: "7px solid #1a5fb4",
  borderLeft: "7px solid transparent",
};

/* ---------------------------------------------------------------- tablo */

function YilTablosu({
  v,
  duzenleyebilir,
  listeAc,
  kaydet,
}: {
  v: YilVerisi;
  duzenleyebilir: boolean;
  listeAc: ListeAc;
  kaydet: (yil: number, aylar: { ay: number; degerler: Partial<Record<Alan, number | null>> }[]) => Promise<boolean>;
}) {
  const [duzen, setDuzen] = useState(false);
  const [taslak, setTaslak] = useState<Record<number, Partial<Record<Alan, number | null>>>>({});
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Düzenleme açılınca taslak, elle girilmiş değerlerle dolar */
  const duzenAc = () => {
    const t: Record<number, Partial<Record<Alan, number | null>>> = {};
    for (const a of v.aylar) {
      t[a.ay] = {};
      for (const { k } of ALANLAR) t[a.ay][k] = a.elle?.includes(k) ? (a[k] as number) : null;
    }
    setTaslak(t);
    setDuzen(true);
  };

  const raporuDoldur = () =>
    setTaslak((t) => {
      const yeni = { ...t };
      for (let ay = 1; ay <= 12; ay++) {
        yeni[ay] = { ...(yeni[ay] ?? {}) };
        for (const { k } of ALANLAR) {
          const d = RAPOR_2025[k]?.[ay - 1];
          if (d !== undefined) yeni[ay][k] = d;
        }
      }
      return yeni;
    });

  const bitir = async () => {
    setKaydediliyor(true);
    const ok = await kaydet(
      v.yil,
      Object.entries(taslak).map(([ay, degerler]) => ({ ay: Number(ay), degerler }))
    );
    setKaydediliyor(false);
    if (ok) setDuzen(false);
  };

  /* Bir ayın düzenleme sırasındaki (taslak) ya da gösterilen değeri */
  const gosterilen = (a: Ay, k: Alan): number | undefined => {
    if (!duzen) return a[k] as number | undefined;
    const t = taslak[a.ay]?.[k];
    return t === null || t === undefined ? a.oto?.[k] : t;
  };

  const ortalama = (a: Ay) => {
    const b = gosterilen(a, "donemBasi") ?? 0;
    const s = gosterilen(a, "donemSonu") ?? 0;
    return (b + s) / 2;
  };
  const aylikOran = (a: Ay) => {
    const o = ortalama(a);
    return o > 0 ? ((gosterilen(a, "cikis") ?? 0) * 100) / o : 0;
  };

  const turu: Partial<Record<Alan, ListeIstegi["tur"]>> = {
    donemBasi: "donemBasi",
    donemSonu: "donemSonu",
    giris: "giris",
    cikis: "cikis",
  };

  const tarih = (a: Ay) => (a.elleTarih ? dayjs(a.elleTarih).format("DD.MM.YYYY HH:mm") : "");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{v.yil}</b>
        {duzenleyebilir &&
          (duzen ? (
            <Space wrap>
              {v.yil === 2025 && (
                <Tooltip title="İK'nın 2025–2026 Turnover Raporu'ndaki 2025 değerleriyle (şube, dönem başı/sonu, çıkış) doldurur; kontrol edip kaydedin">
                  <Button size="small" onClick={raporuDoldur}>
                    Rapordaki 2025 değerlerini doldur
                  </Button>
                </Tooltip>
              )}
              <Button size="small" icon={<X size={14} />} onClick={() => setDuzen(false)} disabled={kaydediliyor}>
                Vazgeç
              </Button>
              <Button size="small" type="primary" icon={<Check size={14} />} onClick={bitir} loading={kaydediliyor}>
                Kaydet
              </Button>
            </Space>
          ) : (
            <Button size="small" icon={<Pencil size={14} />} onClick={duzenAc}>
              Düzenle
            </Button>
          ))}
      </div>

      {duzen && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="Elle girdiğiniz değer otomatik hesabın yerine geçer. Hücreyi boşaltırsanız o değer otomatiğe döner (gri yazı otomatik değerdir)."
        />
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 900 }}>
          <thead>
            <tr>
              <th colSpan={13} style={{ ...hucre, background: "#c4d79b", fontWeight: 800 }}>
                {v.yil} TURNOVER ORANI
              </th>
            </tr>
            <tr>
              <th style={{ ...hucre, background: "#fafbf8" }} />
              {AYLAR.map((a, i) => (
                <th key={a} style={{ ...hucre, background: "#fafbf8", fontWeight: 700 }}>
                  {a}
                  {v.aylar[i]?.devam ? <div style={{ fontSize: 10, fontWeight: 500, color: "#8a929b" }}>devam ediyor</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALANLAR.map(({ k, ad }) => (
              <tr key={k}>
                <td style={etiket}>{ad}</td>
                {v.aylar.map((a) => {
                  const elleMi = !!a.elle?.includes(k);
                  if (duzen)
                    return (
                      <td key={a.ay} style={{ ...hucre, padding: 2 }}>
                        <InputNumber
                          size="small"
                          min={0}
                          max={100000}
                          controls={false}
                          value={taslak[a.ay]?.[k] ?? null}
                          placeholder={a.oto ? String(a.oto[k]) : ""}
                          onChange={(d) =>
                            setTaslak((t) => ({ ...t, [a.ay]: { ...(t[a.ay] ?? {}), [k]: d === null ? null : Number(d) } }))
                          }
                          style={{ width: 62 }}
                        />
                      </td>
                    );
                  if (a.bos) return <td key={a.ay} style={hucre} />;
                  const tur = turu[k];
                  const icerik = (
                    <td
                      key={a.ay}
                      style={{
                        ...hucre,
                        position: "relative",
                        ...(a.devam ? { fontStyle: "italic", color: "#6b7480" } : {}),
                        ...(tur ? tiklanir : {}),
                        ...(elleMi ? { color: "#1a5fb4", fontWeight: 700 } : {}),
                      }}
                      onClick={
                        tur
                          ? () =>
                              listeAc({
                                baslik: `${AYLAR[a.ay - 1]} ${v.yil} · ${ad.toLocaleLowerCase("tr-TR")}`,
                                yil: v.yil,
                                ay: a.ay,
                                tur,
                                ekranSayisi: a[k] as number,
                                elleMi,
                              })
                          : undefined
                      }
                    >
                      {elleMi && <i style={elleIsaret} />}
                      {sayi(a[k] as number)}
                    </td>
                  );
                  return elleMi ? (
                    <Tooltip
                      key={a.ay}
                      title={`Elle girildi${a.elleGuncelleyen ? ` · ${a.elleGuncelleyen}` : ""}${tarih(a) ? ` · ${tarih(a)}` : ""} · otomatik: ${sayi(a.oto?.[k])}`}
                    >
                      {icerik}
                    </Tooltip>
                  ) : (
                    icerik
                  );
                })}
              </tr>
            ))}
            <tr>
              <td style={etiket}>ORTALAMA</td>
              {v.aylar.map((a) => (
                <td key={a.ay} style={{ ...hucre, ...(a.devam && !duzen ? { fontStyle: "italic", color: "#6b7480" } : {}) }}>
                  {a.bos ? "" : sayi(ortalama(a), ortalama(a) % 1 ? 1 : 0)}
                </td>
              ))}
            </tr>
            <tr>
              <td style={etiket}>AYLIK ORAN</td>
              {v.aylar.map((a) => (
                <td key={a.ay} style={{ ...hucre, color: "#c0392b" }}>
                  {a.bos ? "" : yuzde(aylikOran(a), 2)}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...etiket, background: "#d9d9d9", fontWeight: 800 }}>{v.yil} ORAN % (yıllık)</td>
              {v.aylar.map((a) => {
                const deger = a.bos ? null : aylikOran(a) * 12;
                const r = oranRengi(deger);
                return (
                  <td
                    key={a.ay}
                    style={{
                      ...hucre,
                      background: r.bg,
                      color: r.fg,
                      fontWeight: 800,
                      fontSize: 13.5,
                      ...(a.devam && !duzen ? { opacity: 0.6 } : {}),
                      ...(a.bos || duzen ? {} : tiklanir),
                    }}
                    onClick={
                      a.bos || duzen
                        ? undefined
                        : () =>
                            listeAc({
                              baslik: `${AYLAR[a.ay - 1]} ${v.yil} · çıkışlar`,
                              yil: v.yil,
                              ay: a.ay,
                              tur: "cikis",
                              ekranSayisi: a.cikis,
                              elleMi: !!a.elle?.includes("cikis"),
                            })
                    }
                  >
                    {deger === null ? "" : yuzde(deger)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Karsilastirma({ bu, gecen, listeAc }: { bu: YilVerisi; gecen: YilVerisi; listeAc: ListeAc }) {
  const renk = (a?: number | null, b?: number | null) => {
    if (a === null || a === undefined || b === null || b === undefined || a === b) return {};
    return a < b ? { background: "#c6efce", color: "#006100" } : { background: "#ffc7ce", color: "#9c0006" };
  };
  const tamAy = (a: Ay) => (a.bos || a.devam ? null : a.yillikOran);

  const satir = (v: YilVerisi, diger: YilVerisi) => (
    <tr>
      <td style={{ ...etiket, fontWeight: 700 }}>{v.yil} Oran %</td>
      {v.aylar.map((a, i) => (
        <td
          key={a.ay}
          style={{ ...hucre, ...renk(tamAy(a), tamAy(diger.aylar[i])), ...(tamAy(a) === null ? {} : tiklanir) }}
          onClick={
            tamAy(a) === null
              ? undefined
              : () =>
                  listeAc({
                    baslik: `${AYLAR[a.ay - 1]} ${v.yil} · çıkışlar`,
                    yil: v.yil,
                    ay: a.ay,
                    tur: "cikis",
                    ekranSayisi: a.cikis,
                    elleMi: !!a.elle?.includes("cikis"),
                  })
          }
        >
          {tamAy(a) === null ? "" : yuzde(a.yillikOran)}
        </td>
      ))}
      <td
        style={{ ...hucre, fontWeight: 800, ...renk(v.ortalamaYillikOran, diger.ortalamaYillikOran), ...tiklanir }}
        onClick={() => listeAc({ baslik: `${v.yil} · yıl boyunca çıkışlar`, yil: v.yil, tur: "cikis" })}
      >
        {yuzde(v.ortalamaYillikOran)}
      </td>
    </tr>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 900 }}>
        <thead>
          <tr>
            <th colSpan={13} style={{ ...hucre, background: "#c4d79b", fontWeight: 800 }}>
              {gecen.yil}–{bu.yil} TURNOVER KARŞILAŞTIRMA
            </th>
            <th rowSpan={2} style={{ ...hucre, background: "#fafbf8", fontWeight: 800 }}>
              ORTALAMA
            </th>
          </tr>
          <tr>
            <th style={etiket}>YIL</th>
            {AYLAR.map((a) => (
              <th key={a} style={{ ...hucre, background: "#fafbf8", fontWeight: 700 }}>
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {satir(gecen, bu)}
          {satir(bu, gecen)}
        </tbody>
      </table>
    </div>
  );
}

function GirisCikisTablosu({ v, listeAc }: { v: YilVerisi; listeAc: ListeAc }) {
  const dolu = v.aylar.filter((a) => !a.bos);
  const tik = (a: Ay, tur: "giris" | "cikis") => () =>
    listeAc({
      baslik: `${AYLAR[a.ay - 1]} ${v.yil} · ${tur === "giris" ? "girişler" : "çıkışlar"}`,
      yil: v.yil,
      ay: a.ay,
      tur,
      ekranSayisi: a[tur],
      elleMi: !!a.elle?.includes(tur),
    });

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead>
        <tr>
          <th colSpan={3} style={{ ...hucre, background: "#4472c4", color: "#fff", fontWeight: 800 }}>
            {v.yil} AY BAZINDA GİRİŞ ÇIKIŞ
          </th>
        </tr>
        <tr>
          <th style={{ ...hucre, background: "#fafbf8" }}>DÖNEM</th>
          <th style={{ ...hucre, background: "#00b050", color: "#fff" }}>GİRİŞ</th>
          <th style={{ ...hucre, background: "#ff0000", color: "#fff" }}>ÇIKIŞ</th>
        </tr>
      </thead>
      <tbody>
        {v.aylar.map((a) => (
          <tr key={a.ay}>
            <td style={{ ...etiket, ...(a.devam ? { fontStyle: "italic" } : {}) }}>{AYLAR[a.ay - 1]}</td>
            <td style={{ ...hucre, background: "#dff3e6", fontWeight: 700, ...(a.bos ? {} : tiklanir) }} onClick={a.bos ? undefined : tik(a, "giris")}>
              {a.bos ? "" : sayi(a.giris)}
            </td>
            <td style={{ ...hucre, background: "#fde2e2", fontWeight: 700, ...(a.bos ? {} : tiklanir) }} onClick={a.bos ? undefined : tik(a, "cikis")}>
              {a.bos ? "" : sayi(a.cikis)}
            </td>
          </tr>
        ))}
        <tr>
          <td style={{ ...etiket, fontWeight: 800 }}>TOPLAM</td>
          <td
            style={{ ...hucre, background: "#00b050", color: "#fff", fontWeight: 800, fontSize: 14, ...tiklanir }}
            onClick={() => listeAc({ baslik: `${v.yil} · yıl boyunca girişler`, yil: v.yil, tur: "giris" })}
          >
            {sayi(dolu.reduce((t, a) => t + (a.giris ?? 0), 0))}
          </td>
          <td
            style={{ ...hucre, background: "#ff0000", color: "#fff", fontWeight: 800, fontSize: 14, ...tiklanir }}
            onClick={() => listeAc({ baslik: `${v.yil} · yıl boyunca çıkışlar`, yil: v.yil, tur: "cikis" })}
          >
            {sayi(dolu.reduce((t, a) => t + (a.cikis ?? 0), 0))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------------- grafik */

function OranGrafigi({ bu, gecen, listeAc }: { bu: YilVerisi; gecen: YilVerisi; listeAc: ListeAc }) {
  const G = 760,
    Y = 260,
    sol = 44,
    sag = 12,
    ust = 18,
    alt = 30;
  const degerler = [...bu.aylar, ...gecen.aylar].filter((a) => !a.bos).map((a) => a.yillikOran ?? 0);
  const enCok = Math.max(120, Math.ceil(Math.max(0, ...degerler) / 20) * 20);
  const x = (i: number) => sol + ((G - sol - sag) * i) / 11;
  const y = (v: number) => ust + (Y - ust - alt) * (1 - v / enCok);
  const cizgi = (v: YilVerisi) =>
    v.aylar
      .map((a, i) => (a.bos ? null : `${x(i)},${y(a.yillikOran ?? 0)}`))
      .filter(Boolean)
      .join(" ");
  const izgara = Array.from({ length: enCok / 20 + 1 }, (_, i) => i * 20);

  return (
    <svg viewBox={`0 0 ${G} ${Y}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Aylık yıllık turnover oranı">
      {izgara.map((g) => (
        <g key={g}>
          <line x1={sol} x2={G - sag} y1={y(g)} y2={y(g)} stroke={g === 100 ? "#c0392b" : "#eceee9"} strokeDasharray={g === 100 ? "5 4" : undefined} />
          <text x={sol - 6} y={y(g) + 4} fontSize={10.5} textAnchor="end" fill="#8a929b">
            %{g}
          </text>
        </g>
      ))}
      {AY_KISA.map((a, i) => (
        <text key={a} x={x(i)} y={Y - 10} fontSize={11} textAnchor="middle" fill="#5b6875">
          {a}
        </text>
      ))}
      {[
        { v: gecen, renk: GECEN_RENK },
        { v: bu, renk: BU_RENK },
      ].map(({ v, renk }) => (
        <g key={v.yil}>
          <polyline points={cizgi(v)} fill="none" stroke={renk} strokeWidth={2.5} strokeLinejoin="round" />
          {v.aylar.map((a, i) =>
            a.bos ? null : (
              <g
                key={a.ay}
                style={tiklanir}
                onClick={() =>
                  listeAc({
                    baslik: `${AYLAR[i]} ${v.yil} · çıkışlar`,
                    yil: v.yil,
                    ay: a.ay,
                    tur: "cikis",
                    ekranSayisi: a.cikis,
                    elleMi: !!a.elle?.includes("cikis"),
                  })
                }
              >
                {/* geniş, görünmez tıklama alanı */}
                <circle cx={x(i)} cy={y(a.yillikOran ?? 0)} r={12} fill="transparent" />
                <circle cx={x(i)} cy={y(a.yillikOran ?? 0)} r={4.5} fill="#fff" stroke={renk} strokeWidth={2}>
                  <title>{`${AYLAR[i]} ${v.yil}: %${sayi(a.yillikOran)} · ${a.cikis} çıkış${a.devam ? " (devam ediyor)" : ""} — tıklayın`}</title>
                </circle>
                {v === bu && (
                  <text x={x(i)} y={y(a.yillikOran ?? 0) - 10} fontSize={10.5} textAnchor="middle" fill={renk} fontWeight={700}>
                    {sayi(a.yillikOran)}
                  </text>
                )}
              </g>
            )
          )}
        </g>
      ))}
    </svg>
  );
}

function GirisCikisGrafigi({ v, listeAc }: { v: YilVerisi; listeAc: ListeAc }) {
  const G = 760,
    Y = 240,
    sol = 36,
    sag = 8,
    ust = 16,
    alt = 30;
  const enCok = Math.max(10, ...v.aylar.filter((a) => !a.bos).flatMap((a) => [a.giris ?? 0, a.cikis ?? 0]));
  const tavan = Math.ceil(enCok / 20) * 20;
  const grup = (G - sol - sag) / 12;
  const cubuk = Math.min(18, grup / 2.6);
  const y = (n: number) => ust + (Y - ust - alt) * (1 - n / tavan);
  const ac = (a: Ay, tur: "giris" | "cikis") => () =>
    listeAc({
      baslik: `${AYLAR[a.ay - 1]} ${v.yil} · ${tur === "giris" ? "girişler" : "çıkışlar"}`,
      yil: v.yil,
      ay: a.ay,
      tur,
      ekranSayisi: a[tur],
      elleMi: !!a.elle?.includes(tur),
    });

  return (
    <svg viewBox={`0 0 ${G} ${Y}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Aylık giriş ve çıkış">
      {[0, 0.25, 0.5, 0.75, 1].map((o) => (
        <g key={o}>
          <line x1={sol} x2={G - sag} y1={y(tavan * o)} y2={y(tavan * o)} stroke="#eceee9" />
          <text x={sol - 6} y={y(tavan * o) + 4} fontSize={10.5} textAnchor="end" fill="#8a929b">
            {Math.round(tavan * o)}
          </text>
        </g>
      ))}
      {v.aylar.map((a, i) => {
        const merkez = sol + grup * i + grup / 2;
        return (
          <g key={a.ay} opacity={a.devam ? 0.55 : 1}>
            {!a.bos && (
              <>
                <g style={tiklanir} onClick={ac(a, "giris")}>
                  <rect x={merkez - cubuk - 1} y={ust} width={cubuk} height={Y - alt - ust} fill="transparent" />
                  <rect x={merkez - cubuk - 1} y={y(a.giris ?? 0)} width={cubuk} height={Y - alt - y(a.giris ?? 0)} rx={3} fill="#00a65a">
                    <title>{`${AYLAR[i]} giriş: ${a.giris} — tıklayın`}</title>
                  </rect>
                  <text x={merkez - cubuk / 2 - 1} y={y(a.giris ?? 0) - 4} fontSize={9.5} textAnchor="middle" fill="#00733f">
                    {a.giris}
                  </text>
                </g>
                <g style={tiklanir} onClick={ac(a, "cikis")}>
                  <rect x={merkez + 1} y={ust} width={cubuk} height={Y - alt - ust} fill="transparent" />
                  <rect x={merkez + 1} y={y(a.cikis ?? 0)} width={cubuk} height={Y - alt - y(a.cikis ?? 0)} rx={3} fill="#e8481c">
                    <title>{`${AYLAR[i]} çıkış: ${a.cikis} — tıklayın`}</title>
                  </rect>
                  <text x={merkez + cubuk / 2 + 1} y={y(a.cikis ?? 0) - 4} fontSize={9.5} textAnchor="middle" fill="#b23a12">
                    {a.cikis}
                  </text>
                </g>
              </>
            )}
            <text x={merkez} y={Y - 10} fontSize={11} textAnchor="middle" fill="#5b6875">
              {AY_KISA[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Pasta({
  baslik,
  dilimler,
  yil,
  suzgec,
  listeAc,
}: {
  baslik: string;
  dilimler: Dilim[];
  yil: number;
  suzgec: "sebep" | "birim" | "sure";
  listeAc: ListeAc;
}) {
  const toplam = dilimler.reduce((t, d) => t + d.adet, 0);
  const R = 70,
    r = 42,
    M = 80;
  let aci = -Math.PI / 2;

  const yay = (bas: number, son: number) => {
    const buyuk = son - bas > Math.PI ? 1 : 0;
    const p = (a: number, yc: number) => `${M + yc * Math.cos(a)},${M + yc * Math.sin(a)}`;
    return `M ${p(bas, R)} A ${R} ${R} 0 ${buyuk} 1 ${p(son, R)} L ${p(son, r)} A ${r} ${r} 0 ${buyuk} 0 ${p(bas, r)} Z`;
  };

  const ac = (d?: Dilim) =>
    listeAc({
      baslik: d ? `${yil} çıkışlar · ${d.ad}` : `${yil} · yıl boyunca çıkışlar`,
      yil,
      tur: "cikis",
      ...(d
        ? d.digerMi
          ? { [suzgec]: "__diger__", haric: dilimler.filter((x) => !x.digerMi).map((x) => x.ad) }
          : { [suzgec]: d.ad }
        : {}),
    });

  return (
    <Card size="small" title={baslik} style={{ height: "100%" }}>
      {toplam === 0 ? (
        <div style={{ color: "#8a929b", padding: 20, textAlign: "center" }}>Bu yıl çıkış yok</div>
      ) : (
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <svg viewBox="0 0 160 160" width={150} height={150} role="img" aria-label={baslik}>
            {dilimler.length === 1 ? (
              <circle cx={M} cy={M} r={(R + r) / 2} fill="none" stroke={PASTA_RENK[0]} strokeWidth={R - r} style={tiklanir} onClick={() => ac(dilimler[0])} />
            ) : (
              dilimler.map((d, i) => {
                const son = aci + (d.adet / toplam) * Math.PI * 2;
                const yol = yay(aci, son - 0.0001);
                aci = son;
                return (
                  <path key={d.ad} d={yol} fill={PASTA_RENK[i % PASTA_RENK.length]} stroke="#fff" strokeWidth={1.5} style={tiklanir} onClick={() => ac(d)}>
                    <title>{`${d.ad}: ${d.adet} (%${Math.round((d.adet * 100) / toplam)}) — tıklayın`}</title>
                  </path>
                );
              })
            )}
            <g style={tiklanir} onClick={() => ac()}>
              <circle cx={M} cy={M} r={r - 2} fill="transparent" />
              <text x={M} y={M - 2} textAnchor="middle" fontSize={22} fontWeight={800} fill="#1d2126">
                {toplam}
              </text>
              <text x={M} y={M + 16} textAnchor="middle" fontSize={10.5} fill="#8a929b">
                çıkış
              </text>
            </g>
          </svg>
          <div style={{ flex: 1, minWidth: 150 }}>
            {dilimler.map((d, i) => (
              <div
                key={d.ad}
                role="button"
                tabIndex={0}
                onClick={() => ac(d)}
                onKeyDown={(e) => e.key === "Enter" && ac(d)}
                style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, padding: "3px 4px", borderRadius: 6, ...tiklanir }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f6ef")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <i style={{ width: 10, height: 10, borderRadius: 3, flex: "0 0 10px", background: PASTA_RENK[i % PASTA_RENK.length] }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.ad}>
                  {d.ad}
                </span>
                <b>{d.adet}</b>
                <span style={{ color: "#8a929b", width: 38, textAlign: "right" }}>%{Math.round((d.adet * 100) / toplam)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- liste penceresi */

interface ListeSatiri {
  personelKodu: string;
  adSoyad: string;
  birim?: string | null;
  pozisyon?: string | null;
  girisTarihi?: string | null;
  cikisTarihi?: string | null;
  cikisSebebi?: string | null;
  sure?: string | null;
  calismaGun?: number | null;
}

function ListePenceresi({ istek, kapsam, kapat }: { istek: ListeIstegi | null; kapsam: string; kapat: () => void }) {
  const { message } = AntdApp.useApp();
  const [liste, setListe] = useState<ListeSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [ara, setAra] = useState("");

  useEffect(() => {
    if (!istek) return;
    setAra("");
    setListe([]);
    setYukleniyor(true);
    const q = new URLSearchParams({ yil: String(istek.yil), tur: istek.tur, kapsam });
    if (istek.ay) q.set("ay", String(istek.ay));
    if (istek.sebep) q.set("sebep", istek.sebep);
    if (istek.birim) q.set("birim", istek.birim);
    if (istek.sure) q.set("sure", istek.sure);
    if (istek.haric?.length) q.set("haric", istek.haric.join("|"));
    api
      .al<ListeSatiri[]>(`/api/Personel/TurnoverListe?${q}`)
      .then(setListe)
      .catch((h) => message.error(h?.message ?? "Liste alınamadı."))
      .finally(() => setYukleniyor(false));
  }, [istek, kapsam, message]);

  const t = (d?: string | null) => (d ? dayjs(d).format("DD.MM.YYYY") : "");
  const a = ara.trim().toLocaleLowerCase("tr-TR");
  const gorunen = a
    ? liste.filter((x) => `${x.adSoyad} ${x.personelKodu} ${x.birim} ${x.pozisyon} ${x.cikisSebebi}`.toLocaleLowerCase("tr-TR").includes(a))
    : liste;

  const excel = () =>
    tabloIndir({
      baslik: istek?.baslik ?? "Turnover",
      sayfaAdi: "Liste",
      dosyaAdi: `turnover-liste-${istek?.yil}${istek?.ay ? `-${istek.ay}` : ""}`,
      sutunlar: [
        { ad: "Sicil", genislik: 10 },
        { ad: "Ad soyad", genislik: 24 },
        { ad: "Birim", genislik: 22 },
        { ad: "Pozisyon", genislik: 20 },
        { ad: "Giriş", genislik: 12 },
        { ad: "Çıkış", genislik: 12 },
        { ad: "Çalışma (gün)", tip: "sayi", toplam: false },
        { ad: "Çıkış sebebi", genislik: 24 },
      ],
      satirlar: gorunen.map((x) => [
        x.personelKodu,
        x.adSoyad,
        x.birim ?? "",
        x.pozisyon ?? "",
        t(x.girisTarihi),
        t(x.cikisTarihi),
        x.calismaGun ?? 0,
        x.cikisSebebi ?? "",
      ]),
    } as any);

  const farkVar = istek?.ekranSayisi !== undefined && !yukleniyor && istek.ekranSayisi !== liste.length;

  return (
    <Modal
      open={!!istek}
      onCancel={kapat}
      footer={null}
      width={980}
      title={
        <Space>
          {istek?.baslik}
          {!yukleniyor && <Tag>{liste.length} kişi</Tag>}
        </Space>
      }
      destroyOnClose
    >
      {farkVar && (
        <Alert
          type={istek?.elleMi ? "info" : "warning"}
          showIcon
          style={{ marginBottom: 10 }}
          message={
            istek?.elleMi
              ? `Tablodaki sayı elle girildi (${istek?.ekranSayisi}); liste Mikro personel kayıtlarından geliyor (${liste.length} kişi).`
              : `Tablodaki sayı ${istek?.ekranSayisi}, listede ${liste.length} kişi var.`
          }
        />
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Input.Search allowClear placeholder="Ad, sicil, birim, pozisyon, sebep" value={ara} onChange={(e) => setAra(e.target.value)} />
        <Button icon={<Download size={15} />} onClick={excel} disabled={gorunen.length === 0}>
          Excel
        </Button>
      </div>
      <Table<ListeSatiri>
        size="small"
        rowKey={(x) => `${x.personelKodu}-${x.girisTarihi}`}
        loading={yukleniyor}
        dataSource={gorunen}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        scroll={{ x: 900 }}
        onRow={(x) => ({
          onClick: () => personelKartiAcilabilir() && personelKartiAc(x.personelKodu),
          style: personelKartiAcilabilir() ? tiklanir : undefined,
        })}
        columns={[
          { title: "Ad soyad", dataIndex: "adSoyad", width: 190, render: (v, x) => <span><b>{v}</b> <span style={{ color: "#8a929b" }}>{x.personelKodu}</span></span> },
          { title: "Birim", dataIndex: "birim", width: 170, ellipsis: true },
          { title: "Pozisyon", dataIndex: "pozisyon", width: 150, ellipsis: true },
          { title: "Giriş", dataIndex: "girisTarihi", width: 100, render: t, sorter: (p, q) => dayjs(p.girisTarihi).valueOf() - dayjs(q.girisTarihi).valueOf() },
          { title: "Çıkış", dataIndex: "cikisTarihi", width: 100, render: t, sorter: (p, q) => dayjs(p.cikisTarihi ?? 0).valueOf() - dayjs(q.cikisTarihi ?? 0).valueOf() },
          {
            title: "Çalışma",
            dataIndex: "calismaGun",
            width: 90,
            render: (v: number | null) => (v === null || v === undefined ? "" : v >= 365 ? `${(v / 365).toFixed(1).replace(".", ",")} yıl` : `${v} gün`),
            sorter: (p, q) => (p.calismaGun ?? 0) - (q.calismaGun ?? 0),
          },
          { title: "Çıkış sebebi", dataIndex: "cikisSebebi", ellipsis: true },
        ]}
      />
    </Modal>
  );
}

/* ----------------------------------------------------------------- sayfa */

export default function Turnover() {
  const { message } = AntdApp.useApp();
  const [yil, setYil] = useState(new Date().getFullYear());
  const [kapsam, setKapsam] = useState<"tumu" | "magaza">("tumu");
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [liste, setListe] = useState<ListeIstegi | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Yanit>(`/api/Personel/Turnover?yil=${yil}&kapsam=${kapsam}`));
    } catch (h: any) {
      message.error(h?.message ?? "Turnover verisi alınamadı.");
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [yil, kapsam, message]);

  useEffect(() => {
    void getir();
  }, [getir]);

  const kaydet = useCallback(
    async (y: number, aylar: { ay: number; degerler: Partial<Record<Alan, number | null>> }[]) => {
      try {
        await api.guncelle("/api/Personel/TurnoverManuel", {
          yil: y,
          kapsam,
          aylar: aylar.map((a) => ({ ay: a.ay, ...a.degerler })),
        });
        message.success(`${y} değerleri kaydedildi.`);
        await getir();
        return true;
      } catch (h: any) {
        message.error(h?.message ?? "Kaydedilemedi.");
        return false;
      }
    },
    [kapsam, getir, message]
  );

  const yillar = useMemo(() => {
    const b = new Date().getFullYear();
    return Array.from({ length: b - 2021 }, (_, i) => b - i);
  }, []);

  const excel = () => {
    if (!veri) return;
    const satirlar: (string | number)[][] = [];
    for (const v of [veri.gecenYil, veri.buYil])
      for (const a of v.aylar)
        if (!a.bos)
          satirlar.push([
            v.yil,
            AYLAR[a.ay - 1],
            a.subeSayisi ?? 0,
            a.donemBasi ?? 0,
            a.donemSonu ?? 0,
            a.giris ?? 0,
            a.cikis ?? 0,
            a.ortalama ?? 0,
            (a.oran ?? 0) / 100,
            (a.yillikOran ?? 0) / 100,
            [a.devam ? "devam ediyor" : "", a.elle?.length ? "elle girilen değer var" : ""].filter(Boolean).join(" · "),
          ]);
    tabloIndir({
      baslik: "İnsan Kaynakları / Turnover",
      altBaslik: `${veri.gecenYil.yil}–${veri.buYil.yil} · ${kapsam === "magaza" ? "Mağaza personeli" : "Tüm personel"}`,
      sayfaAdi: "Turnover",
      dosyaAdi: `turnover-${veri.gecenYil.yil}-${veri.buYil.yil}`,
      sutunlar: [
        { ad: "Yıl", tip: "sayi", toplam: false },
        { ad: "Ay", genislik: 12 },
        { ad: "Şube sayısı", tip: "sayi", toplam: false },
        { ad: "Dönem başı çalışan", tip: "sayi", toplam: false },
        { ad: "Dönem sonu çalışan", tip: "sayi", toplam: false },
        { ad: "Giriş", tip: "sayi" },
        { ad: "Çıkış", tip: "sayi" },
        { ad: "Ortalama", tip: "ondalik", toplam: false },
        { ad: "Aylık oran", tip: "yuzde", toplam: false },
        { ad: "Yıllık oran", tip: "yuzde", toplam: false },
        { ad: "Not", genislik: 22 },
      ],
      satirlar,
    } as any);
  };

  const bu = veri?.buYil;
  const gecen = veri?.gecenYil;
  const fark = bu?.ortalamaYillikOran != null && gecen?.ortalamaYillikOran != null ? bu.ortalamaYillikOran - gecen.ortalamaYillikOran : null;
  const enYuksek = bu?.aylar.filter((a) => !a.bos && !a.devam).sort((a, b) => (b.yillikOran ?? 0) - (a.yillikOran ?? 0))[0];
  const duzenleyebilir = !!veri?.duzenleyebilir;

  const kart = (ad: string, deger: ReactNode, alt: ReactNode, renk?: string, tik?: () => void) => (
    <Card size="small" hoverable={!!tik} onClick={tik} style={tik ? tiklanir : undefined}>
      <div style={{ fontSize: 12, color: "#5b6875", fontWeight: 600 }}>{ad}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: renk }}>{deger}</div>
      <div style={{ fontSize: 12, color: "#8a929b" }}>{alt}</div>
    </Card>
  );

  return (
    <div>
      <Card size="small" className="rp-filtre" style={{ marginBottom: 12 }}>
        <Row gutter={[10, 10]} align="middle">
          <Col>
            <Space>
              <span style={{ fontWeight: 600 }}>Yıl</span>
              <Select value={yil} onChange={setYil} style={{ width: 110 }} options={yillar.map((y) => ({ value: y, label: `${y}` }))} />
            </Space>
          </Col>
          <Col>
            <Segmented
              value={kapsam}
              onChange={(v) => setKapsam(v as "tumu" | "magaza")}
              options={[
                { label: "Tüm personel", value: "tumu" },
                { label: "Mağaza personeli", value: "magaza" },
              ]}
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Space>
              <Tooltip title="Yenile">
                <Button icon={<RefreshCw size={15} />} onClick={getir} loading={yukleniyor} />
              </Tooltip>
              <Button icon={<Download size={15} />} onClick={excel} disabled={!veri}>
                Excel
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : !bu || !gecen ? null : (
        <Spin spinning={yukleniyor}>
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={12} lg={6}>
              {kart(
                `${bu.yil} ortalama turnover`,
                yuzde(bu.ortalamaYillikOran),
                fark === null
                  ? `${gecen.yil}: ${yuzde(gecen.ortalamaYillikOran)}`
                  : `${gecen.yil}: ${yuzde(gecen.ortalamaYillikOran)} · ${fark > 0 ? "▲" : "▼"} ${sayi(Math.abs(fark))} puan`,
                fark === null ? undefined : fark > 0 ? "#c0392b" : "#3f7d0a"
              )}
            </Col>
            <Col xs={12} lg={6}>
              {kart(`${bu.yil} giriş`, sayi(bu.toplamGiris), `${gecen.yil}: ${sayi(gecen.toplamGiris)}`, "#00873e", () =>
                setListe({ baslik: `${bu.yil} · yıl boyunca girişler`, yil: bu.yil, tur: "giris" })
              )}
            </Col>
            <Col xs={12} lg={6}>
              {kart(`${bu.yil} çıkış`, sayi(bu.toplamCikis), `${gecen.yil}: ${sayi(gecen.toplamCikis)}`, "#e8481c", () =>
                setListe({ baslik: `${bu.yil} · yıl boyunca çıkışlar`, yil: bu.yil, tur: "cikis" })
              )}
            </Col>
            <Col xs={12} lg={6}>
              {kart(
                "En yüksek ay",
                enYuksek ? AYLAR[enYuksek.ay - 1] : "—",
                enYuksek ? `${yuzde(enYuksek.yillikOran)} · ${enYuksek.cikis} çıkış` : "",
                undefined,
                enYuksek
                  ? () =>
                      setListe({
                        baslik: `${AYLAR[enYuksek.ay - 1]} ${bu.yil} · çıkışlar`,
                        yil: bu.yil,
                        ay: enYuksek.ay,
                        tur: "cikis",
                        ekranSayisi: enYuksek.cikis,
                        elleMi: !!enYuksek.elle?.includes("cikis"),
                      })
                  : undefined
              )}
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} xl={18}>
              <Card
                size="small"
                title={
                  <span style={{ color: "#e8481c", fontSize: 16 }}>
                    İnsan Kaynakları / <span style={{ color: "#5f8c10" }}>Turnover</span>
                  </span>
                }
                extra={<span style={{ fontSize: 12, color: "#8a929b" }}>Sayılara tıklayınca personel listesi açılır</span>}
              >
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <YilTablosu v={gecen} duzenleyebilir={duzenleyebilir} listeAc={setListe} kaydet={kaydet} />
                  <YilTablosu v={bu} duzenleyebilir={duzenleyebilir} listeAc={setListe} kaydet={kaydet} />
                  <Karsilastirma bu={bu} gecen={gecen} listeAc={setListe} />
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={6}>
              <Card size="small">
                <GirisCikisTablosu v={bu} listeAc={setListe} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title="Aylık turnover oranı (yıllık)"
                extra={
                  <Space size={12} style={{ fontSize: 12 }}>
                    <span>
                      <i style={{ display: "inline-block", width: 14, height: 3, background: GECEN_RENK, verticalAlign: "middle", marginRight: 5 }} />
                      {gecen.yil}
                    </span>
                    <span>
                      <i style={{ display: "inline-block", width: 14, height: 3, background: BU_RENK, verticalAlign: "middle", marginRight: 5 }} />
                      {bu.yil}
                    </span>
                    <span style={{ color: "#c0392b" }}>- - %100</span>
                  </Space>
                }
              >
                <OranGrafigi bu={bu} gecen={gecen} listeAc={setListe} />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card
                size="small"
                title={`${bu.yil} aylık giriş ve çıkış`}
                extra={
                  <Space size={12} style={{ fontSize: 12 }}>
                    <span>
                      <i style={{ display: "inline-block", width: 10, height: 10, background: "#00a65a", borderRadius: 2, marginRight: 5 }} />
                      Giriş
                    </span>
                    <span>
                      <i style={{ display: "inline-block", width: 10, height: 10, background: "#e8481c", borderRadius: 2, marginRight: 5 }} />
                      Çıkış
                    </span>
                  </Space>
                }
              >
                <GirisCikisGrafigi v={bu} listeAc={setListe} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} lg={8}>
              <Pasta baslik={`${bu.yil} çıkış sebepleri`} dilimler={bu.sebepler} yil={bu.yil} suzgec="sebep" listeAc={setListe} />
            </Col>
            <Col xs={24} lg={8}>
              <Pasta baslik={`${bu.yil} çıkışların birimleri`} dilimler={bu.birimler} yil={bu.yil} suzgec="birim" listeAc={setListe} />
            </Col>
            <Col xs={24} lg={8}>
              <Pasta baslik={`${bu.yil} ayrılanların çalışma süresi`} dilimler={bu.sureler} yil={bu.yil} suzgec="sure" listeAc={setListe} />
            </Col>
          </Row>

          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            icon={<Info size={16} />}
            message="Nasıl hesaplanıyor?"
            description={
              <span>
                Ortalama = (dönem başı + dönem sonu) / 2 · Aylık oran = çıkış / ortalama · Yıllık oran = aylık oran × 12 (%100: bir yılda
                kadronun tamamı kadar çıkış). Otomatik değerler Mikro personel kayıtlarından gelir; elle girilen değerler (mavi köşeli
                hücreler) onların yerine geçer, oranlar ekrandaki değerlerden hesaplanır. Süren ay soluk ve "devam ediyor" olarak gösterilir,
                karşılaştırmaya ve yıl ortalamasına girmez. Pasta grafikler ve açılan listeler Mikro kayıtlarındaki kişilerdir.
              </span>
            }
          />
        </Spin>
      )}

      <ListePenceresi istek={liste} kapsam={kapsam} kapat={() => setListe(null)} />
    </div>
  );
}

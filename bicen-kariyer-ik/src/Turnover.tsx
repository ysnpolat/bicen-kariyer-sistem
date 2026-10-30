/**
 * Sirkülasyon › Turnover (30.10.2026).
 *
 * İK'nın elle tuttuğu "2025–2026 TURNOVER RAPORU" Excel'inin panel hâli:
 * seçilen yıl ve bir önceki yılın aylık tabloları, iki yılın
 * karşılaştırması, aylık giriş / çıkış sayıları; altında oran ve giriş /
 * çıkış grafikleri ve yıl içinde ayrılanlar için üç pasta grafik (çıkış
 * sebebi, birim, çalışma süresi).
 *
 * Hesap sunucuda (/api/Personel/Turnover):
 *   ortalama = (dönem başı + dönem sonu) / 2
 *   aylık oran = çıkış / ortalama
 *   yıllık oran = aylık oran × 12   (Excel'deki "Oran %" satırı)
 * Süren ay "devam ediyor" olarak gösterilir ve yıl ortalamasına girmez.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { App as AntdApp, Alert, Button, Card, Col, Row, Segmented, Select, Space, Spin, Tooltip } from "antd";
import { Download, Info, RefreshCw } from "lucide-react";

import { api } from "./api";
import { tabloIndir } from "./raporExcel";

const AYLAR = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

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
}

interface Dilim {
  ad: string;
  adet: number;
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
  buYil: YilVerisi;
  gecenYil: YilVerisi;
}

/* ------------------------------------------------------------------ biçim */

const sayi = (v?: number | null, ondalik = 0) =>
  v === null || v === undefined ? "" : v.toLocaleString("tr-TR", { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik });

const yuzde = (v?: number | null, ondalik = 0) => (v === null || v === undefined ? "" : `%${sayi(v, ondalik)}`);

/** Yıllık oran rengi: Excel'deki renk skalasının karşılığı (düşük yeşil, yüksek kırmızı) */
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

/* ---------------------------------------------------------------- tablo */

const hucre: CSSProperties = { border: "1px solid #c9cec4", padding: "4px 6px", textAlign: "center", whiteSpace: "nowrap" };
const etiket: CSSProperties = { ...hucre, textAlign: "left", fontWeight: 600, background: "#fafbf8" };

function YilTablosu({ v }: { v: YilVerisi }) {
  const satir = (ad: string, f: (a: Ay) => ReactNode, stil?: (a: Ay) => CSSProperties) => (
    <tr>
      <td style={etiket}>{ad}</td>
      {v.aylar.map((a) => (
        <td key={a.ay} style={{ ...hucre, ...(a.devam ? { fontStyle: "italic", color: "#6b7480" } : {}), ...(stil && !a.bos ? stil(a) : {}) }}>
          {a.bos ? "" : f(a)}
        </td>
      ))}
    </tr>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 880 }}>
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
          {satir("ŞUBE SAYISI", (a) => sayi(a.subeSayisi))}
          {satir("DÖNEM BAŞI ÇALIŞAN SAYISI", (a) => sayi(a.donemBasi))}
          {satir("DÖNEM SONU ÇALIŞAN SAYISI", (a) => sayi(a.donemSonu))}
          {satir("GİRİŞ SAYISI", (a) => sayi(a.giris))}
          {satir("ÇIKIŞ SAYISI", (a) => sayi(a.cikis))}
          {satir("ORTALAMA", (a) => sayi(a.ortalama, a.ortalama && a.ortalama % 1 ? 1 : 0))}
          {satir("AYLIK ORAN", (a) => yuzde(a.oran, 2), () => ({ color: "#c0392b" }))}
          <tr>
            <td style={{ ...etiket, background: "#d9d9d9", fontWeight: 800 }}>{v.yil} ORAN % (yıllık)</td>
            {v.aylar.map((a) => {
              const r = oranRengi(a.bos ? null : a.yillikOran);
              return (
                <td key={a.ay} style={{ ...hucre, background: r.bg, color: r.fg, fontWeight: 800, fontSize: 13.5, ...(a.devam ? { opacity: 0.6 } : {}) }}>
                  {a.bos ? "" : yuzde(a.yillikOran)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Karsilastirma({ bu, gecen }: { bu: YilVerisi; gecen: YilVerisi }) {
  const renk = (a?: number | null, b?: number | null) => {
    if (a === null || a === undefined || b === null || b === undefined) return {};
    if (a === b) return {};
    return a < b ? { background: "#c6efce", color: "#006100" } : { background: "#ffc7ce", color: "#9c0006" };
  };
  const tamAy = (a: Ay) => (a.bos || a.devam ? null : a.yillikOran);

  const satir = (v: YilVerisi, diger: YilVerisi) => (
    <tr>
      <td style={{ ...etiket, fontWeight: 700 }}>{v.yil} Oran %</td>
      {v.aylar.map((a, i) => (
        <td key={a.ay} style={{ ...hucre, ...renk(tamAy(a), tamAy(diger.aylar[i])) }}>
          {tamAy(a) === null ? "" : yuzde(a.yillikOran)}
        </td>
      ))}
      <td style={{ ...hucre, fontWeight: 800, ...renk(v.ortalamaYillikOran, diger.ortalamaYillikOran) }}>
        {yuzde(v.ortalamaYillikOran)}
      </td>
    </tr>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 880 }}>
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
            <th style={{ ...etiket }}>YIL</th>
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

function GirisCikisTablosu({ v }: { v: YilVerisi }) {
  const dolu = v.aylar.filter((a) => !a.bos);
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
            <td style={{ ...hucre, background: "#dff3e6", fontWeight: 700 }}>{a.bos ? "" : sayi(a.giris)}</td>
            <td style={{ ...hucre, background: "#fde2e2", fontWeight: 700 }}>{a.bos ? "" : sayi(a.cikis)}</td>
          </tr>
        ))}
        <tr>
          <td style={{ ...etiket, fontWeight: 800 }}>TOPLAM</td>
          <td style={{ ...hucre, background: "#00b050", color: "#fff", fontWeight: 800, fontSize: 14 }}>
            {sayi(dolu.reduce((t, a) => t + (a.giris ?? 0), 0))}
          </td>
          <td style={{ ...hucre, background: "#ff0000", color: "#fff", fontWeight: 800, fontSize: 14 }}>
            {sayi(dolu.reduce((t, a) => t + (a.cikis ?? 0), 0))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------------- grafik */

/** İki yılın aylık yıllık oranı: çizgi grafik, %100 hedef çizgisi */
function OranGrafigi({ bu, gecen }: { bu: YilVerisi; gecen: YilVerisi }) {
  const G = 760,
    Y = 260,
    sol = 44,
    sag = 12,
    ust = 14,
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
              <g key={a.ay}>
                <circle cx={x(i)} cy={y(a.yillikOran ?? 0)} r={4} fill="#fff" stroke={renk} strokeWidth={2}>
                  <title>{`${AYLAR[i]} ${v.yil}: %${sayi(a.yillikOran)}${a.devam ? " (devam ediyor)" : ""}`}</title>
                </circle>
                {v === bu && (
                  <text x={x(i)} y={y(a.yillikOran ?? 0) - 9} fontSize={10.5} textAnchor="middle" fill={renk} fontWeight={700}>
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

/** Seçilen yılın aylık giriş ve çıkış çubukları */
function GirisCikisGrafigi({ v }: { v: YilVerisi }) {
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
                <rect x={merkez - cubuk - 1} y={y(a.giris ?? 0)} width={cubuk} height={Y - alt - y(a.giris ?? 0)} rx={3} fill="#00a65a">
                  <title>{`${AYLAR[i]} giriş: ${a.giris}`}</title>
                </rect>
                <rect x={merkez + 1} y={y(a.cikis ?? 0)} width={cubuk} height={Y - alt - y(a.cikis ?? 0)} rx={3} fill="#e8481c">
                  <title>{`${AYLAR[i]} çıkış: ${a.cikis}`}</title>
                </rect>
                <text x={merkez - cubuk / 2 - 1} y={y(a.giris ?? 0) - 4} fontSize={9.5} textAnchor="middle" fill="#00733f">
                  {a.giris}
                </text>
                <text x={merkez + cubuk / 2 + 1} y={y(a.cikis ?? 0) - 4} fontSize={9.5} textAnchor="middle" fill="#b23a12">
                  {a.cikis}
                </text>
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

/** Pasta (halka) grafik ve yanında açıklama */
function Pasta({ baslik, dilimler }: { baslik: string; dilimler: Dilim[] }) {
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

  return (
    <Card size="small" title={baslik} style={{ height: "100%" }}>
      {toplam === 0 ? (
        <div style={{ color: "#8a929b", padding: 20, textAlign: "center" }}>Bu yıl çıkış yok</div>
      ) : (
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <svg viewBox="0 0 160 160" width={150} height={150} role="img" aria-label={baslik}>
            {dilimler.length === 1 ? (
              <circle cx={M} cy={M} r={(R + r) / 2} fill="none" stroke={PASTA_RENK[0]} strokeWidth={R - r} />
            ) : (
              dilimler.map((d, i) => {
                const son = aci + (d.adet / toplam) * Math.PI * 2;
                const yol = yay(aci, son - 0.0001);
                aci = son;
                return (
                  <path key={d.ad} d={yol} fill={PASTA_RENK[i % PASTA_RENK.length]} stroke="#fff" strokeWidth={1.5}>
                    <title>{`${d.ad}: ${d.adet} (%${Math.round((d.adet * 100) / toplam)})`}</title>
                  </path>
                );
              })
            )}
            <text x={M} y={M - 2} textAnchor="middle" fontSize={22} fontWeight={800} fill="#1d2126">
              {toplam}
            </text>
            <text x={M} y={M + 16} textAnchor="middle" fontSize={10.5} fill="#8a929b">
              çıkış
            </text>
          </svg>
          <div style={{ flex: 1, minWidth: 150 }}>
            {dilimler.map((d, i) => (
              <div key={d.ad} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, padding: "2px 0" }}>
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

/* ----------------------------------------------------------------- sayfa */

export default function Turnover() {
  const { message } = AntdApp.useApp();
  const [yil, setYil] = useState(new Date().getFullYear());
  const [kapsam, setKapsam] = useState<"tumu" | "magaza">("tumu");
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

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
            a.devam ? "devam ediyor" : "",
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
        { ad: "Not", genislik: 14 },
      ],
      satirlar,
    } as any);
  };

  const bu = veri?.buYil;
  const gecen = veri?.gecenYil;
  const fark = bu?.ortalamaYillikOran != null && gecen?.ortalamaYillikOran != null ? bu.ortalamaYillikOran - gecen.ortalamaYillikOran : null;
  const enYuksek = bu?.aylar.filter((a) => !a.bos && !a.devam).sort((a, b) => (b.yillikOran ?? 0) - (a.yillikOran ?? 0))[0];

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
          {/* -------------------------------------------------- özet */}
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            {[
              {
                ad: `${bu.yil} ortalama turnover`,
                deger: yuzde(bu.ortalamaYillikOran),
                alt:
                  fark === null
                    ? `${gecen.yil}: ${yuzde(gecen.ortalamaYillikOran)}`
                    : `${gecen.yil}: ${yuzde(gecen.ortalamaYillikOran)} · ${fark > 0 ? "▲" : "▼"} ${sayi(Math.abs(fark))} puan`,
                renk: fark === null ? undefined : fark > 0 ? "#c0392b" : "#3f7d0a",
              },
              { ad: `${bu.yil} giriş`, deger: sayi(bu.toplamGiris), alt: `${gecen.yil}: ${sayi(gecen.toplamGiris)}`, renk: "#00873e" },
              { ad: `${bu.yil} çıkış`, deger: sayi(bu.toplamCikis), alt: `${gecen.yil}: ${sayi(gecen.toplamCikis)}`, renk: "#e8481c" },
              {
                ad: "En yüksek ay",
                deger: enYuksek ? `${AYLAR[enYuksek.ay - 1]}` : "—",
                alt: enYuksek ? `${yuzde(enYuksek.yillikOran)} · ${enYuksek.cikis} çıkış` : "",
              },
            ].map((k) => (
              <Col key={k.ad} xs={12} lg={6}>
                <Card size="small">
                  <div style={{ fontSize: 12, color: "#5b6875", fontWeight: 600 }}>{k.ad}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: k.renk }}>{k.deger}</div>
                  <div style={{ fontSize: 12, color: "#8a929b" }}>{k.alt}</div>
                </Card>
              </Col>
            ))}
          </Row>

          {/* --------------------------------------------- tablolar */}
          <Row gutter={[12, 12]}>
            <Col xs={24} xl={18}>
              <Card size="small" title={<span style={{ color: "#e8481c", fontSize: 16 }}>İnsan Kaynakları / <span style={{ color: "#5f8c10" }}>Turnover</span></span>}>
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  <YilTablosu v={gecen} />
                  <YilTablosu v={bu} />
                  <Karsilastirma bu={bu} gecen={gecen} />
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={6}>
              <Card size="small">
                <GirisCikisTablosu v={bu} />
              </Card>
            </Col>
          </Row>

          {/* ---------------------------------------------- grafikler */}
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
                <OranGrafigi bu={bu} gecen={gecen} />
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
                <GirisCikisGrafigi v={bu} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} lg={8}>
              <Pasta baslik={`${bu.yil} çıkış sebepleri`} dilimler={bu.sebepler} />
            </Col>
            <Col xs={24} lg={8}>
              <Pasta baslik={`${bu.yil} çıkışların birimleri`} dilimler={bu.birimler} />
            </Col>
            <Col xs={24} lg={8}>
              <Pasta baslik={`${bu.yil} ayrılanların çalışma süresi`} dilimler={bu.sureler} />
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
                Ortalama = (dönem başı + dönem sonu) / 2 · Aylık oran = çıkış / ortalama · Yıllık oran = aylık oran × 12 (%100: bir
                yılda kadronun tamamı kadar çıkış). Dönem sonu, bir sonraki ayın 1'indeki çalışan sayısıdır. Süren ay soluk ve
                "devam ediyor" olarak gösterilir, karşılaştırmaya ve yıl ortalamasına girmez. Kaynak Mikro personel kayıtları;
                seçili bölge varsa ona göre süzülür.
              </span>
            }
          />
        </Spin>
      )}
    </div>
  );
}

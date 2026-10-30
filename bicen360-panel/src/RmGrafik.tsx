/**
 * ---------------------------------------------------------------------------
 * Rapor Merkezi grafikleri
 * ---------------------------------------------------------------------------
 * Çizgi, çubuk (yatay/dikey, gruplu), halka, dağılım ve kıvılcım. El yazımı
 * SVG: panel bilinçli olarak grafik kütüphanesi taşımıyor (Grafik.tsx).
 * Hepsi kabın genişliğine göre çiziliyor, üzerine gelince ipucu gösteriyor,
 * tıklanabilir olanlar süzgeç değiştiriyor.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------- renkler */

export const RM = {
  brand: "#7CB518",
  brandInk: "#4F7D0C",
  orange: "#E8481C",
  good: "#2E8B3D",
  warn: "#B9800A",
  bad: "#CF3A1A",
  info: "#2E7DAF",
  muted: "#5E6858",
  line: "#DADFD3",
  fg: "#1B2218",
  surface: "#FFFFFF",
};

export const PALET = [
  "#7CB518", "#E8481C", "#2E86AB", "#E3A33B", "#8E5DB8", "#2BA39A", "#C44569",
  "#7A8794", "#C9A800", "#A0612D", "#4F7D0C", "#D9738B", "#3D5A80", "#6A994E",
];

export const saydam = (hex: string, a: number) =>
  hex.startsWith("#") && hex.length === 7
    ? hex + Math.round(a * 255).toString(16).padStart(2, "0")
    : hex;

/* ---------------------------------------------------------- biçimleme */

const nf = (d: number) =>
  new Intl.NumberFormat("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const N0 = nf(0);
export const N1 = nf(1);
export const N2 = nf(2);

export function TL(v: number, tam = false): string {
  if (!Number.isFinite(v)) return "—";
  if (tam) return "₺" + N0.format(v);

  const a = Math.abs(v);

  if (a >= 1e9) return "₺" + N2.format(v / 1e9) + " Mr";
  if (a >= 1e6) return "₺" + N2.format(v / 1e6) + " Mn";
  if (a >= 1e4) return "₺" + N1.format(v / 1e3) + " B";

  return "₺" + N0.format(v);
}

export const PCT = (v: number) => (Number.isFinite(v) ? "%" + N1.format(v * 100) : "—");

/* ------------------------------------------------------------ yardımcı */

/** Kabın genişliği; pencere ya da yan menü değişince yeniden çizilsin. */
function useGenislik() {
  const ref = useRef<HTMLDivElement>(null);
  const [g, setG] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;

    if (!el) return;

    setG(el.clientWidth);

    const ro = new ResizeObserver(() => setG(el.clientWidth));
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return [ref, g] as const;
}

/** Okunaklı eksen adımları (0, 250 B, 500 B …). */
function eksen(max: number, min = 0, adet = 5): number[] {
  if (!(max > min)) max = min + 1;

  const ham = (max - min) / adet;
  const us = Math.pow(10, Math.floor(Math.log10(ham)));
  const k = ham / us;
  const adim = (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * us;

  const bas = Math.floor(min / adim) * adim;
  const l: number[] = [];

  for (let v = bas; v <= max + adim * 0.001; v += adim) l.push(Number(v.toFixed(10)));

  if (l[l.length - 1] < max) l.push(l[l.length - 1] + adim);

  return l;
}

type Ipucu = { x: number; y: number; icerik: ReactNode } | null;

function IpucuKutu({ ipucu, genislik }: { ipucu: Ipucu; genislik: number }) {
  if (!ipucu) return null;

  const sag = ipucu.x > genislik * 0.6;

  return (
    <div
      className="rm-ipucu"
      style={{
        left: sag ? undefined : ipucu.x + 12,
        right: sag ? genislik - ipucu.x + 12 : undefined,
        top: Math.max(0, ipucu.y - 10),
      }}
    >
      {ipucu.icerik}
    </div>
  );
}

const Bos = ({ metin = "Bu filtrelerle veri yok." }: { metin?: string }) => (
  <div className="rm-bos">{metin}</div>
);

/* ============================================================ kıvılcım */

export function Kivilcim({ veri, renk = RM.brand }: { veri: number[]; renk?: string }) {
  if (!veri || veri.length < 2) return null;

  const w = 84;
  const h = 28;
  const mx = Math.max(...veri);
  const mn = Math.min(...veri);
  const sp = mx - mn || 1;

  const pts = veri.map((v, i) => [(i / (veri.length - 1)) * w, h - 3 - ((v - mn) / sp) * (h - 6)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const son = pts[pts.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${d}L${w} ${h}L0 ${h}Z`} fill={renk} opacity={0.12} />
      <path d={d} fill="none" stroke={renk} strokeWidth={1.6} />
      <circle cx={son[0]} cy={son[1]} r={2.4} fill={renk} />
    </svg>
  );
}

/* =============================================================== çizgi */

export interface CizgiSeri {
  ad: string;
  veri: number[];
  renk: string;
  kesik?: boolean;
  alan?: boolean;
}

export function CizgiGrafik({
  etiketler,
  seriler,
  yukseklik = 260,
  bicim = TL,
}: {
  etiketler: string[];
  seriler: CizgiSeri[];
  yukseklik?: number;
  bicim?: (v: number) => string;
}) {
  const [ref, W] = useGenislik();
  const [ip, setIp] = useState<Ipucu>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = etiketler.length;
  const max = Math.max(0, ...seriler.flatMap((s) => s.veri.slice(0, n)));
  const tik = eksen(max);
  const ust = tik[tik.length - 1] || 1;

  const sol = 58;
  const sag = 10;
  const ustP = 10;
  const alt = 26;
  const iw = Math.max(10, W - sol - sag);
  const ih = yukseklik - ustP - alt;

  const X = (i: number) => sol + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v: number) => ustP + ih - (v / ust) * ih;

  const adim = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));

  const hareket = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (x / iw) * (n - 1))));

    setHover(i);
    setIp({
      x: X(i),
      y: e.clientY - r.top,
      icerik: (
        <>
          <b>{etiketler[i]}</b>
          {seriler.map((s) => (
            <div key={s.ad}>
              <i style={{ background: s.renk }} /> {s.ad}: {s.veri[i] === undefined ? "—" : bicim(s.veri[i])}
            </div>
          ))}
        </>
      ),
    });
  };

  return (
    <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
      {W > 0 && n > 0 && (
        <svg width={W} height={yukseklik}>
          {tik.map((t) => (
            <g key={t}>
              <line x1={sol} x2={W - sag} y1={Y(t)} y2={Y(t)} stroke={RM.line} />
              <text x={sol - 6} y={Y(t) + 4} textAnchor="end" className="rm-eksen">
                {bicim(t)}
              </text>
            </g>
          ))}

          {etiketler.map((e, i) =>
            i % adim === 0 ? (
              <text key={i} x={X(i)} y={yukseklik - 8} textAnchor="middle" className="rm-eksen">
                {e}
              </text>
            ) : null
          )}

          {[...seriler].reverse().map((s) => {
            const v = s.veri.slice(0, n);

            if (v.length === 0) return null;

            const d = v.map((y, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(y).toFixed(1)).join("");

            return (
              <g key={s.ad}>
                {s.alan && (
                  <path
                    d={`${d}L${X(v.length - 1)} ${Y(0)}L${X(0)} ${Y(0)}Z`}
                    fill={saydam(s.renk, 0.14)}
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={s.renk}
                  strokeWidth={s.kesik ? 1.5 : 2}
                  strokeDasharray={s.kesik ? "5 4" : undefined}
                  strokeLinejoin="round"
                />
                {!s.kesik && n <= 45 &&
                  v.map((y, i) => <circle key={i} cx={X(i)} cy={Y(y)} r={2.5} fill={s.renk} />)}
              </g>
            );
          })}

          {hover !== null && (
            <line x1={X(hover)} x2={X(hover)} y1={ustP} y2={ustP + ih} stroke={RM.muted} strokeDasharray="3 3" />
          )}

          <rect
            x={sol}
            y={ustP}
            width={iw}
            height={ih}
            fill="transparent"
            onMouseMove={hareket}
            onMouseLeave={() => {
              setIp(null);
              setHover(null);
            }}
          />
        </svg>
      )}
      <IpucuKutu ipucu={ip} genislik={W} />
    </div>
  );
}

/* ============================================================== çubuk */

export interface CubukSeri {
  ad: string;
  veri: number[];
  renk: string | string[];
}

export function CubukGrafik({
  etiketler,
  seriler,
  yatay = false,
  yukseklik = 260,
  bicim = TL,
  eksenBicim,
  tikla,
  hedef,
  ipucuEk,
}: {
  etiketler: string[];
  seriler: CubukSeri[];
  yatay?: boolean;
  yukseklik?: number;
  bicim?: (v: number) => string;
  eksenBicim?: (v: number) => string;
  tikla?: (i: number) => void;
  /** Kesikli hedef çizgisi (ör. 14 gün) */
  hedef?: number;
  ipucuEk?: (i: number) => ReactNode;
}) {
  const [ref, W] = useGenislik();
  const [ip, setIp] = useState<Ipucu>(null);

  const n = etiketler.length;

  if (n === 0)
    return (
      <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
        <Bos />
      </div>
    );

  const tum = seriler.flatMap((s) => s.veri);
  const max = Math.max(0, hedef ?? 0, ...tum);
  const min = Math.min(0, ...tum);
  const tik = eksen(max, min, yatay ? 4 : 5);
  const ust = tik[tik.length - 1] || 1;
  const alt0 = tik[0];
  const eb = eksenBicim ?? bicim;

  const renk = (s: CubukSeri, i: number) => (Array.isArray(s.renk) ? s.renk[i] : s.renk);

  const goster = (i: number, x: number, y: number) =>
    setIp({
      x,
      y,
      icerik: (
        <>
          <b>{etiketler[i]}</b>
          {seriler.map((s) => (
            <div key={s.ad}>
              {seriler.length > 1 && <i style={{ background: renk(s, i) }} />}
              {seriler.length > 1 ? `${s.ad}: ` : ""}
              {bicim(s.veri[i] ?? 0)}
            </div>
          ))}
          {ipucuEk?.(i)}
        </>
      ),
    });

  if (yatay) {
    const enUzun = Math.max(...etiketler.map((e) => e.length));
    const sol = Math.min(Math.max(60, enUzun * 6.6 + 10), W * 0.42);
    const sag = 14;
    const ustP = 4;
    const altP = 22;
    const iw = Math.max(10, W - sol - sag);
    const ih = yukseklik - ustP - altP;
    const satir = ih / n;
    const kalinlik = Math.min(26, satir * 0.7) / seriler.length;

    const X = (v: number) => sol + ((v - alt0) / (ust - alt0)) * iw;

    const kirp = (e: string) => {
      const sigar = Math.floor((sol - 10) / 6.4);
      return e.length > sigar ? e.slice(0, Math.max(3, sigar - 1)) + "…" : e;
    };

    return (
      <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
        {W > 0 && (
          <svg width={W} height={yukseklik}>
            {tik.map((t) => (
              <g key={t}>
                <line x1={X(t)} x2={X(t)} y1={ustP} y2={ustP + ih} stroke={RM.line} />
                <text x={X(t)} y={yukseklik - 6} textAnchor="middle" className="rm-eksen">
                  {eb(t)}
                </text>
              </g>
            ))}

            {etiketler.map((e, i) => {
              const yMerkez = ustP + satir * i + satir / 2;

              return (
                <g
                  key={i}
                  className={tikla ? "rm-tiklanir" : undefined}
                  onClick={() => tikla?.(i)}
                  onMouseMove={(ev) => {
                    const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    goster(i, ev.clientX - r.left, ev.clientY - r.top);
                  }}
                  onMouseLeave={() => setIp(null)}
                >
                  <rect x={0} y={ustP + satir * i} width={W} height={satir} fill="transparent" />
                  <text x={sol - 8} y={yMerkez + 4} textAnchor="end" className="rm-etiket">
                    {kirp(e)}
                  </text>
                  {seriler.map((s, k) => {
                    const v = s.veri[i] ?? 0;
                    const x0 = X(Math.min(0, v));
                    const x1 = X(Math.max(0, v));
                    const y = yMerkez - (kalinlik * seriler.length) / 2 + kalinlik * k;

                    return (
                      <rect
                        key={s.ad}
                        x={x0}
                        y={y}
                        width={Math.max(1, x1 - x0)}
                        height={Math.max(2, kalinlik - 1)}
                        rx={3}
                        fill={renk(s, i)}
                      />
                    );
                  })}
                </g>
              );
            })}

            {hedef !== undefined && (
              <line x1={X(hedef)} x2={X(hedef)} y1={ustP} y2={ustP + ih} stroke={RM.muted} strokeDasharray="4 4" strokeWidth={1.5} />
            )}
          </svg>
        )}
        <IpucuKutu ipucu={ip} genislik={W} />
      </div>
    );
  }

  /* Dikey */
  const sol = 58;
  const sag = 10;
  const ustP = 10;
  const altP = 26;
  const iw = Math.max(10, W - sol - sag);
  const ih = yukseklik - ustP - altP;
  const sutun = iw / n;
  const kalinlik = Math.min(46, sutun * 0.72) / seriler.length;

  const Y = (v: number) => ustP + ih - ((v - alt0) / (ust - alt0)) * ih;
  const adim = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));

  return (
    <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
      {W > 0 && (
        <svg width={W} height={yukseklik}>
          {tik.map((t) => (
            <g key={t}>
              <line x1={sol} x2={W - sag} y1={Y(t)} y2={Y(t)} stroke={RM.line} />
              <text x={sol - 6} y={Y(t) + 4} textAnchor="end" className="rm-eksen">
                {eb(t)}
              </text>
            </g>
          ))}

          {etiketler.map((e, i) => {
            const xm = sol + sutun * i + sutun / 2;

            return (
              <g
                key={i}
                className={tikla ? "rm-tiklanir" : undefined}
                onClick={() => tikla?.(i)}
                onMouseMove={(ev) => {
                  const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  goster(i, ev.clientX - r.left, ev.clientY - r.top);
                }}
                onMouseLeave={() => setIp(null)}
              >
                <rect x={sol + sutun * i} y={ustP} width={sutun} height={ih} fill="transparent" />
                {seriler.map((s, k) => {
                  const v = s.veri[i] ?? 0;
                  const y0 = Y(Math.max(0, v));
                  const y1 = Y(Math.min(0, v));
                  const x = xm - (kalinlik * seriler.length) / 2 + kalinlik * k;

                  return (
                    <rect
                      key={s.ad}
                      x={x}
                      y={y0}
                      width={Math.max(2, kalinlik - 2)}
                      height={Math.max(1, y1 - y0)}
                      rx={3}
                      fill={renk(s, i)}
                    />
                  );
                })}
                {i % adim === 0 && (
                  <text x={xm} y={yukseklik - 8} textAnchor="middle" className="rm-eksen">
                    {e}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <IpucuKutu ipucu={ip} genislik={W} />
    </div>
  );
}

/* ============================================================== halka */

export function HalkaGrafik({
  dilimler,
  yukseklik = 260,
  bicim = TL,
}: {
  dilimler: { ad: string; deger: number; renk: string }[];
  yukseklik?: number;
  bicim?: (v: number) => string;
}) {
  const [ref, W] = useGenislik();
  const [ip, setIp] = useState<Ipucu>(null);

  const toplam = dilimler.reduce((t, d) => t + Math.max(0, d.deger), 0);

  if (toplam <= 0)
    return (
      <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
        <Bos />
      </div>
    );

  const lejant = 26 * Math.ceil(dilimler.length / 2);
  const R = Math.max(30, Math.min(W / 2 - 10, (yukseklik - lejant - 10) / 2));
  const r = R * 0.62;
  const cx = W / 2;
  const cy = R + 4;

  let aci = -Math.PI / 2;

  const yay = (a0: number, a1: number) => {
    const b = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rr: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    const [x0, y0] = p(a0, R);
    const [x1, y1] = p(a1, R);
    const [x2, y2] = p(a1, r);
    const [x3, y3] = p(a0, r);

    return `M${x0} ${y0}A${R} ${R} 0 ${b} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${b} 0 ${x3} ${y3}Z`;
  };

  return (
    <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
      {W > 0 && (
        <svg width={W} height={R * 2 + 8}>
          {dilimler.map((d) => {
            const pay = Math.max(0, d.deger) / toplam;
            const a0 = aci;
            const a1 = aci + Math.max(0.0001, pay * Math.PI * 2 - (dilimler.length > 1 ? 0.012 : 0));

            aci += pay * Math.PI * 2;

            if (pay <= 0) return null;

            return (
              <path
                key={d.ad}
                d={pay >= 0.9999 ? yay(-Math.PI / 2, Math.PI * 1.4999) : yay(a0, a1)}
                fill={d.renk}
                stroke={RM.surface}
                strokeWidth={1.5}
                onMouseMove={(ev) => {
                  const b = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setIp({
                    x: ev.clientX - b.left,
                    y: ev.clientY - b.top,
                    icerik: (
                      <>
                        <b>{d.ad}</b>
                        <div>
                          {bicim(d.deger)} ({PCT(pay)})
                        </div>
                      </>
                    ),
                  });
                }}
                onMouseLeave={() => setIp(null)}
              />
            );
          })}
          <text x={cx} y={cy - 2} textAnchor="middle" className="rm-halka-toplam">
            {bicim(toplam)}
          </text>
          <text x={cx} y={cy + 15} textAnchor="middle" className="rm-eksen">
            toplam
          </text>
        </svg>
      )}
      <div className="rm-lejant rm-lejant-orta">
        {dilimler.map((d) => (
          <span key={d.ad}>
            <i style={{ background: d.renk }} />
            {d.ad} · {PCT(Math.max(0, d.deger) / toplam)}
          </span>
        ))}
      </div>
      <IpucuKutu ipucu={ip} genislik={W} />
    </div>
  );
}

/* ============================================================ dağılım */

export interface Nokta {
  x: number;
  y: number;
  renk: string;
  secili?: boolean;
  soluk?: boolean;
  etiket: ReactNode;
}

export function DagilimGrafik({
  noktalar,
  xBaslik,
  yBaslik,
  xBicim = (v: number) => N0.format(v),
  yBicim = (v: number) => "₺" + N0.format(v),
  yukseklik = 340,
  tikla,
}: {
  noktalar: Nokta[];
  xBaslik: string;
  yBaslik: string;
  xBicim?: (v: number) => string;
  yBicim?: (v: number) => string;
  yukseklik?: number;
  tikla?: (i: number) => void;
}) {
  const [ref, W] = useGenislik();
  const [ip, setIp] = useState<Ipucu>(null);

  const gecerli = noktalar.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (gecerli.length === 0)
    return (
      <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
        <Bos />
      </div>
    );

  const xs = gecerli.map((p) => p.x);
  const ys = gecerli.map((p) => p.y);
  const xt = eksen(Math.max(...xs) * 1.05, Math.min(...xs) * 0.9, 5);
  const yt = eksen(Math.max(...ys) * 1.05, Math.min(...ys) * 0.9, 5);

  const sol = 64;
  const sag = 14;
  const ustP = 10;
  const altP = 40;
  const iw = Math.max(10, W - sol - sag);
  const ih = yukseklik - ustP - altP;

  const X = (v: number) => sol + ((v - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * iw;
  const Y = (v: number) => ustP + ih - ((v - yt[0]) / (yt[yt.length - 1] - yt[0] || 1)) * ih;

  return (
    <div ref={ref} className="rm-grafik" style={{ height: yukseklik }}>
      {W > 0 && (
        <svg width={W} height={yukseklik}>
          {yt.map((t) => (
            <g key={"y" + t}>
              <line x1={sol} x2={W - sag} y1={Y(t)} y2={Y(t)} stroke={RM.line} />
              <text x={sol - 6} y={Y(t) + 4} textAnchor="end" className="rm-eksen">
                {yBicim(t)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <g key={"x" + t}>
              <line x1={X(t)} x2={X(t)} y1={ustP} y2={ustP + ih} stroke={RM.line} />
              <text x={X(t)} y={ustP + ih + 16} textAnchor="middle" className="rm-eksen">
                {xBicim(t)}
              </text>
            </g>
          ))}
          <text x={sol + iw / 2} y={yukseklik - 4} textAnchor="middle" className="rm-eksen rm-eksen-baslik">
            {xBaslik}
          </text>
          <text
            transform={`translate(12 ${ustP + ih / 2}) rotate(-90)`}
            textAnchor="middle"
            className="rm-eksen rm-eksen-baslik"
          >
            {yBaslik}
          </text>

          {noktalar.map((p, i) =>
            Number.isFinite(p.x) && Number.isFinite(p.y) ? (
              <circle
                key={i}
                cx={X(p.x)}
                cy={Y(p.y)}
                r={p.secili ? 9 : 6}
                fill={saydam(p.renk, p.soluk ? 0.25 : 0.85)}
                stroke={RM.surface}
                strokeWidth={1}
                className={tikla ? "rm-tiklanir" : undefined}
                onClick={() => tikla?.(i)}
                onMouseMove={(ev) => {
                  const b = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setIp({ x: ev.clientX - b.left, y: ev.clientY - b.top, icerik: p.etiket });
                }}
                onMouseLeave={() => setIp(null)}
              />
            ) : null
          )}
        </svg>
      )}
      <IpucuKutu ipucu={ip} genislik={W} />
    </div>
  );
}

/* ---------------------------------------------- yeniden çizim tetikleyici */

/** Grafik kabı ilk açılışta 0 genişlikte olabiliyor (gizli sekme); bir kez daha ölç. */
export function useIlkCizim() {
  const [, setN] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setN((x) => x + 1), 50);
    return () => clearTimeout(t);
  }, []);
}

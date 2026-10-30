/**
 * Personel Bütçesi grafikleri (30.10.2026): yığılmış aylık çubuk, halka ve
 * yatay çubuk. Kütüphane yok; Turnover.tsx'teki gibi elle SVG.
 */
import { useMemo, useState } from "react";
import type { AyOzeti } from "./butceOrtak";
import { BILESENLER, para, paraKisa } from "./butceOrtak";

/* ------------------------------------------------------- yığılmış çubuk */

interface YigilmisProps {
  aylar: AyOzeti[];
  /** Karşılaştırma için ikinci seri (çizgi olarak toplam) */
  bazAylar?: AyOzeti[] | null;
  bazAd?: string;
  yukseklik?: number;
}

export function AylikYigilmis({ aylar, bazAylar, bazAd, yukseklik = 300 }: YigilmisProps) {
  const [kapali, setKapali] = useState<Set<string>>(new Set());
  const [ipucu, setIpucu] = useState<{ i: number; x: number; y: number } | null>(null);

  const G = 920, Y = yukseklik, solBos = 70, altBos = 30, ustBos = 14;
  const aktifBilesenler = BILESENLER.filter((b) => !kapali.has(b.k));
  const toplamlar = aylar.map((a) => aktifBilesenler.reduce((t, b) => t + Math.max(0, a[b.k]), 0));
  const bazToplam = bazAylar?.map((a) => aktifBilesenler.reduce((t, b) => t + Math.max(0, a[b.k]), 0)) ?? null;
  const enYuksek = Math.max(1, ...toplamlar, ...(bazToplam ?? []));
  const adim = useMemo(() => {
    const kaba = enYuksek / 4;
    const us = Math.pow(10, Math.floor(Math.log10(kaba)));
    const k = kaba / us;
    return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * us;
  }, [enYuksek]);
  const tavan = Math.ceil(enYuksek / adim) * adim;
  const icG = G - solBos - 12, icY = Y - altBos - ustBos;
  const sutunG = icG / 12, cubukG = sutunG * 0.62;
  const y = (v: number) => ustBos + icY - (v / tavan) * icY;
  const cizgiler = Array.from({ length: Math.round(tavan / adim) + 1 }, (_, i) => i * adim);

  return (
    <div className="pb-grafik">
      <svg viewBox={`0 0 ${G} ${Y}`} role="img" aria-label="Aylık personel maliyeti">
        {cizgiler.map((v) => (
          <g key={v}>
            <line x1={solBos} x2={G - 12} y1={y(v)} y2={y(v)} stroke="#e6eae3" strokeDasharray={v === 0 ? undefined : "3 4"} />
            <text x={solBos - 8} y={y(v) + 4} fontSize={11} fill="#66706a" textAnchor="end">{paraKisa(v)}</text>
          </g>
        ))}
        {aylar.map((a, i) => {
          let ust = 0;
          const x0 = solBos + i * sutunG + (sutunG - cubukG) / 2;
          return (
            <g key={a.ay} className={"cubuk" + (ipucu && ipucu.i !== i ? " sonuk" : "")}
              onMouseEnter={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setIpucu({ i, x: ((x0 + cubukG / 2) / G) * r.width, y: (y(toplamlar[i]) / Y) * r.height }); }}
              onMouseLeave={() => setIpucu(null)}>
              {aktifBilesenler.map((b) => {
                const v = Math.max(0, a[b.k]);
                const y1 = y(ust + v), y2 = y(ust);
                ust += v;
                return <rect key={b.k} x={x0} y={y1} width={cubukG} height={Math.max(0, y2 - y1)} fill={b.renk} rx={b === aktifBilesenler[aktifBilesenler.length - 1] ? 3 : 0} />;
              })}
              <text x={x0 + cubukG / 2} y={Y - altBos + 16} fontSize={11.5} fontWeight={700} fill="#66706a" textAnchor="middle">{a.etiket.split(" ")[0].slice(0, 3)}</text>
              <text x={x0 + cubukG / 2} y={y(toplamlar[i]) - 5} fontSize={10.5} fontWeight={700} fill="#17321f" textAnchor="middle">{paraKisa(toplamlar[i])}</text>
            </g>
          );
        })}
        {bazToplam && (
          <g>
            <polyline fill="none" stroke="#b4433a" strokeWidth={2} strokeDasharray="5 4"
              points={bazToplam.map((v, i) => `${solBos + i * sutunG + sutunG / 2},${y(v)}`).join(" ")} />
            {bazToplam.map((v, i) => <circle key={i} cx={solBos + i * sutunG + sutunG / 2} cy={y(v)} r={3.5} fill="#fff" stroke="#b4433a" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {ipucu && (() => {
        const a = aylar[ipucu.i];
        return (
          <div className="pb-ipucu" style={{ left: ipucu.x, top: ipucu.y }}>
            <b>{a.etiket}</b>
            {aktifBilesenler.map((b) => <div key={b.k}><span><i style={{ background: b.renk }} />{b.ad}</span><span>{para(a[b.k])}</span></div>)}
            <div className="toplam"><span>Toplam</span><span>{para(toplamlar[ipucu.i])}</span></div>
            {bazToplam && <div><span>{bazAd ?? "Baz"}</span><span>{para(bazToplam[ipucu.i])}</span></div>}
          </div>
        );
      })()}
      <div className="pb-lejant">
        {BILESENLER.map((b) => (
          <button key={b.k} className={kapali.has(b.k) ? "kapali" : ""} title={b.aciklama}
            onClick={() => setKapali((k) => { const n = new Set(k); if (n.has(b.k)) n.delete(b.k); else n.add(b.k); return n; })}>
            <i style={{ background: b.renk }} />{b.ad}
          </button>
        ))}
        {bazToplam && <button style={{ cursor: "default" }}><i style={{ background: "#b4433a", height: 2, width: 14 }} />{bazAd ?? "Baz senaryo"} toplamı</button>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- halka */

export interface Dilim { ad: string; deger: number; renk: string }

export function Halka({ dilimler, baslik, cap = 150 }: { dilimler: Dilim[]; baslik?: string; cap?: number }) {
  const toplam = dilimler.reduce((t, d) => t + Math.max(0, d.deger), 0) || 1;
  const r = 70, kalinlik = 22, C = 2 * Math.PI * r;
  let birikim = 0;
  return (
    <div className="pb-halka">
      <svg viewBox="0 0 160 160" width={cap} height={cap} role="img" aria-label={baslik ?? "Dağılım"}>
        <circle cx={80} cy={80} r={r} fill="none" stroke="#edf0ea" strokeWidth={kalinlik} />
        {dilimler.map((d) => {
          const oran = Math.max(0, d.deger) / toplam;
          const el = <circle key={d.ad} cx={80} cy={80} r={r} fill="none" stroke={d.renk} strokeWidth={kalinlik}
            strokeDasharray={`${oran * C} ${C}`} strokeDashoffset={-birikim * C} transform="rotate(-90 80 80)" />;
          birikim += oran;
          return el;
        })}
        <text x={80} y={76} textAnchor="middle" fontSize={11} fill="#66706a" fontWeight={600}>{baslik ?? "Toplam"}</text>
        <text x={80} y={94} textAnchor="middle" fontSize={14} fill="#17321f" fontWeight={800}>{paraKisa(toplam)}</text>
      </svg>
      <ul>
        {dilimler.map((d) => (
          <li key={d.ad}><i style={{ background: d.renk }} /><span style={{ color: "inherit", textAlign: "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{d.ad}</span><b>{paraKisa(d.deger)}</b><span>%{((Math.max(0, d.deger) / toplam) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</span></li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- yatay çubuklar */

export function YatayCubuk({ satirlar, enFazla = 12, onTikla }: { satirlar: { ad: string; deger: number; ek?: string }[]; enFazla?: number; onTikla?: (ad: string) => void }) {
  const l = satirlar.slice(0, enFazla);
  const en = Math.max(1, ...l.map((s) => s.deger));
  return (
    <div className="pb-tablo dar">
      <table>
        <tbody>
          {l.map((s) => (
            <tr key={s.ad} className={onTikla ? "tik" : ""} onClick={() => onTikla?.(s.ad)}>
              <td style={{ width: "34%", whiteSpace: "normal" }}><span className="ad">{s.ad}</span>{s.ek && <small>{s.ek}</small>}</td>
              <td><span className="pay" style={{ width: `${(s.deger / en) * 100}%`, maxWidth: 220 }} /></td>
              <td className="sag mono" style={{ fontWeight: 700 }}>{paraKisa(s.deger)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

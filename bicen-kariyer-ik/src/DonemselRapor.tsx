/**
 * Dönemsel değerlendirme · Rapor ve analiz (24.10.2026)
 * ---------------------------------------------------------------------------
 * Dönem trendi (değerlendirilen sayısı + ortalama, çift eksen), şube ve
 * pozisyon kıyası (önceki dönemle), puan dağılımı, soru bazında değişim,
 * değerlendirici eğilimi, en çok yükselen/düşen personel ve oryantasyon
 * değerlendirmesiyle birlikte yeni personelin durumu.
 * Uç: /api/DonemselDegerlendirme/Rapor/Analiz. Grafikler el yapımı SVG.
 */
import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Drawer, Empty, Segmented, Spin, Table, Tooltip } from "antd";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Download, Info } from "lucide-react";
import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import "./DonemselRapor.css";

/* ------------------------------------------------------------------ tipler */

interface Analiz {
  donem: string | null; donemAdi?: string; onceki?: string | null; oncekiAdi?: string | null;
  genel: {
    ortalama: number | null; onceki: number | null; fark: number | null; soruOrt: number | null; oncekiSoruOrt: number | null;
    yapilan: number; oncekiYapilan: number; kadro: number; sube: number; yukselen: number; dusen: number;
  };
  trend: { donem: string; ad: string; ortalama: number | null; soruOrt: number | null; yapilan: number; sube: number }[];
  subeler: {
    sube: string; ortalama: number | null; onceki: number | null; fark: number | null; soruOrt: number | null; oncekiSoruOrt: number | null;
    yapilan: number; kadro: number; tamamlanma: number; dusuk: number; yuksek: number;
  }[];
  pozisyonlar: { pozisyon: string; ortalama: number | null; onceki: number | null; fark: number | null; soruOrt: number | null; yapilan: number; oncekiYapilan: number }[];
  dagilim: { puan: number; bu: number; onceki: number }[];
  sorular: { soru: string; ortalama: number; onceki: number | null; fark: number | null; adet: number }[];
  degerlendirenler: { kod?: string; ad: string; gorev: string | null; sube: string; adet: number; ortalama: number | null; sapma: number | null; dagilim: number }[];
  yukselenler: Degisim[]; dusenler: Degisim[];
  oryantasyon: Ory[];
  oryOzet: {
    kisi: number; yeniOrt: number | null; digerOrt: number | null; calisanOrt: number | null; yoneticiOrt: number | null;
    dustu: number; yukseldi: number; zayif: number;
    subeler: { sube: string; kisi: number; ddOrt: number; oryOrt: number | null }[];
  };
}
interface Degisim { kod: string; adSoyad: string; sube: string; pozisyon: string; puan: number; onceki: number; fark: number }
interface Ory {
  kod: string; adSoyad: string; sube: string; pozisyon: string; puan: number; oryCalisan: number | null; oryYonetici: number | null;
  asama: string | null; asamaAdi: string | null; giris: string | null; durum: string;
}

/** Rapordaki bir alanın arkasındaki personel listesi (26.10.2026) */
export interface Ayrinti { tur: string; deger?: string; sube?: string; donem?: string; baslik?: string }
type Ac = (a: Ayrinti) => void;
interface ListeKisi {
  kod: string; adSoyad: string; sube: string; pozisyon: string; puan: number | null; onceki: number | null; fark: number | null;
  soruOrt: number | null; degerlendiren: string | null; tarih: string | null; soruPuan: number | null; durum: string;
}

/* ------------------------------------------------------------------ yardımcı */

const R = {
  yesil: "#7cb518", yesilKoyu: "#4d7a0c", yesilAcik: "#eef7df", gri: "#c9d1c0", griKoyu: "#8b9483", mavi: "#1a4d80",
  turuncu: "#d0421a", sari: "#c98a0b", cizgi: "#e6e9e3", metin: "#1f2933", soluk: "#6b7280",
};
const v1 = (n?: number | null, b = 1) => (n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: b, maximumFractionDigits: b }));
const puanRengi = (p?: number | null) => (p == null ? R.soluk : p >= 8 ? R.yesilKoyu : p >= 6.5 ? "#6f9a1a" : p >= 5 ? R.sari : R.turuncu);

function Fark({ f, ondalik = true, ters }: { f: number | null | undefined; ondalik?: boolean; ters?: boolean }) {
  if (f == null) return <span className="ddr-fark ddr-yok">ilk</span>;
  if (Math.abs(f) < (ondalik ? 0.05 : 0.5)) return <span className="ddr-fark ddr-esit">=</span>;
  const iyi = ters ? f < 0 : f > 0;
  return (
    <span className={"ddr-fark " + (iyi ? "ddr-art" : "ddr-eks")}>
      {f > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {f > 0 ? "+" : ""}{ondalik ? v1(f) : f}
    </span>
  );
}

function Kart({ baslik, alt, sag, children, genis }: { baslik: string; alt?: string; sag?: React.ReactNode; children: React.ReactNode; genis?: boolean }) {
  return (
    <section className={"ddr-kart" + (genis ? " ddr-genis" : "")}>
      <header>
        <div><h3>{baslik}</h3>{alt && <p>{alt}</p>}</div>
        {sag}
      </header>
      {children}
    </section>
  );
}

function Lejant({ l }: { l: [string, string, ("kutu" | "cizgi")?][] }) {
  return (
    <div className="ddr-lejant">
      {l.map(([ad, renk, tur]) => (
        <span key={ad}><i style={{ background: renk, height: tur === "cizgi" ? 3 : 10, borderRadius: tur === "cizgi" ? 2 : 3 }} />{ad}</span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- ayrıntı çekmecesi */

function AyrintiCekmecesi({ a, donem, kapsam, pozisyon, kapat, sec, ac }: {
  a: Ayrinti | null; donem: string; kapsam: string; pozisyon?: string; kapat: () => void;
  sec: (s: string) => void; ac: (k: { kod: string; adSoyad: string }) => void;
}) {
  const { message } = AntdApp.useApp();
  const [v, setV] = useState<{ baslik: string; oncekiAdi?: string | null; kisiler: ListeKisi[] } | null>(null);
  const [yuk, setYuk] = useState(false);

  useEffect(() => {
    if (!a) return;
    setV(null);
    setYuk(true);
    const q = new URLSearchParams({ donem: a.donem ?? donem, kapsam, tur: a.tur });
    if (a.deger != null) q.set("deger", a.deger);
    if (a.sube) q.set("sube", a.sube);
    if (pozisyon && a.tur !== "pozisyon") q.set("pozisyon", pozisyon);
    api.al<{ baslik: string; oncekiAdi?: string | null; kisiler: ListeKisi[] }>(`/api/DonemselDegerlendirme/Rapor/Liste?${q}`)
      .then(setV)
      .catch((e) => message.error(e?.message ?? "Liste alınamadı"))
      .finally(() => setYuk(false));
  }, [a, donem, kapsam, pozisyon, message]);

  const l = v?.kisiler ?? [];
  const soru = a?.tur === "soru";
  const tamam = l.filter((x) => x.puan != null);
  const ort = tamam.length ? tamam.reduce((t, x) => t + (x.puan ?? 0), 0) / tamam.length : null;

  const excel = () => tabloIndir({
    baslik: v?.baslik ?? "Dönemsel değerlendirme",
    altBaslik: pozisyon ? `Pozisyon: ${pozisyon}` : undefined,
    sayfaAdi: "Liste",
    dosyaAdi: `donemsel-ayrinti-${a?.donem ?? donem}`,
    sutunlar: [
      { ad: "Ad soyad", genislik: 26 }, { ad: "Şube", genislik: 22 }, { ad: "Pozisyon", genislik: 18 },
      { ad: "Puan", tip: "sayi", toplam: false }, { ad: "Önceki", tip: "sayi", toplam: false }, { ad: "Değişim", tip: "sayi", toplam: false },
      ...(soru ? [{ ad: "Soru puanı", tip: "sayi" as const, toplam: false }] : []),
      { ad: "Soru ort.", tip: "ondalik", toplam: false }, { ad: "Değerlendiren", genislik: 22 },
    ],
    satirlar: l.map((k) => [k.adSoyad, k.sube, k.pozisyon, k.puan, k.onceki, k.fark, ...(soru ? [k.soruPuan] : []), k.soruOrt, k.degerlendiren ?? (k.durum === "bekliyor" ? "Bekliyor" : "")]),
  });

  return (
    <Drawer open={!!a} onClose={kapat} width={Math.min(980, window.innerWidth - 40)} destroyOnClose
      title={<div className="ddr-cekmece-baslik"><b>{v?.baslik ?? a?.baslik ?? "Ayrıntı"}</b>
        <small>{l.length} kişi{ort != null ? ` · ortalama ${v1(ort)}` : ""}</small></div>}
      extra={<Button size="small" icon={<Download size={14} />} onClick={excel} disabled={!l.length}>Excel</Button>}>
      {yuk && !v ? <div className="dd-yukleniyor"><Spin /></div> : (
        <Table<ListeKisi> size="small" rowKey="kod" dataSource={l} pagination={l.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          onRow={(k) => ({ onClick: () => ac(k), style: { cursor: "pointer" } })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kayıt yok" /> }}
          columns={[
            { title: "Personel", dataIndex: "adSoyad", sorter: (p, q) => p.adSoyad.localeCompare(q.adSoyad, "tr"),
              render: (_, k) => <span className="ddr-hucre-kisi"><b>{k.adSoyad}</b><small>{k.pozisyon}</small></span> },
            { title: "Şube", dataIndex: "sube", sorter: (p, q) => (p.sube ?? "").localeCompare(q.sube ?? "", "tr"),
              render: (x: string) => x ? <a onClick={(e) => { e.stopPropagation(); kapat(); sec(x); }}>{x}</a> : "—" },
            ...(soru ? [{ title: "Soru puanı", dataIndex: "soruPuan", width: 96, align: "center" as const,
              sorter: (p: ListeKisi, q: ListeKisi) => (p.soruPuan ?? 0) - (q.soruPuan ?? 0),
              render: (x: number | null) => <b style={{ color: x == null ? R.soluk : x <= 2 ? R.turuncu : x === 3 ? R.sari : R.yesilKoyu }}>{x ?? "—"}<small style={{ color: R.soluk }}>/5</small></b> }] : []),
            { title: "Puan", dataIndex: "puan", width: 80, align: "center" as const, sorter: (p, q) => (p.puan ?? -1) - (q.puan ?? -1),
              render: (x: number | null, k) => x == null ? <span className="ddr-fark ddr-eks">{k.durum === "bekliyor" ? "bekliyor" : "—"}</span>
                : <b style={{ color: puanRengi(x) }}>{x}<small style={{ color: R.soluk }}>/10</small></b> },
            { title: v?.oncekiAdi ?? "Önceki", dataIndex: "onceki", width: 120, align: "center" as const, sorter: (p, q) => (p.fark ?? -99) - (q.fark ?? -99),
              render: (x: number | null, k) => x == null ? <span className="ddr-fark ddr-yok">ilk</span> : <span>{x} {k.puan != null && <Fark f={k.fark} ondalik={false} />}</span> },
            { title: "Soru ort.", dataIndex: "soruOrt", width: 86, align: "center" as const, sorter: (p, q) => (p.soruOrt ?? 0) - (q.soruOrt ?? 0), render: (x: number | null) => v1(x, 2) },
            { title: "Değerlendiren", dataIndex: "degerlendiren", render: (x: string | null) => x ?? "—" },
            { title: "", width: 30, render: () => <ChevronRight size={15} color={R.soluk} /> },
          ]} />
      )}
      <p className="ddr-not">Satıra tıklayınca kişinin bütün değerlendirmeleri, şubeye tıklayınca şube ayrıntısı açılır.</p>
    </Drawer>
  );
}

/* ------------------------------------------------------- 1. dönem trendi */

function TrendGrafigi({ t, goster }: { t: Analiz["trend"]; goster: Ac }) {
  const W = 1150, H = 300, sol = 44, sag = 40, ust = 30, alt = 34;
  const iw = W - sol - sag, ih = H - ust - alt;
  /* Çubuklar alanın ~%60'ında kalır; üstte ortalama çizgisi ile çakışmaz */
  const maxY = Math.max(10, ...t.map((x) => x.yapilan)) * 1.65;
  const bw = Math.min(56, (iw / Math.max(1, t.length)) * 0.55);
  const x = (i: number) => sol + (iw / t.length) * (i + 0.5);
  const yb = (v: number) => ust + ih - (v / maxY) * ih;
  const yl = (v: number) => ust + ih - (v / 10) * ih;
  const nokta = t.map((d, i) => (d.ortalama == null ? null : [x(i), yl(d.ortalama)] as const)).filter(Boolean) as (readonly [number, number])[];
  if (t.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <>
      <Lejant l={[["Değerlendirilen personel", R.yesil], ["Genel ortalama (/10)", R.mavi, "cizgi"]]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="ddr-svg" role="img" aria-label="Dönem trendi">
        {[0, 2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line x1={sol} x2={W - sag} y1={yl(v)} y2={yl(v)} stroke={R.cizgi} />
            <text x={W - sag + 6} y={yl(v) + 4} className="ddr-eksen">{v}</text>
          </g>
        ))}
        {[0, 0.5, 1].map((k) => (
          <text key={k} x={sol - 6} y={yb(maxY / 1.65 * k) + 4} textAnchor="end" className="ddr-eksen">{Math.round((maxY / 1.65) * k)}</text>
        ))}
        {t.map((d, i) => (
          <g key={d.donem} className="ddr-tikla" onClick={() => goster({ tur: "hepsi", donem: d.donem, baslik: d.ad })}>
            <Tooltip title={`${d.ad}: ${d.yapilan} değerlendirme · ${d.sube} şube · ort. ${v1(d.ortalama)} · listeyi açmak için tıklayın`}>
              <rect x={x(i) - bw / 2} y={yb(d.yapilan)} width={bw} height={Math.max(0, ust + ih - yb(d.yapilan))} rx={4}
                fill={i === t.length - 1 ? R.yesil : "#b7d77a"} />
            </Tooltip>
            {/* Adet çubuğun içinde: üstteki ortalama etiketiyle çakışmasın */}
            <text x={x(i)} y={Math.min(ust + ih - 6, yb(d.yapilan) + 16)} textAnchor="middle" className="ddr-deger"
              fill={i === t.length - 1 ? "#fff" : R.yesilKoyu}>{d.yapilan}</text>
            <text x={x(i)} y={H - 12} textAnchor="middle" className="ddr-eksen">{d.ad}</text>
          </g>
        ))}
        {nokta.length > 1 && <polyline points={nokta.map((p) => p.join(",")).join(" ")} fill="none" stroke={R.mavi} strokeWidth={2.5} />}
        {t.map((d, i) => d.ortalama == null ? null : (
          <g key={"n" + d.donem}>
            <circle cx={x(i)} cy={yl(d.ortalama)} r={5} fill="#fff" stroke={R.mavi} strokeWidth={2.5} className="ddr-tikla"
              onClick={() => goster({ tur: "hepsi", donem: d.donem, baslik: d.ad })} />
            <text x={x(i)} y={yl(d.ortalama) - 10} textAnchor="middle" className="ddr-deger" fill={R.mavi}>{v1(d.ortalama)}</text>
          </g>
        ))}
      </svg>
    </>
  );
}

/* ---------------------------------------------------- 2. şube kıyası */

function SubeKiyasi({ l, sec, oncekiAdi, goster }: { l: Analiz["subeler"]; sec: (s: string) => void; oncekiAdi?: string | null; goster: Ac }) {
  const [sira, setSira] = useState<"puan" | "fark" | "tamam">("puan");
  const liste = useMemo(() => {
    const a = l.filter((x) => x.ortalama != null || x.onceki != null);
    if (sira === "fark") return [...a].sort((p, q) => (q.fark ?? -99) - (p.fark ?? -99));
    if (sira === "tamam") return [...a].sort((p, q) => q.tamamlanma - p.tamamlanma);
    return a;
  }, [l, sira]);
  const bekleyen = l.filter((x) => x.ortalama == null && x.onceki == null);
  return (
    <Kart baslik="Şube kıyası" alt={`Bu dönem ile ${oncekiAdi ?? "önceki dönem"} · çubuğa tıklayınca şube açılır`} genis
      sag={<Segmented size="small" value={sira} onChange={(v) => setSira(v as any)} options={[{ value: "puan", label: "Puan" }, { value: "fark", label: "Değişim" }, { value: "tamam", label: "Tamamlanma" }]} />}>
      <Lejant l={[["Bu dönem", R.yesil], [oncekiAdi ?? "Önceki", R.gri]]} />
      <div className="ddr-subeler">
        {liste.map((s, i) => (
          <button key={s.sube} type="button" className="ddr-sube" onClick={() => sec(s.sube)}>
            <span className="ddr-sira">{i + 1}</span>
            <span className="ddr-ad" title={s.sube}>{s.sube}</span>
            <span className="ddr-cubuklar">
              <span className="ddr-cubuk"><i style={{ width: `${((s.ortalama ?? 0) / 10) * 100}%`, background: puanRengi(s.ortalama) }} /></span>
              <span className="ddr-cubuk ddr-ince"><i style={{ width: `${((s.onceki ?? 0) / 10) * 100}%`, background: R.gri }} /></span>
            </span>
            <b style={{ color: puanRengi(s.ortalama) }}>{v1(s.ortalama)}</b>
            <Fark f={s.fark} />
            <Tooltip title={`${s.yapilan} / ${s.kadro} personel değerlendirildi · bekleyenler için tıklayın`}>
              <span className="ddr-tamam" onClick={(e) => { e.stopPropagation(); goster({ tur: "bekleyen", sube: s.sube }); }}>
                <span><i style={{ width: `${s.tamamlanma}%` }} /></span>%{s.tamamlanma}
              </span>
            </Tooltip>
          </button>
        ))}
      </div>
      {bekleyen.length > 0 && (
        <p className="ddr-not">Henüz değerlendirme yapılmayan:{" "}
          {bekleyen.map((x, i) => (
            <span key={x.sube}>{i > 0 && ", "}<a onClick={() => goster({ tur: "bekleyen", sube: x.sube })}>{x.sube}</a></span>
          ))}
        </p>
      )}
    </Kart>
  );
}

/* -------------------------------------------------- 3. pozisyon kıyası */

function PozisyonKiyasi({ l, oncekiAdi, goster }: { l: Analiz["pozisyonlar"]; oncekiAdi?: string | null; goster: Ac }) {
  const a = l.filter((x) => x.yapilan > 0 || x.oncekiYapilan > 0).slice(0, 14);
  const W = 520, satir = 30, H = a.length * satir + 30, sol = 170;
  const x = (v: number) => sol + (v / 10) * (W - sol - 50);
  return (
    <Kart baslik="Pozisyon kıyası" alt="Ortalama puan (/10), açık renk önceki dönem · tıklayınca kişiler">
      {a.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="ddr-svg">
          {[0, 5, 10].map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={4} y2={H - 22} stroke={R.cizgi} strokeDasharray={v === 5 ? "3 3" : undefined} />
              <text x={x(v)} y={H - 6} textAnchor="middle" className="ddr-eksen">{v}</text>
            </g>
          ))}
          {a.map((p, i) => {
            const y = 8 + i * satir;
            return (
              <g key={p.pozisyon} className="ddr-tikla" onClick={() => goster({ tur: "pozisyon", deger: p.pozisyon })}>
                <rect x={0} y={y - 2} width={W} height={satir - 2} fill="transparent" />
                <text x={sol - 8} y={y + 14} textAnchor="end" className="ddr-etiket">{p.pozisyon.length > 24 ? p.pozisyon.slice(0, 23) + "…" : p.pozisyon}</text>
                {p.onceki != null && <rect x={x(0)} y={y + 14} width={x(p.onceki) - x(0)} height={6} rx={3} fill={R.gri} />}
                {p.ortalama != null && (
                  <Tooltip title={`${p.pozisyon}: ${v1(p.ortalama)} (${p.yapilan} kişi) · ${oncekiAdi ?? "önceki"} ${v1(p.onceki)}`}>
                    <rect x={x(0)} y={y + 2} width={x(p.ortalama) - x(0)} height={11} rx={4} fill={puanRengi(p.ortalama)} />
                  </Tooltip>
                )}
                <text x={x(p.ortalama ?? p.onceki ?? 0) + 6} y={y + 12} className="ddr-deger" fill={R.metin}>
                  {v1(p.ortalama)}{p.fark != null && Math.abs(p.fark) >= 0.05 ? ` (${p.fark > 0 ? "+" : ""}${v1(p.fark)})` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </Kart>
  );
}

/* ---------------------------------------------------- 4. puan dağılımı */

function Dagilim({ d, oncekiAdi, goster }: { d: Analiz["dagilim"]; oncekiAdi?: string | null; goster: Ac }) {
  const W = 520, H = 230, sol = 30, alt = 28, ust = 18, iw = W - sol - 10, ih = H - ust - alt;
  const max = Math.max(1, ...d.map((x) => Math.max(x.bu, x.onceki)));
  const gw = iw / 10;
  const y = (v: number) => ust + ih - (v / max) * ih;
  return (
    <Kart baslik="Puan dağılımı" alt="Kaç kişi hangi genel puanı aldı (1–10) · çubuğa tıklayınca kişiler">
      <Lejant l={[["Bu dönem", R.yesil], [oncekiAdi ?? "Önceki", R.gri]]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="ddr-svg">
        <line x1={sol} x2={W - 10} y1={ust + ih} y2={ust + ih} stroke={R.cizgi} />
        {d.map((p, i) => {
          const x0 = sol + gw * i + gw * 0.14, bw = gw * 0.34;
          const renk = p.puan <= 4 ? R.turuncu : p.puan <= 6 ? R.sari : R.yesil;
          return (
            <g key={p.puan} className={p.bu > 0 ? "ddr-tikla" : undefined} onClick={() => p.bu > 0 && goster({ tur: "puan", deger: String(p.puan) })}>
              <rect x={sol + gw * i} y={ust} width={gw} height={ih} fill="transparent" />
              <rect x={x0} y={y(p.bu)} width={bw} height={ust + ih - y(p.bu)} rx={3} fill={renk} />
              <rect x={x0 + bw + 2} y={y(p.onceki)} width={bw} height={ust + ih - y(p.onceki)} rx={3} fill={R.gri} />
              {p.bu > 0 && <text x={x0 + bw / 2} y={y(p.bu) - 4} textAnchor="middle" className="ddr-deger" fill={R.metin}>{p.bu}</text>}
              <text x={sol + gw * i + gw / 2} y={H - 8} textAnchor="middle" className="ddr-eksen">{p.puan}</text>
            </g>
          );
        })}
      </svg>
    </Kart>
  );
}

/* --------------------------------------------------- 5. sorular */

function Sorular({ l, oncekiAdi, goster }: { l: Analiz["sorular"]; oncekiAdi?: string | null; goster: Ac }) {
  const [gor, setGor] = useState<"dusuk" | "degisim">("dusuk");
  const a = useMemo(() => (gor === "dusuk" ? l : [...l].sort((p, q) => Math.abs(q.fark ?? 0) - Math.abs(p.fark ?? 0))).slice(0, 12), [l, gor]);
  return (
    <Kart baslik="Konu bazında" alt={`Soru ortalaması (1–5) · çizgi ${oncekiAdi ?? "önceki dönem"} · soruya tıklayınca kişilerin puanı`} genis
      sag={<Segmented size="small" value={gor} onChange={(v) => setGor(v as any)} options={[{ value: "dusuk", label: "En düşük" }, { value: "degisim", label: "En çok değişen" }]} />}>
      {a.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
        <div className="ddr-sorular">
          {a.map((s) => (
            <div key={s.soru} className="ddr-soru ddr-tikla" role="button" tabIndex={0}
              onClick={() => goster({ tur: "soru", deger: s.soru })} onKeyDown={(e) => e.key === "Enter" && goster({ tur: "soru", deger: s.soru })}>
              <span className="ddr-soru-ad">{s.soru}</span>
              <span className="ddr-soru-cubuk">
                <i style={{ width: `${(s.ortalama / 5) * 100}%`, background: s.ortalama < 3 ? R.turuncu : s.ortalama < 3.8 ? R.sari : R.yesil }} />
                {s.onceki != null && <em style={{ left: `${(s.onceki / 5) * 100}%` }} title={`${oncekiAdi}: ${v1(s.onceki, 2)}`} />}
              </span>
              <b>{v1(s.ortalama, 2)}</b>
              <Fark f={s.fark} />
              <small>{s.adet}</small>
            </div>
          ))}
        </div>
      )}
    </Kart>
  );
}

/* --------------------------------------------- 6. değerlendirici eğilimi */

function Degerlendiriciler({ l, goster }: { l: Analiz["degerlendirenler"]; goster: Ac }) {
  const max = Math.max(1, ...l.map((x) => Math.abs(x.sapma ?? 0)));
  return (
    <Kart baslik="Değerlendirici eğilimi" alt="Genel ortalamadan sapma · cömert (+) ya da katı (−) puanlayanlar"
      sag={<Tooltip title="En az 3 değerlendirme yapanlar. Tek tip puan (ör. herkese 10) veren değerlendiricide 'çeşit' 1 görünür."><Info size={15} color={R.soluk} /></Tooltip>}>
      {l.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
        <div className="ddr-sapmalar">
          {l.map((d) => (
            <div key={d.ad + d.sube} className="ddr-sapma ddr-tikla" role="button" tabIndex={0}
              onClick={() => goster({ tur: "degerlendiren", deger: d.kod ?? d.ad })}>
              <span className="ddr-sapma-ad"><b>{d.ad}</b><small>{d.sube} · {d.adet} kişi · çeşit {d.dagilim}</small></span>
              <span className="ddr-sapma-cubuk">
                <span className="ddr-orta" />
                <i style={{
                  width: `${(Math.abs(d.sapma ?? 0) / max) * 50}%`,
                  left: (d.sapma ?? 0) >= 0 ? "50%" : `${50 - (Math.abs(d.sapma ?? 0) / max) * 50}%`,
                  background: (d.sapma ?? 0) >= 0 ? R.yesil : R.turuncu,
                }} />
              </span>
              <b className="ddr-sapma-deger">{(d.sapma ?? 0) > 0 ? "+" : ""}{v1(d.sapma)}</b>
            </div>
          ))}
        </div>
      )}
    </Kart>
  );
}

/* -------------------------------------------- 7. yükselen / düşen */

function Degisimler({ yuk, dus, ac, goster }: { yuk: Degisim[]; dus: Degisim[]; ac: (k: { kod: string; adSoyad: string }) => void; goster: Ac }) {
  const Liste = ({ l, iyi }: { l: Degisim[]; iyi: boolean }) => (
    <div className="ddr-kisiler">
      {l.length === 0 && <span className="ddr-not">Kayıt yok</span>}
      {l.map((k) => (
        <button key={k.kod} type="button" className="ddr-kisi" onClick={() => ac(k)}>
          <span><b>{k.adSoyad}</b><small>{k.sube} · {k.pozisyon}</small></span>
          <span className="ddr-kisi-puan">{k.onceki} → <b>{k.puan}</b></span>
          <span className={"ddr-fark " + (iyi ? "ddr-art" : "ddr-eks")}>{k.fark > 0 ? "+" : ""}{k.fark}</span>
        </button>
      ))}
    </div>
  );
  return (
    <Kart baslik="En çok değişenler" alt="İki dönemde de değerlendirilen personel">
      <div className="ddr-iki">
        <div><h4 className="ddr-art-baslik">▲ Yükselenler <a className="ddr-tumu" onClick={() => goster({ tur: "degisim", deger: "art" })}>tümü</a></h4><Liste l={yuk.filter((x) => x.fark > 0)} iyi /></div>
        <div><h4 className="ddr-eks-baslik">▼ Düşenler <a className="ddr-tumu" onClick={() => goster({ tur: "degisim", deger: "eks" })}>tümü</a></h4><Liste l={dus.filter((x) => x.fark < 0)} iyi={false} /></div>
      </div>
    </Kart>
  );
}

/* ------------------------------------------------ 8. oryantasyon */

const DURUM: Record<string, [string, string]> = {
  dustu: ["Oryantasyonda iyiydi, düştü", R.turuncu],
  "uyumlu-zayif": ["İkisinde de zayıf", "#9f1d0f"],
  yukseldi: ["Oryantasyondan sonra yükseldi", R.yesilKoyu],
  "uyumlu-iyi": ["İkisinde de iyi", R.yesil],
  uyumlu: ["Tutarlı", R.griKoyu],
  bilinmiyor: ["Oryantasyon puanı yok", R.soluk],
};

function Oryantasyon({ l, o, ac, sec }: { l: Ory[]; o: Analiz["oryOzet"]; ac: (k: { kod: string; adSoyad: string }) => void; sec: (s: string) => void }) {
  const [filtre, setFiltre] = useState<string>("dikkat");
  const W = 420, H = 300, sol = 36, alt = 34, ust = 14, sag = 14;
  const iw = W - sol - sag, ih = H - ust - alt;
  const x = (v: number) => sol + ((v - 1) / 4) * iw;
  const y = (v: number) => ust + ih - ((v - 1) / 9) * ih;
  const noktalar = l.filter((k) => (k.oryYonetici ?? k.oryCalisan) != null);
  const goster = filtre === "dikkat" ? l.filter((k) => k.durum === "dustu" || k.durum === "uyumlu-zayif") : filtre === "hepsi" ? l : l.filter((k) => k.durum === filtre);

  if (o.kisi === 0)
    return (
      <Kart baslik="Oryantasyon ile birlikte" alt="Yeni personelin oryantasyon değerlendirmesi ve dönemsel puanı" genis>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bu dönem değerlendirilenler arasında oryantasyon anketi dolmuş personel yok." />
      </Kart>
    );

  return (
    <Kart baslik="Oryantasyon ile birlikte" genis
      alt="Oryantasyon puanı (1–5): yöneticinin son değerlendirmesi, yoksa çalışanın kendi anketi · dönemsel puan (1–10)">
      <div className="ddr-ory-kpi">
        <div><span>Oryantasyondaki personel</span><b>{o.kisi}</b><small>bu dönem değerlendirildi</small></div>
        <div><span>Dönemsel ort. (yeni / diğer)</span><b>{v1(o.yeniOrt)} <small>/ {v1(o.digerOrt)}</small></b><small>yeni personel ile kıdemliler</small></div>
        <div><span>Oryantasyon ort.</span><b>{v1(o.yoneticiOrt ?? o.calisanOrt)}<small>/5</small></b><small>yönetici {v1(o.yoneticiOrt)} · çalışan {v1(o.calisanOrt)}</small></div>
        <div className="ddr-uyari ddr-tikla" onClick={() => setFiltre("dikkat")}><span>Dikkat</span><b>{o.dustu + o.zayif}</b><small>{o.dustu} düşen · {o.zayif} ikisinde de zayıf</small></div>
      </div>
      <div className="ddr-ory">
        <div>
          <svg viewBox={`0 0 ${W} ${H}`} className="ddr-svg">
            <rect x={x(1)} y={y(10)} width={x(3.5) - x(1)} height={y(7) - y(10)} fill="#f2f9e8" />
            <rect x={x(3.5)} y={y(7)} width={x(5) - x(3.5)} height={y(1) - y(7)} fill="#fdeee8" />
            {[1, 2, 3, 4, 5].map((v) => (
              <g key={"x" + v}><line x1={x(v)} x2={x(v)} y1={ust} y2={ust + ih} stroke={R.cizgi} /><text x={x(v)} y={H - 16} textAnchor="middle" className="ddr-eksen">{v}</text></g>
            ))}
            {[1, 4, 7, 10].map((v) => (
              <g key={"y" + v}><line x1={sol} x2={W - sag} y1={y(v)} y2={y(v)} stroke={R.cizgi} /><text x={sol - 6} y={y(v) + 4} textAnchor="end" className="ddr-eksen">{v}</text></g>
            ))}
            <text x={sol + iw / 2} y={H - 2} textAnchor="middle" className="ddr-eksen">Oryantasyon puanı →</text>
            <text x={x(1) + 6} y={y(10) + 14} className="ddr-bolge" fill={R.yesilKoyu}>sonradan yükseldi</text>
            <text x={x(5) - 6} y={y(1) - 8} textAnchor="end" className="ddr-bolge" fill={R.turuncu}>oryantasyonda iyiydi, düştü</text>
            {noktalar.map((k) => (
              <Tooltip key={k.kod} title={`${k.adSoyad} · ${k.sube} · dönemsel ${k.puan} · oryantasyon ${v1(k.oryYonetici ?? k.oryCalisan)} (${k.asamaAdi ?? "—"})`}>
                <circle cx={x(k.oryYonetici ?? k.oryCalisan ?? 1)} cy={y(k.puan)} r={6} fill={DURUM[k.durum]?.[1] ?? R.griKoyu} fillOpacity={0.75}
                  stroke="#fff" strokeWidth={1.5} style={{ cursor: "pointer" }} onClick={() => ac(k)} />
              </Tooltip>
            ))}
          </svg>
          <Lejant l={Object.entries(DURUM).filter(([k]) => k !== "bilinmiyor").map(([, [ad, r]]) => [ad, r])} />
        </div>
        <div className="ddr-ory-liste">
          <Segmented size="small" value={filtre} onChange={(v) => setFiltre(v as string)}
            options={[{ value: "dikkat", label: "Dikkat" }, { value: "yukseldi", label: "Yükselen" }, { value: "hepsi", label: "Tümü" }]} />
          <div className="ddr-kisiler">
            {goster.length === 0 && <span className="ddr-not">Kayıt yok</span>}
            {goster.slice(0, 40).map((k) => (
              <button key={k.kod} type="button" className="ddr-kisi" onClick={() => ac(k)}>
                <span><b>{k.adSoyad}</b><small>{k.sube} · {k.pozisyon}{k.asamaAdi ? ` · ${k.asamaAdi}` : ""}</small></span>
                <span className="ddr-kisi-puan">
                  ory. <b>{v1(k.oryYonetici ?? k.oryCalisan)}</b>/5 · dön. <b style={{ color: puanRengi(k.puan) }}>{k.puan}</b>/10
                </span>
                <i className="ddr-nokta" style={{ background: DURUM[k.durum]?.[1] }} title={DURUM[k.durum]?.[0]} />
              </button>
            ))}
          </div>
          {o.subeler.length > 0 && (
            <table className="ddr-tablo">
              <thead><tr><th>Şube</th><th>Yeni</th><th>Ory. ort.</th><th>Dönemsel</th></tr></thead>
              <tbody>{o.subeler.slice(0, 10).map((s) => (
                <tr key={s.sube} className="ddr-tikla" onClick={() => sec(s.sube)}><td><a>{s.sube}</a></td><td>{s.kisi}</td><td>{v1(s.oryOrt)}</td><td style={{ color: puanRengi(s.ddOrt), fontWeight: 700 }}>{v1(s.ddOrt)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </Kart>
  );
}

/* ================================================================= kök */

export default function DonemselRapor({ donem, kapsam, pozisyon, sec, ac }: {
  donem: string; kapsam: string; pozisyon?: string;
  sec: (sube: string) => void; ac: (k: { kod: string; adSoyad: string }) => void;
}) {
  const { message } = AntdApp.useApp();
  const [v, setV] = useState<Analiz | null>(null);
  const [yuk, setYuk] = useState(false);
  const [ayrinti, setAyrinti] = useState<Ayrinti | null>(null);

  useEffect(() => {
    setYuk(true);
    const q = new URLSearchParams({ donem, kapsam });
    if (pozisyon) q.set("pozisyon", pozisyon);
    api.al<Analiz>(`/api/DonemselDegerlendirme/Rapor/Analiz?${q}`)
      .then(setV)
      .catch((e) => message.error(e?.message ?? "Rapor alınamadı"))
      .finally(() => setYuk(false));
  }, [donem, kapsam, pozisyon, message]);

  if (yuk && !v) return <div className="dd-yukleniyor"><Spin /></div>;
  if (!v?.genel) return <Empty description="Rapor için veri yok" />;
  const g = v.genel;
  const tamam = g.kadro ? Math.round((g.yapilan / g.kadro) * 100) : 0;

  const excel = () => tabloIndir({
    baslik: `Dönemsel değerlendirme raporu · ${v.donemAdi}`,
    altBaslik: `Önceki dönem: ${v.oncekiAdi ?? "—"}${pozisyon ? ` · ${pozisyon}` : ""}`,
    sayfaAdi: "Şube kıyası",
    dosyaAdi: `donemsel-rapor-${v.donem}`,
    sutunlar: [
      { ad: "Şube", genislik: 24 }, { ad: "Ortalama", tip: "ondalik", toplam: false }, { ad: "Önceki", tip: "ondalik", toplam: false },
      { ad: "Değişim", tip: "ondalik", toplam: false }, { ad: "Soru ort.", tip: "ondalik", toplam: false },
      { ad: "Değerlendirilen", tip: "sayi" }, { ad: "Kadro", tip: "sayi" }, { ad: "Tamamlanma %", tip: "sayi", toplam: false },
      { ad: "5 ve altı", tip: "sayi" }, { ad: "9 ve üstü", tip: "sayi" },
    ],
    satirlar: v.subeler.map((s) => [s.sube, s.ortalama, s.onceki, s.fark, s.soruOrt, s.yapilan, s.kadro, s.tamamlanma, s.dusuk, s.yuksek]),
  });

  return (
    <div className="ddr">
      <div className="ddr-ozet">
        <div className="ddr-ana ddr-tikla" onClick={() => setAyrinti({ tur: "hepsi" })} title="Değerlendirilenler">
          <span>Genel ortalama · {v.donemAdi}</span>
          <b style={{ color: puanRengi(g.ortalama) }}>{v1(g.ortalama)}<small>/10</small></b>
          <small>{v.oncekiAdi ?? "Önceki dönem"} {v1(g.onceki)} <Fark f={g.fark} /></small>
        </div>
        <div className="ddr-tikla" onClick={() => setAyrinti({ tur: "bekleyen" })} title="Değerlendirme bekleyenler"><span>Tamamlanma</span><b>%{tamam}</b><small>{g.yapilan} / {g.kadro} personel · {g.sube} şube</small></div>
        <div className="ddr-tikla" onClick={() => setAyrinti({ tur: "hepsi" })} title="Değerlendirilenler"><span>Değerlendirilen</span><b>{g.yapilan}</b><small>{v.oncekiAdi ?? "önceki"}: {g.oncekiYapilan} <Fark f={g.oncekiYapilan ? g.yapilan - g.oncekiYapilan : null} ondalik={false} /></small></div>
        <div className="ddr-tikla" onClick={() => setAyrinti({ tur: "hepsi" })} title="Değerlendirilenler"><span>Soru ortalaması</span><b>{v1(g.soruOrt, 2)}<small>/5</small></b><small>{v.oncekiAdi ?? "önceki"} {v1(g.oncekiSoruOrt, 2)}</small></div>
        <div><span>Personel değişimi</span><b>
          <em className="ddr-art-y ddr-tikla" onClick={() => setAyrinti({ tur: "degisim", deger: "art" })} title="Yükselenler">▲{g.yukselen}</em>{" "}
          <em className="ddr-eks-y ddr-tikla" onClick={() => setAyrinti({ tur: "degisim", deger: "eks" })} title="Düşenler">▼{g.dusen}</em></b><small>önceki dönemle aynı kişiler</small></div>
        <Button icon={<Download size={15} />} onClick={excel} className="ddr-excel">Excel</Button>
      </div>

      <div className="ddr-izgara">
        <Kart baslik="Dönem trendi" alt="Değerlendirilen personel sayısı ve genel ortalama" genis>
          <TrendGrafigi t={v.trend} goster={setAyrinti} />
        </Kart>
        <SubeKiyasi l={v.subeler} sec={sec} oncekiAdi={v.oncekiAdi} goster={setAyrinti} />
        <PozisyonKiyasi l={v.pozisyonlar} oncekiAdi={v.oncekiAdi} goster={setAyrinti} />
        <Dagilim d={v.dagilim} oncekiAdi={v.oncekiAdi} goster={setAyrinti} />
        <Sorular l={v.sorular} oncekiAdi={v.oncekiAdi} goster={setAyrinti} />
        <Oryantasyon l={v.oryantasyon} o={v.oryOzet} ac={ac} sec={sec} />
        <Degisimler yuk={v.yukselenler} dus={v.dusenler} ac={ac} goster={setAyrinti} />
        <Degerlendiriciler l={v.degerlendirenler} goster={setAyrinti} />
      </div>

      <AyrintiCekmecesi a={ayrinti} donem={v.donem ?? donem} kapsam={kapsam} pozisyon={pozisyon} kapat={() => setAyrinti(null)} sec={sec} ac={ac} />
    </div>
  );
}

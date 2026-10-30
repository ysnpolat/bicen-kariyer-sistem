/* ===========================================================================
   İzin Yönetimi › Rapor (07.10.2026)

   Kişi kişi hak ediş, önceki dönemden kullanılmamış devir, kullanılan ve
   planlı günler. Amaç yıl sonunda devrin sıfıra inmesi: devri olup planı
   olmayanlar öne çıkıyor, onlara ve yöneticilerine plan hatırlatması
   gönderilebiliyor. Her kutu, çubuk ve satır ayrıntı çekmecesi açar.
   =========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { App as AntdApp, Button, Drawer, Empty, Input, Select, Spin, Table, Tooltip } from "antd";
import { BellRing, ChevronLeft, Download, FileSpreadsheet, Search } from "lucide-react";

import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import { IzinDonemRaporu } from "./DonemRaporu";
import "./IzinRapor.css";

export interface RaporKisi {
  kod: string;
  ad: string;
  sube: string;
  bolge: string | null;
  gorev: string | null;
  hakYok: boolean;
  hak: number;
  devir: number;
  toplam: number;
  kullanilan: number;
  planli: number;
  kalan: number;
  aylar: number[];
  plan: number[];
}

export const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const AYU = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export const g1 = (n: number) => (Math.round((n ?? 0) * 10) / 10).toLocaleString("tr-TR");
const top = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + (f(x) || 0), 0);
const yuzde = (a: number, b: number) => (b > 0 ? Math.round((a * 100) / b) : 0);

type Odak = "toplam" | "kull" | "planli" | "kalan" | "devir" | "hakyok" | "plansiz";

const ODAK: Record<Odak, { ad: string; f: (k: RaporKisi) => boolean; d: (k: RaporKisi) => number | string; sira: (k: RaporKisi) => number }> = {
  toplam: { ad: "Toplam hak ediş", f: (k) => !k.hakYok, d: (k) => `${g1(k.toplam)} gün`, sira: (k) => k.toplam },
  kull: { ad: "İzin kullananlar", f: (k) => k.kullanilan > 0, d: (k) => `${g1(k.kullanilan)} gün`, sira: (k) => k.kullanilan },
  planli: { ad: "İleri tarihli planı olanlar", f: (k) => k.planli > 0, d: (k) => `${g1(k.planli)} gün`, sira: (k) => k.planli },
  kalan: { ad: "Kullanılmamış hak edişi olanlar", f: (k) => !k.hakYok && k.kalan > 0, d: (k) => `${g1(k.kalan)} gün`, sira: (k) => k.kalan },
  devir: { ad: "Önceki dönemden devri olanlar", f: (k) => k.devir > 0, d: (k) => `${g1(k.devir)} gün`, sira: (k) => k.devir },
  hakyok: { ad: "İzin hak edişi yok", f: (k) => k.hakYok, d: () => "hak ediş yok", sira: () => 0 },
  plansiz: { ad: "Devri var, planı yok", f: (k) => k.devir > 0 && k.planli <= 0 && k.kalan > 0, d: (k) => `${g1(k.kalan)} gün`, sira: (k) => k.kalan },
};

const KOVALAR: [string, (k: RaporKisi) => boolean][] = [
  ["0 gün", (k) => k.devir <= 0],
  ["1–5", (k) => k.devir > 0 && k.devir <= 5],
  ["6–10", (k) => k.devir > 5 && k.devir <= 10],
  ["11–20", (k) => k.devir > 10 && k.devir <= 20],
  ["20+", (k) => k.devir > 20],
];

type Cekmece =
  | { tur: "liste"; baslik: string; alt?: string; kisiler: RaporKisi[]; deger: (k: RaporKisi) => ReactNode; ust?: ReactNode }
  | { tur: "kisi"; kisi: RaporKisi };

export function KisiDurumu({ k }: { k: RaporKisi }) {
  if (k.hakYok) return <span className="ir-cip g">İzin hak edişi yok</span>;
  if (k.devir > 10 && k.planli <= 0 && k.kalan > 0) return <span className="ir-cip k">Devir {g1(k.devir)} gün · plansız</span>;
  if (k.kalan > 10) return <span className="ir-cip t">{g1(k.kalan)} gün kullanılmadı</span>;
  return <span className="ir-cip y">Yolunda</span>;
}

export default function IzinRapor({ onKisiAc }: { onKisiAc?: (sicil: string) => void }) {
  const { message } = AntdApp.useApp();

  const [yil, setYil] = useState(new Date().getFullYear());
  const [veri, setVeri] = useState<{ yil: number; bugunAy: number; kisiler: RaporKisi[]; duzenleyebilir: boolean } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [bolge, setBolge] = useState<string | undefined>();
  const [sube, setSube] = useState<string | undefined>();
  const [arama, setArama] = useState("");
  const [yigin, setYigin] = useState<Cekmece[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<any>(`/api/IzinRapor?yil=${yil}`));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [yil, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const hepsi = veri?.kisiler ?? [];
  const bolgeler = useMemo(() => [...new Set(hepsi.map((k) => k.bolge).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr")), [hepsi]);
  const subeler = useMemo(
    () => [...new Set(hepsi.filter((k) => !bolge || k.bolge === bolge).map((k) => k.sube).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")),
    [hepsi, bolge]
  );

  const a = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    return hepsi.filter(
      (k) =>
        (!bolge || k.bolge === bolge) &&
        (!sube || k.sube === sube) &&
        (!q || `${k.ad} ${k.kod} ${k.gorev ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [hepsi, bolge, sube, arama]);

  const bugunAy = veri?.bugunAy ?? new Date().getMonth();
  const T = top(a, (k) => k.toplam);
  const U = top(a, (k) => k.kullanilan);
  const P = top(a, (k) => k.planli);
  const K = Math.max(0, T - U - P);
  const devirli = a.filter((k) => k.devir > 0);
  const hakYok = a.filter((k) => k.hakYok).length;
  const plansiz = a.filter(ODAK.plansiz.f);

  const ac = (c: Cekmece) => setYigin((y) => [...y, c]);
  const kisiAc = (k: RaporKisi) => ac({ tur: "kisi", kisi: k });

  const odakAc = (o: Odak) => {
    const l = a.filter(ODAK[o].f).sort((x, y) => ODAK[o].sira(y) - ODAK[o].sira(x));
    ac({ tur: "liste", baslik: ODAK[o].ad, alt: `${l.length} kişi`, kisiler: l, deger: ODAK[o].d, ust: o !== "hakyok" && o !== "toplam" ? <PlanDugmesi kisiler={l} /> : undefined });
  };

  const planIste = async (kisiler: RaporKisi[]) => {
    const l = kisiler.filter((k) => !k.hakYok && k.kalan > 0);
    if (l.length === 0) return message.info("Kullanılmamış hak edişi olan kimse yok.");
    setGonderiliyor(true);
    try {
      const c = await api.gonder<any>("/api/IzinRapor/PlanIste", { siciller: l.map((k) => k.kod), yoneticiye: true });
      message.success(`${c.gonderilen} kişiye bildirim gitti${c.yonetici ? `, ${c.yonetici} yöneticiye liste gönderildi` : ""}. Bugün hatırlatılanlara ikinci kez gitmez.`);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  function PlanDugmesi({ kisiler }: { kisiler: RaporKisi[] }) {
    if (!veri?.duzenleyebilir) return null;
    return (
      <Button type="primary" icon={<BellRing size={14} />} loading={gonderiliyor} onClick={() => planIste(kisiler)}>
        Plan hatırlatması gönder ({kisiler.filter((k) => !k.hakYok && k.kalan > 0).length})
      </Button>
    );
  }

  /* ------------------------------------------------------------ aylık */
  const ayKullanilan = AY.map((_, i) => top(a, (k) => k.aylar[i]));
  const ayPlanli = AY.map((_, i) => top(a, (k) => k.plan[i]));

  const ayAc = (i: number) => {
    const l = a.filter((k) => k.aylar[i] || k.plan[i]).sort((x, y) => y.aylar[i] + y.plan[i] - (x.aylar[i] + x.plan[i]));
    ac({
      tur: "liste",
      baslik: `${AYU[i]} ${veri?.yil}`,
      alt: `${g1(ayKullanilan[i])} gün kullanıldı · ${g1(ayPlanli[i])} gün planlı · ${l.length} kişi`,
      kisiler: l,
      deger: (k) => [k.aylar[i] ? `${g1(k.aylar[i])} kullandı` : "", k.plan[i] ? `${g1(k.plan[i])} planlı` : ""].filter(Boolean).join(" · "),
    });
  };

  /* ------------------------------------------------------------ şube */
  const subeSatirlari = useMemo(() => {
    const m = new Map<string, RaporKisi[]>();
    a.forEach((k) => m.set(k.sube || "—", [...(m.get(k.sube || "—") ?? []), k]));
    return [...m.entries()].map(([s, b]) => {
      const t = top(b, (k) => k.toplam), u = top(b, (k) => k.kullanilan), p = top(b, (k) => k.planli);
      const dv = b.filter((k) => k.devir > 0);
      return { sube: s, kisi: b.length, t, u, p, kalan: Math.max(0, t - u - p), devirKisi: dv.length, devir: top(dv, (k) => k.devir), oran: yuzde(u + p, t), plansiz: b.filter(ODAK.plansiz.f).length, b };
    });
  }, [a]);

  const subeAc = (s: (typeof subeSatirlari)[number]) =>
    ac({
      tur: "liste",
      baslik: s.sube,
      alt: `${s.kisi} personel · ${g1(s.kalan)} gün kullanılmamış · ${s.devirKisi} kişide devir`,
      kisiler: s.b.slice().sort((x, y) => y.kalan - x.kalan),
      deger: (k) => (k.hakYok ? <span className="ir-cip g">hak ediş yok</span> : `${g1(k.kalan)} gün`),
      ust: <PlanDugmesi kisiler={s.b} />,
    });

  const indir = () =>
    tabloIndir({
      baslik: `${veri?.yil} İzin Hak Ediş Raporu`,
      altBaslik: `${a.length} personel${sube ? ` · ${sube}` : bolge ? ` · ${bolge}` : ""}`,
      sayfaAdi: "İzin Raporu",
      dosyaAdi: `izin-raporu-${veri?.yil}`,
      grupSutunu: 2,
      genelToplam: true,
      sutunlar: [
        { ad: "SİCİL", genislik: 10 },
        { ad: "ADI SOYADI", genislik: 26 },
        { ad: "ŞUBE", genislik: 22 },
        { ad: "BÖLGE", genislik: 14 },
        { ad: "GÖREV", genislik: 20 },
        { ad: "DEVİR", tip: "ondalik" },
        { ad: "HAK EDİŞ", tip: "ondalik" },
        { ad: "TOPLAM", tip: "ondalik" },
        { ad: "KULLANILAN", tip: "ondalik", veriCubugu: true },
        { ad: "PLANLI", tip: "ondalik" },
        { ad: "KULLANILMAMIŞ", tip: "ondalik", renkOlcegi: true },
        ...AYU.map((x) => ({ ad: x.toLocaleUpperCase("tr"), tip: "ondalik" as const, genislik: 9 })),
      ],
      satirlar: a.map((k) => [k.kod, k.ad, k.sube, k.bolge ?? "", k.gorev ?? "", k.devir, k.hak, k.toplam, k.kullanilan, k.planli, k.kalan, ...k.aylar.map((x, i) => x + k.plan[i])]),
    });

  const cek = yigin[yigin.length - 1];

  if (!veri && yukleniyor)
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Spin />
      </div>
    );

  const kpi = (o: Odak, et: string, d: string, alt: string, sinif = "") => (
    <button type="button" className={`ir-kpi ${sinif}`} onClick={() => odakAc(o)}>
      <span className="et">{et}</span>
      <span className="d">{d}</span>
      <span className="alt">{alt}</span>
    </button>
  );

  const maxAy = Math.max(1, ...ayKullanilan.map((v, i) => v + ayPlanli[i]));
  const kovaSay = KOVALAR.map(([, f]) => a.filter((k) => !k.hakYok && f(k)).length);
  const maxKova = Math.max(1, ...kovaSay);

  return (
    <div className="ir">
      <div className="ir-arac">
        <Select value={yil} onChange={setYil} style={{ width: 100 }} options={[0, 1, 2].map((i) => ({ value: new Date().getFullYear() - i, label: String(new Date().getFullYear() - i) }))} />
        <Select allowClear placeholder="Bölge" value={bolge} onChange={(v) => { setBolge(v); setSube(undefined); }} style={{ width: 160 }} options={bolgeler.map((x) => ({ value: x, label: x }))} />
        <Select allowClear showSearch placeholder="Şube" value={sube} onChange={setSube} style={{ width: 190 }} options={subeler.map((x) => ({ value: x, label: x }))} />
        <Input allowClear prefix={<Search size={14} />} placeholder="Ad, sicil, görev" value={arama} onChange={(e) => setArama(e.target.value)} style={{ width: 200 }} />
        <span style={{ flex: 1 }} />
        <IzinDonemRaporu dugme={<Button type="primary" icon={<FileSpreadsheet size={14} />}>Dönem raporu (Excel)</Button>} />
        <Button icon={<Download size={14} />} onClick={indir}>Excel</Button>
      </div>

      <div className="ir-kpiler">
        {kpi("toplam", "Toplam hak ediş", `${g1(T)} gün`, `${a.length - hakYok} kişi · devir dahil`)}
        {kpi("kull", "Kullanılan", `${g1(U)} gün`, `%${yuzde(U, T)} · ${a.filter((k) => k.kullanilan > 0).length} kişi`)}
        {kpi("planli", "Planlanmış", `${g1(P)} gün`, `${a.filter((k) => k.planli > 0).length} kişi · ileri tarihli`)}
        {kpi("kalan", "Kullanılmamış", `${g1(K)} gün`, `%${yuzde(K, T)} · plansız`, "uyari")}
        {kpi("devir", "Önceki dönemden devir", `${g1(top(devirli, (k) => k.devir))} gün`, `${devirli.length} kişi`, "kotu")}
        {kpi("hakyok", "İzin hak edişi yok", `${hakYok} kişi`, "ilk yılı ya da girilmemiş")}
      </div>

      <div className="ir-izgara">
        <section className="ir-kart">
          <div className="ir-ust">
            <div>
              <h3>Yıl sonu hedefi: devir 0 gün</h3>
              <span>Hak edişin nereye gittiği · dilime tıklayın</span>
            </div>
            <span className={`ir-cip ${K > T * 0.25 ? "k" : "t"}`}>{g1(K)} gün plansız</span>
          </div>
          <div className="ir-serit">
            <button type="button" aria-label="Kullanılan" style={{ width: `${yuzde(U, T)}%`, background: "var(--ir-yesil)" }} onClick={() => odakAc("kull")} />
            <button type="button" aria-label="Planlı" style={{ width: `${yuzde(P, T)}%`, background: "var(--ir-mavi)" }} onClick={() => odakAc("planli")} />
            <button type="button" aria-label="Plansız" style={{ width: `${Math.max(0, 100 - yuzde(U, T) - yuzde(P, T))}%`, background: "var(--ir-turuncu)" }} onClick={() => odakAc("kalan")} />
          </div>
          <div className="ir-lejant">
            <button type="button" onClick={() => odakAc("kull")}><i style={{ background: "var(--ir-yesil)" }} />Kullanıldı <b>{g1(U)}</b></button>
            <button type="button" onClick={() => odakAc("planli")}><i style={{ background: "var(--ir-mavi)" }} />Planlı <b>{g1(P)}</b></button>
            <button type="button" onClick={() => odakAc("kalan")}><i style={{ background: "var(--ir-turuncu)" }} />Plansız <b>{g1(K)}</b></button>
          </div>
          {plansiz.length > 0 && (
            <div className="ir-not uyari">
              <b>{plansiz.length} kişinin</b> önceki dönemden devri var ama planı yok. Yıl sonuna kadar izin kullanmazlarsa devir büyüyor.
            </div>
          )}
          <div className="ir-dugmeler">
            <Button onClick={() => odakAc("plansiz")}>Devri olup planı olmayanlar ({plansiz.length})</Button>
            {veri?.duzenleyebilir && (
              <Button type="primary" icon={<BellRing size={14} />} loading={gonderiliyor} onClick={() => planIste(plansiz)}>
                Hepsine hatırlat
              </Button>
            )}
          </div>
        </section>

        <section className="ir-kart">
          <div className="ir-ust">
            <div>
              <h3>Devir dağılımı</h3>
              <span>Önceki dönemden kaç gün devretti · kişi sayısı</span>
            </div>
          </div>
          <div className="ir-kova">
            {KOVALAR.map(([ad, f], i) => (
              <button
                type="button"
                key={ad}
                onClick={() => {
                  const l = a.filter((k) => !k.hakYok && f(k)).sort((x, y) => y.devir - x.devir);
                  ac({ tur: "liste", baslik: `Devir: ${ad}${i ? " gün" : ""}`, alt: `${l.length} kişi`, kisiler: l, deger: (k) => `${g1(k.devir)} gün devir · ${k.planli > 0 ? `${g1(k.planli)} planlı` : "plansız"}`, ust: i ? <PlanDugmesi kisiler={l} /> : undefined });
                }}
              >
                <span className="s">
                  <b style={{ height: `${Math.max(4, (kovaSay[i] * 100) / maxKova)}%`, background: i === 0 ? "var(--ir-yesil)" : i < 3 ? "var(--ir-turuncu)" : "var(--ir-kirmizi)" }} />
                </span>
                <b>{kovaSay[i]}</b>
                <small>{ad}{i ? " gün" : ""}</small>
              </button>
            ))}
          </div>
          <div className="ir-not">Hedef: herkes “0 gün” sütununda. 10 günü aşan devri olanlardan plan istenir.</div>
        </section>
      </div>

      <section className="ir-kart">
        <div className="ir-ust">
          <div>
            <h3>Aylara göre izin</h3>
            <span>Kullanılan ve planlı (onay bekleyen dahil) · aya tıklayın</span>
          </div>
          <div className="ir-lejant">
            <span><i style={{ background: "var(--ir-yesil)" }} />Kullanılan</span>
            <span><i style={{ background: "var(--ir-mavi)" }} />Planlı</span>
          </div>
        </div>
        <div className="ir-aylar">
          {AY.map((ad, i) => (
            <button type="button" key={ad} className={i === bugunAy ? "bu" : ""} onClick={() => ayAc(i)} aria-label={`${AYU[i]}: ${g1(ayKullanilan[i])} kullanıldı, ${g1(ayPlanli[i])} planlı`}>
              <span className="s">
                <b style={{ height: `${(ayPlanli[i] * 100) / maxAy}%`, background: "var(--ir-mavi)" }} />
                <b style={{ height: `${(ayKullanilan[i] * 100) / maxAy}%`, background: "var(--ir-yesil)" }} />
              </span>
              <small>{g1(ayKullanilan[i] + ayPlanli[i])}</small>
              <span>{ad}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ir-kart">
        <div className="ir-ust">
          <div>
            <h3>Şubeler</h3>
            <span>Satıra tıklayın: şubenin personeli</span>
          </div>
        </div>
        <Table
          size="small"
          rowKey="sube"
          dataSource={subeSatirlari}
          pagination={false}
          scroll={{ x: 900 }}
          onRow={(r) => ({ onClick: () => subeAc(r), style: { cursor: "pointer" } })}
          columns={[
            { title: "Şube", dataIndex: "sube", sorter: (x, y) => x.sube.localeCompare(y.sube, "tr"), render: (v) => <b>{v}</b> },
            { title: "Kişi", dataIndex: "kisi", align: "right", sorter: (x, y) => x.kisi - y.kisi },
            { title: "Hak ediş", dataIndex: "t", align: "right", render: g1, sorter: (x, y) => x.t - y.t },
            { title: "Kullanılan", dataIndex: "u", align: "right", render: g1, sorter: (x, y) => x.u - y.u },
            { title: "Planlı", dataIndex: "p", align: "right", render: g1, sorter: (x, y) => x.p - y.p },
            { title: "Kullanılmamış", dataIndex: "kalan", align: "right", render: (v) => <b>{g1(v)}</b>, sorter: (x, y) => x.kalan - y.kalan, defaultSortOrder: "descend" },
            { title: "Devir", key: "devir", align: "right", render: (_, r) => `${r.devirKisi} kişi · ${g1(r.devir)} g`, sorter: (x, y) => x.devir - y.devir },
            {
              title: "Kullanım + plan",
              dataIndex: "oran",
              width: 170,
              sorter: (x, y) => x.oran - y.oran,
              render: (v) => (
                <div className="ir-oran">
                  <div><b style={{ width: `${Math.min(100, v)}%`, background: v >= 70 ? "var(--ir-yesil)" : v >= 50 ? "var(--ir-turuncu)" : "var(--ir-kirmizi)" }} /></div>
                  <span>%{v}</span>
                </div>
              ),
            },
            {
              title: "Risk",
              dataIndex: "plansiz",
              sorter: (x, y) => x.plansiz - y.plansiz,
              render: (v) => (v ? <span className={`ir-cip ${v > 4 ? "k" : "t"}`}>{v} plansız devir</span> : <span className="ir-cip y">yok</span>),
            },
          ]}
        />
      </section>

      <section className="ir-kart">
        <div className="ir-ust">
          <div>
            <h3>En çok biriktirenler</h3>
            <span>Kullanılmamış hak edişi en yüksek 10 kişi</span>
          </div>
        </div>
        <KisiListesi
          kisiler={a.filter((k) => !k.hakYok).sort((x, y) => y.kalan - x.kalan).slice(0, 10)}
          deger={(k) => <span className={`ir-cip ${k.kalan > 20 ? "k" : "t"}`}>{g1(k.kalan)} gün</span>}
          onKisi={kisiAc}
        />
      </section>

      <Drawer
        open={!!cek}
        onClose={() => setYigin([])}
        width="min(560px, 100vw)"
        title={
          cek ? (
            <div className="ir-ck-bas">
              {yigin.length > 1 && (
                <Button size="small" type="text" icon={<ChevronLeft size={16} />} onClick={() => setYigin((y) => y.slice(0, -1))} aria-label="Geri" />
              )}
              <div>
                <b>{cek.tur === "kisi" ? cek.kisi.ad : cek.baslik}</b>
                <small>{cek.tur === "kisi" ? `${cek.kisi.gorev ?? ""} · ${cek.kisi.sube} · sicil ${cek.kisi.kod}` : cek.alt}</small>
              </div>
            </div>
          ) : null
        }
      >
        {cek?.tur === "liste" && (
          <div className="ir-ck">
            {cek.ust}
            <KisiListesi kisiler={cek.kisiler} deger={cek.deger} onKisi={kisiAc} />
          </div>
        )}
        {cek?.tur === "kisi" && (
          <KisiAyrinti
            k={cek.kisi}
            yil={veri?.yil ?? yil}
            planIste={veri?.duzenleyebilir ? () => planIste([cek.kisi]) : undefined}
            kartAc={onKisiAc ? () => onKisiAc(cek.kisi.kod) : undefined}
          />
        )}
      </Drawer>
    </div>
  );
}

export function KisiListesi({ kisiler, deger, onKisi }: { kisiler: RaporKisi[]; deger: (k: RaporKisi) => ReactNode; onKisi: (k: RaporKisi) => void }) {
  const [sinir, setSinir] = useState(80);
  if (kisiler.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bu seçimde kimse yok." />;
  return (
    <div className="ir-liste">
      {kisiler.slice(0, sinir).map((k, i) => (
        <button type="button" key={k.kod} onClick={() => onKisi(k)}>
          <span className="sira">{i + 1}</span>
          <span>
            <b>{k.ad}</b>
            <small>{k.gorev ?? "—"} · {k.sube}</small>
          </span>
          <span className="deger">{deger(k)}</span>
        </button>
      ))}
      {kisiler.length > sinir && (
        <Button type="link" onClick={() => setSinir((s) => s + 200)}>
          {kisiler.length - sinir} kişi daha göster
        </Button>
      )}
    </div>
  );
}

function KisiAyrinti({ k, yil, planIste, kartAc }: { k: RaporKisi; yil: number; planIste?: () => void; kartAc?: () => void }) {
  const hareket = AY.map((_, i) => ({ i, u: k.aylar[i], p: k.plan[i] })).filter((x) => x.u || x.p);
  return (
    <div className="ir-ck">
      <div><KisiDurumu k={k} /></div>
      {k.hakYok ? (
        <div className="ir-not">Bu personelin izin hak edişi yok (ilk yılını doldurmadı ya da hak edişi girilmedi).</div>
      ) : (
        <div className="ir-kirilim">
          <div><span>Önceki dönemden devir</span><b>{g1(k.devir)} gün</b></div>
          <div><span>Bu dönemin hak edişi</span><b>{g1(k.hak)} gün</b></div>
          <div className="top"><span>Toplam hak ediş</span><span>{g1(k.toplam)} gün</span></div>
          <div><span>Kullanılan</span><b>{g1(k.kullanilan)} gün</b></div>
          <div><span>Planlanmış (onay bekleyen dahil)</span><b>{g1(k.planli)} gün</b></div>
          <div className="top"><span>Kullanılmamış hak ediş</span><span style={{ color: k.kalan > 10 ? "var(--ir-turuncu)" : "var(--ir-yesil-k)" }}>{g1(k.kalan)} gün</span></div>
        </div>
      )}
      <div className="ir-dugmeler">
        {planIste && !k.hakYok && k.kalan > 0 && (
          <Button type="primary" icon={<BellRing size={14} />} onClick={planIste}>İzin planı iste</Button>
        )}
        {kartAc && <Button onClick={kartAc}>İzin kartını aç</Button>}
      </div>
      <h4 style={{ margin: "6px 0 0" }}>{yil} hareketleri</h4>
      {hareket.length === 0 ? (
        <div className="ir-not">Bu yıl izin kullanmadı ve planı yok.</div>
      ) : (
        <div className="ir-zaman">
          {hareket.map((x) => (
            <div key={x.i}>
              <i style={{ background: x.p && !x.u ? "var(--ir-mavi)" : "var(--ir-yesil)" }} />
              <span>{AYU[x.i]}</span>
              <Tooltip title="Kullanılan · planlı">
                <b>{[x.u ? `${g1(x.u)} kullandı` : "", x.p ? `${g1(x.p)} planlı` : ""].filter(Boolean).join(" · ")}</b>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

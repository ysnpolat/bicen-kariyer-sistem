/**
 * ---------------------------------------------------------------------------
 * Künye Analizi (12.10.2026: Rakip Fiyat Analizi ile aynı tasarım)
 * ---------------------------------------------------------------------------
 * Mobilden okutulan rakip künyeleri. Pozitif fark, aynı üründe rakipten
 * pahalıya aldığımız anlamına geliyor; satın alma bunu tedarikçiyle
 * konuşurken kullanıyor.
 *
 * Süzgeçler sunucuda uygulanıyor; kartlar her zaman ekrandaki listeyle
 * aynı kümeyi anlatıyor. Günlük, dağılım ve mağaza kırılımı sunucunun
 * döndürdüğü kayıtlardan tarayıcıda hesaplanıyor (uç değişmedi).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Drawer, message } from "antd";
import { Copy, Download, RefreshCw, X } from "lucide-react";
import dayjs from "dayjs";

import { api } from "../api";
import { CubukGrafik, HalkaGrafik, Kivilcim, N0, N1, N2, RM, saydam } from "../RmGrafik";
import { Bekle, Kart, Kpiler, Tablo, type Kopya, type KpiVeri, type Sutun } from "./RaporMerkezi";
import "./RaporMerkezi.css";

/* ========================================================================== */
/* Türler                                                                     */
/* ========================================================================== */

interface Kayit {
  id: number;
  kunyeNo: string;
  urunAdi: string | null;
  uretici: string | null;
  uretimYeri: string | null;
  rakipIsletme: string | null;
  rakipFiyat: number | null;
  bizimFiyat: number | null;
  bizimKunye: string | null;
  bizimTarih: string | null;
  fark: number | null;
  farkYuzde: number | null;
  subeAdi: string | null;
  personelAdi: string | null;
  notMetni: string | null;
  olusturma: string;
}

interface KirilimSatir {
  ad: string;
  adet: number;
  karsilastirilan: number;
  pahali: number;
  esit: number;
  ucuz: number;
  ortalamaFark: number | null;
  ortalamaYuzde: number | null;
  son: string;
}

interface Rapor {
  toplam: number;
  karsilastirilan: number;
  pahaliAldigimiz: number;
  ucuzAldigimiz: number;
  ortalamaFark: number;
  toplamFark: number;
  kayitlar: Kayit[];
  okutanlar: { okutan: string; adet: number }[];
  secenekler: {
    subeler: string[];
    okutanlar: string[];
    rakipler: string[];
    urunler: string[];
  };
}

type Donem = "7" | "30" | "ay" | "90" | "ozel";

interface Suzgec {
  donem: Donem;
  bas: string;
  bit: string;
  sube?: string;
  okutan?: string;
  rakip?: string;
  urun?: string;
  yon?: "pahali" | "esit" | "ucuz";
  ara?: string;
}

/* ========================================================================== */
/* Biçim                                                                      */
/* ========================================================================== */

const tl = (v: number | null | undefined) => (v == null ? "—" : "₺" + N2.format(v));
const isaretliTl = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}₺${N2.format(Math.abs(v))}`;
const yuzde = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}%${N1.format(Math.abs(v))}`;
const tarih = (v: string) => dayjs(v).format("DD.MM.YYYY");
const tarihSaat = (v: string) => dayjs(v).format("DD.MM.YY HH:mm");
const oran = (a: number, b: number) => (b > 0 ? a / b : 0);
const iso = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");

/** Fark rozeti: pozitif = rakipten pahalıya aldık (kırmızı) */
const FarkHap = ({ fark, yuzdeV }: { fark: number | null; yuzdeV?: number | null }) =>
  fark == null ? (
    <span className="rm-hap">karşılaştırılamadı</span>
  ) : (
    <span className={`rm-hap ${fark > 0 ? "bad" : fark < 0 ? "good" : "info"}`} title={yuzdeV != null ? yuzde(yuzdeV) : undefined}>
      {fark === 0 ? "eşit" : `${isaretliTl(fark)}${yuzdeV != null ? ` · ${yuzde(yuzdeV)}` : ""}`}
    </span>
  );

/** Pahalı / eşit / ucuz oranı tek çubukta */
const KonumCubugu = ({ p, e, u }: { p: number; e: number; u: number }) => {
  const t = p + e + u;
  if (!t) return <span style={{ color: RM.muted }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 140 }}>
      <span style={{ display: "flex", width: 90, height: 8, borderRadius: 4, overflow: "hidden", background: RM.line }}>
        <i style={{ width: `${(p / t) * 100}%`, background: RM.bad }} />
        <i style={{ width: `${(e / t) * 100}%`, background: saydam(RM.muted, 0.5) }} />
        <i style={{ width: `${(u / t) * 100}%`, background: RM.good }} />
      </span>
      <span style={{ fontSize: 12, color: RM.muted }}>%{N0.format((p / t) * 100)} pahalı</span>
    </span>
  );
};

/* ========================================================================== */
/* Dönem                                                                      */
/* ========================================================================== */

function donemAraligi(s: Suzgec): [string, string] {
  const bugun = dayjs();
  switch (s.donem) {
    case "7":
      return [iso(bugun.subtract(6, "day")), iso(bugun)];
    case "ay":
      return [iso(bugun.startOf("month")), iso(bugun)];
    case "90":
      return [iso(bugun.subtract(89, "day")), iso(bugun)];
    case "ozel":
      return [s.bas, s.bit];
    default:
      return [iso(bugun.subtract(29, "day")), iso(bugun)];
  }
}

const ANAHTAR = "b360.kunye.suzgec";

function suzgecOku(): Suzgec {
  const bos: Suzgec = { donem: "30", bas: iso(dayjs().subtract(29, "day")), bit: iso(dayjs()) };
  try {
    const h = JSON.parse(localStorage.getItem(ANAHTAR) ?? "null");
    return h ? { ...bos, donem: h.donem ?? "30", bas: h.bas ?? bos.bas, bit: h.bit ?? bos.bit } : bos;
  } catch {
    return bos;
  }
}

/** Kayıtları bir alana göre gruplar: adet, konum, ortalama fark */
function kir(kayitlar: Kayit[], alan: (k: Kayit) => string | null): KirilimSatir[] {
  const m = new Map<string, Kayit[]>();
  for (const k of kayitlar) {
    const a = alan(k);
    if (!a) continue;
    const l = m.get(a) ?? [];
    l.push(k);
    m.set(a, l);
  }

  return [...m.entries()].map(([ad, l]) => {
    const k = l.filter((x) => x.fark != null);
    const y = l.filter((x) => x.farkYuzde != null);
    return {
      ad,
      adet: l.length,
      karsilastirilan: k.length,
      pahali: k.filter((x) => (x.fark ?? 0) > 0).length,
      esit: k.filter((x) => x.fark === 0).length,
      ucuz: k.filter((x) => (x.fark ?? 0) < 0).length,
      ortalamaFark: k.length ? k.reduce((t, x) => t + (x.fark ?? 0), 0) / k.length : null,
      ortalamaYuzde: y.length ? y.reduce((t, x) => t + (x.farkYuzde ?? 0), 0) / y.length : null,
      son: l.reduce((s, x) => (x.olusturma > s ? x.olusturma : s), l[0].olusturma),
    };
  });
}

/* ========================================================================== */
/* Sayfa                                                                      */
/* ========================================================================== */

export default function KunyeAnalizi() {
  const [suzgec, setSuzgec] = useState<Suzgec>(suzgecOku);
  const [veri, setVeri] = useState<Rapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [araMetni, setAraMetni] = useState("");
  const [detay, setDetay] = useState<Kayit | null>(null);
  const kopya: Kopya = useRef({});

  const [bas, bit] = donemAraligi(suzgec);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      const q = new URLSearchParams({ bas, bit });
      for (const a of ["sube", "okutan", "rakip", "urun", "yon", "ara"] as const) {
        const d = suzgec[a];
        if (d) q.set(a, String(d));
      }
      setVeri(await api.getir<Rapor>(`Kunye/Rapor?${q.toString()}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Rapor alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [bas, bit, suzgec.sube, suzgec.okutan, suzgec.rakip, suzgec.urun, suzgec.yon, suzgec.ara]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Dönem tarayıcıda hatırlanıyor */
  useEffect(() => {
    try {
      localStorage.setItem(ANAHTAR, JSON.stringify({ donem: suzgec.donem, bas: suzgec.bas, bit: suzgec.bit }));
    } catch {
      /* saklanamazsa her açılışta son 30 gün */
    }
  }, [suzgec.donem, suzgec.bas, suzgec.bit]);

  const degistir = (d: Partial<Suzgec>) => setSuzgec((o) => ({ ...o, ...d }));
  const temizle = () => {
    setAraMetni("");
    setSuzgec((o) => ({ donem: o.donem, bas: o.bas, bit: o.bit }));
  };

  /* ------------------------------------------------------------ hesaplar */
  const V = veri;
  const kayitlar = V?.kayitlar ?? [];

  const esit = kayitlar.filter((k) => k.fark === 0).length;
  const karsilastirilamayan = kayitlar.filter((k) => k.fark == null).length;

  const gunluk = useMemo(() => {
    const gunler: string[] = [];
    for (let d = dayjs(bas); !d.isAfter(dayjs(bit), "day"); d = d.add(1, "day")) gunler.push(iso(d));
    const m = new Map(gunler.map((g) => [g, { gun: g, adet: 0, pahali: 0, esit: 0, ucuz: 0 }]));
    for (const k of kayitlar) {
      const g = m.get(iso(dayjs(k.olusturma)));
      if (!g) continue;
      g.adet++;
      if (k.fark == null) continue;
      if (k.fark > 0) g.pahali++;
      else if (k.fark < 0) g.ucuz++;
      else g.esit++;
    }
    return [...m.values()];
  }, [kayitlar, bas, bit]);

  const urunler = useMemo(() => kir(kayitlar, (k) => k.urunAdi ?? "Bilinmiyor"), [kayitlar]);
  const rakipler = useMemo(() => kir(kayitlar, (k) => k.rakipIsletme), [kayitlar]);
  const subeler = useMemo(() => kir(kayitlar, (k) => k.subeAdi), [kayitlar]);
  const okutanlar = useMemo(() => kir(kayitlar, (k) => k.personelAdi), [kayitlar]);

  /* Pahalıya aldıklarımız: ürün bazında ortalama yüzde, büyükten küçüğe */
  const pahalilar = useMemo(
    () => urunler.filter((x) => (x.ortalamaFark ?? 0) > 0).sort((a, b) => (b.ortalamaYuzde ?? 0) - (a.ortalamaYuzde ?? 0)),
    [urunler]
  );
  const ucuzlar = useMemo(
    () => urunler.filter((x) => (x.ortalamaFark ?? 0) < 0).sort((a, b) => (a.ortalamaYuzde ?? 0) - (b.ortalamaYuzde ?? 0)),
    [urunler]
  );

  /* Fark dağılımı: (bizim − rakip) / rakip */
  const DILIMLER: { ad: string; yon: "pahali" | "esit" | "ucuz"; icinde: (v: number) => boolean; renk: string }[] = [
    { ad: "%20 ve üstü ucuz", yon: "ucuz", icinde: (v) => v <= -20, renk: RM.good },
    { ad: "%10…%20 ucuz", yon: "ucuz", icinde: (v) => v > -20 && v <= -10, renk: saydam(RM.good, 0.75) },
    { ad: "%0…%10 ucuz", yon: "ucuz", icinde: (v) => v > -10 && v < 0, renk: saydam(RM.good, 0.5) },
    { ad: "Eşit", yon: "esit", icinde: (v) => v === 0, renk: saydam(RM.muted, 0.5) },
    { ad: "%0…%10 pahalı", yon: "pahali", icinde: (v) => v > 0 && v < 10, renk: saydam(RM.bad, 0.5) },
    { ad: "%10…%20 pahalı", yon: "pahali", icinde: (v) => v >= 10 && v < 20, renk: saydam(RM.bad, 0.75) },
    { ad: "%20 ve üstü pahalı", yon: "pahali", icinde: (v) => v >= 20, renk: RM.bad },
  ];
  const yuzdeler = kayitlar.filter((k) => k.farkYuzde != null).map((k) => k.farkYuzde as number);
  const dagilim = DILIMLER.map((d) => ({ ...d, adet: yuzdeler.filter(d.icinde).length }));

  const kpi: KpiVeri[] = V
    ? [
        {
          l: "Okutma",
          v: N0.format(V.toplam),
          sp: <Kivilcim veri={gunluk.map((g) => g.adet)} />,
          k: `${N0.format(urunler.length)} ürün · ${N0.format(rakipler.length)} rakip`,
          d: "",
        },
        {
          l: "Pahalı aldığımız",
          v: `%${N0.format(oran(V.pahaliAldigimiz, V.karsilastirilan) * 100)}`,
          k: `${N0.format(V.pahaliAldigimiz)} / ${N0.format(V.karsilastirilan)} karşılaştırma`,
          d: V.pahaliAldigimiz > 0 ? <span className="rm-hap bad">tedarikçiyle konuşun</span> : "",
        },
        {
          l: "Ucuza aldığımız",
          v: `%${N0.format(oran(V.ucuzAldigimiz, V.karsilastirilan) * 100)}`,
          k: `${N0.format(V.ucuzAldigimiz)} okutma`,
          d: "",
        },
        {
          l: "Ortalama fark",
          v: isaretliTl(V.ortalamaFark),
          k: "okutma başına · + pahalıya aldık",
          d: <span className={`rm-hap ${V.ortalamaFark > 0 ? "bad" : V.ortalamaFark < 0 ? "good" : "info"}`}>{V.ortalamaFark > 0 ? "pahalı" : V.ortalamaFark < 0 ? "ucuz" : "eşit"}</span>,
        },
        {
          l: "Toplam fark",
          v: isaretliTl(V.toplamFark),
          k: "birim fiyat farklarının toplamı",
          d: "",
        },
        {
          l: "Karşılaştırılamayan",
          v: N0.format(karsilastirilamayan),
          k: "bizde aynı cinste alış bulunamayan",
          d: karsilastirilamayan > 0 ? <span className="rm-hap warn">kontrol edin</span> : "",
        },
      ]
    : [];

  /* --------------------------------------------------------- kopyala/aktar */
  const kopyala = (id: string) => {
    const k = kopya.current[id]?.();
    if (!k) return;
    navigator.clipboard
      ?.writeText(k.tsv)
      .then(() => message.success(`${N0.format(k.adet)} satır kopyalandı; Excel'e yapıştırabilirsiniz.`))
      .catch(() => message.error("Kopyalanamadı."));
  };

  const KopyaDugme = ({ id }: { id: string }) => (
    <button className="rm-dugme yuvarlak" onClick={() => kopyala(id)} title="Tabloyu kopyala (Excel'e yapıştırılır)">
      <Copy size={12} /> Kopyala
    </button>
  );

  /* Dışa aktarma tarayıcıda: kayıt sayısı birkaç bini geçmiyor */
  const disaAktar = () => {
    if (!kayitlar.length) return message.info("Aktarılacak kayıt yok.");

    const basliklar = ["Tarih", "Ürün", "Künye no", "Üretici", "Üretim yeri", "Rakip", "Rakip fiyat", "Bizim fiyat", "Fark", "Fark %", "Bizim künye", "Mağaza", "Okutan", "Not"];
    const satirlar = kayitlar.map((k) => [
      dayjs(k.olusturma).format("DD.MM.YYYY HH:mm"),
      k.urunAdi ?? "",
      k.kunyeNo ?? "",
      k.uretici ?? "",
      k.uretimYeri ?? "",
      k.rakipIsletme ?? "",
      k.rakipFiyat ?? "",
      k.bizimFiyat ?? "",
      k.fark ?? "",
      k.farkYuzde ?? "",
      k.bizimKunye ?? "",
      k.subeAdi ?? "",
      k.personelAdi ?? "",
      k.notMetni ?? "",
    ]);

    /* Noktalı virgül ve BOM: Türkçe Excel virgülü ondalık sayıyor */
    const metin = (h: unknown) => (typeof h === "number" ? String(h).replace(".", ",") : String(h));
    const csv =
      "﻿" +
      [basliklar, ...satirlar].map((s) => s.map((h) => `"${metin(h).replace(/"/g, '""')}"`).join(";")).join("\r\n");

    const bag = document.createElement("a");
    bag.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    bag.download = `kunye-analizi-${bas}_${bit}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
  };

  /* ------------------------------------------------------------ tablolar */
  const kirilimSutun = (baslik: string, kalin = true): Sutun<KirilimSatir>[] => [
    { k: "ad", l: baslik, f: (x) => (kalin ? <b>{x.ad}</b> : x.ad), tx: (x) => x.ad },
    { k: "adet", l: "Okutma", num: true, f: (x) => N0.format(x.adet) },
    {
      k: "konum",
      l: "Konum",
      sv: (x) => oran(x.pahali, x.karsilastirilan),
      f: (x) => <KonumCubugu p={x.pahali} e={x.esit} u={x.ucuz} />,
      tx: (x) => `${x.pahali} pahalı / ${x.ucuz} ucuz`,
    },
    {
      k: "ortalamaFark",
      l: "Ort. fark",
      num: true,
      sv: (x) => x.ortalamaFark ?? 0,
      f: (x) => <FarkHap fark={x.ortalamaFark == null ? null : Math.round(x.ortalamaFark * 100) / 100} yuzdeV={x.ortalamaYuzde} />,
      tx: (x) => x.ortalamaFark ?? "",
    },
    { k: "son", l: "Son okutma", soluk: true, sv: (x) => x.son, f: (x) => tarih(x.son), tx: (x) => tarih(x.son) },
  ];

  const okutmaSutun: Sutun<Kayit>[] = [
    { k: "olusturma", l: "Tarih", soluk: true, sv: (x) => x.olusturma, f: (x) => tarihSaat(x.olusturma), tx: (x) => tarihSaat(x.olusturma) },
    {
      k: "urunAdi",
      l: "Ürün",
      sv: (x) => x.urunAdi ?? "",
      f: (x) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{x.urunAdi ?? "—"}</div>
          <small style={{ color: RM.muted }}>{x.kunyeNo}</small>
        </div>
      ),
      tx: (x) => `${x.urunAdi ?? ""} (${x.kunyeNo})`,
    },
    { k: "rakipIsletme", l: "Rakip", sv: (x) => x.rakipIsletme ?? "", f: (x) => x.rakipIsletme ?? "—" },
    { k: "rakipFiyat", l: "Rakip alış", num: true, sv: (x) => x.rakipFiyat ?? 0, f: (x) => <b>{tl(x.rakipFiyat)}</b>, tx: (x) => x.rakipFiyat ?? "" },
    { k: "bizimFiyat", l: "Bizim alış", num: true, sv: (x) => x.bizimFiyat ?? 0, f: (x) => tl(x.bizimFiyat), tx: (x) => x.bizimFiyat ?? "" },
    {
      k: "fark",
      l: "Fark",
      num: true,
      sv: (x) => x.farkYuzde ?? x.fark ?? -999,
      f: (x) => <FarkHap fark={x.fark} yuzdeV={x.farkYuzde} />,
      tx: (x) => x.fark ?? "",
    },
    { k: "subeAdi", l: "Mağaza", soluk: true, sv: (x) => x.subeAdi ?? "", f: (x) => x.subeAdi ?? "—" },
    { k: "personelAdi", l: "Okutan", soluk: true, sv: (x) => x.personelAdi ?? "", f: (x) => x.personelAdi ?? "—" },
  ];

  /* -------------------------------------------------------------- çipler */
  const cipler: [string, string, () => void][] = [
    ...(suzgec.rakip ? [["rakip", `Rakip: ${suzgec.rakip}`, () => degistir({ rakip: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.urun ? [["urun", `Ürün: ${suzgec.urun}`, () => degistir({ urun: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.sube ? [["sube", `Mağaza: ${suzgec.sube}`, () => degistir({ sube: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.okutan ? [["okutan", `Okutan: ${suzgec.okutan}`, () => degistir({ okutan: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.yon
      ? [["yon", suzgec.yon === "pahali" ? "Pahalı aldıklarımız" : suzgec.yon === "ucuz" ? "Ucuza aldıklarımız" : "Eşit", () => degistir({ yon: undefined })] as [string, string, () => void]]
      : []),
    ...(suzgec.ara
      ? [["ara", `Arama: ${suzgec.ara}`, () => { setAraMetni(""); degistir({ ara: undefined }); }] as [string, string, () => void]]
      : []),
  ];

  const sec = (alan: "rakip" | "urun" | "sube" | "okutan", deger: string) =>
    degistir({ [alan]: suzgec[alan] === deger ? undefined : deger } as Partial<Suzgec>);

  const Lejant = ({ l }: { l: [string, string][] }) => (
    <span className="rm-lejant">
      {l.map(([ad, renk]) => (
        <span key={ad}>
          <i style={{ background: renk }} />
          {ad}
        </span>
      ))}
    </span>
  );

  /* ------------------------------------------------------------- ekran */
  return (
    <div className="rm">
      <div className="rm-ust">
        <div>
          <h1>Künye Analizi</h1>
          <div className="rm-alt">
            Rakip markette okutulan meyve-sebze künyelerinde rakibin alış fiyatı ile aynı cinste bizim son alış fiyatımız ·{" "}
            {tarih(bas)} – {tarih(bit)}
          </div>
        </div>
        <div className="rm-sag">
          <div className="rm-canli">
            <button className="rm-dugme yuvarlak" onClick={getir} title="Yenile">
              <RefreshCw size={13} className={yukleniyor ? "rm-don" : undefined} /> Yenile
            </button>
          </div>
          <button className="rm-dugme" onClick={disaAktar}>
            <Download size={13} /> Excel'e aktar
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- süzgeç */}
      <div className="rm-suzgec">
        <div className="rm-alan">
          <label htmlFor="kuDonem">Dönem</label>
          <select
            id="kuDonem"
            value={suzgec.donem}
            onChange={(e) => {
              const d = e.target.value as Donem;
              degistir(d === "ozel" ? { donem: d, bas, bit } : { donem: d });
            }}
          >
            <option value="7">Son 7 gün</option>
            <option value="30">Son 30 gün</option>
            <option value="ay">Bu ay</option>
            <option value="90">Son 90 gün</option>
            <option value="ozel">Özel aralık…</option>
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="kuBas">Başlangıç</label>
          <input
            id="kuBas"
            type="date"
            value={bas}
            max={bit}
            onChange={(e) => e.target.value && degistir({ donem: "ozel", bas: e.target.value, bit })}
          />
        </div>
        <div className="rm-alan">
          <label htmlFor="kuBit">Bitiş</label>
          <input
            id="kuBit"
            type="date"
            value={bit}
            min={bas}
            max={iso(dayjs())}
            onChange={(e) => e.target.value && degistir({ donem: "ozel", bas, bit: e.target.value })}
          />
        </div>
        <div className="rm-alan">
          <label htmlFor="kuRakip">Rakip</label>
          <select id="kuRakip" value={suzgec.rakip ?? ""} onChange={(e) => degistir({ rakip: e.target.value || undefined })}>
            <option value="">Tüm rakipler</option>
            {(V?.secenekler.rakipler ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="kuUrun">Ürün</label>
          <select id="kuUrun" value={suzgec.urun ?? ""} onChange={(e) => degistir({ urun: e.target.value || undefined })}>
            <option value="">Tüm ürünler</option>
            {(V?.secenekler.urunler ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="kuSube">Mağaza</label>
          <select id="kuSube" value={suzgec.sube ?? ""} onChange={(e) => degistir({ sube: e.target.value || undefined })}>
            <option value="">Tüm mağazalar</option>
            {(V?.secenekler.subeler ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="kuOkutan">Okutan</label>
          <select id="kuOkutan" value={suzgec.okutan ?? ""} onChange={(e) => degistir({ okutan: e.target.value || undefined })}>
            <option value="">Herkes</option>
            {(V?.secenekler.okutanlar ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="kuAra">Ara</label>
          <input
            id="kuAra"
            type="search"
            placeholder="Ürün, künye no, üretici · Enter"
            value={araMetni}
            onChange={(e) => {
              setAraMetni(e.target.value);
              if (!e.target.value) degistir({ ara: undefined });
            }}
            onKeyDown={(e) => e.key === "Enter" && degistir({ ara: araMetni.trim() || undefined })}
          />
        </div>
        <div className="rm-alan">
          <label>Konum</label>
          <span className="rm-dilim">
            {(
              [
                [undefined, "Tümü"],
                ["pahali", "Pahalı"],
                ["esit", "Eşit"],
                ["ucuz", "Ucuz"],
              ] as const
            ).map(([k, l]) => (
              <button key={l} aria-pressed={suzgec.yon === k} onClick={() => degistir({ yon: k })}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <button className="rm-dugme" onClick={temizle} style={{ height: 34 }}>
          Filtreleri temizle
        </button>
      </div>

      <div className="rm-cipler">
        {cipler.length ? (
          cipler.map(([k, l, kaldir]) => (
            <span key={k} className="rm-cip">
              {l}
              <button aria-label="Kaldır" onClick={kaldir}>
                <X size={12} />
              </button>
            </span>
          ))
        ) : (
          <span className="rm-ipucu-metin">
            Ürün, rakip, mağaza ve okutan satırlarına tıklayarak süzebilir; okutmaya tıklayarak künyenin ayrıntısını görebilirsiniz.
          </span>
        )}
      </div>

      {!V ? (
        <Bekle hata={hata} metin="Künye okutmaları okunuyor…" />
      ) : (
        <>
          {hata && <div style={{ color: RM.bad, fontSize: 13 }}>{hata}</div>}

          <Kpiler liste={kpi} yukleniyor={yukleniyor} />

          <div className="rm-izgara">
            <Kart
              sinif="c8"
              baslik="Günlük okutma"
              ipucu="her gün okutulan künyelerde alış konumumuz"
              araclar={<Lejant l={[["Pahalı aldık", RM.bad], ["Eşit", saydam(RM.muted, 0.5)], ["Ucuza aldık", RM.good]]} />}
            >
              <CubukGrafik
                etiketler={gunluk.map((g) => dayjs(g.gun).format("DD.MM"))}
                seriler={[
                  { ad: "Pahalı aldık", veri: gunluk.map((g) => g.pahali), renk: RM.bad },
                  { ad: "Eşit", veri: gunluk.map((g) => g.esit), renk: saydam(RM.muted, 0.5) },
                  { ad: "Ucuza aldık", veri: gunluk.map((g) => g.ucuz), renk: RM.good },
                ]}
                bicim={(v) => N0.format(v)}
                eksenBicim={(v) => N0.format(v)}
                ipucuEk={(i) => <div style={{ marginTop: 4 }}>{N0.format(gunluk[i].adet)} okutma</div>}
              />
            </Kart>

            <Kart sinif="c4" baslik="Alış konumumuz" ipucu="dönemdeki bütün okutmalar">
              <HalkaGrafik
                bicim={(v) => N0.format(v)}
                dilimler={[
                  { ad: "Pahalı aldık", deger: V.pahaliAldigimiz, renk: RM.bad },
                  { ad: "Eşit", deger: esit, renk: saydam(RM.muted, 0.5) },
                  { ad: "Ucuza aldık", deger: V.ucuzAldigimiz, renk: RM.good },
                  { ad: "Karşılaştırılamadı", deger: karsilastirilamayan, renk: RM.warn },
                ]}
              />
            </Kart>

            <Kart sinif="c7" baslik="Rakipler" ipucu="satıra tıklayınca süzülür" araclar={<KopyaDugme id="rakip" />}>
              <Tablo<KirilimSatir>
                id="rakip"
                kopya={kopya}
                sutunlar={kirilimSutun("Rakip")}
                satirlar={rakipler}
                varsayilan="adet"
                limit={10}
                tikla={(x) => sec("rakip", x.ad)}
                secili={(x) => suzgec.rakip === x.ad}
              />
            </Kart>

            <Kart sinif="c5" baslik="Fark dağılımı" ipucu="(bizim − rakip) / rakip · çubuğa tıklayınca süzülür">
              <CubukGrafik
                etiketler={dagilim.map((d) => d.ad)}
                seriler={[{ ad: "Okutma", veri: dagilim.map((d) => d.adet), renk: dagilim.map((d) => d.renk) }]}
                bicim={(v) => N0.format(v)}
                eksenBicim={(v) => N0.format(v)}
                yatay
                yukseklik={300}
                tikla={(i) => {
                  const y = dagilim[i]?.yon;
                  if (y) degistir({ yon: suzgec.yon === y ? undefined : y });
                }}
              />
            </Kart>

            <Kart sinif="c6" baslik="Pahalıya aldığımız ürünler" ipucu="ürün bazında ortalama fark" araclar={<KopyaDugme id="pahali" />}>
              <Tablo<KirilimSatir>
                id="pahali"
                kopya={kopya}
                sutunlar={kirilimSutun("Ürün")}
                satirlar={pahalilar}
                limit={10}
                tikla={(x) => sec("urun", x.ad)}
                secili={(x) => suzgec.urun === x.ad}
              />
            </Kart>

            <Kart sinif="c6" baslik="Ucuza aldığımız ürünler" ipucu="ürün bazında ortalama fark" araclar={<KopyaDugme id="ucuz" />}>
              <Tablo<KirilimSatir>
                id="ucuz"
                kopya={kopya}
                sutunlar={kirilimSutun("Ürün")}
                satirlar={ucuzlar}
                limit={10}
                tikla={(x) => sec("urun", x.ad)}
                secili={(x) => suzgec.urun === x.ad}
              />
            </Kart>

            <Kart sinif="c6" baslik="Mağazalar" ipucu="okutmanın yapıldığı mağaza" araclar={<KopyaDugme id="sube" />}>
              <Tablo<KirilimSatir>
                id="sube"
                kopya={kopya}
                sutunlar={kirilimSutun("Mağaza", false)}
                satirlar={subeler}
                varsayilan="adet"
                limit={10}
                tikla={(x) => sec("sube", x.ad)}
                secili={(x) => suzgec.sube === x.ad}
              />
            </Kart>

            <Kart sinif="c6" baslik="Okutanlar" araclar={<KopyaDugme id="okutan" />}>
              <Tablo<KirilimSatir>
                id="okutan"
                kopya={kopya}
                sutunlar={kirilimSutun("Okutan", false)}
                satirlar={okutanlar}
                varsayilan="adet"
                limit={10}
                tikla={(x) => sec("okutan", x.ad)}
                secili={(x) => suzgec.okutan === x.ad}
              />
            </Kart>

            <Kart
              sinif="c12"
              baslik={`Okutmalar (${N0.format(kayitlar.length)})`}
              ipucu="satıra tıklayınca künyenin ayrıntısı açılır"
              araclar={<KopyaDugme id="okutma" />}
            >
              <Tablo<Kayit>
                id="okutma"
                kopya={kopya}
                sutunlar={okutmaSutun}
                satirlar={kayitlar}
                varsayilan="olusturma"
                limit={25}
                suzgec
                tikla={(x) => setDetay(x)}
              />
            </Kart>
          </div>

          <div className="rm-dipnot">
            Rakibin alış fiyatı künyede HKS'ye bildirilen fiyattır; bizim fiyatımız aynı cinste en son alış künyemizdeki fiyattır ve
            okutma anında kayda yazılır. Pozitif fark aynı ürünü rakipten pahalıya aldığımız anlamına gelir. Ortalama fark birkaç
            büyük farktan etkilenebilir; ürün bazındaki tablolara ve toplam farka birlikte bakınız.
          </div>
        </>
      )}

      <KunyeDetay kayit={detay} kapat={() => setDetay(null)} />
    </div>
  );
}

/* ========================================================================== */
/* Künye ayrıntısı                                                            */
/* ========================================================================== */

function KunyeDetay({ kayit, kapat }: { kayit: Kayit | null; kapat: () => void }) {
  const satir = (b: ReactNode, d: ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: `1px solid ${RM.line}` }}>
      <span style={{ color: RM.muted }}>{b}</span>
      <span style={{ textAlign: "right" }}>{d}</span>
    </div>
  );

  return (
    <Drawer open={!!kayit} onClose={kapat} width={480} title={kayit?.urunAdi ?? kayit?.kunyeNo ?? ""} destroyOnClose>
      {kayit ? (
        <div className="rm" style={{ gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <div style={{ border: `1px solid ${RM.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ color: RM.muted, fontSize: 12 }}>Rakip alış</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{tl(kayit.rakipFiyat)}</div>
              <div style={{ color: RM.muted, fontSize: 12 }}>{kayit.rakipIsletme ?? "—"}</div>
            </div>
            <div style={{ border: `1px solid ${RM.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ color: RM.muted, fontSize: 12 }}>Bizim alış</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: RM.brandInk }}>{tl(kayit.bizimFiyat)}</div>
              <div style={{ color: RM.muted, fontSize: 12 }}>{kayit.bizimTarih ? tarih(kayit.bizimTarih) : "—"}</div>
            </div>
          </div>

          <div>
            Fark: <FarkHap fark={kayit.fark} yuzdeV={kayit.farkYuzde} />
          </div>

          <div>
            {satir("Künye no", kayit.kunyeNo)}
            {satir("Üretici", kayit.uretici ?? "—")}
            {satir("Üretim yeri", kayit.uretimYeri ?? "—")}
            {satir("Bizim künye", kayit.bizimKunye ?? "—")}
            {satir("Mağaza", kayit.subeAdi ?? "—")}
            {satir("Okutan", kayit.personelAdi ?? "—")}
            {satir("Okutma", tarihSaat(kayit.olusturma))}
            {kayit.notMetni ? satir("Not", kayit.notMetni) : null}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

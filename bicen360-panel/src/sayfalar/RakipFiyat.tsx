/**
 * ---------------------------------------------------------------------------
 * Rakip Fiyat Analizi (09.10.2026)
 * ---------------------------------------------------------------------------
 * Mobilden okutulan rakip raf fiyatları ile kendi satış fiyatımızın
 * karşılaştırması; Rapor Merkezi'nin düzeni ve grafikleriyle.
 *
 * Fark "bizim fiyat − rakip fiyat": pozitif olması bizim pahalı olduğumuz
 * anlamına geliyor (künye modülüyle aynı yön). Fiyat endeksi bizim / rakip
 * × 100 ortalaması: 100 eşit, 104 ortalamada %4 pahalıyız.
 *
 * Süzgeçler sunucuda uygulanıyor; KPI'lar, grafikler ve tablolar her zaman
 * aynı kümeyi anlatıyor. Grafik ve tablo satırlarına tıklamak süzgeci
 * değiştiriyor; ürüne tıklamak o ürünün bütün rakip fiyatlarını açıyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Drawer, Spin, message } from "antd";
import { Copy, Download, RefreshCw, X } from "lucide-react";
import dayjs from "dayjs";

import { API_TABAN, api } from "../api";
import { CubukGrafik, HalkaGrafik, Kivilcim, N0, N1, N2, RM, saydam } from "../RmGrafik";
import { Bekle, Kart, Kpiler, Tablo, type Kopya, type KpiVeri, type Sutun } from "./RaporMerkezi";
import RakipWebFiyat from "./RakipWebFiyat";
import { RakipAdi } from "../RakipLogosu";
import "./RaporMerkezi.css";

/* ========================================================================== */
/* Türler                                                                     */
/* ========================================================================== */

interface Kayit {
  id: number;
  barkod: string;
  stokKodu: string | null;
  urunAdi: string | null;
  rakipFiyat: number;
  bizimFiyat: number | null;
  fark: number | null;
  farkYuzde: number | null;
  subeKodu: string | null;
  personelAdi: string | null;
  notMetni: string | null;
  olusturma: string;
  firma: string | null;
  kaynak?: "mobil" | "web";
  webLink?: string | null;
  /* İki fiyat (09.10.2026): bizimFiyat geçerli fiyat (BiCard > 0 ise BiCard, değilse raf) */
  rafFiyat: number | null;
  bicardFiyat: number | null;
  rafFark: number | null;
  rafFarkYuzde: number | null;
  fiyatTuru: "bicard" | "raf" | null;
  /** Rakibin indirimsiz (üstü çizili) fiyatı; indirim yoksa satış fiyatı */
  rakipListeFiyat?: number | null;
  /** Ürün görseli (Fiyat Kontrol › görseller); yoksa null */
  gorselId?: number | null;
}

interface FirmaSatir {
  firma: string;
  adet: number;
  karsilastirilan: number;
  ortalamaFark: number;
  pahaliSayisi: number;
  ucuzSayisi: number;
  esitSayisi: number;
  endeks: number | null;
  rafEndeks: number | null;
  bicardSayisi: number;
  ortalamaYuzde: number | null;
  sonOkutma: string;
  urunSayisi: number;
}

interface SubeSatir {
  sube: string | null;
  adet: number;
  pahaliSayisi: number;
  ucuzSayisi: number;
  endeks: number | null;
  okutanSayisi: number;
}

interface OkutanSatir {
  okutan: string;
  adet: number;
  sube: string | null;
  son: string;
  firmaSayisi: number;
}

interface SonDurum {
  id: number;
  barkod: string;
  urunAdi: string | null;
  firma: string | null;
  rakipFiyat: number;
  bizimFiyat: number | null;
  fark: number | null;
  farkYuzde: number | null;
  olusturma: string;
  subeKodu: string | null;
  /* İki fiyat (09.10.2026): bizimFiyat geçerli fiyat (BiCard > 0 ise BiCard, değilse raf) */
  rafFiyat: number | null;
  bicardFiyat: number | null;
  rafFark: number | null;
  rafFarkYuzde: number | null;
  fiyatTuru: "bicard" | "raf" | null;
  /** Rakibin indirimsiz (üstü çizili) fiyatı; indirim yoksa satış fiyatı */
  rakipListeFiyat?: number | null;
  /** Ürün görseli (Fiyat Kontrol › görseller); yoksa null */
  gorselId?: number | null;
}

interface Rapor {
  baslangic: string;
  bitis: string;
  toplam: number;
  karsilastirilan: number;
  karsilastirilamayan: number;
  pahaliAldigimiz: number;
  ucuzAldigimiz: number;
  esit: number;
  ortalamaFark: number;
  toplamFark: number;
  endeks: number | null;
  ortalamaYuzde: number | null;
  urunSayisi: number;
  fiyatKiyas?: FiyatKiyas;
  /** BiCard kuralına henüz çevrilmemiş eski okutmalar */
  eskiKayit?: { kalan: number; hata: string | null };
  kayitlar: Kayit[];
  firmalar: FirmaSatir[];
  subeler: SubeSatir[];
  okutanlar: OkutanSatir[];
  gunluk: { gun: string; adet: number; pahali: number; ucuz: number; esit: number; endeks: number | null }[];
  dagilim: { ad: string; yon: "ucuz" | "esit" | "pahali"; adet: number }[];
  sonDurum: SonDurum[];
  onceki: {
    toplam: number;
    pahali: number;
    karsilastirilan: number;
    endeks: number | null;
    ortalamaYuzde: number | null;
  } | null;
  secenekler: {
    firmalar: { id: number; ad: string; logo?: string | null }[];
    okutanlar: string[];
    subeler: string[];
  };
}

interface KiyasTaraf {
  karsilastirilan: number;
  pahali: number;
  ucuz: number;
  esit: number;
  endeks: number | null;
  ortalamaYuzde: number | null;
  toplamFark: number;
  ortalamaFark: number;
}

/** "BiCard ile satıyoruz / rafla satsaydık" */
interface FiyatKiyas {
  satiyoruz: KiyasTaraf;
  rafla: KiyasTaraf;
  bicardUygulanan: number;
  rafUygulanan: number;
  ortalamaBicardIndirim: number | null;
  bicardlaOneGecilen: number;
  bicardlaDaPahali: number;
  rakipIndirimde?: number;
  ortalamaRakipIndirim?: number | null;
}

type Donem = "7" | "30" | "ay" | "90" | "ozel";

interface Suzgec {
  donem: Donem;
  bas: string;
  bit: string;
  firma?: number;
  okutan?: string;
  sube?: string;
  yon?: "pahali" | "ucuz" | "esit";
  ara?: string;
  kaynak?: "mobil" | "web";
}

/* ========================================================================== */
/* Biçimler                                                                   */
/* ========================================================================== */

const tl = (v: number | null | undefined) => (v == null ? "—" : "₺" + N2.format(v));

/** Ürün görseli (12.10.2026): Fiyat Kontrol'e yüklenen kapak görseli */
const gorselAdresi = (id?: number | null) => (id ? `${API_TABAN}/api/FiyatKontrol/Gorsel/${id}` : "");

const UrunResmi = ({ id, boyut = 34 }: { id?: number | null; boyut?: number }) => {
  const [hata, setHata] = useState(false);
  return (
    <span
      style={{
        width: boyut,
        height: boyut,
        flex: "none",
        borderRadius: 8,
        border: `1px solid ${RM.line}`,
        background: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {id && !hata ? (
        <img src={gorselAdresi(id)} alt="" loading="lazy" onError={() => setHata(true)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      ) : (
        <span style={{ width: boyut * 0.42, height: boyut * 0.42, borderRadius: 4, background: RM.line }} />
      )}
    </span>
  );
};
const yuzde = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}%${N1.format(Math.abs(v))}`;
const tarih = (v: string) => dayjs(v).format("DD.MM.YYYY");
const tarihSaat = (v: string) => dayjs(v).format("DD.MM.YY HH:mm");
const oran = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Endeks rozeti: 100'ün üstü pahalı (kırmızı), altı ucuz (yeşil) */
const EndeksHap = ({ v }: { v: number | null | undefined }) =>
  v == null ? (
    <span className="rm-hap">—</span>
  ) : (
    <span className={`rm-hap ${v > 100.5 ? "bad" : v < 99.5 ? "good" : "info"}`}>{N1.format(v)}</span>
  );

/** Fark rozeti: pozitif = biz pahalı */
const FarkHap = ({ yuzdeV, tutar }: { yuzdeV: number | null; tutar?: number | null }) =>
  yuzdeV == null ? (
    <span className="rm-hap">karşılaştırılamadı</span>
  ) : (
    <span className={`rm-hap ${yuzdeV > 0 ? "bad" : yuzdeV < 0 ? "good" : "info"}`} title={tutar != null ? tl(tutar) : undefined}>
      {yuzdeV === 0 ? "eşit" : yuzde(yuzdeV)}
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

const PuanFarki = ({ simdi, once }: { simdi: number | null | undefined; once: number | null | undefined }) => {
  if (simdi == null || once == null) return <span className="rm-delta flat">—</span>;
  const d = simdi - once;
  const sinif = Math.abs(d) < 0.05 ? "flat" : d > 0 ? "down" : "up"; /* endeks artışı kötü */
  return (
    <span className={`rm-delta ${sinif}`} title="Önceki eş uzunluktaki döneme göre (puan)">
      {d >= 0 ? "▲" : "▼"} {N1.format(Math.abs(d))} puan
    </span>
  );
};

const AdetFarki = ({ simdi, once }: { simdi: number; once: number | null | undefined }) => {
  if (once == null || once === 0) return <span className="rm-delta flat">—</span>;
  const d = (simdi - once) / once;
  return (
    <span className={`rm-delta ${Math.abs(d) < 0.005 ? "flat" : d > 0 ? "up" : "down"}`} title="Önceki eş uzunluktaki döneme göre">
      {d >= 0 ? "▲" : "▼"} %{N0.format(Math.abs(d) * 100)}
    </span>
  );
};

/* ========================================================================== */
/* Dönem                                                                      */
/* ========================================================================== */

const iso = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");

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

const ANAHTAR = "b360.rakipfiyat.suzgec";

function suzgecOku(): Suzgec {
  const bos: Suzgec = { donem: "30", bas: iso(dayjs().subtract(29, "day")), bit: iso(dayjs()) };
  try {
    const h = JSON.parse(localStorage.getItem(ANAHTAR) ?? "null");
    return h ? { ...bos, donem: h.donem ?? "30", bas: h.bas ?? bos.bas, bit: h.bit ?? bos.bit } : bos;
  } catch {
    return bos;
  }
}

/* ========================================================================== */
/* Sayfa                                                                      */
/* ========================================================================== */

export default function RakipFiyat() {
  const [suzgec, setSuzgec] = useState<Suzgec>(suzgecOku);
  const [veri, setVeri] = useState<Rapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [araMetni, setAraMetni] = useState("");
  const [urun, setUrun] = useState<{ barkod: string; ad: string | null } | null>(null);
  const kopya: Kopya = useRef({});
  /* Sekmeler (12.10.2026): ilk açılışta iki kaynak birlikte; mağaza ve web
     ayrı sayfalarda da görülebiliyor. Kaynak süzgeci sekmeden geliyor. */
  const [sekme, setSekme] = useState<"tumu" | "mobil" | "web" | "eslestirme">("tumu");
  const sekmeSec = (k: "tumu" | "mobil" | "web" | "eslestirme") => {
    setSekme(k);
    if (k !== "eslestirme") setSuzgec((o) => ({ ...o, kaynak: k === "tumu" ? undefined : k }));
  };

  const [bas, bit] = donemAraligi(suzgec);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      const q = new URLSearchParams({ bas, bit });
      if (suzgec.firma) q.set("firma", String(suzgec.firma));
      if (suzgec.okutan) q.set("okutan", suzgec.okutan);
      if (suzgec.sube) q.set("sube", suzgec.sube);
      if (suzgec.yon) q.set("yon", suzgec.yon);
      if (suzgec.ara) q.set("ara", suzgec.ara);
      if (suzgec.kaynak) q.set("kaynak", suzgec.kaynak);

      setVeri(await api.getir<Rapor>(`RakipFiyat/Rapor?${q.toString()}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Rapor alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [bas, bit, suzgec.firma, suzgec.okutan, suzgec.sube, suzgec.yon, suzgec.ara, suzgec.kaynak]);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    try {
      localStorage.setItem(ANAHTAR, JSON.stringify({ donem: suzgec.donem, bas: suzgec.bas, bit: suzgec.bit }));
    } catch {
      /* tarayıcı saklamaya izin vermiyorsa her açılışta son 30 gün */
    }
  }, [suzgec.donem, suzgec.bas, suzgec.bit]);

  const degistir = (d: Partial<Suzgec>) => setSuzgec((o) => ({ ...o, ...d }));

  const firmaAdi = (id?: number) => veri?.secenekler.firmalar.find((f) => f.id === id)?.ad ?? String(id);

  /* Rakip logoları (12.10.2026): ada göre; satırlarda firma adıyla geliyor */
  const rakip = (ad?: string | null, kalin = false) => {
    const f = veri?.secenekler.firmalar.find((x) => x.ad === ad);
    return <RakipAdi id={f?.id} ad={ad} logo={f?.logo} kalin={kalin} />;
  };
  const firmaSec = (ad: string) => {
    const id = veri?.secenekler.firmalar.find((f) => f.ad === ad)?.id;
    if (id) degistir({ firma: suzgec.firma === id ? undefined : id });
  };

  const cipler: [string, string, () => void][] = [
    ...(suzgec.firma ? [["firma", `Firma: ${firmaAdi(suzgec.firma)}`, () => degistir({ firma: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.sube ? [["sube", `Mağaza: ${suzgec.sube}`, () => degistir({ sube: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.okutan ? [["okutan", `Okutan: ${suzgec.okutan}`, () => degistir({ okutan: undefined })] as [string, string, () => void]] : []),
    ...(suzgec.yon
      ? [["yon", { pahali: "Pahalı olduğumuz", ucuz: "Ucuz olduğumuz", esit: "Eşit" }[suzgec.yon], () => degistir({ yon: undefined })] as [string, string, () => void]]
      : []),
    ...(suzgec.ara ? [["ara", `“${suzgec.ara}”`, () => { setAraMetni(""); degistir({ ara: undefined }); }] as [string, string, () => void]] : []),
  ];

  const temizle = () => {
    setAraMetni("");
    setSuzgec((o) => ({ donem: o.donem, bas: o.bas, bit: o.bit, kaynak: o.kaynak }));
  };

  /* ------------------------------------------------------------ dışa aktar */
  const disaAktar = () => {
    if (!veri?.kayitlar?.length) return message.info("Aktarılacak kayıt yok.");

    const basliklar = ["Tarih", "Firma", "Ürün", "Barkod", "Stok kodu", "Rakip fiyat", "Rakip indirimsiz", "Bizim fiyat", "Fiyat türü", "Fark", "Fark %", "Raf fiyatı", "BiCard fiyatı", "Rafla fark", "Rafla fark %", "Mağaza", "Okutan", "Not"];
    const satirlar = veri.kayitlar.map((k) => [
      dayjs(k.olusturma).format("DD.MM.YYYY HH:mm"),
      k.firma ?? "",
      k.urunAdi ?? "",
      k.barkod,
      k.stokKodu ?? "",
      k.rakipFiyat,
      k.rakipListeFiyat ?? "",
      k.bizimFiyat ?? "",
      k.fiyatTuru === "bicard" ? "BiCard" : k.fiyatTuru === "raf" ? "Raf" : "",
      k.fark ?? "",
      k.farkYuzde ?? "",
      k.rafFiyat ?? "",
      k.bicardFiyat ?? "",
      k.rafFark ?? "",
      k.rafFarkYuzde ?? "",
      k.subeKodu ?? "",
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
    bag.download = `rakip-fiyat-${bas}_${bit}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
  };

  const [eskiGuncelleniyor, setEskiGuncelleniyor] = useState(false);
  const eskileriGuncelle = async () => {
    setEskiGuncelleniyor(true);
    try {
      const c = await api.gonder<{ guncellenen: number }>("RakipFiyat/FiyatlariGuncelle", {});
      message.success(`${N0.format(c?.guncellenen ?? 0)} okutma BiCard fiyatına göre güncellendi.`);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Güncellenemedi.");
    } finally {
      setEskiGuncelleniyor(false);
    }
  };

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

  /* ------------------------------------------------------------ hesaplar */
  const V = veri;
  const O = V?.onceki;

  const pahalilar = useMemo(
    () =>
      [...(V?.sonDurum ?? [])]
        .filter((x) => (x.farkYuzde ?? 0) > 0)
        .sort((a, b) => (b.farkYuzde ?? 0) - (a.farkYuzde ?? 0)),
    [V]
  );
  const ucuzlar = useMemo(
    () =>
      [...(V?.sonDurum ?? [])]
        .filter((x) => (x.farkYuzde ?? 0) < 0)
        .sort((a, b) => (a.farkYuzde ?? 0) - (b.farkYuzde ?? 0)),
    [V]
  );

  const kpi: KpiVeri[] = V
    ? [
        {
          l: "Bundan satıyoruz · BiCard",
          v: V.endeks == null ? "—" : N1.format(V.endeks),
          k: "endeks · rakibin indirimli fiyatına göre (100 = aynı)",
          d: <PuanFarki simdi={V.endeks} once={O?.endeks} />,
        },
        {
          l: "Rafla satsaydık",
          v: V.fiyatKiyas?.rafla.endeks == null ? "—" : N1.format(V.fiyatKiyas.rafla.endeks),
          k: "endeks · rakibin indirimsiz fiyatına göre",
          d: "",
        },
        {
          l: "Rakipte indirimdeki ürün",
          v: `%${N0.format(oran(V.fiyatKiyas?.rakipIndirimde ?? 0, V.toplam) * 100)}`,
          k: `${N0.format(V.fiyatKiyas?.rakipIndirimde ?? 0)} / ${N0.format(V.toplam)} okutma${
            V.fiyatKiyas?.ortalamaRakipIndirim != null ? ` · ortalama indirim %${N1.format(V.fiyatKiyas.ortalamaRakipIndirim)}` : ""
          }`,
          d: "",
        },
        {
          l: "BiCard ile öne geçtiğimiz",
          v: `${N0.format(V.fiyatKiyas?.bicardlaOneGecilen ?? 0)} ürün`,
          k: "rafla pahalıyken BiCard ile aynı ya da ucuz",
          d: (V.fiyatKiyas?.bicardlaOneGecilen ?? 0) > 0 ? <span className="rm-hap good">BiCard etkisi</span> : "",
        },
        {
          l: "Okutma",
          v: N0.format(V.toplam),
          sp: <Kivilcim veri={V.gunluk.map((g) => g.adet)} />,
          k: `${N0.format(V.urunSayisi)} ürün · ${N0.format(V.firmalar.length)} firma`,
          d: <AdetFarki simdi={V.toplam} once={O?.toplam} />,
        },
        {
          l: "Karşılaştırılamayan",
          v: N0.format(V.karsilastirilamayan),
          k: "bizde bulunmayan ya da fiyatı olmayan",
          d: V.karsilastirilamayan > 0 ? <span className="rm-hap warn">kontrol edin</span> : "",
        },
      ]
    : [];

  /* ------------------------------------------------------------- tablolar */
  const firmaSutun: Sutun<FirmaSatir>[] = [
    { k: "firma", l: "Rakip firma", f: (x) => rakip(x.firma, true), tx: (x) => x.firma },
    { k: "adet", l: "Okutma", num: true, f: (x) => N0.format(x.adet) },
    { k: "endeks", l: "Endeks", num: true, sv: (x) => x.endeks ?? 0, f: (x) => <EndeksHap v={x.endeks} />, tx: (x) => x.endeks ?? "" },
    { k: "rafEndeks", l: "Rafla", num: true, sv: (x) => x.rafEndeks ?? 0, f: (x) => <EndeksHap v={x.rafEndeks} />, tx: (x) => x.rafEndeks ?? "" },
    {
      k: "konum",
      l: "Konum",
      sv: (x) => oran(x.pahaliSayisi, x.karsilastirilan),
      f: (x) => <KonumCubugu p={x.pahaliSayisi} e={x.esitSayisi} u={x.ucuzSayisi} />,
      tx: (x) => `${x.pahaliSayisi} pahalı / ${x.ucuzSayisi} ucuz`,
    },
    { k: "ortalamaYuzde", l: "Ort. fark", num: true, sv: (x) => x.ortalamaYuzde ?? 0, f: (x) => <FarkHap yuzdeV={x.ortalamaYuzde} /> },
    { k: "sonOkutma", l: "Son okutma", soluk: true, sv: (x) => x.sonOkutma, f: (x) => tarih(x.sonOkutma), tx: (x) => tarih(x.sonOkutma) },
  ];

  const urunSutun = (yon: "pahali" | "ucuz"): Sutun<SonDurum>[] => [
    {
      k: "urunAdi",
      l: "Ürün",
      sv: (x) => x.urunAdi ?? "",
      f: (x) => (
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <UrunResmi id={x.gorselId} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{x.urunAdi ?? "—"}</div>
            <small style={{ color: RM.muted }}>{x.barkod}</small>
          </div>
        </div>
      ),
      tx: (x) => `${x.urunAdi ?? ""} (${x.barkod})`,
    },
    { k: "firma", l: "Rakip", sv: (x) => x.firma ?? "", f: (x) => rakip(x.firma), tx: (x) => x.firma ?? "" },
    { k: "rakipFiyat", l: "Rakip", num: true, f: (x) => <RakipFiyati x={x} />, tx: (x) => x.rakipFiyat },
    { k: "bizimFiyat", l: "Biz", num: true, sv: (x) => x.bizimFiyat ?? 0, f: (x) => <BizimFiyat x={x} />, tx: (x) => x.bizimFiyat ?? "" },
    {
      k: "farkYuzde",
      l: yon === "pahali" ? "Pahalıyız" : "Ucuzuz",
      num: true,
      sv: (x) => x.farkYuzde ?? 0,
      f: (x) => <FarkHap yuzdeV={x.farkYuzde} tutar={x.fark} />,
    },
    {
      k: "rafFarkYuzde",
      l: "Rafla",
      num: true,
      sv: (x) => x.rafFarkYuzde ?? 0,
      f: (x) => (x.rafFarkYuzde !== x.farkYuzde || x.rafFark !== x.fark ? <FarkHap yuzdeV={x.rafFarkYuzde} tutar={x.rafFark} /> : <span style={{ color: RM.muted }}>aynı</span>),
      tx: (x) => x.rafFarkYuzde ?? "",
    },
  ];

  const subeSutun: Sutun<SubeSatir>[] = [
    { k: "sube", l: "Mağaza", sv: (x) => x.sube ?? "", f: (x) => <b>{x.sube ?? "Belirtilmemiş"}</b> },
    { k: "adet", l: "Okutma", num: true, f: (x) => N0.format(x.adet) },
    { k: "okutanSayisi", l: "Okutan", num: true },
    { k: "endeks", l: "Endeks", num: true, sv: (x) => x.endeks ?? 0, f: (x) => <EndeksHap v={x.endeks} />, tx: (x) => x.endeks ?? "" },
    {
      k: "konum",
      l: "Konum",
      sv: (x) => oran(x.pahaliSayisi, x.pahaliSayisi + x.ucuzSayisi),
      f: (x) => <KonumCubugu p={x.pahaliSayisi} e={0} u={x.ucuzSayisi} />,
      tx: (x) => `${x.pahaliSayisi} pahalı / ${x.ucuzSayisi} ucuz`,
    },
  ];

  const okutanSutun: Sutun<OkutanSatir>[] = [
    { k: "okutan", l: "Okutan", f: (x) => <b>{x.okutan}</b> },
    { k: "sube", l: "Mağaza", soluk: true, sv: (x) => x.sube ?? "", f: (x) => x.sube ?? "—" },
    { k: "adet", l: "Okutma", num: true, f: (x) => N0.format(x.adet) },
    { k: "firmaSayisi", l: "Firma", num: true },
    { k: "son", l: "Son okutma", soluk: true, sv: (x) => x.son, f: (x) => tarihSaat(x.son), tx: (x) => tarihSaat(x.son) },
  ];

  const okutmaSutun: Sutun<Kayit>[] = [
    { k: "olusturma", l: "Tarih", soluk: true, sv: (x) => x.olusturma, f: (x) => tarihSaat(x.olusturma), tx: (x) => tarihSaat(x.olusturma) },
    {
      k: "urunAdi",
      l: "Ürün",
      sv: (x) => x.urunAdi ?? "",
      f: (x) => (
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <UrunResmi id={x.gorselId} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{x.urunAdi ?? <span style={{ color: RM.warn }}>Stokta bulunamadı</span>}</div>
          <small style={{ color: RM.muted }}>
            {x.kaynak === "web" && (
              <span className="rm-hap info" style={{ marginRight: 6, fontSize: 10.5, padding: "0 6px" }}>
                web
              </span>
            )}
            {x.barkod}
            {x.notMetni ? ` · ${x.notMetni}` : ""}
            {x.webLink && (
              <>
                {" · "}
                <a href={x.webLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  sayfa
                </a>
              </>
            )}
          </small>
        </div>
        </div>
      ),
      tx: (x) => x.urunAdi ?? "",
    },
    {
      k: "kaynak",
      l: "Kaynak",
      soluk: true,
      sv: (x) => (x.kaynak === "web" ? "web" : "mağaza"),
      f: (x) => (x.kaynak === "web" ? <span className="rm-hap info">web</span> : <span className="rm-hap">mağaza</span>),
    },
    { k: "firma", l: "Rakip", sv: (x) => x.firma ?? "", f: (x) => rakip(x.firma), tx: (x) => x.firma ?? "" },
    { k: "rakipFiyat", l: "Rakip indirimli", num: true, f: (x) => <b>{tl(x.rakipFiyat)}</b>, tx: (x) => x.rakipFiyat },
    {
      k: "rakipListeFiyat",
      l: "Rakip indirimsiz",
      num: true,
      sv: (x) => x.rakipListeFiyat ?? x.rakipFiyat,
      f: (x) =>
        x.rakipListeFiyat != null && x.rakipListeFiyat > x.rakipFiyat + 0.004 ? (
          <span>
            <s style={{ color: RM.muted }}>{tl(x.rakipListeFiyat)}</s>{" "}
            <span style={{ fontSize: 11.5, color: RM.warn, fontWeight: 700 }}>
              −%{N0.format(((x.rakipListeFiyat - x.rakipFiyat) / x.rakipListeFiyat) * 100)}
            </span>
          </span>
        ) : (
          <span style={{ color: RM.muted }}>indirim yok</span>
        ),
      tx: (x) => x.rakipListeFiyat ?? "",
    },
    {
      k: "bicardFiyat",
      l: "BiCard",
      num: true,
      sv: (x) => (x.fiyatTuru === "bicard" ? x.bicardFiyat ?? 0 : 0),
      f: (x) => (x.fiyatTuru === "bicard" ? <b style={{ color: RM.good }}>{tl(x.bicardFiyat)}</b> : <span style={{ color: RM.muted }}>—</span>),
      tx: (x) => (x.fiyatTuru === "bicard" ? x.bicardFiyat ?? "" : ""),
    },
    { k: "rafFiyat", l: "Raf", num: true, sv: (x) => x.rafFiyat ?? 0, f: (x) => tl(x.rafFiyat), tx: (x) => x.rafFiyat ?? "" },
    {
      k: "farkYuzde",
      l: "BiCard ↔ indirimli",
      num: true,
      sv: (x) => x.farkYuzde ?? -999,
      f: (x) => (
        <span title={x.fiyatTuru === "raf" ? "BiCard fiyatı yok; raf fiyatıyla" : undefined}>
          <FarkHap yuzdeV={x.farkYuzde} tutar={x.fark} />
          {x.fiyatTuru === "raf" && <small style={{ color: RM.muted, marginLeft: 4 }}>raf</small>}
        </span>
      ),
      tx: (x) => x.farkYuzde ?? "",
    },
    {
      k: "rafFarkYuzde",
      l: "Raf ↔ indirimsiz",
      num: true,
      sv: (x) => x.rafFarkYuzde ?? -999,
      f: (x) => <FarkHap yuzdeV={x.rafFarkYuzde} tutar={x.rafFark} />,
      tx: (x) => x.rafFarkYuzde ?? "",
    },
    { k: "subeKodu", l: "Mağaza", soluk: true, sv: (x) => x.subeKodu ?? "", f: (x) => x.subeKodu ?? "—" },
    { k: "personelAdi", l: "Okutan", soluk: true, sv: (x) => x.personelAdi ?? "", f: (x) => x.personelAdi ?? "—" },
  ];

  const DAGILIM_RENK: Record<string, string[]> = {
    ucuz: [RM.good, saydam(RM.good, 0.8), saydam(RM.good, 0.6), saydam(RM.good, 0.42)],
    esit: [saydam(RM.muted, 0.5)],
    pahali: [saydam(RM.bad, 0.42), saydam(RM.bad, 0.6), saydam(RM.bad, 0.8), RM.bad],
  };
  const dagilimRenk = (V?.dagilim ?? []).map((d, i, l) => {
    const ayni = l.slice(0, i).filter((x) => x.yon === d.yon).length;
    return DAGILIM_RENK[d.yon][Math.min(ayni, DAGILIM_RENK[d.yon].length - 1)];
  });

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

  return (
    <div className="rm">
      <div className="rm-ust">
        <div>
          <h1>Rakip Fiyat Analizi</h1>
          <div className="rm-alt">
            Mağazada okutulan ve rakip web sitelerinden alınan fiyatlar ile satış fiyatımızın karşılaştırması · {tarih(bas)} – {tarih(bit)}
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

      <nav className="rm-sekmeler" role="tablist" aria-label="Rakip fiyat sayfaları">
        {(
          [
            ["tumu", "Tümü · mağaza + web"],
            ["mobil", "Mağaza okutmaları"],
            ["web", "Web fiyatları"],
            ["eslestirme", "Web eşleştirme"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sekme === k} onClick={() => sekmeSec(k)}>
            {l}
          </button>
        ))}
      </nav>

      {sekme === "eslestirme" ? (
        <RakipWebFiyat degisti={getir} />
      ) : (
      <>
      {/* ---------------------------------------------------------- süzgeç */}
      <div className="rm-suzgec">
        <div className="rm-alan">
          <label htmlFor="rfDonem">Dönem</label>
          <select
            id="rfDonem"
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
        {/* Tarih aralığı her zaman görünür (12.10.2026); değiştirmek dönemi "özel" yapar */}
        <div className="rm-alan">
          <label htmlFor="rfBas">Başlangıç</label>
          <input
            id="rfBas"
            type="date"
            value={bas}
            max={bit}
            onChange={(e) => e.target.value && degistir({ donem: "ozel", bas: e.target.value, bit })}
          />
        </div>
        <div className="rm-alan">
          <label htmlFor="rfBit">Bitiş</label>
          <input
            id="rfBit"
            type="date"
            value={bit}
            min={bas}
            max={iso(dayjs())}
            onChange={(e) => e.target.value && degistir({ donem: "ozel", bas, bit: e.target.value })}
          />
        </div>
        <div className="rm-alan">
          <label htmlFor="rfFirma">Rakip firma</label>
          <select id="rfFirma" value={suzgec.firma ?? ""} onChange={(e) => degistir({ firma: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Tüm firmalar</option>
            {(V?.secenekler.firmalar ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.ad}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="rfSube">Mağaza</label>
          <select id="rfSube" value={suzgec.sube ?? ""} onChange={(e) => degistir({ sube: e.target.value || undefined })}>
            <option value="">Tüm mağazalar</option>
            {(V?.secenekler.subeler ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="rfOkutan">Okutan</label>
          <select id="rfOkutan" value={suzgec.okutan ?? ""} onChange={(e) => degistir({ okutan: e.target.value || undefined })}>
            <option value="">Herkes</option>
            {(V?.secenekler.okutanlar ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="rfAra">Ürün</label>
          <input
            id="rfAra"
            type="search"
            placeholder="Ad, barkod, stok kodu · Enter"
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
            Firma, mağaza ve okutan satırlarına tıklayarak süzebilir; ürüne tıklayarak bütün rakip fiyatlarını görebilirsiniz.
          </span>
        )}
      </div>

      {!V ? (
        <Bekle hata={hata} metin="Rakip fiyatlar okunuyor…" />
      ) : (
        <>
          {V.eskiKayit && (V.eskiKayit.kalan > 0 || V.eskiKayit.hata) && (
            <div
              style={{
                padding: "10px 14px",
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                textAlign: "left",
                border: `1px solid ${RM.warn}`,
                borderRadius: 10,
                background: saydam(RM.warn, 0.08),
              }}
            >
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <b>{N0.format(V.eskiKayit.kalan)} eski okutma henüz BiCard fiyatına göre güncellenmedi.</b>
                {V.eskiKayit.hata && (
                  <div style={{ color: RM.bad, fontSize: 12.5, marginTop: 4 }}>Sebep: {V.eskiKayit.hata}</div>
                )}
              </div>
              <button className="rm-dugme" disabled={eskiGuncelleniyor} onClick={eskileriGuncelle}>
                <RefreshCw size={13} className={eskiGuncelleniyor ? "rm-don" : undefined} /> Şimdi güncelle
              </button>
            </div>
          )}

          <Kpiler liste={kpi} yukleniyor={yukleniyor} />

          <div className="rm-izgara">
            {V.fiyatKiyas && <FiyatKiyasKarti k={V.fiyatKiyas} />}

            <Kart
              sinif="c8"
              baslik="Günlük okutma"
              ipucu="her gün okutulan ürünlerde konumumuz"
              araclar={<Lejant l={[["Pahalı", RM.bad], ["Eşit", saydam(RM.muted, 0.5)], ["Ucuz", RM.good]]} />}
            >
              <CubukGrafik
                etiketler={V.gunluk.map((g) => dayjs(g.gun).format("DD.MM"))}
                seriler={[
                  { ad: "Pahalı", veri: V.gunluk.map((g) => g.pahali), renk: RM.bad },
                  { ad: "Eşit", veri: V.gunluk.map((g) => g.esit), renk: saydam(RM.muted, 0.5) },
                  { ad: "Ucuz", veri: V.gunluk.map((g) => g.ucuz), renk: RM.good },
                ]}
                bicim={(v) => N0.format(v)}
                eksenBicim={(v) => N0.format(v)}
                ipucuEk={(i) => (
                  <div style={{ marginTop: 4 }}>
                    {N0.format(V.gunluk[i].adet)} okutma · endeks {V.gunluk[i].endeks == null ? "—" : N1.format(V.gunluk[i].endeks!)}
                  </div>
                )}
              />
            </Kart>

            <Kart sinif="c4" baslik="Konumumuz" ipucu="dönemdeki bütün okutmalar">
              <HalkaGrafik
                bicim={(v) => N0.format(v)}
                dilimler={[
                  { ad: "Pahalı", deger: V.pahaliAldigimiz, renk: RM.bad },
                  { ad: "Eşit", deger: V.esit, renk: saydam(RM.muted, 0.5) },
                  { ad: "Ucuz", deger: V.ucuzAldigimiz, renk: RM.good },
                  { ad: "Karşılaştırılamadı", deger: V.karsilastirilamayan, renk: RM.warn },
                ]}
              />
            </Kart>

            <Kart sinif="c7" baslik="Rakip firmalar" ipucu="satıra tıklayınca süzülür" araclar={<KopyaDugme id="firma" />}>
              <Tablo<FirmaSatir>
                id="firma"
                kopya={kopya}
                sutunlar={firmaSutun}
                satirlar={V.firmalar}
                varsayilan="adet"
                limit={10}
                tikla={(x) => firmaSec(x.firma)}
                secili={(x) => firmaAdi(suzgec.firma) === x.firma}
              />
            </Kart>

            <Kart sinif="c5" baslik="Fark dağılımı" ipucu="(bizim − rakip) / rakip">
              <CubukGrafik
                etiketler={V.dagilim.map((d) => d.ad)}
                seriler={[{ ad: "Okutma", veri: V.dagilim.map((d) => d.adet), renk: dagilimRenk }]}
                bicim={(v) => N0.format(v)}
                eksenBicim={(v) => N0.format(v)}
                yatay
                yukseklik={300}
                tikla={(i) => {
                  const y = V.dagilim[i]?.yon;
                  if (y) degistir({ yon: suzgec.yon === y ? undefined : y });
                }}
              />
            </Kart>

            <Kart sinif="c6" baslik="En pahalı olduğumuz ürünler" ipucu="her ürün ve firma için son okutma" araclar={<KopyaDugme id="pahali" />}>
              <Tablo<SonDurum>
                id="pahali"
                kopya={kopya}
                sutunlar={urunSutun("pahali")}
                satirlar={pahalilar}
                limit={10}
                tikla={(x) => setUrun({ barkod: x.barkod, ad: x.urunAdi })}
              />
            </Kart>

            <Kart sinif="c6" baslik="En ucuz olduğumuz ürünler" ipucu="her ürün ve firma için son okutma" araclar={<KopyaDugme id="ucuz" />}>
              <Tablo<SonDurum>
                id="ucuz"
                kopya={kopya}
                sutunlar={urunSutun("ucuz")}
                satirlar={ucuzlar}
                limit={10}
                tikla={(x) => setUrun({ barkod: x.barkod, ad: x.urunAdi })}
              />
            </Kart>

            <Kart sinif="c6" baslik="Mağazalar" ipucu="okutmanın yapıldığı mağaza" araclar={<KopyaDugme id="sube" />}>
              <Tablo<SubeSatir>
                id="sube"
                kopya={kopya}
                sutunlar={subeSutun}
                satirlar={V.subeler}
                varsayilan="adet"
                limit={10}
                tikla={(x) => x.sube && degistir({ sube: suzgec.sube === x.sube ? undefined : x.sube })}
                secili={(x) => suzgec.sube === x.sube}
              />
            </Kart>

            <Kart sinif="c6" baslik="Okutanlar" araclar={<KopyaDugme id="okutan" />}>
              <Tablo<OkutanSatir>
                id="okutan"
                kopya={kopya}
                sutunlar={okutanSutun}
                satirlar={V.okutanlar}
                varsayilan="adet"
                limit={10}
                tikla={(x) => degistir({ okutan: suzgec.okutan === x.okutan ? undefined : x.okutan })}
                secili={(x) => suzgec.okutan === x.okutan}
              />
            </Kart>

            <Kart
              sinif="c12"
              baslik={`Okutmalar (${N0.format(V.kayitlar.length)})`}
              ipucu="ürüne tıklayınca bütün rakip fiyatları açılır"
              araclar={<KopyaDugme id="okutma" />}
            >
              <Tablo<Kayit>
                id="okutma"
                kopya={kopya}
                sutunlar={okutmaSutun}
                satirlar={V.kayitlar}
                varsayilan="olusturma"
                limit={25}
                suzgec
                tikla={(x) => setUrun({ barkod: x.barkod, ad: x.urunAdi })}
              />
            </Kart>
          </div>

          <div className="rm-dipnot">
            Fiyatımız okutma anındaki satış fiyatıdır ve kayda yazılır; sonradan fiyat değişse de geçmiş karşılaştırma değişmez.
            Satış fiyatı BiCard fiyatıdır; BiCard fiyatı tanımlı değilse ya da sıfırsa raf fiyatıdır. "Rafla" sütunları aynı
            okutmanın raf fiyatıyla karşılaştırmasıdır. Fiyatlar Fiyat Kontrol ekranıyla aynı yerden okunur: okutmanın yapıldığı
            şubenin fiyatı, yoksa genel fiyat. 09.10.2026'dan önceki okutmalarda BiCard fiyatı o gün kaydedilmediği için raf ve
            BiCard fiyatı güncellendikleri andaki Mikro fiyatıdır.
            Endeks ve konum önceki eş uzunluktaki dönemle kıyaslanır.
          </div>
        </>
      )}
      </>
      )}

      <UrunGecmisi urun={urun} kayitlar={V?.kayitlar ?? []} kapat={() => setUrun(null)} rakip={rakip} />
    </div>
  );
}

/* ========================================================================== */
/* BiCard / raf                                                               */
/* ========================================================================== */

/** Rakip satış (indirimli) fiyatı; indirimsiz fiyatı farklıysa üstü çizili altında */
function RakipFiyati({ x }: { x: { rakipFiyat: number; rakipListeFiyat?: number | null } }) {
  const liste = x.rakipListeFiyat;
  return (
    <span>
      {tl(x.rakipFiyat)}
      {liste != null && liste > x.rakipFiyat + 0.004 && (
        <div style={{ fontSize: 11, color: RM.muted, textDecoration: "line-through" }}>{tl(liste)}</div>
      )}
    </span>
  );
}

/** Bizim fiyat; BiCard uygulanıyorsa küçük rozetle ve raf fiyatı ipucunda */
function BizimFiyat({ x }: { x: { bizimFiyat: number | null; fiyatTuru?: string | null; rafFiyat?: number | null } }) {
  if (x.bizimFiyat == null) return <>—</>;
  return (
    <span title={x.fiyatTuru === "bicard" && x.rafFiyat != null ? `Raf fiyatı ${tl(x.rafFiyat)}` : undefined}>
      {tl(x.bizimFiyat)}
      {x.fiyatTuru === "bicard" && (
        <span className="rm-hap good" style={{ marginLeft: 6, fontSize: 10.5, padding: "0 6px" }}>
          BiCard
        </span>
      )}
    </span>
  );
}

/**
 * "Bundan satıyoruz / bundan satsaydık" (09.10.2026): aynı okutmalar geçerli
 * fiyatla (BiCard, yoksa raf) ve raf fiyatıyla.
 */
function FiyatKiyasKarti({ k }: { k: FiyatKiyas }) {
  const Panel = ({ baslik, t, vurgu }: { baslik: string; t: KiyasTaraf; vurgu?: boolean }) => {
    const top = t.pahali + t.esit + t.ucuz;
    const y = (n: number) => (top ? (n / top) * 100 : 0);
    return (
      <div
        style={{
          flex: "1 1 320px",
          minWidth: 0,
          border: `${vurgu ? 1.5 : 1}px solid ${vurgu ? saydam(RM.good, 0.55) : RM.line}`,
          background: vurgu ? saydam(RM.good, 0.04) : undefined,
          borderRadius: 12,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <b style={{ fontSize: 13.5 }}>{baslik}</b>
          <span style={{ fontSize: 12.5, color: RM.muted }}>
            endeks <EndeksHap v={t.endeks} />
          </span>
        </div>
        <div
          style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: RM.line }}
          role="img"
          aria-label={`Pahalı ${t.pahali}, eşit ${t.esit}, ucuz ${t.ucuz}`}
        >
          <i style={{ width: `${y(t.pahali)}%`, background: RM.bad }} />
          <i style={{ width: `${y(t.esit)}%`, background: saydam(RM.muted, 0.5) }} />
          <i style={{ width: `${y(t.ucuz)}%`, background: RM.good }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontSize: 12.5, color: RM.muted }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: RM.bad }}>{N0.format(t.pahali)}</div>pahalıyız
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{N0.format(t.esit)}</div>eşitiz
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: RM.good }}>{N0.format(t.ucuz)}</div>ucuzuz
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: RM.muted }}>
          Ortalama fark <FarkHap yuzdeV={t.ortalamaYuzde} /> · ürün başına {t.ortalamaFark > 0 ? "+" : ""}
          {tl(t.ortalamaFark)} · toplam {tl(t.toplamFark)}
        </div>
      </div>
    );
  };

  return (
    <Kart sinif="c12" baslik="İki fiyatla rakibe göre durumumuz" ipucu="aynı okutmalar iki kez karşılaştırılır">
      <div style={{ fontSize: 12.5, color: RM.muted, lineHeight: 1.55, marginBottom: 10 }}>
        <b style={{ color: "inherit" }}>Bundan satıyoruz:</b> BiCard fiyatımız (yoksa raf) ↔ rakibin indirimli satış
        fiyatı. <b style={{ color: "inherit" }}>Rafla satsaydık:</b> raf fiyatımız ↔ rakibin indirimsiz (üstü çizili)
        fiyatı; rakipte indirim yoksa satış fiyatı.
      </div>

      {k.bicardUygulanan === 0 && (
        <div style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 8, background: saydam(RM.warn, 0.12), marginBottom: 10 }}>
          Bu dönemdeki okutmaların hiçbirinde BiCard fiyatı yok.
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Panel baslik="Bundan satıyoruz · BiCard ↔ rakibin indirimli fiyatı" t={k.satiyoruz} vurgu />
        <Panel baslik="Rafla satsaydık · raf ↔ rakibin indirimsiz fiyatı" t={k.rafla} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <span className="rm-hap info">{N0.format(k.bicardUygulanan)} okutmada BiCard fiyatı var</span>
        <span className="rm-hap">{N0.format(k.rafUygulanan)} okutmada yalnızca raf fiyatı</span>
        {k.ortalamaBicardIndirim != null && (
          <span className="rm-hap info">BiCard rafa göre ortalama %{N1.format(k.ortalamaBicardIndirim)} düşük</span>
        )}
        {k.bicardUygulanan > 0 && (
          <>
            <span className="rm-hap good">{N0.format(k.bicardlaOneGecilen)} üründe BiCard ile rakibin önüne geçiyoruz</span>
            <span className={`rm-hap ${k.bicardlaDaPahali > 0 ? "bad" : ""}`}>
              {N0.format(k.bicardlaDaPahali)} üründe BiCard ile bile pahalıyız
            </span>
          </>
        )}
      </div>
    </Kart>
  );
}

/* ========================================================================== */
/* Ürün geçmişi                                                               */
/* ========================================================================== */

function UrunGecmisi({
  urun,
  kayitlar,
  kapat,
  rakip,
}: {
  urun: { barkod: string; ad: string | null } | null;
  kayitlar: Kayit[];
  kapat: () => void;
  rakip: (ad?: string | null) => ReactNode;
}) {
  const liste = useMemo(
    () => (urun ? kayitlar.filter((k) => k.barkod === urun.barkod).sort((a, b) => b.olusturma.localeCompare(a.olusturma)) : []),
    [urun, kayitlar]
  );

  /* Her firmanın son fiyatı + bizim son fiyatımız */
  const sonlar = useMemo(() => {
    const m = new Map<string, Kayit>();
    for (const k of liste) if (!m.has(k.firma ?? "—")) m.set(k.firma ?? "—", k);
    return [...m.values()].sort((a, b) => a.rakipFiyat - b.rakipFiyat);
  }, [liste]);

  const sonBizim = liste.find((k) => k.bizimFiyat != null);
  const bizim = sonBizim?.bizimFiyat ?? null;

  const satir = (b: ReactNode, d: ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: `1px solid ${RM.line}` }}>
      <span style={{ color: RM.muted }}>{b}</span>
      <span>{d}</span>
    </div>
  );

  return (
    <Drawer open={!!urun} onClose={kapat} width={560} title={urun?.ad ?? urun?.barkod ?? ""} destroyOnClose>
      {!urun ? (
        <Spin />
      ) : (
        <div className="rm" style={{ gap: 16 }}>
          {liste.find((k) => k.gorselId)?.gorselId ? (
            <div style={{ display: "flex", justifyContent: "center", background: "#fff", border: `1px solid ${RM.line}`, borderRadius: 12, padding: 10 }}>
              <img
                src={gorselAdresi(liste.find((k) => k.gorselId)?.gorselId)}
                alt={urun.ad ?? ""}
                style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }}
                onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")}
              />
            </div>
          ) : null}
          <div>
            {satir("Barkod", urun.barkod)}
            {satir("Stok kodu", liste[0]?.stokKodu ?? "—")}
            {satir(
              "Bizim fiyatımız (son okutma)",
              <b>
                {tl(bizim)}
                {sonBizim?.fiyatTuru === "bicard" ? " · BiCard" : ""}
              </b>
            )}
            {sonBizim?.fiyatTuru === "bicard" && satir("Raf fiyatı (rafla satsaydık)", tl(sonBizim.rafFiyat))}
            {satir("Okutma", `${liste.length} kez · ${sonlar.length} firma`)}
          </div>

          {sonlar.length > 0 && (
            <div className="rm-kart" style={{ padding: 12 }}>
              <h3 style={{ margin: "0 0 8px" }}>
                <span>Firmalara göre son fiyat</span>
              </h3>
              <CubukGrafik
                yatay
                yukseklik={Math.max(120, 44 * (sonlar.length + 1))}
                etiketler={[...(bizim != null ? ["Biçen (biz)"] : []), ...sonlar.map((s) => s.firma ?? "—")]}
                seriler={[
                  {
                    ad: "Fiyat",
                    veri: [...(bizim != null ? [bizim] : []), ...sonlar.map((s) => s.rakipFiyat)],
                    renk: [
                      ...(bizim != null ? [RM.brand] : []),
                      ...sonlar.map((s) => (bizim == null ? RM.info : s.rakipFiyat < bizim ? RM.bad : s.rakipFiyat > bizim ? RM.good : RM.muted)),
                    ],
                  },
                ]}
                bicim={(v) => "₺" + N2.format(v)}
                eksenBicim={(v) => "₺" + N0.format(v)}
              />
              <div className="rm-ipucu-metin" style={{ marginTop: 6 }}>
                Kırmızı: rakip bizden ucuz · yeşil: rakip bizden pahalı
              </div>
            </div>
          )}

          <div className="rm-tablo-kap">
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Firma</th>
                  <th className="num">Rakip</th>
                  <th className="num">Biz</th>
                  <th className="num">Fark</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((k) => (
                  <tr key={k.id}>
                    <td className="soluk">
                      {tarihSaat(k.olusturma)}
                      {k.subeKodu || k.personelAdi ? (
                        <div style={{ fontSize: 11 }}>{[k.subeKodu, k.personelAdi].filter(Boolean).join(" · ")}</div>
                      ) : null}
                    </td>
                    <td>{rakip(k.firma)}</td>
                    <td className="num">{tl(k.rakipFiyat)}</td>
                    <td className="num">
                      <BizimFiyat x={k} />
                    </td>
                    <td className="num">
                      <FarkHap yuzdeV={k.farkYuzde} tutar={k.fark} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

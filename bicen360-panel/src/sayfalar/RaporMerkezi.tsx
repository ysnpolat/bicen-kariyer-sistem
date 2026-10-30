/**
 * ---------------------------------------------------------------------------
 * Rapor Merkezi
 * ---------------------------------------------------------------------------
 * Power BI tarzı rapor sayfası: Genel Bakış, Satış Analizi, Depo & Stok,
 * Şube Karşılaştırma. Veriler canlı: ciro, kâr, fire, kategori ve şube
 * kırılımları Mikro'daki satış hareketlerinden; stok PUSULA'dan; merkez
 * depo transferleri depolar arası siparişlerden; fiş ve ödeme tipi
 * PosBack'ten (yönetici tanımladıysa).
 *
 * Süzgeçler (dönem, bölge, şube, kategori) bütün sekmelerde ortak ve
 * tarayıcıda hatırlanıyor. Grafik çubuklarına ve tablo satırlarına
 * tıklamak süzgeci değiştiriyor; tablolar sıralanıyor ve Excel'e
 * yapıştırılmak üzere kopyalanabiliyor.
 *
 * Sunucu uzun hesapları arka planda yapıyor: cevap "hazırlanıyor" ise
 * birkaç saniye sonra tekrar soruluyor.
 * ---------------------------------------------------------------------------
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Button, Drawer, Input, Popconfirm, Space, Spin, message } from "antd";
import {
  Copy,
  Database,
  LayoutDashboard,
  MapPin,
  RefreshCw,
  TrendingUp,
  Warehouse,
  X,
} from "lucide-react";

import { api } from "../api";
import {
  CizgiGrafik,
  CubukGrafik,
  DagilimGrafik,
  HalkaGrafik,
  Kivilcim,
  N0,
  N1,
  N2,
  PALET,
  PCT,
  RM,
  TL,
  saydam,
} from "../RmGrafik";
import "./RaporMerkezi.css";

/* ========================================================================== */
/* Türler                                                                     */
/* ========================================================================== */

interface SubeSecenek {
  depo: number;
  ad: string;
  bolge: string;
}

interface Secenekler {
  subeler: SubeSecenek[];
  bolgeler: string[];
  bolgesiz: number;
  gruplar: { kod: string; ad: string }[];
  kilit: { depo: number; ad: string } | null;
  kilitBulunamadi: boolean;
  admin: boolean;
  dun: string;
  bugun: string;
  kaynak: { posFis: boolean; posOdeme: boolean };
}

interface Kume {
  ciro: number;
  net: number;
  kar: number;
  fire: number;
  fis: number;
}

interface Toplam extends Kume {
  miktar: number;
  gunSayisi: number;
  gunler: number[];
  kat: (Kume & { kod: string })[];
  sube: (Kume & { depo: number })[];
  bolge: { ad: string; ciro: number }[];
  hafta: number[];
  haftaN: number[];
  isi: number[][];
  saat: number[];
  odeme: { tip: string; tutar: number }[];
}

interface Ozet {
  hazirlaniyor: boolean;
  eksik?: number;
  toplam?: number;
  durum?: string | null;
  hata?: string | null;
  donem?: { bas: string; bit: string; pbas: string | null; pbit: string | null };
  a?: Toplam;
  p?: Toplam | null;
  uyarilar?: { tur: string; metin: string }[];
  kaynak?: { posSaat: boolean; posOdeme: boolean };
}

interface Bugun {
  hazirlaniyor: boolean;
  hata?: string | null;
  saat?: string;
  ciro?: number;
  fis?: number;
  dunAyniSaat?: number | null;
}

interface UrunSatir {
  kod: string;
  barkod: string;
  ad: string;
  grup: string;
  birim: string;
  miktar: number;
  fiyat: number;
  ciro: number;
  kar: number;
  onceki: number | null;
}

interface Hazirlik {
  hazirlaniyor?: boolean;
  hata?: string | null;
}

interface StokSatir {
  depo: number;
  sube: string;
  kod: string;
  urun: string;
  barkod: string;
  birim: string;
  miktar: number;
  esik: number;
  gunluk: number;
  gun: number;
  deger: number;
  durum: string;
  renk: string;
  yokSatiyor: boolean;
}

interface StokCevap {
  stok: Hazirlik & {
    kpi?: {
      deger: number;
      kayit: number;
      ortGun: number | null;
      kritik: number;
      dusuk: number;
      fazlaDeger: number;
      fazlaKayit: number;
      tahminiPay: number;
    };
    depolar?: { depo: number; ad: string; merkez: boolean; deger: number }[];
    kategoriGun?: { kod: string; gun: number }[];
    sayac?: Record<string, number>;
    toplamSatir?: number;
    satirlar?: StokSatir[];
    merkez?: string;
    merkezHata?: string | null;
    zaman?: string;
  };
  skt: Hazirlik & {
    kaynak?: boolean;
    mesaj?: string | null;
    adet?: number;
    deger?: number;
    acil?: number;
    satirlar?: {
      depo: number;
      sube: string;
      urun: string;
      birim: string;
      miktar: number;
      skt: string;
      kalan: number;
    }[];
  };
  transfer: Hazirlik & {
    bekleyen?: number;
    yolda?: number;
    sayac?: number[];
    satirlar?: {
      belge: string;
      depo: number;
      sube: string;
      kalem: number;
      tutar: number;
      tarih: string;
      durum: number;
    }[];
  };
}

/* ========================================================================== */
/* Tarih ve dönem                                                             */
/* ========================================================================== */

const iki = (n: number) => String(n).padStart(2, "0");
const isoYaz = (d: Date) => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
const isoOku = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ekle = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const gunFarki = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5);

const fmtK = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const fmtU = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });

const GUN_ADI = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const GUN_SIRA = [1, 2, 3, 4, 5, 6, 0];

type DonemKodu = "dun" | "7" | "30" | "ay" | "90" | "ytd" | "ozel";

interface Suzgec {
  donem: DonemKodu;
  bas: string | null;
  bit: string | null;
  bolge: string;
  depo: number | null;
  grup: string;
}

const BOS_SUZGEC: Suzgec = { donem: "30", bas: null, bit: null, bolge: "", depo: null, grup: "" };

const SAKLAMA = "bicen-rapor-f";

function suzgecOku(): Suzgec {
  try {
    const s = JSON.parse(localStorage.getItem(SAKLAMA) || "null");
    if (s && typeof s === "object") return { ...BOS_SUZGEC, ...s };
  } catch {
    /* tarayıcı depolaması kapalı olabilir */
  }
  return BOS_SUZGEC;
}

function suzgecYaz(f: Suzgec) {
  try {
    localStorage.setItem(SAKLAMA, JSON.stringify(f));
  } catch {
    /* önemli değil */
  }
}

interface Aralik {
  s: Date;
  e: Date;
  ps: Date | null;
  pe: Date | null;
}

function aralik(f: Suzgec, dunStr: string): Aralik {
  const dun = isoOku(dunStr);
  let e = dun;
  let s: Date;
  let ps: Date | null = null;
  let pe: Date | null = null;

  switch (f.donem) {
    case "dun":
      s = e;
      break;
    case "7":
      s = ekle(e, -6);
      break;
    case "90":
      s = ekle(e, -89);
      break;
    case "ay":
      s = new Date(e.getFullYear(), e.getMonth(), 1);
      break;
    case "ytd": {
      s = new Date(e.getFullYear(), 0, 1);
      ps = new Date(e.getFullYear() - 1, 0, 1);
      pe = ekle(ps, gunFarki(s, e));
      break;
    }
    case "ozel": {
      s = f.bas ? isoOku(f.bas) : ekle(e, -29);
      e = f.bit ? isoOku(f.bit) : e;
      if (s > e) [s, e] = [e, s];
      if (e > dun) e = dun;
      if (s > e) s = e;
      break;
    }
    default:
      s = ekle(e, -29);
  }

  if (!ps) {
    const uz = gunFarki(s, e) + 1;
    pe = ekle(s, -1);
    ps = ekle(s, -uz);
  }

  return { s, e, ps, pe };
}

/* ========================================================================== */
/* Küçük bileşenler                                                           */
/* ========================================================================== */

const fark = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || !b ? null : (a - b) / Math.abs(b);

export function Delta({ v, ters = false }: { v: number | null | undefined; ters?: boolean }) {
  if (v == null || !Number.isFinite(v)) return <span className="rm-delta flat">—</span>;

  const iyi = ters ? v < 0 : v > 0;
  const sinif = Math.abs(v) < 0.005 ? "flat" : iyi ? "up" : "down";

  return (
    <span className={`rm-delta ${sinif}`}>
      {v >= 0 ? "▲" : "▼"} {PCT(Math.abs(v))}
    </span>
  );
}

export interface KpiVeri {
  l: string;
  v: ReactNode;
  t?: string;
  sp?: ReactNode;
  k?: ReactNode;
  d?: ReactNode;
}

export function Kpiler({ liste, yukleniyor = false }: { liste: KpiVeri[]; yukleniyor?: boolean }) {
  return (
    <div className="rm-kpiler">
      {liste.map((x) => (
        <div key={x.l} className={`rm-kpi${yukleniyor ? " yukleniyor" : ""}`}>
          <div className="l">{x.l}</div>
          <div className="satir">
            <div className="v" title={x.t ?? (typeof x.v === "string" ? x.v : undefined)}>
              {x.v}
            </div>
            {x.sp}
          </div>
          <div className="satir">
            <span className="k">{x.k}</span>
            {x.d}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Kart({
  sinif,
  baslik,
  ipucu,
  araclar,
  children,
}: {
  sinif: string;
  baslik: ReactNode;
  ipucu?: ReactNode;
  araclar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`rm-kart ${sinif}`}>
      <h3>
        <span>
          {baslik} {ipucu && <span className="rm-ipucu-metin">{ipucu}</span>}
        </span>
        {araclar && <span className="rm-araclar">{araclar}</span>}
      </h3>
      {children}
    </div>
  );
}

export function Bekle({ metin = "Hazırlanıyor…", hata }: { metin?: string; hata?: string | null }) {
  return (
    <div className="rm-bekle">
      {hata ? (
        <span style={{ color: RM.bad }}>{hata}</span>
      ) : (
        <span>
          <Spin size="small" /> &nbsp;{metin}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- tablo */

export interface Sutun<T> {
  k: string;
  l: string;
  num?: boolean;
  soluk?: boolean;
  f?: (r: T) => ReactNode;
  sv?: (r: T) => number | string;
  tx?: (r: T) => string | number;
  /** Sütun süzgecinde kutu gösterilmez (işlem düğmeleri gibi) */
  suzgecYok?: boolean;
}

/**
 * Sütun süzgeci (12.10.2026): yazıda "içerir" (Türkçe harf ve büyük/küçük
 * farkı gözetmeden); sayıda ">10", "<5", "=0", "10-20" ya da düz sayı (içerir).
 */
function suzgecUyar(deger: unknown, ifade: string): boolean {
  const q = ifade.trim();
  if (!q) return true;
  const kat = (t: string) =>
    t.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c);
  const sayi = typeof deger === "number" ? deger : null;
  const m = q.replace(",", ".").match(/^([<>]=?|=)\s*(-?\d+(?:\.\d+)?)$/);
  if (m && sayi != null) {
    const v = parseFloat(m[2]);
    return m[1] === ">" ? sayi > v : m[1] === ">=" ? sayi >= v : m[1] === "<" ? sayi < v : m[1] === "<=" ? sayi <= v : Math.abs(sayi - v) < 0.005;
  }
  const a = q.replace(/,/g, ".").match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (a && sayi != null) return sayi >= parseFloat(a[1]) && sayi <= parseFloat(a[2]);
  return kat(String(deger ?? "")).includes(kat(q));
}

export type Kopya = MutableRefObject<Record<string, () => { tsv: string; adet: number }>>;

export function Tablo<T>({
  id,
  sutunlar,
  satirlar,
  varsayilan,
  yon: varsayilanYon = -1,
  limit,
  tikla,
  secili,
  kopya,
  kontrol,
  suzgec,
}: {
  id: string;
  /** Başlığın altında sütun süzgeci satırı */
  suzgec?: boolean;
  sutunlar: Sutun<T>[];
  satirlar: T[];
  varsayilan?: string;
  yon?: number;
  limit?: number;
  tikla?: (r: T) => void;
  secili?: (r: T) => boolean;
  kopya: Kopya;
  /** Sunucuda sıralanan tablo: sıralama ve "tümü" dışarıda */
  kontrol?: {
    k: string;
    yon: number;
    degistir: (k: string) => void;
    tumu: boolean;
    tumuDegistir: () => void;
    toplam: number;
  };
}) {
  const [sira, setSira] = useState<{ k: string | null; yon: number }>({
    k: varsayilan ?? null,
    yon: varsayilanYon,
  });
  const [tumu, setTumu] = useState(false);
  const [suzgecler, setSuzgecler] = useState<Record<string, string>>({});

  const etkin = kontrol ? { k: kontrol.k, yon: kontrol.yon } : sira;
  const hepsi = kontrol ? kontrol.tumu : tumu;

  const suzulmus = useMemo(() => {
    const etkinler = Object.entries(suzgecler).filter(([, v]) => v.trim());
    if (!etkinler.length) return satirlar;
    return satirlar.filter((r) =>
      etkinler.every(([k, v]) => {
        const c = sutunlar.find((x) => x.k === k);
        if (!c) return true;
        const d = c.tx ? c.tx(r) : c.sv ? c.sv(r) : (r as Record<string, unknown>)[c.k];
        return suzgecUyar(d, v);
      })
    );
  }, [satirlar, suzgecler, sutunlar]);

  const sirali = useMemo(() => {
    if (kontrol || !sira.k) return suzulmus;

    const c = sutunlar.find((x) => x.k === sira.k);

    if (!c) return suzulmus;

    const g = c.sv ?? ((r: T) => (r as Record<string, unknown>)[c.k] as number | string);

    return [...suzulmus].sort((a, b) => {
      const x = g(a);
      const y = g(b);

      return (
        (typeof x === "string" || typeof y === "string"
          ? String(x).localeCompare(String(y), "tr")
          : (Number(x) || 0) - (Number(y) || 0)) * sira.yon
      );
    });
  }, [suzulmus, sira, sutunlar, kontrol]);

  const gosterilen = !kontrol && limit && !hepsi ? sirali.slice(0, limit) : sirali;

  const deger = (c: Sutun<T>, r: T) =>
    c.tx ? c.tx(r) : c.sv ? c.sv(r) : ((r as Record<string, unknown>)[c.k] as string | number);

  kopya.current[id] = () => ({
    adet: sirali.length,
    tsv: [
      sutunlar.map((c) => c.l).join("\t"),
      ...sirali.map((r) =>
        sutunlar
          .map((c) => {
            const v = deger(c, r);
            return typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
          })
          .join("\t")
      ),
    ].join("\n"),
  });

  const basliga = (k: string) => {
    if (kontrol) return kontrol.degistir(k);

    setSira((s) => (s.k === k ? { k, yon: -s.yon } : { k, yon: -1 }));
  };

  const toplam = kontrol ? kontrol.toplam : sirali.length;
  const sinir = kontrol ? 20 : limit;

  return (
    <>
      <div className="rm-tablo-kap">
        <table>
          <thead>
            <tr>
              {sutunlar.map((c) => (
                <th
                  key={c.k}
                  className={`${c.num ? "num " : ""}${etkin.k === c.k ? "sirali" : ""}`}
                  onClick={() => basliga(c.k)}
                >
                  {c.l}
                  <span className="ok">{etkin.k === c.k ? (etkin.yon > 0 ? "▲" : "▼") : "↕"}</span>
                </th>
              ))}
            </tr>
            {suzgec && (
              <tr className="rm-suzgec-satir">
                {sutunlar.map((c) => (
                  <th key={c.k} className={c.num ? "num" : ""}>
                    {c.suzgecYok ? null : (
                      <input
                        type="search"
                        aria-label={`${c.l} süzgeci`}
                        placeholder={c.num ? ">10, 5-20" : "süz…"}
                        value={suzgecler[c.k] ?? ""}
                        onChange={(e) => setSuzgecler((o) => ({ ...o, [c.k]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {gosterilen.length ? (
              gosterilen.map((r, i) => (
                <tr
                  key={i}
                  className={`${tikla ? "tik " : ""}${secili?.(r) ? "sec" : ""}`}
                  onClick={() => tikla?.(r)}
                >
                  {sutunlar.map((c) => (
                    <td key={c.k} className={`${c.num ? "num" : ""}${c.soluk ? " soluk" : ""}`}>
                      {c.f ? c.f(r) : String((r as Record<string, unknown>)[c.k] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={sutunlar.length} className="soluk">
                  Bu filtrelerle kayıt yok.
                  {Object.values(suzgecler).some((v) => v.trim()) && (
                    <button className="rm-dugme" style={{ marginLeft: 10 }} onClick={() => setSuzgecler({})}>
                      Sütun süzgeçlerini temizle
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sinir && toplam > sinir ? (
        <button
          className="rm-dugme rm-daha"
          onClick={() => (kontrol ? kontrol.tumuDegistir() : setTumu((x) => !x))}
        >
          {hepsi ? "Daha az göster" : `Tümünü göster (${N0.format(toplam)})`}
        </button>
      ) : null}
    </>
  );
}

const CubukHucre = ({ v, max, renk = RM.brand, gen = 90 }: { v: number; max: number; renk?: string; gen?: number }) => (
  <div className="rm-cubuk-hucre">
    <i style={{ width: Math.max(4, (max ? Math.max(0, v) / max : 0) * gen), background: renk }} />
    {TL(v, true)}
  </div>
);

/* ========================================================================== */
/* Sayfa                                                                      */
/* ========================================================================== */

type Sekme = "genel" | "satis" | "stok" | "sube";

const SEKMELER: { kod: Sekme; ad: string; simge: ReactNode }[] = [
  { kod: "genel", ad: "Genel Bakış", simge: <LayoutDashboard size={17} /> },
  { kod: "satis", ad: "Satış Analizi", simge: <TrendingUp size={17} /> },
  { kod: "stok", ad: "Depo & Stok", simge: <Warehouse size={17} /> },
  { kod: "sube", ad: "Şube Karşılaştırma", simge: <MapPin size={17} /> },
];

const ODEME_RENK = [RM.brand, RM.info, RM.orange, RM.warn, ...PALET.slice(4)];
const TR_DURUM = ["Hazırlanıyor", "Yolda", "Teslim alındı"];

function sekmeOku(): Sekme {
  const s = new URLSearchParams(window.location.search).get("sekme");
  return (["genel", "satis", "stok", "sube"] as string[]).includes(s ?? "") ? (s as Sekme) : "genel";
}

/** Bir isteği "hazırlanıyor" cevabı geldikçe aralıkla tekrarlar. */
function useYoklama<T extends { hazirlaniyor?: boolean }>(
  yol: string | null,
  aralikMs: number,
  ekTekrar?: (v: T) => boolean
) {
  const [veri, setVeri] = useState<T | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sayac, setSayac] = useState(0);

  useEffect(() => {
    if (!yol) return;

    let iptal = false;
    let zaman: ReturnType<typeof setTimeout> | undefined;

    const al = async () => {
      setYukleniyor(true);

      try {
        const v = await api.getir<T>(yol);

        if (iptal) return;

        setVeri(v);
        setHata(null);

        if (v.hazirlaniyor || ekTekrar?.(v)) zaman = setTimeout(al, aralikMs);
      } catch (e) {
        if (!iptal) setHata((e as Error).message);
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    };

    al();

    return () => {
      iptal = true;
      if (zaman) clearTimeout(zaman);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yol, sayac, aralikMs]);

  return { veri, hata, yukleniyor, tekrar: () => setSayac((x) => x + 1) };
}

export default function RaporMerkezi() {
  const [sec, setSec] = useState<Secenekler | null>(null);
  const [secHata, setSecHata] = useState<string | null>(null);
  const [F, setF] = useState<Suzgec>(suzgecOku);
  const [sekme, setSekmeDurum] = useState<Sekme>(sekmeOku);
  const [kaynakAcik, setKaynakAcik] = useState(false);
  const [yenileSayac, setYenileSayac] = useState(0);

  const kopya = useRef<Record<string, () => { tsv: string; adet: number }>>({});

  /* -------------------------------------------------- seçenekler */
  const secenekAl = useCallback((yenile = false) => {
    setSecHata(null);
    api
      .getir<Secenekler>(`RaporMerkezi/Secenekler${yenile ? "?yenile=true" : ""}`)
      .then(setSec)
      .catch((e) => setSecHata(e.message));
  }, []);

  useEffect(() => secenekAl(), [secenekAl]);

  /* Şube kilidi ve geçersiz süzgeç düzeltmesi */
  const suzgec: Suzgec = useMemo(() => {
    if (!sec) return F;

    let f = F;

    if (sec.kilit) f = { ...f, bolge: "", depo: sec.kilit.depo };
    else if (f.depo != null && !sec.subeler.some((s) => s.depo === f.depo)) f = { ...f, depo: null };

    if (f.bolge && !sec.bolgeler.includes(f.bolge)) f = { ...f, bolge: "" };
    if (f.grup && !sec.gruplar.some((g) => g.kod === f.grup)) f = { ...f, grup: "" };

    return f;
  }, [F, sec]);

  const degistir = (yeni: Partial<Suzgec>) =>
    setF((f) => {
      const n = { ...f, ...yeni };
      suzgecYaz(n);
      return n;
    });

  const sekmeSec = (s: Sekme) => {
    setSekmeDurum(s);

    try {
      const u = new URL(window.location.href);
      u.searchParams.set("sekme", s);
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    } catch {
      /* önemli değil */
    }
  };

  /* -------------------------------------------------- adlar */
  const subeAd = useMemo(() => {
    const m = new Map<number, SubeSecenek>();
    sec?.subeler.forEach((s) => m.set(s.depo, s));
    return m;
  }, [sec]);

  const grupAd = useMemo(() => {
    const m = new Map<string, string>();
    sec?.gruplar.forEach((g) => m.set(g.kod, g.ad));
    return (k: string) => m.get(k) ?? (k ? k : "Grupsuz");
  }, [sec]);

  const grupRenk = useMemo(() => {
    const m = new Map<string, string>();
    sec?.gruplar.forEach((g, i) => m.set(g.kod, PALET[i % PALET.length]));
    return (k: string) => m.get(k) ?? "#9AA394";
  }, [sec]);

  const bolgeRenk = useMemo(() => {
    const m = new Map<string, string>();
    sec?.bolgeler.forEach((b, i) => m.set(b, PALET[i % PALET.length]));
    return (b: string) => m.get(b) ?? "#9AA394";
  }, [sec]);

  const subeEtiket = (d: number) => {
    const s = subeAd.get(d);
    return s ? `${d} · ${s.ad}` : `Depo ${d}`;
  };

  /* -------------------------------------------------- dönem */
  const r = useMemo(() => (sec ? aralik(suzgec, sec.dun) : null), [suzgec, sec]);

  const sorgu = useMemo(() => {
    if (!r) return "";

    const p = new URLSearchParams({
      bas: isoYaz(r.s),
      bit: isoYaz(r.e),
      bolge: suzgec.bolge,
      grup: suzgec.grup,
    });

    if (r.ps && r.pe) {
      p.set("pbas", isoYaz(r.ps));
      p.set("pbit", isoYaz(r.pe));
    }

    if (suzgec.depo != null) p.set("depo", String(suzgec.depo));

    return p.toString();
  }, [r, suzgec]);

  /* -------------------------------------------------- veriler */
  const ozet = useYoklama<Ozet>(sec && sorgu ? `RaporMerkezi/Ozet?${sorgu}&_=${yenileSayac}` : null, 3000);

  /* Son hazır özet: yeni süzgeç hesaplanırken eski görünüm kalsın */
  const sonOzet = useRef<Ozet | null>(null);
  if (ozet.veri && !ozet.veri.hazirlaniyor && ozet.veri.a) sonOzet.current = ozet.veri;
  const O = ozet.veri && !ozet.veri.hazirlaniyor && ozet.veri.a ? ozet.veri : sonOzet.current;
  const A = O?.a ?? null;
  const P = O?.p ?? null;
  const guncelleniyor = ozet.yukleniyor || !!ozet.veri?.hazirlaniyor;

  const bugunYolu = sec
    ? `RaporMerkezi/Bugun?${new URLSearchParams({
        bolge: suzgec.bolge,
        ...(suzgec.depo != null ? { depo: String(suzgec.depo) } : {}),
      }).toString()}&_=${yenileSayac}`
    : null;
  const bugun = useYoklama<Bugun>(bugunYolu, 4000);

  /* Bugün dakikada bir */
  const [dakika, setDakika] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDakika((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (dakika > 0) bugun.tekrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dakika]);

  const urunYolu = sec && sorgu && sekme === "satis" ? `RaporMerkezi/Urunler?${sorgu}&_=${yenileSayac}` : null;
  const urunler = useYoklama<Hazirlik & { satirlar?: UrunSatir[] | null }>(urunYolu, 4000);

  /* Stok tablosu sunucuda süzülüp sıralanıyor */
  const [stokSeg, setStokSeg] = useState("all");
  const [stokAra, setStokAra] = useState("");
  const [stokAraG, setStokAraG] = useState("");
  const [stokSira, setStokSira] = useState<{ k: string; yon: number }>({ k: "days", yon: 1 });
  const [stokTumu, setStokTumu] = useState(false);
  const [trSeg, setTrSeg] = useState(-1);
  const [urunAra, setUrunAra] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setStokAraG(stokAra), 350);
    return () => clearTimeout(t);
  }, [stokAra]);

  const SUNUCU_SIRA: Record<string, string> = {
    depo: "depo", sube: "sube", urun: "urun", qty: "qty", min: "min",
    daily: "daily", days: "gun", deger: "deger", durum: "durum",
  };

  const stokYolu =
    sec && (sekme === "stok" || sekme === "genel")
      ? `RaporMerkezi/Stok?${new URLSearchParams({
          bolge: suzgec.bolge,
          grup: suzgec.grup,
          ...(suzgec.depo != null ? { depo: String(suzgec.depo) } : {}),
          seg: stokSeg,
          ara: stokAraG,
          sirala: SUNUCU_SIRA[stokSira.k] ?? "gun",
          yon: String(stokSira.yon),
          limit: stokTumu ? "2000" : sekme === "stok" ? "20" : "1",
        }).toString()}&_=${yenileSayac}`
      : null;

  const stok = useYoklama<StokCevap & { hazirlaniyor?: boolean }>(stokYolu, 6000, (v) =>
    Boolean(
      v.stok?.hazirlaniyor ||
        v.skt?.hazirlaniyor ||
        v.transfer?.hazirlaniyor ||
        v.stok?.merkez === "hazirlaniyor"
    )
  );

  /* -------------------------------------------------- süzgeç eylemleri */
  const grupDegistir = (k: string) => degistir({ grup: suzgec.grup === k ? "" : k });
  const depoDegistir = (d: number) => {
    if (sec?.kilit) return;
    const s = subeAd.get(d);
    degistir({
      depo: suzgec.depo === d ? null : d,
      bolge: suzgec.bolge && s && s.bolge !== suzgec.bolge ? "" : suzgec.bolge,
    });
  };
  const bolgeDegistir = (b: string) => {
    if (sec?.kilit) return;
    degistir({ bolge: suzgec.bolge === b ? "" : b, depo: null });
  };

  const temizle = () => {
    setF(() => {
      suzgecYaz(BOS_SUZGEC);
      return BOS_SUZGEC;
    });
    message.success("Filtreler sıfırlandı");
  };

  const yenile = async () => {
    try {
      await api.gonder("RaporMerkezi/Yenile", {});
    } catch {
      /* bugün verisi alınamadıysa da ekran yenilensin */
    }
    setYenileSayac((x) => x + 1);
    message.success("Veriler yenilendi");
  };

  const kopyala = (id: string) => {
    const k = kopya.current[id]?.();

    if (!k) return;

    navigator.clipboard
      .writeText(k.tsv)
      .then(() => message.success(`${N0.format(k.adet)} satır panoya kopyalandı — Excel'e yapıştırabilirsiniz`))
      .catch(() => message.error("Panoya kopyalanamadı. Tarayıcı izin vermedi."));
  };

  const KopyaDugme = ({ id }: { id: string }) => (
    <button className="rm-dugme" onClick={() => kopyala(id)}>
      <Copy size={13} /> Tabloyu kopyala
    </button>
  );

  /* ======================================================== çizim */

  if (secHata)
    return (
      <div className="rm">
        <div className="rm-not hata">
          Rapor Merkezi açılamadı: {secHata}{" "}
          <Button size="small" onClick={() => secenekAl()}>
            Tekrar dene
          </Button>
        </div>
      </div>
    );

  if (!sec || !r)
    return (
      <div className="rm">
        <Bekle metin="Rapor Merkezi açılıyor…" />
      </div>
    );

  const tekGun = gunFarki(r.s, r.e) === 0;

  const kapsamAdi = suzgec.depo != null
    ? `${subeAd.get(suzgec.depo)?.ad ?? suzgec.depo} şubesi`
    : suzgec.bolge
    ? `${suzgec.bolge} bölgesi`
    : `Tüm şubeler (${sec.subeler.length})`;

  const altBaslik = `${kapsamAdi} · ${
    tekGun ? fmtU.format(r.s) : `${fmtK.format(r.s)} – ${fmtU.format(r.e)}`
  } · önceki dönemle karşılaştırmalı`;

  const subeListesi = sec.subeler.filter((s) => !suzgec.bolge || s.bolge === suzgec.bolge);

  /* -------------------------------------------------- canlı */
  const canli = (() => {
    const b = bugun.veri;

    if (!b || b.hazirlaniyor) return <span>Bugünün satışı hesaplanıyor…</span>;
    if (b.hata) return <span>Bugünün verisi alınamadı</span>;

    const dv = fark(b.ciro, b.dunAyniSaat ?? null);

    return (
      <span>
        Bugün {b.saat} itibarıyla <b>{TL(b.ciro ?? 0)}</b>{" "}
        {dv != null && Number.isFinite(dv) && (
          <span className="rm-ipucu-metin">
            dünün aynı saatine göre {dv >= 0 ? "+" : "−"}
            {PCT(Math.abs(dv))}
          </span>
        )}
      </span>
    );
  })();

  /* -------------------------------------------------- ortak hesaplar */
  const ciroTop = A?.kat.reduce((t, x) => t + x.ciro, 0) ?? 0;
  const pKat = new Map((P?.kat ?? []).map((x) => [x.kod, x]));
  const pSube = new Map((P?.sube ?? []).map((x) => [x.depo, x]));

  const aktifSaatler = (() => {
    const s = [...(A?.saat ?? []), ...(P?.saat ?? [])];
    const dolu = A?.saat.map((v, i) => (v > 0 || (P?.saat[i] ?? 0) > 0 ? i : -1)).filter((i) => i >= 0) ?? [];

    if (!s.length || dolu.length === 0) return Array.from({ length: 15 }, (_, i) => i + 8);

    const ilk = Math.min(8, Math.min(...dolu));
    const son = Math.max(22, Math.max(...dolu));

    return Array.from({ length: son - ilk + 1 }, (_, i) => i + ilk);
  })();

  const notlar = (
    <div className="rm-notlar">
      {sec.kilitBulunamadi && (
        <div className="rm-not hata">
          Kullanıcınız bir şubeye kilitli ama şubenin Mikro depo eşleşmesi bulunamadı. Yönetim → Şube ve
          depo ekranından eşleşmeyi tamamlayınız.
        </div>
      )}
      {ozet.veri?.hazirlaniyor && (
        <div className={`rm-not ${ozet.veri.hata ? "hata" : "bilgi"}`}>
          {ozet.veri.hata ? (
            <>
              {ozet.veri.hata}{" "}
              <Button size="small" onClick={ozet.tekrar}>
                Tekrar dene
              </Button>
            </>
          ) : (
            <>
              <Spin size="small" /> &nbsp;Satış verisi Mikro'dan hazırlanıyor
              {ozet.veri.toplam
                ? ` — ${N0.format((ozet.veri.toplam ?? 0) - (ozet.veri.eksik ?? 0))} / ${N0.format(ozet.veri.toplam ?? 0)} gün hazır`
                : ""}
              {ozet.veri.durum ? ` (${ozet.veri.durum})` : ""}. Uzun dönemler ilk açılışta birkaç dakika
              sürebilir; sonra anında açılır.
            </>
          )}
        </div>
      )}
      {ozet.hata && (
        <div className="rm-not hata">
          {ozet.hata}{" "}
          <Button size="small" onClick={ozet.tekrar}>
            Tekrar dene
          </Button>
        </div>
      )}
      {(O?.uyarilar ?? []).map((u, i) => (
        <div key={i} className={`rm-not ${u.tur === "uyari" ? "" : "bilgi"}`}>
          {u.metin}
        </div>
      ))}
    </div>
  );

  /* ================================================== GENEL */
  const genel = () => {
    const stokKpi = stok.veri?.stok?.kpi;
    const fisAd = suzgec.grup ? "Kategoriyi içeren fiş" : "Fiş sayısı";

    const kpi: KpiVeri[] = A
      ? [
          {
            l: "Ciro (KDV dahil)",
            v: TL(A.ciro),
            t: TL(A.ciro, true),
            sp: A.gunler.length > 1 ? <Kivilcim veri={A.gunler} /> : undefined,
            k: P ? "Önceki: " + TL(P.ciro) : "",
            d: <Delta v={fark(A.ciro, P?.ciro)} />,
          },
          {
            l: "Brüt kâr",
            v: TL(A.kar),
            t: TL(A.kar, true),
            k: "Marj " + PCT(A.net ? A.kar / A.net : 0),
            d: <Delta v={fark(A.kar, P?.kar)} />,
          },
          {
            l: fisAd,
            v: N0.format(A.fis),
            k: "Günlük ort. " + N0.format(A.fis / Math.max(1, A.gunSayisi)),
            d: <Delta v={fark(A.fis, P?.fis)} />,
          },
          {
            l: "Sepet ortalaması",
            v: "₺" + N2.format(A.fis ? A.ciro / A.fis : 0),
            k: P && P.fis ? "Önceki: ₺" + N2.format(P.ciro / P.fis) : "",
            d: <Delta v={fark(A.fis ? A.ciro / A.fis : null, P && P.fis ? P.ciro / P.fis : null)} />,
          },
          {
            l: "Fire tutarı",
            v: TL(A.fire),
            k: "Cironun " + PCT(A.ciro ? A.fire / A.ciro : 0) + "’i",
            d: <Delta v={fark(A.fire, P?.fire)} ters />,
          },
          {
            l: "Stok değeri (bugün)",
            v: stokKpi ? TL(stokKpi.deger) : "…",
            k: stokKpi ? "Maliyet bazında" : stok.veri?.stok?.hata ? "Alınamadı" : "Hesaplanıyor",
            d: "",
          },
        ]
      : [];

    const katSira = [...(A?.kat ?? [])].sort((a, b) => b.ciro - a.ciro).slice(0, 15);
    const top = [...(A?.sube ?? [])].sort((a, b) => b.ciro - a.ciro).slice(0, 10);
    const saatMax = Math.max(0, ...aktifSaatler.map((h) => A?.saat[h] ?? 0));

    const etiketler = A ? A.gunler.map((_, i) => fmtK.format(ekle(isoOku(O!.donem!.bas), i))) : [];

    return (
      <>
        {A ? <Kpiler liste={kpi} yukleniyor={guncelleniyor} /> : <Bekle hata={ozet.hata} />}

        {A && (
          <div className="rm-izgara">
            <Kart
              sinif="c8"
              baslik={tekGun ? "Saatlik ciro (dün) — önceki gün ile" : "Günlük ciro"}
              araclar={
                <span className="rm-lejant">
                  <span>
                    <i style={{ background: RM.brand }} />
                    Seçili dönem
                  </span>
                  <span>
                    <i style={{ background: RM.muted }} />
                    Önceki dönem
                  </span>
                </span>
              }
            >
              {tekGun ? (
                <CubukGrafik
                  etiketler={aktifSaatler.map((h) => h + ":00")}
                  seriler={[
                    { ad: "Dün", veri: aktifSaatler.map((h) => A.saat[h]), renk: RM.brand },
                    ...(P ? [{ ad: "Önceki gün", veri: aktifSaatler.map((h) => P.saat[h]), renk: saydam(RM.muted, 0.45) }] : []),
                  ]}
                />
              ) : (
                <CizgiGrafik
                  etiketler={etiketler}
                  seriler={[
                    { ad: "Seçili dönem", veri: A.gunler, renk: RM.brand, alan: true },
                    ...(P ? [{ ad: "Önceki dönem", veri: P.gunler, renk: RM.muted, kesik: true }] : []),
                  ]}
                />
              )}
            </Kart>

            <Kart sinif="c4" baslik="Ödeme tipi dağılımı">
              {A.odeme.length ? (
                <HalkaGrafik
                  dilimler={A.odeme.map((o, i) => ({ ad: o.tip, deger: o.tutar, renk: ODEME_RENK[i % ODEME_RENK.length] }))}
                />
              ) : (
                <div className="rm-bos" style={{ height: 260 }}>
                  <div>
                    {O?.kaynak?.posOdeme || sec.kaynak.posOdeme
                      ? "Bu dönemde ödeme kaydı yok."
                      : "Ödeme tipleri (nakit, kredi kartı, Biçen Kart, yemek kartı) PosBack'ten okunur; kaynak sorgusu henüz tanımlanmadı."}
                    {sec.admin && !sec.kaynak.posOdeme && (
                      <div style={{ marginTop: 10 }}>
                        <button className="rm-dugme" onClick={() => setKaynakAcik(true)}>
                          <Database size={13} /> Veri kaynaklarını aç
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Kart>

            <Kart sinif="c6" baslik="Kategori cirosu" ipucu="Çubuğa tıkla → filtrele">
              <CubukGrafik
                yatay
                yukseklik={Math.max(340, katSira.length * 24 + 30)}
                etiketler={katSira.map((x) => grupAd(x.kod))}
                seriler={[
                  {
                    ad: "Ciro",
                    veri: katSira.map((x) => x.ciro),
                    renk: katSira.map((x) =>
                      !suzgec.grup || suzgec.grup === x.kod ? grupRenk(x.kod) : saydam(grupRenk(x.kod), 0.25)
                    ),
                  },
                ]}
                tikla={(i) => grupDegistir(katSira[i].kod)}
                ipucuEk={(i) => <div>Pay {PCT(ciroTop ? katSira[i].ciro / ciroTop : 0)}</div>}
              />
            </Kart>

            <Kart sinif="c6" baslik="En yüksek ciro yapan 10 şube" ipucu="Çubuğa tıkla → filtrele">
              <CubukGrafik
                yatay
                yukseklik={340}
                etiketler={top.map((x) => subeEtiket(x.depo))}
                seriler={[
                  {
                    ad: "Ciro",
                    veri: top.map((x) => x.ciro),
                    renk: top.map((x) =>
                      suzgec.depo == null || suzgec.depo === x.depo ? RM.orange : saydam(RM.orange, 0.25)
                    ),
                  },
                ]}
                tikla={(i) => depoDegistir(top[i].depo)}
              />
            </Kart>

            <Kart sinif="c12" baslik="Saatlik yoğunluk" ipucu="Seçili dönemde saat başına ortalama ciro">
              <CubukGrafik
                yukseklik={220}
                etiketler={aktifSaatler.map((h) => h + ":00")}
                seriler={[
                  {
                    ad: "Günlük ort.",
                    veri: aktifSaatler.map((h) => A.saat[h] / Math.max(1, A.gunSayisi)),
                    renk: aktifSaatler.map((h) => (A.saat[h] === saatMax && saatMax > 0 ? RM.orange : saydam(RM.brand, 0.8))),
                  },
                ]}
              />
            </Kart>
          </div>
        )}
      </>
    );
  };

  /* ================================================== SATIŞ */
  const satis = () => {
    if (!A) return <Bekle hata={ozet.hata} />;

    const ortalama = A.hafta.map((v, i) => v / (A.haftaN[i] || 1));
    const enIyi = ortalama.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
    const marjA = A.net ? A.kar / A.net : 0;
    const marjP = P && P.net ? P.kar / P.net : null;

    const katSatir = A.kat.map((x) => ({
      ...x,
      ad: grupAd(x.kod),
      pay: ciroTop ? x.ciro / ciroTop : 0,
      marj: x.net ? x.kar / x.net : 0,
      fo: x.ciro ? x.fire / x.ciro : 0,
      dg: P ? fark(x.ciro, pKat.get(x.kod)?.ciro ?? 0) : null,
    }));
    const mxKat = Math.max(0, ...katSatir.map((x) => x.ciro));

    /* Isı haritası */
    const ort = A.isi.map((satir, w) => satir.map((v) => v / (A.haftaN[w] || 1)));
    const mx = Math.max(0, ...GUN_SIRA.flatMap((w) => aktifSaatler.map((h) => ort[w][h])));

    /* Ürünler */
    const q = urunAra.toLocaleLowerCase("tr");
    const urunSatir = (urunler.veri?.satirlar ?? []).filter(
      (p) => !q || p.ad.toLocaleLowerCase("tr").includes(q) || p.barkod.includes(q) || p.kod.toLocaleLowerCase("tr").includes(q)
    );
    const mxUrun = Math.max(0, ...urunSatir.map((x) => x.ciro));
    const miktarYaz = (v: number, b: string) =>
      (/kg|gr|lt/i.test(b) ? N1.format(v) : N0.format(v)) + (b ? " " + b.toLocaleLowerCase("tr") : "");

    return (
      <>
        <Kpiler
          yukleniyor={guncelleniyor}
          liste={[
            {
              l: "Ciro",
              v: TL(A.ciro),
              t: TL(A.ciro, true),
              k: "Günlük ort. " + TL(A.ciro / Math.max(1, A.gunSayisi)),
              d: <Delta v={fark(A.ciro, P?.ciro)} />,
            },
            {
              l: "Brüt marj",
              v: PCT(marjA),
              k: marjP != null ? "Önceki: " + PCT(marjP) : "",
              d: <Delta v={marjP != null ? fark(marjA, marjP) : null} />,
            },
            {
              l: "Satılan miktar",
              v: N0.format(A.miktar),
              k: "Adet + kg toplamı",
              d: <Delta v={fark(A.miktar, P?.miktar)} />,
            },
            {
              l: "En güçlü gün",
              v: ortalama.some((x) => x > 0) ? GUN_ADI[enIyi] : "—",
              k: "Ortalama ciroya göre",
            },
          ]}
        />

        <div className="rm-izgara">
          <Kart
            sinif="c12"
            baslik="Kategori performansı"
            araclar={
              <>
                <span className="rm-ipucu-metin">Satıra tıkla → filtrele</span>
                <KopyaDugme id="tCat" />
              </>
            }
          >
            <Tablo
              id="tCat"
              kopya={kopya}
              satirlar={katSatir}
              varsayilan="ciro"
              tikla={(x) => grupDegistir(x.kod)}
              secili={(x) => suzgec.grup === x.kod}
              sutunlar={[
                {
                  k: "ad",
                  l: "Kategori",
                  f: (x) => (
                    <>
                      <span className="rm-hap" style={{ background: saydam(grupRenk(x.kod), 0.16), color: grupRenk(x.kod) }}>
                        ●
                      </span>{" "}
                      {x.ad}
                    </>
                  ),
                  tx: (x) => x.ad,
                },
                { k: "ciro", l: "Ciro", num: true, f: (x) => <CubukHucre v={x.ciro} max={mxKat} renk={grupRenk(x.kod)} />, tx: (x) => Math.round(x.ciro) },
                { k: "pay", l: "Pay", num: true, f: (x) => PCT(x.pay), tx: (x) => PCT(x.pay) },
                { k: "kar", l: "Brüt kâr", num: true, f: (x) => TL(x.kar, true), tx: (x) => Math.round(x.kar) },
                { k: "marj", l: "Marj", num: true, f: (x) => PCT(x.marj), tx: (x) => PCT(x.marj) },
                { k: "fire", l: "Fire", num: true, f: (x) => TL(x.fire, true), tx: (x) => Math.round(x.fire) },
                {
                  k: "fo",
                  l: "Fire oranı",
                  num: true,
                  f: (x) => <span className={`rm-hap ${x.fo > 0.03 ? "bad" : x.fo > 0.012 ? "warn" : "good"}`}>{PCT(x.fo)}</span>,
                  tx: (x) => PCT(x.fo),
                },
                { k: "dg", l: "Önceki döneme göre", num: true, sv: (x) => x.dg ?? -9, f: (x) => <Delta v={x.dg} />, tx: (x) => (x.dg == null ? "" : PCT(x.dg)) },
              ]}
            />
          </Kart>

          <Kart sinif="c7" baslik="Gün × saat ısı haritası" ipucu="Ortalama ciro (bin ₺)">
            <div className="rm-isi-kap">
              <div className="rm-isi" style={{ gridTemplateColumns: `44px repeat(${aktifSaatler.length}, minmax(22px, 1fr))` }}>
                <div />
                {aktifSaatler.map((h) => (
                  <div key={h}>{h}</div>
                ))}
                {GUN_SIRA.map((w) => (
                  <FragmentSatir key={w}>
                    <div style={{ justifyContent: "start" }}>{GUN_ADI[w]}</div>
                    {aktifSaatler.map((h) => {
                      const v = ort[w][h];
                      const a = mx ? v / mx : 0;

                      return (
                        <div
                          key={h}
                          className="h"
                          title={`${GUN_ADI[w]} ${h}:00 · ort. ${TL(v, true)}`}
                          style={{
                            background: `rgba(124,181,24,${(a * 0.85 + 0.05).toFixed(3)})`,
                            color: a > 0.6 ? "#fff" : RM.muted,
                          }}
                        >
                          {a > 0 ? N0.format(v / 1e3) : ""}
                        </div>
                      );
                    })}
                  </FragmentSatir>
                ))}
              </div>
            </div>
            {suzgec.grup && (
              <span className="rm-ipucu-metin">
                Kategori süzgecinde saat dağılımı, şubenin o günkü kategori payıyla orantılanır.
              </span>
            )}
          </Kart>

          <Kart sinif="c5" baslik="Haftanın günlerine göre ortalama ciro">
            <CubukGrafik
              etiketler={GUN_SIRA.map((w) => GUN_ADI[w])}
              seriler={[
                { ad: "Seçili", veri: GUN_SIRA.map((w) => ortalama[w]), renk: RM.brand },
                ...(P ? [{ ad: "Önceki", veri: GUN_SIRA.map((w) => P.hafta[w] / (P.haftaN[w] || 1)), renk: saydam(RM.muted, 0.4) }] : []),
              ]}
            />
            {P && (
              <span className="rm-lejant rm-lejant-orta">
                <span>
                  <i style={{ background: RM.brand }} />
                  Seçili
                </span>
                <span>
                  <i style={{ background: saydam(RM.muted, 0.4) }} />
                  Önceki
                </span>
              </span>
            )}
          </Kart>

          <Kart
            sinif="c12"
            baslik="Ürün satışları"
            ipucu={urunler.veri?.satirlar ? `En çok ciro yapan ${N0.format(urunler.veri.satirlar.length)} ürün` : undefined}
            araclar={
              <>
                <input
                  type="search"
                  placeholder="Ürün adı, kodu veya barkod ara"
                  value={urunAra}
                  onChange={(e) => setUrunAra(e.target.value)}
                />
                <KopyaDugme id="tProd" />
              </>
            }
          >
            {urunler.veri?.satirlar ? (
              <Tablo
                id="tProd"
                kopya={kopya}
                satirlar={urunSatir}
                varsayilan="ciro"
                limit={15}
                sutunlar={[
                  { k: "barkod", l: "Barkod", soluk: true },
                  { k: "ad", l: "Ürün" },
                  { k: "grup", l: "Kategori", soluk: true, sv: (x) => grupAd(x.grup), f: (x) => grupAd(x.grup) },
                  { k: "miktar", l: "Miktar", num: true, f: (x) => miktarYaz(x.miktar, x.birim) },
                  { k: "fiyat", l: "Raf fiyatı", num: true, f: (x) => (x.fiyat ? "₺" + N2.format(x.fiyat) : "—") },
                  { k: "ciro", l: "Ciro", num: true, f: (x) => <CubukHucre v={x.ciro} max={mxUrun} gen={80} />, tx: (x) => Math.round(x.ciro) },
                  { k: "kar", l: "Brüt kâr", num: true, f: (x) => TL(x.kar, true), tx: (x) => Math.round(x.kar) },
                  {
                    k: "dg",
                    l: "Değişim",
                    num: true,
                    sv: (x) => fark(x.ciro, x.onceki) ?? -9,
                    f: (x) => <Delta v={x.onceki == null ? null : fark(x.ciro, x.onceki)} />,
                    tx: (x) => (x.onceki ? PCT(fark(x.ciro, x.onceki) ?? 0) : ""),
                  },
                ]}
              />
            ) : (
              <Bekle
                metin="Ürün satışları Mikro'dan hesaplanıyor…"
                hata={urunler.hata ?? urunler.veri?.hata}
              />
            )}
          </Kart>
        </div>
      </>
    );
  };

  /* ================================================== STOK */
  const stokSekme = () => {
    const v = stok.veri;
    const st = v?.stok;
    const kpi = st?.kpi;
    const skt = v?.skt;
    const tr = v?.transfer;

    const qf = (x: number, b: string) =>
      (/kg|gr|lt/i.test(b) ? N1.format(x) : N0.format(Math.round(x))) + (b ? " " + b.toLocaleLowerCase("tr") : "");

    const ortGun = kpi?.ortGun ?? null;

    return (
      <>
        <Kpiler
          yukleniyor={!kpi}
          liste={[
            {
              l: "Stok değeri",
              v: kpi ? TL(kpi.deger) : "…",
              k: kpi ? N0.format(kpi.kayit) + " depo-ürün kaydı" : "Hesaplanıyor",
            },
            {
              l: "Ortalama stok günü",
              v: ortGun != null ? N1.format(ortGun) + " gün" : "—",
              k: "Hedef 14 gün",
              d:
                ortGun != null ? (
                  <span className={`rm-hap ${ortGun > 20 ? "warn" : ortGun < 8 ? "bad" : "good"}`}>
                    {ortGun > 20 ? "Yüksek" : ortGun < 8 ? "Düşük" : "Hedefte"}
                  </span>
                ) : undefined,
            },
            {
              l: "Kritik stok",
              v: kpi ? N0.format(kpi.kritik) : "…",
              k: "3 günden az kaldı · düşük: " + (kpi ? N0.format(kpi.dusuk) : "…"),
              d: kpi?.kritik ? <span className="rm-hap bad">Sipariş gerekli</span> : undefined,
            },
            {
              l: "Fazla stok bağlı para",
              v: kpi ? TL(kpi.fazlaDeger) : "…",
              k: kpi ? N0.format(kpi.fazlaKayit) + " kayıt 45 günü aşıyor" : "",
            },
            {
              l: "SKT ≤ 7 gün",
              v: skt?.kaynak ? N0.format(skt.adet ?? 0) + " parti" : skt?.kaynak === false ? "—" : "…",
              k: skt?.kaynak ? TL(skt.deger ?? 0) + " maliyet" : skt?.kaynak === false ? "Parti takibi yok" : "",
              d: skt?.acil ? <span className="rm-hap bad">Bugün/yarın var</span> : undefined,
            },
            {
              l: "Bekleyen transfer",
              v: tr?.bekleyen != null ? N0.format(tr.bekleyen) : "…",
              k: tr?.yolda != null ? "Yolda: " + N0.format(tr.yolda) : "",
            },
          ]}
        />

        {(st?.hata || stok.hata) && <div className="rm-not hata">Stok verisi alınamadı: {st?.hata ?? stok.hata}</div>}
        {kpi && kpi.tahminiPay > 0.05 && (
          <div className="rm-not bilgi">
            Stok değerinin {PCT(kpi.tahminiPay)}'i son bir yılda alışı olmayan ürünlerden; bunların maliyeti aynı
            kategorideki maliyet/fiyat oranıyla tahmin edildi.
          </div>
        )}
        {st?.merkez === "hazirlaniyor" && (
          <div className="rm-not bilgi">
            <Spin size="small" /> &nbsp;Merkez depo stoğu hareketlerden hesaplanıyor; hazır olunca listeye eklenecek.
          </div>
        )}

        <div className="rm-izgara">
          <Kart sinif="c7" baslik="Depo bazında stok değeri" ipucu="Maliyet, ilk 12 depo">
            {st?.depolar ? (
              <CubukGrafik
                yatay
                yukseklik={340}
                etiketler={st.depolar.map((d) => (d.merkez ? "100 · Merkez Depo" : `${d.depo} · ${d.ad}`))}
                seriler={[
                  {
                    ad: "Stok değeri",
                    veri: st.depolar.map((d) => d.deger),
                    renk: st.depolar.map((d) =>
                      d.merkez ? RM.orange : suzgec.depo == null || suzgec.depo === d.depo ? RM.brand : saydam(RM.brand, 0.25)
                    ),
                  },
                ]}
                tikla={(i) => {
                  const d = st.depolar![i];
                  if (!d.merkez) depoDegistir(d.depo);
                }}
              />
            ) : (
              <Bekle metin="Stok PUSULA'dan okunuyor…" hata={st?.hata} />
            )}
          </Kart>

          <Kart sinif="c5" baslik="Kategori stok günü" ipucu="Hedef 14 gün">
            {st?.kategoriGun ? (
              <CubukGrafik
                yatay
                yukseklik={Math.max(340, Math.min(15, st.kategoriGun.length) * 24 + 30)}
                etiketler={st.kategoriGun.slice(0, 15).map((x) => grupAd(x.kod))}
                seriler={[
                  {
                    ad: "Stok günü",
                    veri: st.kategoriGun.slice(0, 15).map((x) => Math.min(x.gun, 120)),
                    renk: st.kategoriGun
                      .slice(0, 15)
                      .map((x) => (x.gun > 20 ? RM.warn : x.gun < 8 ? RM.bad : RM.brand)),
                  },
                ]}
                bicim={(x) => N1.format(x) + " gün"}
                eksenBicim={(x) => N0.format(x) + " g"}
                hedef={14}
                tikla={(i) => grupDegistir(st.kategoriGun![i].kod)}
              />
            ) : (
              <Bekle metin="Hesaplanıyor…" hata={st?.hata} />
            )}
          </Kart>

          <Kart
            sinif="c12"
            baslik="Stok durumu"
            araclar={
              <>
                <span className="rm-dilim">
                  {[
                    ["all", "Tümü"],
                    ["Kritik", "Kritik"],
                    ["Düşük", "Düşük"],
                    ["Normal", "Normal"],
                    ["Fazla stok", "Fazla"],
                  ].map(([k, l]) => (
                    <button
                      key={k}
                      aria-pressed={stokSeg === k}
                      onClick={() => {
                        setStokSeg(k);
                        setStokTumu(false);
                      }}
                    >
                      {l} · {N0.format(st?.sayac?.[k] ?? 0)}
                    </button>
                  ))}
                </span>
                <input
                  type="search"
                  placeholder="Ürün, barkod veya şube ara"
                  value={stokAra}
                  onChange={(e) => {
                    setStokAra(e.target.value);
                    setStokTumu(false);
                  }}
                />
                <KopyaDugme id="tStock" />
              </>
            }
          >
            {st?.satirlar ? (
              <Tablo
                id="tStock"
                kopya={kopya}
                satirlar={st.satirlar}
                tikla={(x) => {
                  if (x.depo !== 100) depoDegistir(x.depo);
                }}
                secili={(x) => suzgec.depo === x.depo}
                kontrol={{
                  k: stokSira.k,
                  yon: stokSira.yon,
                  degistir: (k) => setStokSira((s) => (s.k === k ? { k, yon: -s.yon } : { k, yon: -1 })),
                  tumu: stokTumu,
                  tumuDegistir: () => setStokTumu((x) => !x),
                  toplam: st.toplamSatir ?? 0,
                }}
                sutunlar={[
                  { k: "depo", l: "Depo", soluk: true },
                  { k: "sube", l: "Şube / depo" },
                  { k: "urun", l: "Ürün", tx: (x) => x.urun },
                  { k: "qty", l: "Mevcut", num: true, f: (x) => qf(x.miktar, x.birim), tx: (x) => x.miktar },
                  { k: "min", l: "Kritik eşik (3 gün)", num: true, f: (x) => (x.esik ? qf(x.esik, x.birim) : "—"), tx: (x) => x.esik },
                  { k: "daily", l: "Günlük satış", num: true, f: (x) => (x.gunluk ? qf(x.gunluk, x.birim) : x.yokSatiyor ? "Yok satıyor" : "—"), tx: (x) => x.gunluk },
                  { k: "days", l: "Kalan gün", num: true, f: (x) => (x.gun >= 999 ? "Satış yok" : N1.format(x.gun)), tx: (x) => x.gun },
                  { k: "deger", l: "Stok değeri", num: true, f: (x) => TL(x.deger, true), tx: (x) => x.deger },
                  { k: "durum", l: "Durum", f: (x) => <span className={`rm-hap ${x.renk}`}>{x.durum}</span>, tx: (x) => x.durum },
                ]}
              />
            ) : (
              <Bekle metin="Stok PUSULA'dan okunuyor…" hata={st?.hata ?? stok.hata} />
            )}
          </Kart>

          <Kart sinif="c6" baslik="Son kullanma tarihi yaklaşanlar" ipucu="7 gün içinde">
            {!skt || skt.hazirlaniyor ? (
              <Bekle hata={skt?.hata} />
            ) : skt.hata ? (
              <Bekle hata={skt.hata} />
            ) : !skt.kaynak ? (
              <div className="rm-bos">{skt.mesaj}</div>
            ) : (
              <Tablo
                id="tSkt"
                kopya={kopya}
                satirlar={skt.satirlar ?? []}
                varsayilan="kalan"
                yon={1}
                limit={10}
                sutunlar={[
                  { k: "sube", l: "Şube" },
                  { k: "urun", l: "Ürün" },
                  { k: "miktar", l: "Miktar", num: true, f: (x) => qf(x.miktar, x.birim) },
                  {
                    k: "kalan",
                    l: "SKT",
                    num: true,
                    f: (x) => (
                      <span className={`rm-hap ${x.kalan <= 1 ? "bad" : x.kalan <= 3 ? "warn" : "info"}`}>
                        {x.kalan === 0 ? "Bugün" : x.kalan === 1 ? "Yarın" : x.kalan + " gün"}
                      </span>
                    ),
                    tx: (x) => x.skt,
                  },
                ]}
              />
            )}
          </Kart>

          <Kart
            sinif="c6"
            baslik="Merkez depo transferleri"
            ipucu="Son 14 gün"
            araclar={
              <span className="rm-dilim">
                {[
                  [-1, "Tümü"],
                  [0, "Hazırlanıyor"],
                  [1, "Yolda"],
                  [2, "Teslim"],
                ].map(([k, l]) => (
                  <button key={k} aria-pressed={trSeg === k} onClick={() => setTrSeg(k as number)}>
                    {l}
                    {(k as number) >= 0 && tr?.sayac ? ` · ${tr.sayac[k as number]}` : ""}
                  </button>
                ))}
              </span>
            }
          >
            {!tr || tr.hazirlaniyor || tr.hata ? (
              <Bekle hata={tr?.hata} />
            ) : (
              <Tablo
                id="tTr"
                kopya={kopya}
                satirlar={(tr.satirlar ?? []).filter((x) => trSeg < 0 || x.durum === trSeg)}
                limit={10}
                tikla={(x) => depoDegistir(x.depo)}
                sutunlar={[
                  { k: "belge", l: "Belge", soluk: true },
                  { k: "sube", l: "Hedef şube", f: (x) => `${x.depo} · ${x.sube}` },
                  { k: "kalem", l: "Kalem", num: true },
                  { k: "tutar", l: "Tutar", num: true, f: (x) => TL(x.tutar, true) },
                  {
                    k: "tarih",
                    l: "Tarih",
                    f: (x) => {
                      const g = gunFarki(isoOku(x.tarih), isoOku(sec.bugun));
                      return g === 0 ? "Bugün" : g === 1 ? "Dün" : fmtK.format(isoOku(x.tarih));
                    },
                  },
                  {
                    k: "durum",
                    l: "Durum",
                    f: (x) => <span className={`rm-hap ${["warn", "info", "good"][x.durum]}`}>{TR_DURUM[x.durum]}</span>,
                    tx: (x) => TR_DURUM[x.durum],
                  },
                ]}
              />
            )}
          </Kart>
        </div>
      </>
    );
  };

  /* ================================================== ŞUBE */
  const subeSekme = () => {
    if (!A) return <Bekle hata={ozet.hata} />;

    const gun = Math.max(1, A.gunSayisi);

    const satirlar = A.sube
      .filter((x) => subeAd.has(x.depo))
      .map((x) => {
        const s = subeAd.get(x.depo)!;

        return {
          depo: x.depo,
          ad: s.ad,
          bolge: s.bolge || "—",
          ciro: x.ciro,
          dg: P ? fark(x.ciro, pSube.get(x.depo)?.ciro ?? 0) : null,
          fis: x.fis / gun,
          sepet: x.fis ? x.ciro / x.fis : 0,
          marj: x.net ? x.kar / x.net : 0,
          fire: x.ciro ? x.fire / x.ciro : 0,
        };
      });

    const toplam = satirlar.reduce((t, x) => t + x.ciro, 0);
    const lider = satirlar.reduce<(typeof satirlar)[number] | null>((a, b) => (!a || b.ciro > a.ciro ? b : a), null);
    const buyume = satirlar.filter((x) => x.dg != null && Number.isFinite(x.dg)).sort((a, b) => (b.dg ?? 0) - (a.dg ?? 0));
    const mxS = Math.max(0, ...satirlar.map((x) => x.ciro));

    const bolgeler = [...A.bolge].sort((a, b) => b.ciro - a.ciro);
    const subeSayisi = (b: string) => sec.subeler.filter((s) => s.bolge === b).length;

    return (
      <>
        <Kpiler
          yukleniyor={guncelleniyor}
          liste={[
            {
              l: "Şube sayısı",
              v: N0.format(satirlar.length),
              k: suzgec.bolge ? suzgec.bolge : `${sec.bolgeler.length} bölge`,
            },
            {
              l: "Şube başına ort. ciro",
              v: TL(satirlar.length ? toplam / satirlar.length : 0),
              k: "Günlük " + TL(satirlar.length ? toplam / satirlar.length / gun : 0),
            },
            { l: "Lider şube", v: lider?.ad ?? "—", k: lider ? TL(lider.ciro) : "" },
            {
              l: "En hızlı büyüyen",
              v: buyume[0]?.ad ?? "—",
              k: "En zayıf: " + (buyume.length ? buyume[buyume.length - 1].ad : "—"),
              d: buyume.length ? <Delta v={buyume[0].dg} /> : undefined,
            },
          ]}
        />

        <div className="rm-izgara">
          <Kart
            sinif="c12"
            baslik="Şube karnesi"
            araclar={
              <>
                <span className="rm-ipucu-metin">Satıra tıkla → şubeyi seç</span>
                <KopyaDugme id="tBr" />
              </>
            }
          >
            <Tablo
              id="tBr"
              kopya={kopya}
              satirlar={satirlar}
              varsayilan="ciro"
              tikla={(x) => depoDegistir(x.depo)}
              secili={(x) => suzgec.depo === x.depo}
              sutunlar={[
                { k: "depo", l: "Depo", num: true, soluk: true },
                { k: "ad", l: "Şube" },
                { k: "bolge", l: "Bölge", soluk: true },
                { k: "ciro", l: "Ciro", num: true, f: (x) => <CubukHucre v={x.ciro} max={mxS} />, tx: (x) => Math.round(x.ciro) },
                { k: "dg", l: "Değişim", num: true, sv: (x) => x.dg ?? -9, f: (x) => <Delta v={x.dg} />, tx: (x) => (x.dg == null ? "" : PCT(x.dg)) },
                { k: "fis", l: "Günlük fiş", num: true, f: (x) => N0.format(x.fis), tx: (x) => Math.round(x.fis) },
                { k: "sepet", l: "Sepet ort.", num: true, f: (x) => "₺" + N2.format(x.sepet), tx: (x) => Math.round(x.sepet * 100) / 100 },
                { k: "marj", l: "Brüt marj", num: true, f: (x) => PCT(x.marj), tx: (x) => PCT(x.marj) },
                {
                  k: "fire",
                  l: "Fire oranı",
                  num: true,
                  f: (x) => <span className={`rm-hap ${x.fire > 0.016 ? "bad" : x.fire > 0.013 ? "warn" : "good"}`}>{PCT(x.fire)}</span>,
                  tx: (x) => PCT(x.fire),
                },
              ]}
            />
          </Kart>

          <Kart sinif="c7" baslik="Fiş sayısı ve sepet ortalaması" ipucu="Günlük ortalama · noktaya tıkla">
            <DagilimGrafik
              noktalar={satirlar.map((x) => ({
                x: x.fis,
                y: x.sepet,
                renk: bolgeRenk(x.bolge),
                secili: suzgec.depo === x.depo,
                soluk: suzgec.depo != null && suzgec.depo !== x.depo,
                etiket: (
                  <>
                    <b>
                      {x.ad} ({x.bolge})
                    </b>
                    {N0.format(x.fis)} fiş/gün · sepet ₺{N2.format(x.sepet)}
                  </>
                ),
              }))}
              xBaslik="Günlük fiş"
              yBaslik="Sepet ortalaması (₺)"
              tikla={(i) => depoDegistir(satirlar[i].depo)}
            />
          </Kart>

          <Kart sinif="c5" baslik="Bölge bazında ciro" ipucu="Çubuğa tıkla → filtrele">
            {bolgeler.length ? (
              <CubukGrafik
                yatay
                yukseklik={Math.max(340, bolgeler.length * 28 + 30)}
                etiketler={bolgeler.map((b) => `${b.ad} (${subeSayisi(b.ad)})`)}
                seriler={[
                  {
                    ad: "Ciro",
                    veri: bolgeler.map((b) => b.ciro),
                    renk: bolgeler.map((b) =>
                      !suzgec.bolge || suzgec.bolge === b.ad ? bolgeRenk(b.ad) : saydam(bolgeRenk(b.ad), 0.25)
                    ),
                  },
                ]}
                tikla={(i) => bolgeDegistir(bolgeler[i].ad)}
              />
            ) : (
              <div className="rm-bos" style={{ height: 340 }}>
                Şubeler bir bölgeye bağlı değil. Yetkiler → Bölgeler ekranında şubeleri bölgelere atadığınızda
                burada bölge karşılaştırması görünür.
              </div>
            )}
          </Kart>
        </div>
      </>
    );
  };

  /* ================================================== düzen */
  const cipler: [string, string, () => void][] = [];
  if (suzgec.bolge && !sec.kilit) cipler.push(["bolge", "Bölge: " + suzgec.bolge, () => degistir({ bolge: "", depo: null })]);
  if (suzgec.depo != null && !sec.kilit)
    cipler.push(["depo", "Şube: " + (subeAd.get(suzgec.depo)?.ad ?? suzgec.depo), () => degistir({ depo: null })]);
  if (suzgec.grup) cipler.push(["grup", "Kategori: " + grupAd(suzgec.grup), () => degistir({ grup: "" })]);

  const baslik = SEKMELER.find((s) => s.kod === sekme)?.ad ?? "";

  return (
    <div className="rm">
      <div className="rm-ust">
        <div>
          <h1>{baslik}</h1>
          <div className="rm-alt">{altBaslik}</div>
        </div>
        <div className="rm-sag">
          <div className="rm-canli" aria-live="polite">
            <span className={`rm-nokta${bugun.veri?.hata ? " pasif" : ""}`} />
            {canli}
            <button className="rm-dugme yuvarlak" onClick={yenile} title="Bugünün verisini ve son günleri yenile">
              <RefreshCw size={13} className={guncelleniyor ? "rm-don" : undefined} /> Yenile
            </button>
          </div>
          {sec.admin && (
            <button className="rm-dugme" onClick={() => setKaynakAcik(true)}>
              <Database size={13} /> Veri kaynakları
            </button>
          )}
        </div>
      </div>

      <nav className="rm-sekmeler" role="tablist" aria-label="Rapor sayfaları">
        {SEKMELER.map((s) => (
          <button key={s.kod} role="tab" aria-selected={sekme === s.kod} onClick={() => sekmeSec(s.kod)}>
            {s.simge}
            {s.ad}
          </button>
        ))}
      </nav>

      <div className="rm-suzgec">
        <div className="rm-alan">
          <label htmlFor="rmDonem">Dönem</label>
          <select
            id="rmDonem"
            value={suzgec.donem}
            onChange={(e) => {
              const d = e.target.value as DonemKodu;
              degistir(d === "ozel" ? { donem: d, bas: isoYaz(r.s), bit: isoYaz(r.e) } : { donem: d });
            }}
          >
            <option value="dun">Dün</option>
            <option value="7">Son 7 gün</option>
            <option value="30">Son 30 gün</option>
            <option value="ay">Bu ay</option>
            <option value="90">Son 90 gün</option>
            <option value="ytd">Yılbaşından beri</option>
            <option value="ozel">Özel aralık…</option>
          </select>
        </div>
        {suzgec.donem === "ozel" && (
          <>
            <div className="rm-alan">
              <label htmlFor="rmBas">Başlangıç</label>
              <input
                id="rmBas"
                type="date"
                value={isoYaz(r.s)}
                max={sec.dun}
                onChange={(e) => e.target.value && degistir({ bas: e.target.value })}
              />
            </div>
            <div className="rm-alan">
              <label htmlFor="rmBit">Bitiş</label>
              <input
                id="rmBit"
                type="date"
                value={isoYaz(r.e)}
                max={sec.dun}
                onChange={(e) => e.target.value && degistir({ bit: e.target.value })}
              />
            </div>
          </>
        )}
        {!sec.kilit && (
          <div className="rm-alan">
            <label htmlFor="rmBolge">Bölge</label>
            <select id="rmBolge" value={suzgec.bolge} onChange={(e) => degistir({ bolge: e.target.value, depo: null })}>
              <option value="">Tüm bölgeler</option>
              {sec.bolgeler.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="rm-alan">
          <label htmlFor="rmSube">Şube</label>
          <select
            id="rmSube"
            value={suzgec.depo ?? ""}
            disabled={!!sec.kilit}
            onChange={(e) => degistir({ depo: e.target.value ? Number(e.target.value) : null })}
          >
            {!sec.kilit && <option value="">Tüm şubeler ({subeListesi.length})</option>}
            {(sec.kilit ? sec.subeler : subeListesi).map((s) => (
              <option key={s.depo} value={s.depo}>
                {s.depo} · {s.ad}
              </option>
            ))}
          </select>
        </div>
        <div className="rm-alan">
          <label htmlFor="rmGrup">Kategori</label>
          <select id="rmGrup" value={suzgec.grup} onChange={(e) => degistir({ grup: e.target.value })}>
            <option value="">Tüm kategoriler</option>
            {sec.gruplar.map((g) => (
              <option key={g.kod} value={g.kod}>
                {g.ad}
              </option>
            ))}
          </select>
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
            Grafik çubuklarına veya tablo satırlarına tıklayarak sayfayı filtreleyebilirsiniz.
          </span>
        )}
      </div>

      {notlar}

      {sekme === "genel" && genel()}
      {sekme === "satis" && satis()}
      {sekme === "stok" && stokSekme()}
      {sekme === "sube" && subeSekme()}

      <div className="rm-dipnot">
        Kaynak: <code>MikroDB_V15_BICEN</code> satış hareketleri (ciro KDV dahil, müşteri iadeleri düşülmüş),
        fire hareketleri (satış fiyatıyla), <code>PUSULA</code> (şube stoğu ve stok günü), depolar arası
        siparişler (transfer)
        {O?.kaynak?.posSaat ? ", PosBack (fiş ve saat)" : ""}
        {O?.kaynak?.posOdeme ? ", PosBack (ödeme tipi)" : ""}. Brüt kâr KDV hariç net satıştan son 365 günün
        ortalama alış maliyeti düşülerek hesaplanır. Bugünün verisi 5 dakikada bir, geçmiş günler her açılışta
        hazır gelir.
      </div>

      {sec.admin && (
        <KaynakCekmece
          acik={kaynakAcik}
          kapat={() => setKaynakAcik(false)}
          kaydedildi={() => {
            secenekAl();
            setYenileSayac((x) => x + 1);
          }}
        />
      )}
    </div>
  );
}

function FragmentSatir({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/* ========================================================================== */
/* Veri kaynakları (yönetici)                                                 */
/* ========================================================================== */

interface KaynakCevap {
  pos: { fisSorgusu: string; odemeSorgusu: string; guncelleyen?: string | null; guncelleme?: string | null };
  kup: {
    yukluGun: number;
    enEski: string | null;
    kuyruk: number;
    yukleniyor: string | null;
    sonHata: string | null;
    sonYukleme: string | null;
  };
  ornek: { fis: string; odeme: string };
}

function KaynakCekmece({ acik, kapat, kaydedildi }: { acik: boolean; kapat: () => void; kaydedildi: () => void }) {
  const [k, setK] = useState<KaynakCevap | null>(null);
  const [fis, setFis] = useState("");
  const [odeme, setOdeme] = useState("");
  const [deneme, setDeneme] = useState<Record<string, unknown> | null>(null);
  const [tani, setTani] = useState<unknown>(null);
  const [mesgul, setMesgul] = useState<string | null>(null);

  const al = useCallback(() => {
    api
      .getir<KaynakCevap>("RaporMerkezi/Kaynak")
      .then((v) => {
        setK(v);
        setFis(v.pos.fisSorgusu ?? "");
        setOdeme(v.pos.odemeSorgusu ?? "");
      })
      .catch((e) => message.error(e.message));
  }, []);

  useEffect(() => {
    if (acik) al();
  }, [acik, al]);

  const dene = async (tur: "fis" | "odeme") => {
    setMesgul(tur);
    setDeneme(null);

    try {
      setDeneme(await api.gonder<Record<string, unknown>>("RaporMerkezi/KaynakDene", { tur, sql: tur === "fis" ? fis : odeme }));
    } catch (e) {
      setDeneme({ hata: (e as Error).message });
    } finally {
      setMesgul(null);
    }
  };

  const kaydet = async () => {
    setMesgul("kaydet");

    try {
      await api.gonder("RaporMerkezi/Kaynak", { fisSorgusu: fis, odemeSorgusu: odeme });
      message.success("Kaydedildi. Satış küpü yeni kaynakla yeniden hazırlanacak.");
      kaydedildi();
      al();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setMesgul(null);
    }
  };

  const taniAl = async () => {
    setMesgul("tani");

    try {
      setTani(await api.getir("RaporMerkezi/PosTani"));
    } catch (e) {
      setTani({ hata: (e as Error).message });
    } finally {
      setMesgul(null);
    }
  };

  const temizle = async () => {
    setMesgul("temizle");

    try {
      await api.gonder("RaporMerkezi/OnbellekTemizle", {});
      message.success("Önbellek temizlendi; veriler Mikro'dan yeniden okunacak.");
      kaydedildi();
      al();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setMesgul(null);
    }
  };

  return (
    <Drawer title="Veri kaynakları" open={acik} onClose={kapat} width={Math.min(720, window.innerWidth)} className="rm-kaynak">
      {!k ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <div>
            <b>Satış küpü</b>
            <div className="rm-ipucu-metin">
              Bellekte {N0.format(k.kup.yukluGun)} gün
              {k.kup.enEski ? ` (en eski ${k.kup.enEski})` : ""} · kuyrukta {N0.format(k.kup.kuyruk)} gün
              {k.kup.yukleniyor ? ` · ${k.kup.yukleniyor}` : ""}
            </div>
            {k.kup.sonHata && <div className="rm-not hata" style={{ marginTop: 6 }}>{k.kup.sonHata}</div>}
            <Popconfirm
              title="Önbellek temizlensin mi?"
              description="Bütün günler Mikro'dan yeniden okunur; uzun dönemler birkaç dakika sürer."
              okText="Temizle"
              cancelText="Vazgeç"
              onConfirm={temizle}
            >
              <Button size="small" style={{ marginTop: 8 }} loading={mesgul === "temizle"}>
                Önbelleği temizle
              </Button>
            </Popconfirm>
          </div>

          <div>
            <b>PosBack · fiş ve saat sorgusu</b>
            <div className="rm-ipucu-metin">
              <code>@bas</code> ve <code>@bit</code> (bitiş hariç) parametreleriyle çalışan tek bir SELECT. Sütunlar:{" "}
              <code>gun, depo, saat, fis, ciro</code>. <code>depo</code> Mikro depo numarası olmalı. Tanımlanınca fiş
              sayısı, sepet ortalaması ve saatlik dağılım kasadan gelir.
            </div>
            <Input.TextArea
              rows={8}
              value={fis}
              onChange={(e) => setFis(e.target.value)}
              placeholder={k.ornek.fis}
              style={{ marginTop: 6 }}
            />
            <Space style={{ marginTop: 6 }}>
              <Button size="small" onClick={() => dene("fis")} loading={mesgul === "fis"} disabled={!fis.trim()}>
                Dünle dene
              </Button>
              <Button size="small" type="link" onClick={() => setFis(k.ornek.fis)}>
                Örneği yaz
              </Button>
            </Space>
          </div>

          <div>
            <b>PosBack · ödeme tipi sorgusu</b>
            <div className="rm-ipucu-metin">
              Sütunlar: <code>gun, depo, tip, tutar</code>. <code>tip</code> ekranda görünecek ad (Nakit, Kredi kartı,
              Biçen Kart, Yemek kartı…).
            </div>
            <Input.TextArea
              rows={8}
              value={odeme}
              onChange={(e) => setOdeme(e.target.value)}
              placeholder={k.ornek.odeme}
              style={{ marginTop: 6 }}
            />
            <Space style={{ marginTop: 6 }}>
              <Button size="small" onClick={() => dene("odeme")} loading={mesgul === "odeme"} disabled={!odeme.trim()}>
                Dünle dene
              </Button>
              <Button size="small" type="link" onClick={() => setOdeme(k.ornek.odeme)}>
                Örneği yaz
              </Button>
            </Space>
          </div>

          {deneme && <pre>{JSON.stringify(deneme, null, 2)}</pre>}

          <Space>
            <Button type="primary" onClick={kaydet} loading={mesgul === "kaydet"}>
              Kaydet
            </Button>
            <span className="rm-ipucu-metin">
              {k.pos.guncelleme ? `Son değişiklik: ${k.pos.guncelleyen ?? ""} · ${new Date(k.pos.guncelleme).toLocaleString("tr-TR")}` : ""}
            </span>
          </Space>

          <div>
            <b>PosBack tanısı</b>
            <div className="rm-ipucu-metin">
              Sorguyu yazmak için PosBack'teki en kalabalık tablolar ve sütunları. Çıktıyı kopyalayıp gönderirseniz
              sorgular hazırlanabilir.
            </div>
            <Space style={{ marginTop: 6 }}>
              <Button size="small" onClick={taniAl} loading={mesgul === "tani"}>
                Tabloları listele
              </Button>
              {tani != null && (
                <Button
                  size="small"
                  icon={<Copy size={13} />}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(JSON.stringify(tani, null, 2))
                      .then(() => message.success("Tanı çıktısı kopyalandı"))
                  }
                >
                  Kopyala
                </Button>
              )}
            </Space>
            {tani != null && <pre style={{ marginTop: 6 }}>{JSON.stringify(tani, null, 2)}</pre>}
          </div>
        </Space>
      )}
    </Drawer>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Kenar Menü
 * ---------------------------------------------------------------------------
 * Panelin sol menüsü. Hangi sayfaların görüneceğine App karar veriyor (rol
 * kapıları, Rol Yetkileri, Yönetim'deki menü sırası ve alt gruplar); bu
 * bileşen yalnızca o süzülmüş listeyi gruplara ayırıp çiziyor.
 *
 * Gruplama sayfa anahtarına göre yapılıyor (App.tsx'teki MENU_GRUPLARI).
 * Eşlemede bulunmayan bir anahtar "Diğer" grubuna düşüyor: yeni bir sayfa
 * eklenip eşlemeye yazılmayı unutulsa da menüden kaybolmuyor.
 *
 * Kullanıcıya ait küçük tercihler tarayıcıda tutuluyor (her erişim
 * try/catch içinde; gizli pencerede ya da kapalı depolamada menü yine
 * çalışır):
 *   - sık kullanılanlar  → bicen_ik_km_sabit_<kullanıcı adı>
 *   - dar / geniş        → bicen_ik_km_dar
 *   - açık / koyu tema   → bicen_ik_km_tema
 *   - kapatılan gruplar  → bicen_ik_km_gruplar
 *
 * Üstteki marka bloğu (başlık, alt başlık, logo) Yönetim → Panel
 * Görünümü'nden geliyor (panelGorunum.ts).
 * ---------------------------------------------------------------------------
 */

import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Dropdown, type MenuProps } from "antd";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  LogOut,
  MessageSquarePlus,
  Sparkles,
  Moon,
  Search,
  Star,
  Sun,
  X,
} from "lucide-react";

import "./KenarMenu.css";
import {
  logoAdresi,
  rozetStili,
  usePanelGorunum,
  type PanelGorunum,
} from "./panelGorunum";

/* ========================================================================== */
/* Tipler                                                                      */
/* ========================================================================== */

export type MenuAltOgesi = { key: string; label: ReactNode };

export type MenuOgesi = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  children?: MenuAltOgesi[];
};

/** Grup tanımı: başlık ve o gruba giren sayfa anahtarları (sıralı) */
export type MenuGrubu = { ad: string; anahtarlar: string[] };

/** Çizime hazır grup */
export type KurulmusGrup = { ad: string; ogeler: MenuOgesi[] };

export type MenuTema = "koyu" | "acik";

/** Eşlemede bulunmayan sayfaların düştüğü grup */
export const DIGER_GRUP = "Diğer";

/** Turuncu (sıcak) rozet alan sayfalar: beklenen iş kişinin kendisinde */
const SICAK = new Set(["basvurular", "izintalep", "etik", "mesajlasma"]);

const SIK_KULLANILANLAR = "Sık kullanılanlar";

/** Kenar menünün çekmeceye dönüştüğü genişlik (AntD "lg" kırılımı) */
export const CEKMECE_ESIGI = 992;

/* ========================================================================== */
/* Depolama                                                                    */
/* ========================================================================== */

export const depoOku = (anahtar: string): string | null => {
  try {
    return window.localStorage.getItem(anahtar);
  } catch {
    return null;
  }
};

export const depoYaz = (anahtar: string, deger: string) => {
  try {
    window.localStorage.setItem(anahtar, deger);
  } catch {
    /* Depolama kapalı: tercih yalnızca bu oturumda geçerli kalır */
  }
};

const listeOku = (anahtar: string): string[] => {
  try {
    const ham = depoOku(anahtar);
    const veri = ham ? JSON.parse(ham) : [];
    return Array.isArray(veri) ? veri.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const DAR_ANAHTARI = "bicen_ik_km_dar";
export const TEMA_ANAHTARI = "bicen_ik_km_tema";
const GRUP_ANAHTARI = "bicen_ik_km_gruplar";
const sabitAnahtari = (kullanici: string) =>
  `bicen_ik_km_sabit_${(kullanici || "anonim").toLocaleLowerCase("tr-TR")}`;

/* ========================================================================== */
/* Ekran genişliği                                                             */
/* ========================================================================== */

const cekmeceMi = () =>
  typeof window !== "undefined" && window.innerWidth < CEKMECE_ESIGI;

/** 992 pikselin altında kenar menü yerine çekmece kullanılır */
export function useKenarCekmece(): boolean {
  const [cekmece, setCekmece] = useState(cekmeceMi);

  useEffect(() => {
    const olcum = () => setCekmece(cekmeceMi());

    window.addEventListener("resize", olcum);
    return () => window.removeEventListener("resize", olcum);
  }, []);

  return cekmece;
}

/* ========================================================================== */
/* Gruplama                                                                    */
/* ========================================================================== */

const metin = (d: ReactNode): string =>
  typeof d === "string" || typeof d === "number" ? String(d) : "";

/**
 * Süzülmüş menüyü gruplara ayırır.
 *
 * Yönetim'de oluşturulan alt gruplar "<anahtar>Grup" adıyla geliyor;
 * eşlemede yoksa baştaki sayfanın grubuna yerleşir.
 *
 * `ozelSira` doluysa (Yönetim'den menü sırası ayarlanmış) grup içi sıra
 * o sıradır; boşsa eşlemedeki sıra kullanılır.
 */
export function menuyuGrupla(
  ogeler: MenuOgesi[],
  gruplar: MenuGrubu[],
  ozelSira: boolean
): KurulmusGrup[] {
  const yer = new Map<string, { grup: number; sira: number }>();

  gruplar.forEach((g, gi) =>
    g.anahtarlar.forEach((k, si) => {
      if (!yer.has(k)) yer.set(k, { grup: gi, sira: si });
    })
  );

  const bul = (k: string) =>
    yer.get(k) ?? (k.endsWith("Grup") ? yer.get(k.slice(0, -4)) : undefined);

  const kovalar: { oge: MenuOgesi; sira: number; asil: number }[][] =
    gruplar.map(() => []);
  const diger: MenuOgesi[] = [];

  ogeler.forEach((oge, asil) => {
    if (!oge?.key) return;

    const y = bul(oge.key);

    if (y) kovalar[y.grup].push({ oge, sira: y.sira, asil });
    else diger.push(oge);
  });

  const sonuc: KurulmusGrup[] = gruplar
    .map((g, gi) => ({
      ad: g.ad,
      ogeler: [...kovalar[gi]]
        .sort((a, b) => (ozelSira ? a.asil - b.asil : a.sira - b.sira || a.asil - b.asil))
        .map((x) => x.oge),
    }))
    /* Rolde görünür öğesi olmayan grup hiç çizilmez */
    .filter((g) => g.ogeler.length > 0);

  if (diger.length > 0) sonuc.push({ ad: DIGER_GRUP, ogeler: diger });

  return sonuc;
}

/** Seçili sayfanın menüdeki yeri: üst bardaki "Grup / Sayfa" yazısı için */
export function menuYolu(
  gruplar: KurulmusGrup[],
  sekme: string
): { grup: string; ust?: string; ad: string } | null {
  for (const g of gruplar) {
    for (const o of g.ogeler) {
      if (o.key === sekme && !o.children) return { grup: g.ad, ad: metin(o.label) };

      const alt = o.children?.find((c) => c.key === sekme);

      if (alt) {
        const ustAd = metin(o.label);
        const altAd = metin(alt.label);

        /* Yönetim'den kurulan grupta sayfanın kendisi ilk alt öğe olur;
           "Yıllık İzin / Yıllık İzin" yazmasın. */
        return ustAd === altAd
          ? { grup: g.ad, ad: altAd }
          : { grup: g.ad, ust: ustAd, ad: altAd };
      }
    }
  }

  return null;
}

/* ========================================================================== */
/* Bileşen                                                                     */
/* ========================================================================== */

type Props = {
  gruplar: KurulmusGrup[];
  secili: string;
  sec: (anahtar: string) => void;

  /** Sayfa anahtarı → bekleyen iş sayısı */
  sayilar: Record<string, number | null | undefined>;

  kullaniciAdi: string;
  adSoyad: string;
  rolAdi: string;

  /** Kullanıcı kartına tıklanınca açılan menü (Profilim, Çıkış…) */
  kullaniciMenusu: MenuProps["items"];
  cikis: () => void;

  /** Yenilikler penceresi (tüm liste) ve okunmamış sayısı (30.10.2026) */
  yenilikAc?: () => void;
  yenilikSayisi?: number;
  /** Talep / Öneri penceresi */
  talepAc?: () => void;

  dar: boolean;
  darDegistir: (dar: boolean) => void;
  tema: MenuTema;
  temaDegistir: (tema: MenuTema) => void;

  /** Dar ekran çekmecesinde: daraltma yok, kapatma düğmesi var */
  cekmece?: boolean;
  kapat?: () => void;

  /** Her artışta arama kutusuna odaklanılır (çekmecede Ctrl+K) */
  aramaIstegi?: number;
};

/* ========================================================================== */
/* Marka bloğu                                                                 */
/* ========================================================================== */

/**
 * Logo rozeti: harf, yüklenen görsel ya da kurum logosu.
 * Görsel yüklenemezse (silinmiş, ağ hatası) harf rozetine düşer.
 */
export function MarkaRozeti({ gorunum }: { gorunum: PanelGorunum }) {
  const adres = logoAdresi(gorunum);
  const [hataliAdres, setHataliAdres] = useState("");

  if (adres && adres !== hataliAdres) {
    return (
      <div
        className={`km-rozet km-rozet-gorsel${gorunum.gorselZemin === "seffaf" ? " km-rozet-seffaf" : ""}`}
        aria-hidden
      >
        <img src={adres} alt="" draggable={false} onError={() => setHataliAdres(adres)} />
      </div>
    );
  }

  return (
    <div
      className={`km-rozet${Array.from(gorunum.harf).length > 1 ? " km-rozet-iki" : ""}`}
      style={rozetStili(gorunum)}
      aria-hidden
    >
      {gorunum.harf}
    </div>
  );
}

/** Rozet, başlık ve alt başlık; ayar ekranındaki önizleme de bunu çiziyor */
export function MarkaBlogu({ gorunum, children }: { gorunum: PanelGorunum; children?: ReactNode }) {
  return (
    <div className="km-logo">
      <MarkaRozeti gorunum={gorunum} />
      <div className="km-yazi">
        <b title={gorunum.baslik}>{gorunum.baslik}</b>
        {gorunum.altBaslik && <small title={gorunum.altBaslik}>{gorunum.altBaslik}</small>}
      </div>
      {children}
    </div>
  );
}

/** Ad soyadın baş harfleri; taklit oturumundaki "(… adına)" eki atlanır */
const basHarfler = (ad: string): string => {
  const parcalar = (ad || "")
    .replace(/\(.*\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parcalar.length === 0) return "?";

  const ilk = parcalar[0][0] ?? "";
  const son = parcalar.length > 1 ? parcalar[parcalar.length - 1][0] ?? "" : "";

  return (ilk + son).toLocaleUpperCase("tr-TR");
};

const sayiYaz = (n: number) => (n > 999 ? "999+" : String(n));

const ikon = (d: ReactNode, boyut = 18): ReactNode =>
  isValidElement(d)
    ? cloneElement(d as any, { size: boyut, strokeWidth: 1.9, "aria-hidden": true })
    : <Circle size={boyut} strokeWidth={1.9} aria-hidden />;

export default function KenarMenu({
  gruplar,
  secili,
  sec,
  sayilar,
  kullaniciAdi,
  adSoyad,
  rolAdi,
  kullaniciMenusu,
  cikis,
  yenilikAc,
  yenilikSayisi = 0,
  talepAc,
  dar: darIstek,
  darDegistir,
  tema,
  temaDegistir,
  cekmece = false,
  kapat,
  aramaIstegi = 0,
}: Props) {
  /* Çekmecede menü hep geniş */
  const dar = darIstek && !cekmece;

  /* Marka bloğu: Yönetim → Panel Görünümü */
  const gorunum = usePanelGorunum();

  const [ara, setAra] = useState("");
  const aramaKutusu = useRef<HTMLInputElement>(null);

  const [sabit, setSabit] = useState<string[]>(() =>
    listeOku(sabitAnahtari(kullaniciAdi))
  );
  const [kapaliGruplar, setKapaliGruplar] = useState<string[]>(() =>
    listeOku(GRUP_ANAHTARI)
  );
  const [acikAltlar, setAcikAltlar] = useState<string[]>([]);

  const [ipucu, setIpucu] = useState<{ metin: string; x: number; y: number } | null>(null);
  const [acilir, setAcilir] = useState<{ anahtar: string; x: number; y: number } | null>(null);
  const acilirRef = useRef<HTMLDivElement>(null);

  /* Kullanıcı değişince (taklit, yeniden giriş) kendi sabitleri okunur */
  useEffect(() => {
    setSabit(listeOku(sabitAnahtari(kullaniciAdi)));
  }, [kullaniciAdi]);

  /* Seçili sayfa bir alt grubun içindeyse o grup açık gelir */
  useEffect(() => {
    for (const g of gruplar)
      for (const o of g.ogeler)
        if (o.children?.some((c) => c.key === secili))
          setAcikAltlar((l) => (l.includes(o.key) ? l : [...l, o.key]));
  }, [secili, gruplar]);

  /* Seçili sayfa menünün görünen alanı dışındaysa oraya kaydırılır
     (bildirimden gelen geçiş, aşağıdaki bir sayfada yenileme). Yalnızca
     menü kaydırılır; scrollIntoView sayfayı da kaydırabiliyordu. */
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = menuRef.current;
    const el = nav?.querySelector<HTMLElement>(".km-ogeler .km-aktif");
    if (!nav || !el) return;

    const n = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();

    if (r.top < n.top) nav.scrollTop -= n.top - r.top + 8;
    else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom + 8;
  }, [secili, dar]);

  /* Daraltınca ipucu ve açılır panel kapanır */
  useEffect(() => {
    setIpucu(null);
    setAcilir(null);
  }, [dar]);

  /* Ctrl/Cmd+K: arama kutusu. Çekmecede App dinliyor (çekmeceyi açması
     gerekiyor) ve aramaIstegi ile haber veriyor. */
  useEffect(() => {
    if (cekmece) return;

    const tus = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dar) darDegistir(false);
        /* Dar modda kutu gizli; genişledikten sonra odaklanılır */
        window.setTimeout(() => aramaKutusu.current?.focus(), dar ? 60 : 0);
      }
    };

    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [cekmece, dar, darDegistir]);

  useEffect(() => {
    if (aramaIstegi > 0)
      window.setTimeout(() => aramaKutusu.current?.focus(), 120);
  }, [aramaIstegi]);

  /* Açılır alt menü: dışarı tıklanınca ya da Esc ile kapanır */
  useEffect(() => {
    if (!acilir) return;

    const disari = (e: MouseEvent) => {
      if (acilirRef.current && !acilirRef.current.contains(e.target as Node))
        setAcilir(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAcilir(null);
    };

    window.addEventListener("mousedown", disari);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", disari);
      window.removeEventListener("keydown", esc);
    };
  }, [acilir]);

  /* ------------------------------------------------------------ türetilen */

  const tumOgeler = useMemo(() => gruplar.flatMap((g) => g.ogeler), [gruplar]);

  /* Sabitlenen ama bu rolde görünmeyen sayfa listede gösterilmez */
  const sabitOgeler = useMemo(
    () =>
      sabit
        .map((k) => tumOgeler.find((o) => o.key === k && !o.children))
        .filter((o): o is MenuOgesi => !!o),
    [sabit, tumOgeler]
  );

  const sorgu = ara.trim().toLocaleLowerCase("tr-TR");
  const eslesir = (d: ReactNode) => metin(d).toLocaleLowerCase("tr-TR").includes(sorgu);

  /** Aramaya göre süzülmüş gruplar; alt öğeler de aranır */
  const gorunen = useMemo((): KurulmusGrup[] => {
    const temel: KurulmusGrup[] =
      !sorgu && sabitOgeler.length > 0
        ? [{ ad: SIK_KULLANILANLAR, ogeler: sabitOgeler }, ...gruplar]
        : gruplar;

    if (!sorgu) return temel;

    return temel
      .map((g) => ({
        ad: g.ad,
        ogeler: g.ogeler
          .map((o) => {
            if (!o.children) return eslesir(o.label) ? o : null;
            if (eslesir(o.label)) return o;

            const altlar = o.children.filter((c) => eslesir(c.label));
            return altlar.length > 0 ? { ...o, children: altlar } : null;
          })
          .filter((o): o is MenuOgesi => !!o),
      }))
      .filter((g) => g.ogeler.length > 0);
    // eslesir sorguya bağlı; sorgu bağımlılıkta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gruplar, sabitOgeler, sorgu]);

  /** Aramada Enter'ın açacağı ilk sayfa */
  const ilkSonuc = (): string | null => {
    for (const g of gorunen)
      for (const o of g.ogeler) {
        if (!o.children) return o.key;
        if (o.children.length > 0) return o.children[0].key;
      }
    return null;
  };

  /* ------------------------------------------------------------- işlemler */

  const git = (anahtar: string) => {
    setIpucu(null);
    setAcilir(null);
    sec(anahtar);
  };

  const sabitle = (anahtar: string) => {
    setSabit((l) => {
      const yeni = l.includes(anahtar) ? l.filter((k) => k !== anahtar) : [...l, anahtar];
      depoYaz(sabitAnahtari(kullaniciAdi), JSON.stringify(yeni));
      return yeni;
    });
  };

  const grupDegistir = (ad: string) => {
    setKapaliGruplar((l) => {
      const yeni = l.includes(ad) ? l.filter((x) => x !== ad) : [...l, ad];
      depoYaz(GRUP_ANAHTARI, JSON.stringify(yeni));
      return yeni;
    });
  };

  const altDegistir = (anahtar: string) =>
    setAcikAltlar((l) =>
      l.includes(anahtar) ? l.filter((k) => k !== anahtar) : [...l, anahtar]
    );

  const aramaTusu = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const k = ilkSonuc();
      if (k) {
        git(k);
        setAra("");
        aramaKutusu.current?.blur();
      }
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (ara) setAra("");
      else aramaKutusu.current?.blur();
    }
  };

  const ipucuGoster = (el: HTMLElement, yazi: string) => {
    if (!dar) return;
    const r = el.getBoundingClientRect();
    setIpucu({ metin: yazi, x: r.right + 12, y: r.top + r.height / 2 });
  };

  /* --------------------------------------------------------------- çizim */

  const sayiOku = (k: string): number => {
    const n = sayilar?.[k];
    return typeof n === "number" && n > 0 ? n : 0;
  };

  const ogeCiz = (o: MenuOgesi, grupAdi: string) => {
    const altVar = !!o.children && o.children.length > 0;
    const altAktif = altVar && o.children!.some((c) => c.key === secili);
    const altAcik = altVar && (!!sorgu || acikAltlar.includes(o.key));
    const aktif = o.key === secili || (altAktif && (!altAcik || dar));
    const say = altVar ? 0 : sayiOku(o.key);
    const sicak = say > 0 && SICAK.has(o.key);
    const sabitMi = sabit.includes(o.key);
    const ad = metin(o.label);
    const ipucuMetni = say > 0 ? `${ad} · ${sayiYaz(say)}` : ad;

    const tikla = (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (!altVar) return git(o.key);

      if (dar) {
        const r = e.currentTarget.getBoundingClientRect();
        setIpucu(null);
        setAcilir((a) =>
          a?.anahtar === o.key ? null : { anahtar: o.key, x: r.right + 10, y: r.top }
        );
        return;
      }

      altDegistir(o.key);
    };

    return (
      <li key={`${grupAdi}:${o.key}`} className="km-satir">
        <div
          className={[
            "km-oge",
            aktif ? "km-aktif" : "",
            altAktif && altAcik && !dar ? "km-ust-aktif" : "",
          ].join(" ")}
        >
          <button
            type="button"
            className="km-oge-dugme"
            onClick={tikla}
            aria-current={o.key === secili ? "page" : undefined}
            aria-expanded={altVar && !dar ? altAcik : undefined}
            aria-haspopup={altVar && dar ? "menu" : undefined}
            aria-label={dar ? ipucuMetni : undefined}
            onMouseEnter={(e) => ipucuGoster(e.currentTarget, ipucuMetni)}
            onMouseLeave={() => setIpucu(null)}
            onFocus={(e) => ipucuGoster(e.currentTarget, ipucuMetni)}
            onBlur={() => setIpucu(null)}
          >
            <span className="km-ikon">{ikon(o.icon)}</span>
            <span className="km-ad">{o.label}</span>
            {say > 0 && (
              <span className={`km-say${sicak ? " km-sicak" : ""}`}>{sayiYaz(say)}</span>
            )}
            {sicak && <span className="km-nokta" aria-hidden />}
            {altVar && (
              <ChevronRight className="km-acil-ok" size={15} strokeWidth={2} aria-hidden />
            )}
          </button>

          {!altVar && (
            <button
              type="button"
              className={`km-yildiz${sabitMi ? " km-secili" : ""}`}
              onClick={() => sabitle(o.key)}
              title={sabitMi ? "Sabitlemeyi kaldır" : "Sık kullanılanlara sabitle"}
              aria-label={sabitMi ? `${ad}: sabitlemeyi kaldır` : `${ad}: sık kullanılanlara sabitle`}
              aria-pressed={sabitMi}
            >
              <Star size={15} strokeWidth={1.9} fill={sabitMi ? "currentColor" : "none"} aria-hidden />
            </button>
          )}
        </div>

        {altVar && altAcik && !dar && (
          <ul className="km-alt-liste">
            {o.children!.map((c) => (
              <li key={c.key}>
                <div className={`km-oge km-alt-oge${c.key === secili ? " km-aktif" : ""}`}>
                  <button
                    type="button"
                    className="km-oge-dugme"
                    onClick={() => git(c.key)}
                    aria-current={c.key === secili ? "page" : undefined}
                  >
                    <span className="km-ad">{c.label}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const acilirOge = acilir ? tumOgeler.find((o) => o.key === acilir.anahtar) : null;

  return (
    <aside
      className={[
        "km",
        tema === "acik" ? "km-acik" : "km-koyu",
        dar ? "km-dar" : "",
        cekmece ? "km-cekmece" : "",
      ].join(" ")}
      aria-label="Kenar menü"
    >
      {!cekmece && (
        <button
          type="button"
          className="km-daralt"
          onClick={() => darDegistir(!dar)}
          title={dar ? "Menüyü genişlet" : "Menüyü daralt"}
          aria-label={dar ? "Menüyü genişlet" : "Menüyü daralt"}
          aria-expanded={!dar}
        >
          <ChevronLeft size={14} strokeWidth={2.2} aria-hidden />
        </button>
      )}

      <MarkaBlogu gorunum={gorunum}>
        {cekmece && kapat && (
          <button type="button" className="km-ikbtn km-kapat" onClick={kapat} aria-label="Menüyü kapat">
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        )}
      </MarkaBlogu>

      <div className="km-ara">
        <Search size={16} strokeWidth={1.9} aria-hidden />
        <input
          ref={aramaKutusu}
          value={ara}
          onChange={(e) => setAra(e.target.value)}
          onKeyDown={aramaTusu}
          placeholder="Menüde ara"
          aria-label="Menüde ara"
          spellCheck={false}
          autoComplete="off"
        />
        {ara ? (
          <button
            type="button"
            className="km-ara-temizle"
            onClick={() => {
              setAra("");
              aramaKutusu.current?.focus();
            }}
            aria-label="Aramayı temizle"
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        ) : (
          !cekmece && <kbd>Ctrl K</kbd>
        )}
      </div>

      <nav ref={menuRef} className="km-menu" aria-label="Sayfalar" onScroll={() => setIpucu(null)}>
        {gorunen.map((g) => {
          const kapali = !sorgu && !dar && kapaliGruplar.includes(g.ad);

          /* Kapalı grupta seçili sayfa yine görünür: kullanıcı nerede
             olduğunu kaybetmesin */
          const ogeler = kapali
            ? g.ogeler.filter(
                (o) => o.key === secili || o.children?.some((c) => c.key === secili)
              )
            : g.ogeler;

          return (
            <section
              key={g.ad}
              className={`km-grup${kapali ? " km-kapali" : ""}${g.ad === SIK_KULLANILANLAR ? " km-sik" : ""}`}
            >
              <button
                type="button"
                className="km-grup-bas"
                onClick={() => grupDegistir(g.ad)}
                aria-expanded={!kapali}
              >
                {g.ad === SIK_KULLANILANLAR && (
                  <Star size={13} strokeWidth={1.9} fill="currentColor" className="km-sik-yildiz" aria-hidden />
                )}
                <span>{g.ad}</span>
                <ChevronDown className="km-ok" size={14} strokeWidth={2} aria-hidden />
              </button>

              {ogeler.length > 0 && <ul className="km-ogeler">{ogeler.map((o) => ogeCiz(o, g.ad))}</ul>}
            </section>
          );
        })}

        {sorgu && gorunen.length === 0 && (
          <div className="km-bos">"{ara.trim()}" için menüde sonuç yok.</div>
        )}
      </nav>

      <div className="km-alt">
        {(yenilikAc || talepAc) && (
          <div className="km-yardim">
            {yenilikAc && (
              <button
                type="button"
                className={`km-yardim-btn${yenilikSayisi > 0 ? " km-yeni-var" : ""}`}
                onClick={yenilikAc}
                title="Yenilikler"
                aria-label={yenilikSayisi > 0 ? `Yenilikler, ${yenilikSayisi} okunmamış` : "Yenilikler"}
              >
                <span className="km-yardim-ikon">
                  <Sparkles size={16} strokeWidth={1.9} aria-hidden />
                  {yenilikSayisi > 0 && <i className="km-yardim-nokta" aria-hidden />}
                </span>
                <span className="km-yardim-metin">Yenilikler</span>
              </button>
            )}
            {talepAc && (
              <button type="button" className="km-yardim-btn" onClick={talepAc} title="Talep / Öneri" aria-label="Talep / Öneri">
                <span className="km-yardim-ikon">
                  <MessageSquarePlus size={16} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="km-yardim-metin">Talep / Öneri</span>
              </button>
            )}
          </div>
        )}

        <div className="km-kullanici">
          <Dropdown menu={{ items: kullaniciMenusu }} trigger={["click"]} placement="topLeft">
            <button
              type="button"
              className="km-kisi"
              aria-label={`${adSoyad} · ${rolAdi} — kullanıcı menüsü`}
              onMouseEnter={(e) => ipucuGoster(e.currentTarget, adSoyad)}
              onMouseLeave={() => setIpucu(null)}
            >
              <span className="km-av" aria-hidden>{basHarfler(adSoyad)}</span>
              <span className="km-bilgi">
                <b>{adSoyad}</b>
                <small>{rolAdi}</small>
              </span>
            </button>
          </Dropdown>

          <button
            type="button"
            className="km-ikbtn"
            onClick={() => temaDegistir(tema === "acik" ? "koyu" : "acik")}
            title={tema === "acik" ? "Koyu menü" : "Açık menü"}
            aria-label={tema === "acik" ? "Koyu menüye geç" : "Açık menüye geç"}
          >
            {tema === "acik" ? (
              <Moon size={18} strokeWidth={1.9} aria-hidden />
            ) : (
              <Sun size={18} strokeWidth={1.9} aria-hidden />
            )}
          </button>

          <button type="button" className="km-ikbtn" onClick={cikis} title="Çıkış yap" aria-label="Çıkış yap">
            <LogOut size={18} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      </div>

      {ipucu && (
        <div className="km-ipucu" role="tooltip" style={{ left: ipucu.x, top: ipucu.y }}>
          {ipucu.metin}
        </div>
      )}

      {acilir && acilirOge?.children && (
        <div
          ref={acilirRef}
          className="km-acilir"
          role="menu"
          aria-label={metin(acilirOge.label)}
          style={{ left: acilir.x, top: acilir.y }}
        >
          <div className="km-acilir-baslik">{acilirOge.label}</div>
          {acilirOge.children.map((c) => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              className={`km-acilir-oge${c.key === secili ? " km-aktif" : ""}`}
              onClick={() => git(c.key)}
              autoFocus={c === acilirOge.children![0]}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

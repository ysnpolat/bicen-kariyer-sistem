/**
 * ---------------------------------------------------------------------------
 * Oryantasyon Takip
 * ---------------------------------------------------------------------------
 * İşe yeni başlayan personelin belirli dönemlerde aranıp durumunun
 * öğrenilmesi içindir: oryantasyon (7 gün), 2. ay, 6. ay ve 1. yıl.
 *
 * Her dönemin bir tolerans aralığı vardır; o aralığa giren personel
 * listelenir. Görüşme yapıldığında not eklenir ve dönem tamamlanmış sayılır.
 *
 * Görünüm onaylanan önizlemeye göre (oryantasyon-takip-onizleme-v2):
 * altı sekme (takip listesi, pano, çalışan karneleri, mağaza & yönetici,
 * trend & analiz, icra kurulu), yandan açılan karne çekmecesi, satır
 * menüsü ve pencereler. Oryantasyon anketleri artık yalnızca Biçen360
 * mobil uygulamasına gider (otomatik ve elle gönderim, yeniden gönderim,
 * hatırlatma); SMS gitmez. Yönetici değerlendirmesi de Biçen360'tan
 * (ana sayfa kartları + Ekibim) yapılır. Kanal rozeti eski SMS kayıtları
 * için durur. Biçen360'a giriş yapmamış kişide anket yine açılır,
 * bildirim gidemez; sunucu bunları ayrıca bildirir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  Alert,
  App as AntdApp,
  Checkbox,
  Drawer,
  Dropdown,
  Empty,
  Modal,
  Select,
  Spin,
  Table,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import dayjs from "dayjs";
import {
  Download,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Smartphone,
  Store,
  User,
  X,
} from "lucide-react";

import "./PersonelTakip.css";
import { DonemselKarne } from "./DonemselDegerlendirme";
import { anketGonderme, api, oturumOku } from "./api";
import { PersonelAdi } from "./personelKarti";

/* ========================================================================= */
/* Sabitler ve küçük yardımcılar                                             */
/* ========================================================================= */

/** Aşamalar: takip dönemi adı (sunucudaki), anket aşama kodu ve ekran adı */
const ASAMALAR = [
  { kod: "7g", donem: "Oryantasyon", ad: "7. gün", enAz: 7 },
  { kod: "2a", donem: "2. Ay", ad: "2. ay", enAz: 55 },
  { kod: "6a", donem: "6. Ay", ad: "6. ay", enAz: 170 },
  { kod: "1y", donem: "1. Yıl", ad: "1. yıl", enAz: 355 },
];

const asamaAdi = (kod?: string | null) =>
  ASAMALAR.find((a) => a.kod === kod)?.ad ?? kod ?? "—";

const donemdenKod = (donem?: string | null) =>
  ASAMALAR.find((a) => a.donem === donem)?.kod;

const donemAdi = (donem?: string | null) =>
  ASAMALAR.find((a) => a.donem === donem)?.ad ?? donem ?? "";

/** Görüşme sonucu seçenekleri */
const DURUMLAR = [
  { value: "Görüşüldü", label: "Görüşüldü · sorun yok", renk: "yesil" },
  { value: "Sorun Var", label: "Sorun bildirdi", renk: "turuncu" },
  { value: "Şube Değişikliği İstedi", label: "Şube değişikliği istedi", renk: "sari" },
  { value: "Ulaşılamadı", label: "Ulaşılamadı", renk: "gri" },
  { value: "Ayrılmayı Düşünüyor", label: "Ayrılmayı düşünüyor", renk: "kirmizi" },
];

/** Seri renkleri (doğrulanmış palet): çalışan yeşil, yönetici mavi */
const RENK_CAL = "#5f8c10";
const RENK_YON = "#2e6aa8";
const RENK_TURUNCU = "#e8481c";
const RENK_TURUNCU_YAZI = "#a33410";
const RENK_YESIL_YAZI = "#3f6507";

/** Erken ayrılma risk eşikleri: 60 ve üstü riskli (İK görüşmesi), 35 ve üstü yakın takip */
const RISK_YUKSEK = 60;
const RISK_ORTA = 35;

/** Sayıyı Türkçe yazımıyla verir: ondalık ayracı virgüldür. */
const sayiYaz = (v: number | null | undefined, basamak = 1) =>
  v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(basamak).replace(".", ",");

const tarihSaat = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—");
const tarih = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY") : "—");

/** Sicil karşılaştırması: baştaki sıfırlar ve boşluklar yok sayılır (sunucudaki K ile aynı) */
const K = (s?: string | null) => String(s ?? "").trim().replace(/^0+/, "").toLocaleUpperCase("tr");

const riskSinifi = (v?: number | null) =>
  v == null ? null : v >= RISK_YUKSEK ? "yuksek" : v >= RISK_ORTA ? "orta" : "dusuk";

const AV_RENK = ["#5f8c10", "#2e6aa8", "#c2410c", "#7c3aed", "#0f766e", "#b45309"];

const avRenk = (ad: string) => {
  let t = 0;
  for (const c of ad) t = (t * 31 + c.charCodeAt(0)) >>> 0;
  return AV_RENK[t % AV_RENK.length];
};

const basHarf = (ad?: string | null) =>
  String(ad ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");

/** Son dolu değer ve sırası */
const sonDolu = (dizi?: (number | null)[] | null): [number | null, number] => {
  const d = dizi ?? [];
  for (let i = d.length - 1; i >= 0; i--) if (d[i] != null) return [d[i] as number, i];
  return [null, -1];
};

/* ========================================================================= */
/* Küçük bileşenler                                                          */
/* ========================================================================= */

/** Renkli etiket */
function Et({
  renk,
  yok,
  children,
}: {
  renk: "yesil" | "mavi" | "turuncu" | "sari" | "kirmizi" | "gri" | string;
  yok?: boolean;
  children: React.ReactNode;
}) {
  return <span className={`ot-e ot-e-${renk}${yok ? " yok" : ""}`}>{children}</span>;
}

/** Kanal rozeti: anketin uygulamadan mı SMS ile mi gittiği */
function KanalEt({ kanal }: { kanal?: string | null }) {
  if (!kanal) return null;

  const uygulama = kanal === "uygulama";

  return (
    <span className="ot-kanal" title={uygulama ? "Uygulamadan" : "SMS ile"}>
      {uygulama ? <Smartphone size={11} strokeWidth={2} /> : <MessageSquare size={11} strokeWidth={2} />}
      {uygulama ? "Uygulama" : "SMS"}
    </span>
  );
}

/** Seri lejantı */
function Lejant({ sol = "Çalışan", sag = "Yönetici" }: { sol?: string; sag?: string }) {
  return (
    <span className="ot-lejant">
      <span><span className="ot-nokta" style={{ background: RENK_CAL }} />{sol}</span>
      <span><span className="ot-nokta" style={{ background: RENK_YON }} />{sag}</span>
    </span>
  );
}

/**
 * Kişi simgesi: fotoğraf varsa o, yoksa adın baş harfleri renkli zeminde.
 * Fotoğraf sunucudan doğrudan istenir; yüklenemezse baş harflere düşer.
 */
function KisiAvatar({ kod, ad, boyut = 34 }: { kod?: string | null; ad?: string | null; boyut?: number }) {
  const [hata, setHata] = useState(false);
  const adres = kod ? api.resimAdresi(kod) : "";
  const r = avRenk(ad || kod || "?");

  return (
    <span className="ot-av" style={{ width: boyut, height: boyut, background: `${r}1f`, color: r }}>
      {adres && !hata ? (
        <img src={adres} alt="" loading="lazy" decoding="async" onError={() => setHata(true)} />
      ) : (
        basHarf(ad || kod)
      )}
    </span>
  );
}

/** Kişi hücresi: simge, ad ve altında küçük bilgi */
function KisiHucre({ kod, ad, alt }: { kod?: string | null; ad?: string | null; alt?: React.ReactNode }) {
  return (
    <div className="ot-kisi">
      <KisiAvatar kod={kod} ad={ad} />
      <div style={{ minWidth: 0 }}>
        <b><PersonelAdi kod={kod}>{ad || kod || "—"}</PersonelAdi></b>
        {alt && <small>{alt}</small>}
      </div>
    </div>
  );
}

/** Yatay oran çubuğu */
function OranCubugu({ oran, renk = RENK_CAL }: { oran: number; renk?: string }) {
  return (
    <div className="ot-yol">
      <div className="ot-dol" style={{ width: `${Math.max(0, Math.min(100, oran))}%`, background: renk }} />
    </div>
  );
}

/** Görüşme sonucu etiketi; notu altta tek satır */
function GorusmeEt({ durum, not, tarihi }: { durum?: string | null; not?: string | null; tarihi?: string | null }) {
  if (!durum) return <span className="ot-soluk">henüz görüşülmedi</span>;

  const d = DURUMLAR.find((x) => x.value === durum);

  return (
    <div className="ot-gorusme">
      <Tooltip title={[tarihi ? tarih(tarihi) : null, not].filter(Boolean).join(" · ") || undefined}>
        <span>
          <Et renk={d?.renk ?? "gri"} yok>
            {d?.label ?? durum}
          </Et>
        </span>
      </Tooltip>
      {not && <small>{not}</small>}
    </div>
  );
}

/** Erken ayrılma risk etiketi */
function RiskEt({ v }: { v?: number | null }) {
  if (v == null) return <span className="ot-soluk">—</span>;

  const s = riskSinifi(v);

  return (
    <Tooltip title={s === "yuksek" ? "İK görüşmesi önerilir" : s === "orta" ? "Yakın takip" : "Normal takip"}>
      <span>
        <Et renk={s === "yuksek" ? "kirmizi" : s === "orta" ? "sari" : "yesil"}>
          {s === "yuksek" ? "yüksek" : s === "orta" ? "orta" : "düşük"} · {v}
        </Et>
      </span>
    </Tooltip>
  );
}

/** Puan; 5'lik ölçekte 3'ün altı turuncu */
function PuanYaz({ v }: { v?: number | null }) {
  if (v == null) return <span className="ot-soluk">—</span>;

  return (
    <span className="ot-puan" style={{ color: v < 3.5 ? RENK_TURUNCU_YAZI : undefined }}>
      {sayiYaz(v)}
    </span>
  );
}

/** Seçenek düğmeleri (önizlemedeki yuvarlak seçimler) */
function Secenekler<T extends string>({
  deger,
  secenekler,
  onChange,
}: {
  deger: T;
  secenekler: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ot-secenekler" role="radiogroup">
      {secenekler.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={deger === s.value}
          className={deger === s.value ? "aktif" : ""}
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** İki seçenekli koyu anahtar (Bekleyen / Tümü, Liste / Şubeye göre) */
function Seg<T extends string>({
  deger,
  secenekler,
  onChange,
}: {
  deger: T;
  secenekler: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ot-seg">
      {secenekler.map((s) => (
        <button key={s.value} type="button" className={deger === s.value ? "aktif" : ""} onClick={() => onChange(s.value)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Aşamalara göre memnuniyet trendi: iki seri (çalışan, yönetici), uç
 * etiketleri, lejant kart başlığında. Üzerine gelince ipucu; tıklayınca o
 * aşamayı dolduranların karnesi.
 */
function TrendGrafik({ asamalar, onSec }: { asamalar: any[]; onSec?: (i: number) => void }) {
  const [uzerinde, setUzerinde] = useState<number | null>(null);

  const v = asamalar.map((a) => [a.asamaAdi as string, a.calisan?.ortalama ?? null, a.yonetici?.ortalama ?? null] as [string, number | null, number | null]);

  const W = 560, H = 230, sol = 34, sag = 64, ust = 14, alt = 30;
  const tumDegerler = v.flatMap((r) => [r[1], r[2]]).filter((x): x is number => x != null);
  const taban = Math.min(2.5, Math.floor((Math.min(...tumDegerler, 5) - 0.2) * 2) / 2);
  const x = (i: number) => sol + (i * (W - sol - sag)) / Math.max(1, v.length - 1);
  const y = (d: number) => ust + ((5 - d) / (5 - taban)) * (H - ust - alt);

  const yol = (j: 1 | 2) => {
    let p = "";
    let yeni = true;
    v.forEach((r, i) => {
      const d = r[j];
      if (d == null) { yeni = true; return; }
      p += `${yeni ? "M" : "L"}${x(i)},${y(d)} `;
      yeni = false;
    });
    return p.trim();
  };

  const izgara: number[] = [];
  for (let d = taban; d <= 5.001; d += 0.5) izgara.push(Math.round(d * 10) / 10);

  /* Uç etiketleri: son dolu noktanın sağında; çakışırsa aralanır */
  const [cSon, cI] = sonDolu(v.map((r) => r[1]));
  const [ySon, yI] = sonDolu(v.map((r) => r[2]));
  let cEt = cSon == null ? null : y(cSon) + 4;
  let yEt = ySon == null ? null : y(ySon) + 4;

  if (cEt != null && yEt != null && Math.abs(cEt - yEt) < 14) {
    if ((cSon ?? 0) >= (ySon ?? 0)) { cEt -= 8; yEt += 8; } else { cEt += 8; yEt -= 8; }
  }

  if (tumDegerler.length === 0)
    return <div className="ot-bos-sat">Henüz doldurulmuş form yok.</div>;

  const u = uzerinde == null ? null : v[uzerinde];

  return (
    <div className="ot-grafik">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Aşamalara göre memnuniyet: çalışan ve yönetici">
        {izgara.map((d) => (
          <g key={d}>
            <line x1={sol} x2={W - sag} y1={y(d)} y2={y(d)} stroke="#eef1ea" />
            <text x={sol - 8} y={y(d) + 4} fontSize={11} fill="#7b8577" textAnchor="end">
              {String(d).replace(".", ",")}
            </text>
          </g>
        ))}
        {v.map((r, i) => (
          <text key={r[0]} x={x(i)} y={H - 8} fontSize={12} fill="#4b5563" textAnchor="middle">
            {r[0]}
          </text>
        ))}
        {uzerinde != null && (
          <line x1={x(uzerinde)} x2={x(uzerinde)} y1={ust} y2={H - alt} stroke="#c9d1c1" strokeDasharray="3 3" />
        )}
        <path d={yol(2)} fill="none" stroke={RENK_YON} strokeWidth={2} />
        <path d={yol(1)} fill="none" stroke={RENK_CAL} strokeWidth={2} />
        {v.map((r, i) => r[2] != null && (
          <circle key={`y${i}`} cx={x(i)} cy={y(r[2])} r={4.5} fill={RENK_YON} stroke="#fff" strokeWidth={2} />
        ))}
        {v.map((r, i) => r[1] != null && (
          <circle key={`c${i}`} cx={x(i)} cy={y(r[1])} r={4.5} fill={RENK_CAL} stroke="#fff" strokeWidth={2} />
        ))}
        {cEt != null && (
          <text x={x(cI) + 10} y={cEt} fontSize={12} fontWeight={700} fill="#1c2419">Çalışan</text>
        )}
        {yEt != null && (
          <text x={x(yI) + 10} y={yEt} fontSize={12} fontWeight={700} fill="#1c2419">Yönetici</text>
        )}
        {v.map((r, i) => (
          <rect
            key={`h${i}`}
            x={x(i) - 40}
            y={ust}
            width={80}
            height={H - ust - alt}
            fill="transparent"
            style={{ cursor: onSec ? "pointer" : "default" }}
            data-i={i}
            onMouseEnter={() => setUzerinde(i)}
            onMouseLeave={() => setUzerinde(null)}
            onClick={() => onSec?.(i)}
          />
        ))}
      </svg>

      {u && uzerinde != null && (
        <div
          className="ot-ipucu"
          style={{
            left: `${(x(uzerinde) / W) * 100}%`,
            top: `${(y(Math.max(u[1] ?? 0, u[2] ?? 0, taban)) / H) * 100}%`,
          }}
        >
          <b>{u[0]}</b>
          <span className="ot-nokta" style={{ background: RENK_CAL }} />Çalışan {sayiYaz(u[1])}
          <br />
          <span className="ot-nokta" style={{ background: RENK_YON }} />Yönetici {sayiYaz(u[2])}
        </div>
      )}
    </div>
  );
}

/** Yanıt JSON'u: çalışan formunda nesne, yönetici formunda kişi başına dizi */
const formlariOku = (json?: string | null): { personelKodu?: string; adSoyad?: string; sorular: any[] }[] => {
  try {
    const k = JSON.parse(json || "{}");
    const dizi = Array.isArray(k) ? k : [k];
    return dizi.map((f: any) => ({ personelKodu: f?.personelKodu, adSoyad: f?.adSoyad, sorular: f?.sorular ?? [] }));
  } catch {
    return [];
  }
};

/** Bir yanıt satırı: ölçek "4 / 5", metin altta */
function YanitSatiri({ c }: { c: any }) {
  const y = c.yanit;

  if (typeof y === "number") {
    const enUst = c.tur === "on" ? 10 : 5;
    const oran = y / enUst;

    return (
      <div className="q">
        <span>
          {c.soru}
          {c.aciklama && <small>{c.aciklama}</small>}
        </span>
        <span style={{ color: oran < 0.6 ? RENK_TURUNCU_YAZI : undefined }}>
          {y} / {enUst}
        </span>
      </div>
    );
  }

  return (
    <div className="q metin">
      <span className="ot-soluk" style={{ fontSize: 12.5 }}>{c.soru}</span>
      <span>
        {y === null || y === undefined || y === "" ? "—" : `“${String(y)}”`}
        {c.aciklama && <small>{c.aciklama}</small>}
      </span>
    </div>
  );
}

/* ========================================================================= */
/* Sayfa                                                                     */
/* ========================================================================= */

export default function PersonelTakip() {
  const { message, modal } = AntdApp.useApp();

  const oturum = oturumOku();

  /* Test ve toplu gönderim yalnızca yönetici rollerine; sunucudaki
     yetkiyle aynı. Yeniden gönderim ve hatırlatma anket gönderme
     yetkisine bağlı. */
  const sinamaYetkisi =
    !!oturum && ["Admin", "IKYoneticisi", "GenelMudurYardimcisi"].includes(oturum.rol);

  const gonderebilir = anketGonderme(oturum);

  /* ------------------------------------------------------------ veriler */
  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<any>(null);
  const [rapor, setRapor] = useState<any>(null);
  const [karneler, setKarneler] = useState<any[]>([]);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(await api.al<any>("/api/Personel/Takip"));
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  const raporlariGetir = useCallback(() => {
    api
      .al<any>("/api/Uyum/Rapor")
      .then(setRapor)
      .catch(() => {
        /* Rapor alınamazsa sayfanın kalanı çalışmaya devam eder */
      });

    api
      .al<any>("/api/Uyum/Karneler")
      .then((d) => setKarneler(d?.karneler ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getir();
    raporlariGetir();
  }, [getir, raporlariGetir]);

  /* Sayfa sekmeli: takip listesi günlük iş, diğerleri raporlama */
  const [anaSekme, setAnaSekme] = useState("takip");

  /* ------------------------------------------------------ takip listesi */
  const [secilenDonem, setSecilenDonem] = useState<string>("Oryantasyon");
  const [suzgec, setSuzgec] = useState<"bekleyen" | "hepsi">("bekleyen");
  const [arama, setArama] = useState("");
  const [birim, setBirim] = useState<string | undefined>();
  const [kanalSuzgec, setKanalSuzgec] = useState<string | undefined>();
  const [gorusmeDurumu, setGorusmeDurumu] = useState<string | undefined>();
  const [takipSayfa, setTakipSayfa] = useState(1);

  const donemler: any[] = veri?.donemler ?? [];
  const donem = donemler.find((d: any) => d.donem === secilenDonem);
  /* Kaçırılanlar (07.10.2026): penceresi geçmiş, anketi artık açık olmayan
     kişiler bekleyen sayılmaz; listenin altında ayrı, kapalı bölümde durur.
     Zamanı gelince bir sonraki dönemin anketine girerler. */
  const donemKisileri: any[] = donem?.kisiler ?? [];
  const tumKisiler: any[] = donemKisileri.filter((k: any) => !k.kacirildi);
  const kacirilanlar: any[] = donemKisileri.filter((k: any) => k.kacirildi);
  const [kacirilanAcik, setKacirilanAcik] = useState(false);
  const secilenAsama = donemdenKod(secilenDonem) ?? "7g";

  /* Filtre kutularının seçenekleri listeden üretilir */
  const birimler = Array.from(new Set(tumKisiler.map((k: any) => k.isGrubu).filter(Boolean))).sort((a: any, b: any) =>
    String(a).localeCompare(String(b), "tr")
  ) as string[];

  const kisiler = tumKisiler.filter((k: any) => {
    if (suzgec === "bekleyen" && k.tamamlandi) return false;
    if (birim && k.isGrubu !== birim) return false;
    if (kanalSuzgec && (k.anketKanal ?? "sms") !== kanalSuzgec) return false;

    if (gorusmeDurumu) {
      if (gorusmeDurumu === "yok" ? k.tamamlandi : k.notDurumu !== gorusmeDurumu) return false;
    }

    if (arama.trim()) {
      const q = arama.trim().toLocaleLowerCase("tr");
      const metin = [k.ad, k.soyad, k.personelKodu, k.telefon, k.kimlikNo, k.isGrubu, k.pozisyon]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");

      if (!metin.includes(q)) return false;
    }

    return true;
  });

  const filtreVar = !!(arama.trim() || birim || kanalSuzgec || gorusmeDurumu);

  const filtreleriTemizle = () => {
    setArama("");
    setBirim(undefined);
    setKanalSuzgec(undefined);
    setGorusmeDurumu(undefined);
  };

  useEffect(() => setTakipSayfa(1), [secilenDonem, suzgec, arama, birim, kanalSuzgec, gorusmeDurumu]);

  /** Kişinin takip listesindeki satırı: en ileri aşamadaki (bir kişi pencere dışı kayıtla iki dönemde olabilir) */
  const takipHaritasi = useMemo(() => {
    const m = new Map<string, { k: any; donem: string }>();

    donemler.forEach((d: any) =>
      (d.kisiler ?? []).forEach((k: any) => {
        const anahtar = K(k.personelKodu);
        const onceki = m.get(anahtar);
        const sira = ASAMALAR.findIndex((a) => a.donem === d.donem);

        if (!onceki || ASAMALAR.findIndex((a) => a.donem === onceki.donem) < sira) m.set(anahtar, { k, donem: d.donem });
      })
    );

    return m;
  }, [donemler]);

  /** Kişinin en son görüşme notu (hangi dönemde olursa) */
  const gorusmesi = (kod?: string | null) => {
    let son: any = null;

    donemler.forEach((d: any) =>
      (d.kisiler ?? []).forEach((k: any) => {
        if (K(k.personelKodu) !== K(kod) || !k.tamamlandi) return;
        if (!son || dayjs(k.notTarihi).isAfter(dayjs(son.notTarihi))) son = { ...k, donem: d.donem };
      })
    );

    return son;
  };

  const toplamBekleyen = donemler.reduce((t: number, d: any) => t + (d.bekleyen ?? 0), 0);

  /* ------------------------------------------------------- not penceresi */
  const [notKisi, setNotKisi] = useState<any>(null);
  const [notDurumu, setNotDurumu] = useState("Görüşüldü");
  const [notMetni, setNotMetni] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /** Not penceresi; dönem verilmezse seçili dönem */
  const notAc = (kisi: any, donemAdiStr?: string) => {
    setNotKisi({ ...kisi, donem: donemAdiStr ?? secilenDonem });
    setNotDurumu(kisi.notDurumu ?? "Görüşüldü");
    setNotMetni(kisi.notMetni ?? "");
  };

  const notKaydet = async () => {
    if (!notKisi) return;

    setKaydediliyor(true);

    try {
      await api.gonder("/api/Personel/Takip", {
        personelKodu: notKisi.personelKodu,
        kimlikNo: notKisi.kimlikNo,
        adSoyad: `${notKisi.ad} ${notKisi.soyad}`,
        donem: notKisi.donem ?? secilenDonem,
        durum: notDurumu,
        not: notMetni.trim(),
      });

      message.success(
        `${notKisi.ad} ${notKisi.soyad} için not kaydedildi` +
          (suzgec === "bekleyen" && !notKisi.tamamlandi ? "; Bekleyen listesinden düştü." : ".")
      );
      setNotKisi(null);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  /* ---------------------------------------------- yeniden gönder, hatırlat */

  /* Yanıtlanmamış anketi yeniden gönderme: çalışana, yöneticisine ya da
     ikisine. Anahtar "kod|asama" ile aynı anda tek işlem. */
  const [yenidenGonderiliyor, setYenidenGonderiliyor] = useState("");

  /** Biçen360'a giriş yapmamış kişiler: anket/değerlendirme açıldı, bildirim gidemedi */
  const girisYapmamisBildir = (adlar: string[]) =>
    message.warning(
      `${adlar.length} kişi Biçen360'a giriş yapmamış (${adlar.slice(0, 4).join(", ")}${adlar.length > 4 ? ` +${adlar.length - 4}` : ""}); ` +
        "bildirim gidemedi, giriş yapınca ana sayfasında görecek.",
      8
    );

  const yenidenGonder = async (k: any, calisan: boolean, yonetici: boolean, donemStr?: string) => {
    const asama = donemdenKod(donemStr ?? k.donem ?? secilenDonem);

    if (!asama) {
      message.error("Aşama belirlenemedi.");
      return;
    }

    setYenidenGonderiliyor(`${k.personelKodu}|${asama}`);

    try {
      const sonuc = await api.gonder<any>("/api/Uyum/YenidenGonder", {
        personelKodu: k.personelKodu,
        asama,
        calisan,
        yonetici,
      });

      if (sonuc?.tamam) message.success(sonuc.mesaj);
      else message.warning(sonuc?.mesaj || "Gönderilemedi.");

      getir();
      if (karneDetay?.kisi) karneAc(karneDetay.kisi.personelKodu, true);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYenidenGonderiliyor("");
    }
  };

  /** Hatırlat: Biçen360 bildirimi; anket ya da değerlendirme kapandıysa yeniden açılır (sunucu karar verir) */
  const hatirlat = async (k: any, asama: string, kime: "c" | "y") => {
    setYenidenGonderiliyor(`${k.personelKodu}|${asama}`);

    try {
      const sonuc = await api.gonder<any>("/api/Uyum/Hatirlat", {
        personelKodu: k.personelKodu,
        asama,
        kime,
      });

      if (sonuc?.tamam) message.success(sonuc.mesaj);
      else message.warning(sonuc?.mesaj || "Gönderilemedi.");

      getir();
      if (karneDetay?.kisi) karneAc(karneDetay.kisi.personelKodu, true);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYenidenGonderiliyor("");
    }
  };

  /* Listedeki yanıtsız anketlerin tamamını Biçen360'tan yeniden gönderir:
     çalışana kişi başına yeni anket, yöneticiye yönetici başına tek
     bildirim (sunucu ayırır). Yalnızca süresi dolanlar: anketi hâlâ açık
     olan zaten Biçen360'ta görüyor. */
  const [yenidenAcik, setYenidenAcik] = useState(false);
  const [topluYenidenGonderiliyor, setTopluYenidenGonderiliyor] = useState(false);

  const dolanlar = tumKisiler.filter(
    (k: any) => k.anketDurumu === "suresiDoldu" || k.yoneticiAnketDurumu === "suresiDoldu"
  );

  const topluYenidenGonder = async () => {
    const calisanlar = tumKisiler.filter((k: any) => k.anketDurumu === "suresiDoldu");
    const yoneticili = tumKisiler.filter((k: any) => k.yoneticiAnketDurumu === "suresiDoldu");

    if (calisanlar.length === 0 && yoneticili.length === 0) {
      message.info("Bu dönemde süresi dolmuş anket yok. Bağlantısı hâlâ açık olanlara satırdaki menüden tek tek gönderebilirsiniz.");
      return;
    }

    setTopluYenidenGonderiliyor(true);

    try {
      /* Çalışan ve yönetici kümeleri farklı olabilir; iki çağrı */
      const c =
        calisanlar.length > 0
          ? await api.gonder<any>("/api/Uyum/YenidenGonderToplu", {
              asama: secilenAsama,
              personelKodlari: calisanlar.map((k: any) => k.personelKodu),
              calisan: true,
              yonetici: false,
            })
          : null;
      const y =
        yoneticili.length > 0
          ? await api.gonder<any>("/api/Uyum/YenidenGonderToplu", {
              asama: secilenAsama,
              personelKodlari: yoneticili.map((k: any) => k.personelKodu),
              calisan: false,
              yonetici: true,
            })
          : null;

      const atlanan = [...(c?.atlanan ?? []), ...(y?.atlanan ?? [])];
      const girisYok = [...(c?.girisYapmamis ?? []), ...(y?.yoneticiGirisYapmamis ?? [])];

      message.success(
        `${c?.calisanGonderim ?? 0} çalışana, ${y?.yoneticiGonderim ?? 0} yöneticiye Biçen360'tan gönderildi` +
          (atlanan.length > 0 ? ` · ${atlanan.length} atlandı` : "")
      );
      if (girisYok.length > 0) girisYapmamisBildir(girisYok);
      if (atlanan.length > 0) message.warning(atlanan.slice(0, 5).join(" · "), 8);
      setYenidenAcik(false);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setTopluYenidenGonderiliyor(false);
    }
  };

  /* ---------------------------------------------------- toplu gönderim */
  const [topluAcik, setTopluAcik] = useState(false);
  const [topluAsama, setTopluAsama] = useState("7g");
  const [bekleyenler, setBekleyenler] = useState<any[]>([]);
  const [bekleyenYukleniyor, setBekleyenYukleniyor] = useState(false);
  const [secilenler, setSecilenler] = useState<React.Key[]>([]);
  const [topluIsleniyor, setTopluIsleniyor] = useState(false);

  /* Personele gönderim yapılınca mağaza müdürüne de tek bildirim gider.
     Varsayılan açık; müdürün değerlendirmesi olmadan karne yarım kalıyor. */
  const [yoneticiyeDe, setYoneticiyeDe] = useState(true);

  /** Anket Biçen360'a gider; telefon gerekmiyor. Personel kodu olan herkes gönderilebilir. */
  const gonderilebilir = (x: any) => !!x.personelKodu;

  const bekleyenleriGetir = async (asama: string) => {
    setBekleyenYukleniyor(true);
    setSecilenler([]);

    try {
      const d = await api.al<any>(`/api/Uyum/Bekleyenler?asama=${asama}`);

      setBekleyenler(d?.kayitlar ?? []);

      /* Gönderilemeyecek olanlar baştan seçilmez: gönderim denenip hata
         dönmesindense hiç işaretlenmemesi daha anlaşılır. */
      setSecilenler((d?.kayitlar ?? []).filter(gonderilebilir).map((x: any) => x.personelKodu));
    } catch (hata: any) {
      message.error(hata.message);
      setBekleyenler([]);
    } finally {
      setBekleyenYukleniyor(false);
    }
  };

  const topluAc = () => {
    setTopluAsama(secilenAsama);
    setTopluAcik(true);
    bekleyenleriGetir(secilenAsama);
  };

  const topluGonder = async () => {
    const secili = bekleyenler.filter((x) => secilenler.includes(x.personelKodu));

    if (secili.length === 0) {
      message.warning("Kişi seçiniz.");
      return;
    }

    setTopluIsleniyor(true);

    try {
      const sonuc = await api.gonder<any>("/api/Uyum/TopluGonder", {
        asama: topluAsama,
        kisiler: secili,
        yoneticiyeDeGonder: yoneticiyeDe,
      });

      const girisYok = [...(sonuc.girisYapmamis ?? []), ...(sonuc.yoneticiGirisYapmamis ?? [])];

      message.success(
        `${sonuc.gonderilen} personele Biçen360'tan gönderildi` +
          (sonuc.yoneticiGonderim > 0 ? ` · ${sonuc.yoneticiGonderim} yöneticiye bildirim` : "") +
          "."
      );
      if (girisYok.length > 0) girisYapmamisBildir(girisYok);

      if ((sonuc.atlanan ?? []).length > 0)
        Modal.info({
          title: "Gönderilemeyenler",
          width: 460,
          content: (
            <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.9 }}>
              {sonuc.atlanan.map((x: string, i: number) => (
                <div key={i}>· {x}</div>
              ))}
            </div>
          ),
        });

      /* Atlanan yoksa pencere kapanır; varsa liste yenilenir ki kalanlar görünsün */
      if ((sonuc.atlanan ?? []).length === 0) setTopluAcik(false);
      else bekleyenleriGetir(topluAsama);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setTopluIsleniyor(false);
    }
  };

  /* ------------------------------------------------------- test gönderimi */
  const [testAcik, setTestAcik] = useState(false);
  const [testAsama, setTestAsama] = useState("7g");
  const [testTur, setTestTur] = useState<"calisan" | "yonetici">("calisan");
  const [sinamaTelefon, setSinamaTelefon] = useState("");

  /* Test kanalı: kendi Biçen360'ına (sicil) ya da SMS ile (telefon) */
  const [testKanal, setTestKanal] = useState<"uygulama" | "sms">("uygulama");
  const [testSicil, setTestSicil] = useState("");
  const [testHedefBilgi, setTestHedefBilgi] = useState<any>(null);

  useEffect(() => {
    if (!testAcik || testHedefBilgi) return;

    api.al<any>("/api/Uyum/TestHedef")
      .then((c) => {
        setTestHedefBilgi(c ?? {});
        if (c?.sicil) setTestSicil((o) => o || c.sicil);
      })
      .catch(() => setTestHedefBilgi({}));
  }, [testAcik, testHedefBilgi]);
  const [sinamaIsleniyor, setSinamaIsleniyor] = useState(false);
  const [sinamaSonuc, setSinamaSonuc] = useState<any[]>([]);

  /** Deneme bağlantısı gönderir ve adresi ekranda gösterir */
  const sinamaGonder = async () => {
    if (testKanal === "uygulama" && !testSicil.trim()) {
      message.warning("Testin gideceği personelin sicilini yazınız.");
      return;
    }

    if (testKanal === "sms" && !/^0?5\d{9}$/.test(sinamaTelefon.replace(/\D/g, ""))) {
      message.warning("Geçerli bir cep numarası giriniz (5xxxxxxxxx).");
      return;
    }

    setSinamaIsleniyor(true);

    try {
      const sonuc = await api.gonder<any>("/api/Uyum/TestGonder", {
        tur: testTur,
        asama: testAsama,
        kanal: testKanal,
        sicil: testKanal === "uygulama" ? testSicil.trim() : null,
        telefon: testKanal === "sms" ? sinamaTelefon : null,
        adSoyad: oturum?.adSoyad ?? "Sınama",
        subeAdi: "",
        gorev: "",
      });

      message.success(testKanal === "uygulama" ? `Test anketi ${sonuc?.adSoyad ?? ""} adlı personelin Biçen360'ına gönderildi.` : "Test bağlantısı gönderildi.");

      /* Son gönderim üstte dursun */
      setSinamaSonuc((o) => [{ tur: testTur, ...sonuc }, ...o].slice(0, 6));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setSinamaIsleniyor(false);
    }
  };

  /* ------------------------------------------------------ karne çekmecesi */
  const [karneDetay, setKarneDetay] = useState<any>(null);
  const [karneYukleniyor, setKarneYukleniyor] = useState(false);
  const [karneAsamaSec, setKarneAsamaSec] = useState<string | null>(null);

  const karneAc = async (personelKodu: string, sessiz = false) => {
    if (!sessiz) {
      setKarneYukleniyor(true);
      setKarneDetay({ yukleniyor: true, kod: personelKodu });
      setKarneAsamaSec(null);
    }

    try {
      setKarneDetay(await api.al<any>(`/api/Uyum/Karne/${encodeURIComponent(personelKodu)}`));
    } catch (hata: any) {
      message.error(hata.message);
      if (!sessiz) setKarneDetay(null);
    } finally {
      setKarneYukleniyor(false);
    }
  };

  /** Bir birimin doldurulmuş formları; yönetici formu da burada görünür */
  const magazaFormlariAc = async (sube: string) => {
    setKarneYukleniyor(true);
    setKarneDetay({ yukleniyor: true });

    try {
      const d = await api.al<any>(`/api/Uyum/BirimFormlari?sube=${encodeURIComponent(sube)}`);

      /* Karne çekmecesi yeniden kullanılır: aynı görünüm, kişi kartı yok */
      setKarneDetay({ kisi: null, formlar: d?.formlar ?? [], birim: sube });
    } catch (hata: any) {
      message.error(hata.message);
      setKarneDetay(null);
    } finally {
      setKarneYukleniyor(false);
    }
  };

  const [yoneticiGonderiliyor, setYoneticiGonderiliyor] = useState("");

  /** Karne çekmecesinden yöneticinin değerlendirmesini Biçen360'ta açar */
  const yoneticiyeGonder = async (personelKodu: string, asama: string) => {
    setYoneticiGonderiliyor(asama);

    try {
      const sonuc = await api.gonder<any>(
        `/api/Uyum/YoneticiyeGonder?personelKodu=${encodeURIComponent(personelKodu)}&asama=${asama}`,
        {}
      );

      if (sonuc.tamam) message.success(sonuc.mesaj);
      else message.warning(sonuc.mesaj);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYoneticiGonderiliyor("");
    }
  };

  /* ------------------------------------------------ karneler süzgeçleri */

  /* Karne listesi iki biçimde okunuyor: düz liste kişi ararken, şube
     kırılımı bölge gözüyle bakarken işe yarıyor. */
  const [karneGorunum, setKarneGorunum] = useState<"liste" | "sube">("liste");
  const [karneArama, setKarneArama] = useState("");
  const [karneRisk, setKarneRisk] = useState<string>("");

  /* Diğer sekmelerden gelen süzgeçler: mağaza, durum, aşama ve analiz
     sekmesindeki "ayrılma ilişkisi" kümesi */
  const [magazaSuzgec, setMagazaSuzgec] = useState<string | null>(null);
  const [karneSuzgec, setKarneSuzgec] = useState<string | null>(null);
  const [asamaSuzgec, setAsamaSuzgec] = useState<number | null>(null);
  const [kisiSuzgec, setKisiSuzgec] = useState<{ etiket: string; kodlar: string[] } | null>(null);

  /** Diğer sekmelerden karne listesine geçiş: süzgeç düz listede görünsün */
  const karneListesineGit = () => {
    setKarneGorunum("liste");
    setAnaSekme("karne");
  };

  const suzgecleriKaldir = () => {
    setMagazaSuzgec(null);
    setKarneSuzgec(null);
    setAsamaSuzgec(null);
    setKisiSuzgec(null);
    setKarneRisk("");
  };

  /* --------------------------------------------- pencereler (modallar) */
  const [karsilastirma, setKarsilastirma] = useState<any | null>(null);
  const [subePencere, setSubePencere] = useState<string | null>(null);
  const [alanDetay, setAlanDetay] = useState<any>(null);
  const [konuDetay, setKonuDetay] = useState<any>(null);

  /* ------------------------------------------------------- icra kurulu */
  const [icraDonem, setIcraDonem] = useState<"6ay" | "3ay" | "yil">("6ay");
  const [icraRaporu, setIcraRaporu] = useState<any>(null);

  useEffect(() => {
    if (icraDonem === "6ay") {
      setIcraRaporu(null);
      return;
    }

    const bas =
      icraDonem === "3ay" ? dayjs().subtract(3, "month").format("YYYY-MM-DD") : dayjs().startOf("year").format("YYYY-MM-DD");

    api
      .al<any>(`/api/Uyum/Rapor?bas=${bas}&bit=${dayjs().format("YYYY-MM-DD")}`)
      .then(setIcraRaporu)
      .catch((h: any) => message.error(h.message));
  }, [icraDonem, message]);

  /* ========================================================= türetilmiş */

  /** Karnede kişinin şu anki aşaması: takip listesindeki ya da son dolu aşama */
  const karneSirasi = (k: any) => {
    const t = takipHaritasi.get(K(k.personelKodu));
    const takipSira = t ? ASAMALAR.findIndex((a) => a.donem === t.donem) : -1;
    const [, cI] = sonDolu(k.puanlar);
    const [, yI] = sonDolu(k.yoneticiPuanlar);

    return Math.max(takipSira, cI, yI);
  };

  /** Değişim: bu aşamanın çalışan puanı eksi bir önceki aşamanınki */
  const degisim = (k: any) => {
    const i = karneSirasi(k);
    const p = k.puanlar ?? [];

    if (i <= 0 || p[i] == null || p[i - 1] == null) return null;

    return Math.round((p[i] - p[i - 1]) * 10) / 10;
  };

  /* Süzgeçler pano, mağaza ve analiz sekmelerinden geliyor; hepsi aynı
     listeyi daraltıyor. Süzülmüş kişi listesi tek yerde üretilir. */
  const suzulmusKarneler = (() => {
    let liste = karneler;

    if (magazaSuzgec) liste = liste.filter((k: any) => k.subeAdi === magazaSuzgec);
    if (asamaSuzgec !== null) liste = liste.filter((k: any) => k.puanlar?.[asamaSuzgec] != null);
    if (karneSuzgec) liste = liste.filter((k: any) => k.durum === karneSuzgec);
    if (karneRisk) liste = liste.filter((k: any) => riskSinifi(k.riskSkoru) === karneRisk);

    if (kisiSuzgec) {
      const kume = new Set(kisiSuzgec.kodlar.map(K));
      liste = liste.filter((k: any) => kume.has(K(k.personelKodu)));
    }

    if (karneArama.trim()) {
      const q = karneArama.trim().toLocaleLowerCase("tr");

      liste = liste.filter((k: any) =>
        [k.adSoyad, k.personelKodu, k.gorev, k.subeAdi].filter(Boolean).join(" ").toLocaleLowerCase("tr").includes(q)
      );
    }

    return liste;
  })();

  /* Karneler şube bazında da toplanabilir; 35 mağazada düz liste
     okunmuyordu. Şubeye tıklayınca o şubenin personeli açılır. */
  const karneSubeleri = (() => {
    const harita = new Map<string, any[]>();

    suzulmusKarneler.forEach((k: any) => {
      const ad = k.subeAdi || "Belirtilmemiş";
      if (!harita.has(ad)) harita.set(ad, []);
      harita.get(ad)!.push(k);
    });

    return Array.from(harita.entries())
      .map(([sube, liste]) => {
        const puanlar = liste.map((k) => k.son).filter((x) => x != null) as number[];

        return {
          sube,
          kisiler: liste,
          kisiSayisi: liste.length,
          riskli: liste.filter((k) => (k.riskSkoru ?? 0) >= RISK_YUKSEK).length,
          takip: liste.filter((k) => k.durum === "takip").length,
          ortalama: puanlar.length === 0 ? null : Math.round((puanlar.reduce((t, x) => t + x, 0) / puanlar.length) * 10) / 10,
        };
      })
      .sort((a, b) => b.riskli - a.riskli || (a.ortalama ?? 9) - (b.ortalama ?? 9));
  })();

  /* Takipteki herkes (aynı kişi iki dönemde görünebilir; bir kez sayılır) */
  const takiptekiler = Array.from(takipHaritasi.values()).map((x) => x.k);
  const cDol = takiptekiler.filter((k) => k.anketDurumu === "dolduruldu").length;
  const yDol = takiptekiler.filter((k) => k.yoneticiAnketDurumu === "dolduruldu").length;
  const riskliSayi = karneler.filter((k: any) => (k.riskSkoru ?? -1) >= RISK_YUKSEK).length;

  const ortalamaMemnuniyet = (r: any) => {
    const a = (r?.asamalar ?? []).filter((x: any) => x.calisan?.ortalama != null && x.calisan?.tamamlanan > 0);
    const n = a.reduce((t: number, x: any) => t + x.calisan.tamamlanan, 0);

    return n === 0 ? null : Math.round((a.reduce((t: number, x: any) => t + x.calisan.ortalama * x.calisan.tamamlanan, 0) / n) * 10) / 10;
  };

  const durumSayisi = (d: string) => karneler.filter((k: any) => k.durum === d).length;

  /* İK'nın bugün ilgilenmesi gerekenler tek listede toplanır. Sıra
     önemlidir: aynı kişi hem riskli hem görüş farklı olabilir, ilk
     girdiği başlıkta kalır ki liste tekrar etmesin. */
  const aksiyonBekleyenler = (() => {
    const liste: any[] = [];
    const girenler = new Set<string>();

    const ekle = (x: { anahtar: string; ad: string; alt?: string; etiket: string; renk: string; personelKodu?: string; asama?: string }) => {
      if (x.personelKodu) {
        if (girenler.has(K(x.personelKodu))) return;
        girenler.add(K(x.personelKodu));
      }

      liste.push(x);
    };

    const karnesi = (kod: string) => karneler.find((k: any) => K(k.personelKodu) === K(kod));

    takiptekiler
      .filter((k) => k.notDurumu === "Ayrılmayı Düşünüyor")
      .forEach((k) =>
        ekle({ anahtar: `ayr-${k.personelKodu}`, ad: `${k.ad} ${k.soyad}`, alt: [k.pozisyon, k.isGrubu].filter(Boolean).join(" · "), etiket: "ayrılmayı düşünüyor", renk: "kirmizi", personelKodu: k.personelKodu })
      );

    karneler
      .filter((k: any) => (k.riskSkoru ?? 0) >= RISK_YUKSEK || k.durum === "risk")
      .slice(0, 8)
      .forEach((k: any) =>
        ekle({
          anahtar: `risk-${k.personelKodu}`,
          ad: k.adSoyad || k.personelKodu,
          alt: [k.gorev, k.subeAdi].filter(Boolean).join(" · "),
          etiket: (sonDolu(k.puanlar)[0] ?? 5) < 3 ? "düşük puan" : k.riskSkoru != null ? `risk skoru ${k.riskSkoru}` : "risk",
          renk: (sonDolu(k.puanlar)[0] ?? 5) < 3 ? "turuncu" : "kirmizi",
          personelKodu: k.personelKodu,
        })
      );

    (rapor?.ikBildirimleri ?? []).slice(0, 8).forEach((x: any, i: number) =>
      ekle({
        anahtar: `ik-${x.personelKodu ?? i}`,
        ad: x.adSoyad || x.personelKodu || "—",
        /* Açıklama zorunlu olduğu için konu burada okunabiliyor */
        alt: x.aciklama ? x.aciklama : [x.gorev, x.subeAdi].filter(Boolean).join(" · "),
        etiket: "İK'ya bildirim",
        renk: "kirmizi",
        personelKodu: x.personelKodu,
        asama: x.asama,
      })
    );

    karneler
      .filter((k: any) => (k.gorusFarki ?? 0) >= 1)
      .slice(0, 6)
      .forEach((k: any) =>
        ekle({ anahtar: `fark-${k.personelKodu}`, ad: k.adSoyad || k.personelKodu, alt: [k.gorev, k.subeAdi].filter(Boolean).join(" · "), etiket: `görüş farkı ${sayiYaz(k.gorusFarki)}`, renk: "turuncu", personelKodu: k.personelKodu })
      );

    karneler
      .filter((k: any) => (k.dusus ?? 0) >= 0.5)
      .slice(0, 6)
      .forEach((k: any) =>
        ekle({ anahtar: `dusus-${k.personelKodu}`, ad: k.adSoyad || k.personelKodu, alt: [k.gorev, k.subeAdi].filter(Boolean).join(" · "), etiket: "memnuniyet düştü", renk: "turuncu", personelKodu: k.personelKodu })
      );

    takiptekiler
      .filter((k) => k.anketDurumu === "suresiDoldu" && !k.tamamlandi && !k.kacirildi)
      .slice(0, 8)
      .forEach((k) =>
        ekle({ anahtar: `cvp-${k.personelKodu}`, ad: `${k.ad} ${k.soyad}`, alt: [k.pozisyon, k.isGrubu].filter(Boolean).join(" · "), etiket: "cevapsız · süresi doldu", renk: "gri", personelKodu: k.personelKodu })
      );

    (rapor?.gecikenler ?? []).slice(0, 6).forEach((x: any, i: number) =>
      ekle({
        anahtar: `gec-${i}`,
        ad: x.sube,
        alt: x.tur === "yonetici" ? "yönetici doldurmadı" : "çalışan doldurmadı",
        etiket: `${x.gun} gün gecikti`,
        renk: "gri",
        asama: x.asama,
      })
    );

    return liste.map((x) => {
      const k = x.personelKodu ? karnesi(x.personelKodu) : null;
      const t = x.personelKodu ? takipHaritasi.get(K(x.personelKodu)) : null;
      const sira = k ? karneSirasi(k) : -1;

      return {
        ...x,
        karne: k,
        takip: t,
        asamaAdi: t ? donemAdi(t.donem) : sira >= 0 ? ASAMALAR[sira].ad : x.asama ? asamaAdi(x.asama) : "—",
        calisan: k ? sonDolu(k.puanlar)[0] : t?.k?.anketPuan ?? null,
        yonetici: k ? sonDolu(k.yoneticiPuanlar)[0] : t?.k?.yoneticiPuan ?? null,
      };
    });
  })();

  /* ============================================================ SATIR */

  /** Süre etiketi: pencerenin son gününe kalan */
  const sureEt = (k: any) => {
    /* Pencere dışı ama anketi yanıtsız: yalnızca yeniden gönderim için listede */
    if (k.pencereDisi)
      return (
        <Tooltip title={`${k.gecenGun}. gün · pencere kapandı; anket yanıtlanmadığı için listede`}>
          <span><Et renk="gri" yok>pencere dışı · {k.gecenGun}. gün</Et></span>
        </Tooltip>
      );

    /* Kişi pencereden çıkınca listeden düşer; o yüzden "geçti" yerine
       "son gün" uyarısı verilir */
    if (k.kalanGun > 1)
      return (
        <Tooltip title={`${k.gecenGun}. gün · pencere ${k.kalanGun} gün sonra kapanır`}>
          <span><Et renk="mavi" yok>{k.kalanGun} gün kaldı</Et></span>
        </Tooltip>
      );

    if (k.kalanGun === 1)
      return (
        <Tooltip title={`${k.gecenGun}. gün · yarın listeden düşer`}>
          <span><Et renk="sari" yok>yarın son gün</Et></span>
        </Tooltip>
      );

    if (k.kalanGun === 0)
      return (
        <Tooltip title={`${k.gecenGun}. gün · bugün listeden düşer`}>
          <span><Et renk="kirmizi" yok>bugün son gün</Et></span>
        </Tooltip>
      );

    return <Et renk="kirmizi" yok>{Math.abs(k.kalanGun)} gün geçti</Et>;
  };

  /** Çalışan anketinin durumu */
  const calisanDurumu = (k: any) => {
    if (!k.anketDurumu) return <Et renk="gri">gönderilmedi</Et>;

    if (k.anketDurumu === "bekliyor")
      return (
        <Tooltip
          title={
            `${tarihSaat(k.anketGonderim)} gönderildi · ${tarihSaat(k.anketGecerlilik)} tarihine kadar geçerli` +
            (k.anketHatirlatma ? ` · ${tarihSaat(k.anketHatirlatma)} hatırlatıldı` : "")
          }
        >
          <span><Et renk="mavi">bekliyor</Et></span>
        </Tooltip>
      );

    if (k.anketDurumu === "suresiDoldu")
      return (
        <Tooltip title="Bağlantı 3 gün içinde açılmadı; satır menüsünden yeniden gönderilebilir">
          <span><Et renk="kirmizi">süresi doldu</Et></span>
        </Tooltip>
      );

    const dusuk = k.anketPuan != null && k.anketPuan < 3;

    return (
      <Tooltip title={`${tarihSaat(k.anketDolduruldu)} dolduruldu · karne için tıklayın`}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {k.anketPuan != null && (
            <span className="ot-puan" style={{ color: dusuk ? RENK_TURUNCU_YAZI : undefined }}>
              {sayiYaz(k.anketPuan)}
            </span>
          )}
          <Et renk={dusuk ? "turuncu" : "yesil"}>doldurdu</Et>
        </span>
      </Tooltip>
    );
  };

  /** Yöneticinin değerlendirmesi: kim, nereden, ne zaman */
  const yoneticiDurumu = (k: any) => {
    const kaynakEtiketi = k.yoneticiKaynak === "bolge" ? "bölge müdürü" : "mağaza yöneticisi";
    const kim = [k.yoneticiAdi, k.yoneticiTelefon].filter(Boolean).join(" · ");

    if (!k.yoneticiAnketDurumu) {
      if (!k.yoneticiBulundu)
        return (
          <Tooltip
            title={
              k.yoneticiKaynak === "bolge"
                ? "Mağaza müdürünü bölge müdürü değerlendirir; bu şubeye bağlı bölge müdürü panelde tanımlı değil ya da telefonu yok (Yönetim → Kullanıcılar)"
                : "Şubede mağaza müdürü / müdür yardımcısı bulunamadı ya da cep numarası geçersiz (Yönetim → Form Ayarları → yönetici eşleştirme)"
            }
          >
            <span><Et renk="kirmizi">{k.yoneticiKaynak === "bolge" ? "bölge müdürü tanımsız" : "yönetici bulunamadı"}</Et></span>
          </Tooltip>
        );

      return (
        <Tooltip
          title={
            k.yoneticiKanal === "uygulama"
              ? `${kim || "Yöneticisi"} Biçen360 kullanıyor; personele anket gidince değerlendirmeyi Biçen360'tan yapar`
              : `Gönderim yapılınca ${kaynakEtiketi} olarak ${kim || "yöneticinin"} Biçen360'ına düşer`
          }
        >
          <span><Et renk="gri">gönderilmedi</Et></span>
        </Tooltip>
      );
    }

    const ip =
      `${kim || "Yönetici"} · ` +
      (k.yoneticiAnketDurumu === "dolduruldu"
        ? `${tarihSaat(k.yoneticiAnketDolduruldu)} değerlendirdi`
        : k.yoneticiKanal === "uygulama"
        ? `uygulamada bekliyor · ${tarihSaat(k.yoneticiAnketGecerlilik)} tarihine kadar`
        : `${tarihSaat(k.yoneticiAnketGonderim)} gönderildi · ${tarihSaat(k.yoneticiAnketGecerlilik)} tarihine kadar geçerli`);

    if (k.yoneticiAnketDurumu === "dolduruldu")
      return (
        <Tooltip title={ip}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {k.yoneticiPuan != null && <span className="ot-puan">{sayiYaz(k.yoneticiPuan)}</span>}
            <Et renk="yesil">doldurdu</Et>
          </span>
        </Tooltip>
      );

    return (
      <Tooltip title={ip}>
        <span>
          {k.yoneticiAnketDurumu === "suresiDoldu" ? <Et renk="kirmizi">süresi doldu</Et> : <Et renk="mavi">bekliyor</Et>}
        </span>
      </Tooltip>
    );
  };

  /** Satır menüsü (⋯): karne, hatırlatma / yeniden gönderim, not */
  const menuOgeleri = (k: any, donemStr: string): MenuProps["items"] => {
    const cYanitsiz = k.anketDurumu === "bekliyor" || k.anketDurumu === "suresiDoldu";
    const yYanitsiz = k.yoneticiAnketDurumu === "bekliyor" || k.yoneticiAnketDurumu === "suresiDoldu";
    const ikon = { size: 15, strokeWidth: 2 };

    const ogeler: MenuProps["items"] = [
      { key: "karne", icon: <User {...ikon} />, label: "Karneyi aç" },
      { type: "divider" },
    ];

    if (gonderebilir) {
      if (k.anketDurumu === "bekliyor")
        ogeler.push({
          key: "hc",
          icon: <Smartphone {...ikon} />,
          label: (
            <span>
              Personele bildirimle hatırlat
              <small>Biçen360 bildirimi · günde bir kez</small>
            </span>
          ),
        });

      if (k.anketDurumu === "suresiDoldu" || !k.anketDurumu)
        ogeler.push({
          key: "gc",
          icon: <Send {...ikon} />,
          label: (
            <span>
              {`Kendisine ${k.anketDurumu ? "yeniden " : ""}gönder`}
              <small>{k.uygulamaKullaniyor ? "Biçen360 bildirimi" : "Biçen360 · giriş yapmamış, bildirim gidemez"}</small>
            </span>
          ),
        });

      if (k.yoneticiAnketDurumu !== "dolduruldu")
        ogeler.push({
          key: "hy",
          icon: <Store {...ikon} />,
          label: (
            <span>
              {k.yoneticiAnketDurumu === "bekliyor" ? "Yöneticisine hatırlat" : "Yöneticisine gönder"}
              <small>
                {(k.yoneticiAdi || "yönetici") + " · Biçen360"}
              </small>
            </span>
          ),
        });

      if (cYanitsiz && yYanitsiz)
        ogeler.push({
          key: "cy",
          icon: <RotateCw {...ikon} />,
          label: (
            <span>
              İkisine de yeniden gönder
              <small>Biçen360 bildirimi · süre baştan başlar</small>
            </span>
          ),
        });

      ogeler.push({ type: "divider" });
    }

    ogeler.push({
      key: "not",
      icon: <Pencil {...ikon} />,
      label: k.tamamlandi ? "Görüşme notunu düzenle" : "Görüşme notu ekle",
    });

    return ogeler;
  };

  const menuSec = (k: any, donemStr: string, key: string) => {
    const asama = donemdenKod(donemStr) ?? secilenAsama;

    if (key === "karne") karneAc(k.personelKodu);
    else if (key === "hc") hatirlat(k, asama, "c");
    else if (key === "gc") yenidenGonder(k, true, false, donemStr);
    else if (key === "hy") hatirlat(k, asama, "y");
    else if (key === "cy") yenidenGonder(k, true, true, donemStr);
    else if (key === "not") notAc(k, donemStr);
  };

  /* ===================================================== TAKİP LİSTESİ */
  const takipGorunumu = (
    <>
      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : !veri ? (
        <div className="ot-kart">
          <Empty style={{ padding: 30 }} description="Takip verisi alınamadı." />
        </div>
      ) : (
        <>
          {/* ------------------------------------------------- aşamalar */}
          <div className="ot-asamalar">
            {donemler.map((d: any) => {
              const grup: any[] = (d.kisiler ?? []).filter((k: any) => !k.kacirildi);
              const n = Math.max(1, grup.length);
              const cOran = Math.round((grup.filter((k) => k.anketDurumu === "dolduruldu").length / n) * 100);
              const yOran = Math.round((grup.filter((k) => k.yoneticiAnketDurumu === "dolduruldu").length / n) * 100);
              const uyg = grup.filter((k) => k.anketKanal === "uygulama").length;

              return (
                <button
                  key={d.donem}
                  type="button"
                  className={`ot-asama${d.donem === secilenDonem ? " secili" : ""}`}
                  onClick={() => setSecilenDonem(d.donem)}
                  aria-pressed={d.donem === secilenDonem}
                >
                  <div className="ot-asama-ust">
                    <span className="ot-asama-ad">{donemAdi(d.donem)}</span>
                    <span className="ot-asama-pen">
                      {d.enAz === d.enFazla ? `çalışma süresi ${d.enAz}. gün` : `${d.enAz}–${d.enFazla}. gün`}
                    </span>
                  </div>
                  <div className="ot-asama-sayi">
                    {d.bekleyen} <small>/ {d.toplam} bekleyen</small>
                  </div>
                  <Tooltip title={`Tamamlanan anket · çalışan %${cOran}, yönetici %${yOran}`}>
                    <div className="ot-cubuk">
                      <i style={{ width: `${cOran / 2}%`, background: RENK_CAL }} />
                      <i style={{ width: `${yOran / 2}%`, background: RENK_YON }} />
                    </div>
                  </Tooltip>
                  <div className="ot-oranlar">
                    <span>
                      <span className="ot-nokta" style={{ background: RENK_CAL }} />
                      Çalışan<b>%{cOran}</b>
                    </span>
                    <span>
                      <span className="ot-nokta" style={{ background: RENK_YON }} />
                      Yönetici<b>%{yOran}</b>
                    </span>
                    <span style={{ marginLeft: "auto", textAlign: "right" }}>
                      Uygulamada<b>{uyg}/{grup.length}</b>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ---------------------------------------------- araç çubuğu */}
          <div className="ot-kart ot-arac">
            <Seg
              deger={suzgec}
              onChange={setSuzgec}
              secenekler={[
                { value: "bekleyen", label: `Bekleyen ${donem?.bekleyen ?? 0}` },
                { value: "hepsi", label: `Tümü ${donem?.toplam ?? 0}` },
              ]}
            />

            <label className="ot-ara">
              <Search size={15} strokeWidth={2} />
              <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Ad, sicil, telefon, ünvan ara" />
              {arama && (
                <button type="button" className="ot-dg hayalet kucuk" onClick={() => setArama("")} aria-label="Aramayı temizle">
                  <X size={13} />
                </button>
              )}
            </label>

            <select className="ot-sec" style={{ width: 130 }} value={birim ?? ""} onChange={(e) => setBirim(e.target.value || undefined)} aria-label="Birim">
              <option value="">Birim</option>
              {birimler.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <select className="ot-sec" style={{ width: 104 }} value={kanalSuzgec ?? ""} onChange={(e) => setKanalSuzgec(e.target.value || undefined)} aria-label="Kanal">
              <option value="">Kanal</option>
              <option value="uygulama">Uygulama</option>
              <option value="sms">SMS</option>
            </select>

            <select className="ot-sec" style={{ width: 130 }} value={gorusmeDurumu ?? ""} onChange={(e) => setGorusmeDurumu(e.target.value || undefined)} aria-label="Görüşme">
              <option value="">Görüşme</option>
              <option value="yok">Görüşülmedi</option>
              {DURUMLAR.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>

            {filtreVar && (
              <button type="button" className="ot-dg hayalet kucuk" onClick={filtreleriTemizle}>
                Temizle
              </button>
            )}

            <span className="ot-bosluk" />

            {gonderebilir && (
              <Tooltip title="Bu dönemin listesinde anket süresi dolmuş herkese (ve yöneticilerine) Biçen360'tan yeniden gönderir; anketi hâlâ açık olanlara gitmez">
                <button type="button" className="ot-dg uyari" onClick={() => setYenidenAcik(true)}>
                  <RotateCw size={14} strokeWidth={2.2} /> Süresi dolanlar <b>{dolanlar.length}</b>
                </button>
              </Tooltip>
            )}

            {sinamaYetkisi && (
              <>
                <button type="button" className="ot-dg ana" onClick={topluAc}>
                  <Mail size={14} strokeWidth={2.2} /> Toplu gönder
                </button>
                <button type="button" className="ot-dg hayalet" onClick={() => { setTestAsama(secilenAsama); setTestAcik(true); }}>
                  Test ▾
                </button>
              </>
            )}
          </div>

          {/* --------------------------------------------------- liste */}
          <div className="ot-kart">
            <div className="ot-kart-bas">
              <h3>
                {donemAdi(secilenDonem)} · {suzgec === "bekleyen" ? "bekleyen" : "tümü"} {kisiler.length} kişi
              </h3>
              <span>
                {donem
                  ? donem.enAz === donem.enFazla
                    ? `çalışma süresi ${donem.enAz}. gün olanlar`
                    : `çalışma süresi ${donem.enAz}–${donem.enFazla}. gün olanlar`
                  : ""}
              </span>
              <span className="ot-sag ot-lejant">
                <KanalEt kanal="uygulama" />
                <KanalEt kanal="sms" />
                <Tooltip title="Yenile">
                  <button type="button" className="ot-dg hayalet kucuk" onClick={getir} aria-label="Yenile">
                    <RefreshCw size={13} strokeWidth={2} className={yukleniyor ? "anticon-spin" : ""} />
                  </button>
                </Tooltip>
              </span>
            </div>

            <div className="ot-tablo-kap" style={{ marginTop: 10 }}>
              <Table
                size="small"
                rowKey="personelKodu"
                dataSource={kisiler}
                pagination={
                  kisiler.length > 20
                    ? { current: takipSayfa, pageSize: 20, showSizeChanger: false, onChange: setTakipSayfa }
                    : false
                }
                scroll={{ x: 1100 }}
                tableLayout="fixed"
                rowClassName={() => "ot-tik"}
                onRow={(k: any) => ({ onClick: () => karneAc(k.personelKodu) })}
                locale={{
                  emptyText: (
                    <div className="ot-bos-sat">
                      {filtreVar
                        ? "Bu süzgeçle kimse yok."
                        : suzgec === "bekleyen"
                        ? `${donemAdi(secilenDonem)} görüşmesi bekleyen personel bulunmuyor.`
                        : "Bu dönemde personel bulunmuyor."}
                      {filtreVar && (
                        <div style={{ marginTop: 8 }}>
                          <button type="button" className="ot-dg kucuk" onClick={filtreleriTemizle}>Filtreleri temizle</button>
                        </div>
                      )}
                    </div>
                  ),
                }}
                columns={[
                  {
                    title: "Personel",
                    key: "ad",
                    width: 216,
                    render: (_: unknown, k: any) => (
                      <KisiHucre
                        kod={k.personelKodu}
                        ad={`${k.ad ?? ""} ${k.soyad ?? ""}`.trim()}
                        alt={`Sicil ${k.personelKodu}${k.telefon ? ` · ${k.telefon}` : ""}`}
                      />
                    ),
                  },
                  {
                    title: "Birim · Ünvan",
                    key: "birim",
                    width: 116,
                    render: (_: unknown, k: any) => (
                      <div className="ot-ikili">
                        {k.isGrubu || "—"}
                        <small>{k.pozisyon}</small>
                      </div>
                    ),
                  },
                  {
                    title: "İşe giriş",
                    dataIndex: "girisTarihi",
                    width: 102,
                    render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{tarih(v)}</span>,
                  },
                  { title: "Süre", key: "sure", width: 138, render: (_: unknown, k: any) => sureEt(k) },
                  {
                    title: "Anket",
                    key: "anket",
                    width: 316,
                    render: (_: unknown, k: any) => (
                      <div className="ot-anket">
                        <span className="k">ÇALIŞAN</span>
                        <span className="h">
                          {calisanDurumu(k)}
                          {k.anketDurumu && <KanalEt kanal={k.anketKanal} />}
                        </span>
                        <span className="k">YÖNETİCİ</span>
                        <span className="h">
                          {yoneticiDurumu(k)}
                          {k.yoneticiAnketDurumu && <KanalEt kanal={k.yoneticiKanal} />}
                        </span>
                      </div>
                    ),
                  },
                  {
                    title: "Görüşme",
                    key: "gorusme",
                    render: (_: unknown, k: any) => (
                      <GorusmeEt durum={k.tamamlandi ? k.notDurumu : null} not={k.notMetni} tarihi={k.notTarihi} />
                    ),
                  },
                  {
                    title: "",
                    key: "islem",
                    width: 128,
                    align: "right" as const,
                    render: (_: unknown, k: any) => {
                      const mesgul = yenidenGonderiliyor.startsWith(`${k.personelKodu}|`);

                      return (
                        <span style={{ whiteSpace: "nowrap", display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <button
                            type="button"
                            className={`ot-dg kucuk${k.tamamlandi ? "" : " ana"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              notAc(k);
                            }}
                          >
                            {k.tamamlandi ? "Düzenle" : "Not ekle"}
                          </button>
                          <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            rootClassName="ot-menu"
                            menu={{
                              items: menuOgeleri(k, secilenDonem),
                              onClick: ({ key, domEvent }) => {
                                domEvent.stopPropagation();
                                menuSec(k, secilenDonem, String(key));
                              },
                            }}
                          >
                            <button
                              type="button"
                              className="ot-dg kucuk hayalet"
                              aria-label="Diğer işlemler"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {mesgul ? <Spin size="small" /> : <MoreHorizontal size={16} strokeWidth={2} />}
                            </button>
                          </Dropdown>
                        </span>
                      );
                    },
                  },
                ]}
              />
            </div>

            <div className="ot-alt-bilgi">
              <span>
                {kisiler.length === 0
                  ? "0 kişi"
                  : `${(takipSayfa - 1) * 20 + 1}–${Math.min(takipSayfa * 20, kisiler.length)} / ${kisiler.length}`}
              </span>
              <span>Satıra tıklayınca karne açılır</span>
            </div>
          </div>

          {/* ------------------------------------- pencereden çıkanlar */}
          {kacirilanlar.length > 0 && (
            <div className="ot-kart ot-kacirilan">
              <button type="button" className="ot-kacirilan-bas" onClick={() => setKacirilanAcik((x) => !x)}>
                <span>
                  <b>Penceresi geçenler · {kacirilanlar.length} kişi</b>
                  <small>
                    {donemAdi(secilenDonem)} anketini kaçırdılar; bekleyen sayılmıyorlar. Zamanı gelince bir sonraki dönemin
                    anketine girerler.
                  </small>
                </span>
                <span className="ot-kacirilan-ok">{kacirilanAcik ? "Gizle" : "Göster"}</span>
              </button>

              {kacirilanAcik && (
                <div className="ot-tablo-kap" style={{ marginTop: 10 }}>
                  <Table
                    size="small"
                    rowKey="personelKodu"
                    dataSource={kacirilanlar}
                    pagination={kacirilanlar.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
                    rowClassName={() => "ot-tik"}
                    onRow={(k: any) => ({ onClick: () => karneAc(k.personelKodu) })}
                    columns={[
                      {
                        title: "Personel",
                        key: "ad",
                        render: (_: unknown, k: any) => (
                          <KisiHucre kod={k.personelKodu} ad={`${k.ad ?? ""} ${k.soyad ?? ""}`.trim()} alt={`Sicil ${k.personelKodu}`} />
                        ),
                      },
                      {
                        title: "Birim · Ünvan",
                        key: "birim",
                        render: (_: unknown, k: any) => (
                          <div className="ot-ikili">
                            {k.isGrubu || "—"}
                            <small>{k.pozisyon}</small>
                          </div>
                        ),
                      },
                      { title: "Çalışma", key: "gun", width: 110, render: (_: unknown, k: any) => `${k.gecenGun}. gün` },
                      {
                        title: "Anket",
                        key: "anket",
                        render: (_: unknown, k: any) => (
                          <div className="ot-ikili">
                            Çalışan: {k.anketDurumu === "dolduruldu" ? "doldurdu" : k.anketDurumu ? "doldurmadı" : "gönderilmedi"}
                            <small>
                              Yönetici:{" "}
                              {k.yoneticiAnketDurumu === "dolduruldu"
                                ? `doldurdu${k.yoneticiPuan != null ? ` · ${String(k.yoneticiPuan).replace(".", ",")}` : ""}`
                                : k.yoneticiAnketDurumu
                                ? "doldurmadı"
                                : "gönderilmedi"}
                            </small>
                          </div>
                        ),
                      },
                      {
                        title: "Sonraki dönem",
                        key: "sonraki",
                        width: 170,
                        render: (_: unknown, k: any) => k.sonrakiDonem ?? "—",
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );

  /* ============================================================= PANO */
  const kanalUyg = (rapor?.kanallar ?? []).find((x: any) => x.kanal === "uygulama");
  const kanalSms = (rapor?.kanallar ?? []).find((x: any) => x.kanal === "sms");

  const panoGorunumu = (
    <>
      <div className="ot-izgara ot-i5 ot-alt-bosluk">
        {[
          {
            et: "Takipteki yeni çalışan",
            d: takiptekiler.length,
            alt: <><b>{toplamBekleyen}</b> kişi aksiyon bekliyor</>,
            git: () => setAnaSekme("takip"),
          },
          {
            et: "Çalışan anketi",
            d: `%${Math.round((cDol / Math.max(1, takiptekiler.length)) * 100)}`,
            alt: <><b>{cDol}</b> / {takiptekiler.length} doldurdu</>,
            git: () => setAnaSekme("takip"),
          },
          {
            et: "Yönetici değerlendirmesi",
            d: `%${Math.round((yDol / Math.max(1, takiptekiler.length)) * 100)}`,
            alt: <><b>{yDol}</b> / {takiptekiler.length} değerlendirildi</>,
            git: () => setAnaSekme("magaza"),
          },
          {
            et: "Ortalama memnuniyet",
            d: sayiYaz(ortalamaMemnuniyet(rapor)),
            alt: <>5 üzerinden · çalışan{rapor?.kacanSayi ? <> · <b>{rapor.kacanSayi}</b> form doldurulmadan kapandı</> : null}</>,
            git: () => setAnaSekme("analiz"),
          },
          {
            et: "Riskli",
            d: riskliSayi,
            alt: <>erken ayrılma skoru {RISK_YUKSEK}+</>,
            git: () => {
              suzgecleriKaldir();
              setKarneRisk("yuksek");
              karneListesineGit();
            },
          },
        ].map((x) => (
          <button key={x.et} type="button" className="ot-kpi" onClick={x.git}>
            <span className="et">{x.et}</span>
            <span className="d" style={x.et === "Riskli" && riskliSayi > 0 ? { color: RENK_TURUNCU_YAZI } : undefined}>{x.d}</span>
            <span className="alt">{x.alt}</span>
          </button>
        ))}
      </div>

      <div className="ot-izgara ot-i2 ot-alt-bosluk">
        <div className="ot-kart">
          <div className="ot-kart-bas">
            <h3>Aşama bazında tamamlanma</h3>
            <span>son 6 ay · satıra tıklayınca o aşamayı dolduranlar</span>
            <span className="ot-sag"><Lejant /></span>
          </div>
          <div className="ot-kart-ic">
            {!rapor ? (
              <Empty description="Rapor verisi alınamadı. Sayfayı yenilemeyi deneyin." />
            ) : (
              (() => {
                const asamalar: any[] = rapor.asamalar ?? [];
                const gonderimli = asamalar.filter((a) => a.yonetici.gonderim > 0);
                const enDusuk = gonderimli.length > 1 ? gonderimli.reduce((m, a) => (a.yonetici.oran < m.yonetici.oran ? a : m)) : null;
                const dusukler = gonderimli.filter((a) => a.yonetici.oran < 70);

                return (
                  <>
                    {asamalar.map((a) => (
                      <div
                        key={a.asama}
                        className="ot-yc tik"
                        style={{ display: "block", padding: "6px 4px" }}
                        onClick={() => {
                          const sira = ASAMALAR.findIndex((x) => x.kod === a.asama);
                          suzgecleriKaldir();
                          setAsamaSuzgec(sira >= 0 ? sira : null);
                          karneListesineGit();
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                          <span>{a.asamaAdi}</span>
                          <span className="ot-soluk" style={{ fontWeight: 600, fontSize: 12 }}>
                            {enDusuk?.asama === a.asama ? "en düşük yönetici oranı · " : ""}
                            ort. {sayiYaz(a.calisan.ortalama)} / {sayiYaz(a.yonetici.ortalama)}
                          </span>
                        </div>
                        {(["calisan", "yonetici"] as const).map((t) => (
                          <Tooltip key={t} title={`${a[t].tamamlanan}/${a[t].gonderim} form`}>
                            <div className="ot-yc" style={{ gridTemplateColumns: "70px 1fr 44px", padding: "3px 0" }}>
                              <span style={{ fontSize: 12, color: "var(--ot-ikincil)" }}>{t === "calisan" ? "Çalışan" : "Yönetici"}</span>
                              <OranCubugu oran={a[t].oran} renk={t === "calisan" ? RENK_CAL : RENK_YON} />
                              <span className="v">%{a[t].oran}</span>
                            </div>
                          </Tooltip>
                        ))}
                      </div>
                    ))}

                    {dusukler.length > 0 && (
                      <div className="ot-bilgi uyari" style={{ marginTop: 10 }}>
                        Yönetici tamamlama oranı şu aşamalarda %70'in altında:{" "}
                        {dusukler.map((a) => `${a.asamaAdi} (%${a.yonetici.oran})`).join(", ")}. Hatırlatma sıklığını artırmak gerekebilir.
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </div>
        </div>

        <div className="ot-kart">
          <div className="ot-kart-bas">
            <h3>Kanal</h3>
            <span>anketin nereden doldurulduğu · son 6 ay</span>
          </div>
          <div className="ot-kart-ic">
            {!kanalUyg && !kanalSms ? (
              <Empty description="Kanal verisi henüz yok." />
            ) : (
              <>
                <div className="ot-izgara ot-i2">
                  {[kanalUyg, kanalSms].filter(Boolean).map((x: any) => (
                    <div key={x.kanal} className="ot-bilgi">
                      <div className="ot-bilgi-bas">
                        {x.kanal === "uygulama" ? <Smartphone size={16} strokeWidth={2} /> : <MessageSquare size={16} strokeWidth={2} />}
                        {x.kanal === "uygulama" ? "Uygulama" : "SMS"}
                      </div>
                      <div className="ot-buyuk">%{x.pay}</div>
                      <div style={{ fontSize: 12, color: "var(--ot-soluk)" }}>
                        {x.kanal === "uygulama" ? "anketlerin uygulamadan gittiği oran" : "uygulamayı kullanmayanlar"} · {x.gonderim} anket
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        Doldurma oranı <b>{x.oran == null ? "—" : `%${x.oran}`}</b>
                        {x.ortalamaSaat != null && (
                          <>
                            {" "}· ortalama <b>{x.ortalamaSaat < 1 ? "1 saatten kısa sürede" : `${Math.round(x.ortalamaSaat)} saatte`}</b>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12, fontSize: 13, color: "var(--ot-ikincil)" }}>
                  {kanalSms?.gonderim > 0 && (
                    <>
                      SMS'le gönderilen anketlerde süresi içinde doldurulmayan oranı <b>%{Math.round((kanalSms.kacan / kanalSms.gonderim) * 100)}</b>.{" "}
                    </>
                  )}
                  {rapor?.uygulamasiz > 0 && (
                    <>
                      SMS alan <b>{rapor.uygulamasiz} kişi</b> uygulamayı hiç kurmamış:
                      <button
                        type="button"
                        className="ot-dg kucuk"
                        style={{ marginLeft: 6 }}
                        onClick={() => {
                          filtreleriTemizle();
                          setKanalSuzgec("sms");
                          setSuzgec("hepsi");
                          setAnaSekme("takip");
                        }}
                      >
                        Listede göster
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="ot-kart">
        <div className="ot-kart-bas">
          <h3>Aksiyon bekleyenler</h3>
          <span>düşük puan, ayrılma sinyali, İK'ya bildirim ya da cevapsız</span>
        </div>
        <div className="ot-tablo-kap" style={{ marginTop: 10 }}>
          <Table
            size="small"
            rowKey="anahtar"
            dataSource={aksiyonBekleyenler}
            pagination={aksiyonBekleyenler.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
            rowClassName={(x: any) => (x.personelKodu ? "ot-tik" : "")}
            onRow={(x: any) => ({ onClick: () => x.personelKodu && karneAc(x.personelKodu) })}
            locale={{ emptyText: <div className="ot-bos-sat">Aksiyon bekleyen kayıt yok.</div> }}
            columns={[
              {
                title: "Personel",
                key: "ad",
                render: (_: unknown, x: any) =>
                  x.personelKodu ? (
                    <KisiHucre kod={x.personelKodu} ad={x.ad} alt={x.alt} />
                  ) : (
                    <div className="ot-ikili"><b>{x.ad}</b><small>{x.alt}</small></div>
                  ),
              },
              { title: "Aşama", dataIndex: "asamaAdi", width: 110 },
              { title: "Neden", key: "neden", render: (_: unknown, x: any) => <Et renk={x.renk}>{x.etiket}</Et> },
              { title: "Çalışan", key: "c", align: "right" as const, width: 100, render: (_: unknown, x: any) => <PuanYaz v={x.calisan} /> },
              { title: "Yönetici", key: "y", align: "right" as const, width: 100, render: (_: unknown, x: any) => <PuanYaz v={x.yonetici} /> },
              {
                title: "",
                key: "islem",
                align: "right" as const,
                width: 110,
                render: (_: unknown, x: any) =>
                  x.takip ? (
                    <button
                      type="button"
                      className="ot-dg kucuk"
                      onClick={(e) => {
                        e.stopPropagation();
                        notAc(x.takip.k, x.takip.donem);
                      }}
                    >
                      {x.takip.k.tamamlandi ? "Düzenle" : "Not ekle"}
                    </button>
                  ) : null,
              },
            ]}
          />
        </div>
        <div className="ot-alt-bilgi">
          <span>{aksiyonBekleyenler.length} kayıt</span>
          <span>Satıra tıklayınca karne açılır; mağaza satırlarında karne yoktur</span>
        </div>
      </div>
    </>
  );

  /* =================================================== ÇALIŞAN KARNELERİ */
  const puanHucresi = (k: any, i: number) => {
    const sira = karneSirasi(k);

    if (i > sira) return <span style={{ color: "#c5ccbf" }}>·</span>;

    const c = k.puanlar?.[i];
    const y = k.yoneticiPuanlar?.[i];

    if (c == null && y == null) return <Et renk="gri" yok>—</Et>;

    return (
      <Tooltip title={`Çalışanın kendi puanı ${sayiYaz(c)} · yöneticinin verdiği ${sayiYaz(y)}`}>
        <span className="ot-hucre-puan">
          <span className="ot-nokta" style={{ background: RENK_CAL }} />
          <b style={{ color: c != null && c < 3.5 ? RENK_TURUNCU_YAZI : undefined }}>{sayiYaz(c)}</b>{" "}
          <span className="ot-nokta" style={{ background: RENK_YON, marginLeft: 6 }} />
          <b>{sayiYaz(y)}</b>
        </span>
      </Tooltip>
    );
  };

  const karneDurumu = (k: any) => {
    const g = gorusmesi(k.personelKodu);

    if (g) return <GorusmeEt durum={g.notDurumu} not={g.notMetni} tarihi={g.notTarihi} />;

    const ip =
      k.durum === "veri yok"
        ? "Henüz ne çalışan ne yönetici anketi doldurulmuş"
        : k.durumKaynagi === "yonetici"
        ? "Çalışan henüz kendi anketini doldurmadı; durum yöneticinin puanından"
        : "Durum çalışanın son anketinden";

    return (
      <Tooltip title={ip}>
        <span>
          {k.durum === "risk" ? (
            <Et renk="kirmizi" yok>risk · takipte</Et>
          ) : k.durum === "takip" ? (
            <Et renk="sari" yok>izlenmeli · takipte</Et>
          ) : k.durum === "iyi" ? (
            <Et renk="gri" yok>takipte</Et>
          ) : (
            <Et renk="gri" yok>anket bekleniyor</Et>
          )}
        </span>
      </Tooltip>
    );
  };

  const degisimYaz = (k: any) => {
    const d = degisim(k);

    if (d == null) return <span className="ot-soluk">—</span>;

    return (
      <Tooltip title="Bu aşamanın çalışan puanı, bir önceki aşamaya göre">
        <b style={{ color: d < -0.5 ? RENK_TURUNCU_YAZI : d > 0.2 ? RENK_YESIL_YAZI : undefined, whiteSpace: "nowrap" }}>
          {d > 0 ? "▲" : d < 0 ? "▼" : "■"} {sayiYaz(Math.abs(d))}
        </b>
      </Tooltip>
    );
  };

  const karneExcel = async () => {
    try {
      const { tabloIndir } = await import("./raporExcel");

      await tabloIndir({
        baslik: "Oryantasyon · çalışan karneleri",
        altBaslik: `${suzulmusKarneler.length} kişi`,
        sayfaAdi: "Karneler",
        dosyaAdi: "oryantasyon-karneleri",
        sutunlar: [
          { ad: "Sicil", genislik: 10 },
          { ad: "Ad soyad", genislik: 24 },
          { ad: "Mağaza", genislik: 20 },
          { ad: "Görev", genislik: 20 },
          ...ASAMALAR.flatMap((a) => [
            { ad: `${a.ad} çalışan`, tip: "ondalik" as const, toplam: false, genislik: 11 },
            { ad: `${a.ad} yönetici`, tip: "ondalik" as const, toplam: false, genislik: 11 },
          ]),
          { ad: "Değişim", tip: "ondalik", toplam: false, genislik: 10 },
          { ad: "Risk skoru", tip: "sayi", toplam: false, renkOlcegi: true, genislik: 11 },
          { ad: "Durum", genislik: 12 },
          { ad: "Görüşme", genislik: 26 },
        ],
        satirlar: suzulmusKarneler.map((k: any) => {
          const g = gorusmesi(k.personelKodu);

          return [
            k.personelKodu,
            k.adSoyad ?? "",
            k.subeAdi ?? "",
            k.gorev ?? "",
            ...ASAMALAR.flatMap((_, i) => [k.puanlar?.[i] ?? null, k.yoneticiPuanlar?.[i] ?? null]),
            degisim(k),
            k.riskSkoru ?? null,
            k.durum ?? "",
            g ? `${g.notDurumu}${g.notMetni ? ` — ${g.notMetni}` : ""}` : "",
          ];
        }),
      });
    } catch (hata: any) {
      message.error(hata?.message ?? "Excel dosyası oluşturulamadı.");
    }
  };

  const suzgecVar = !!(magazaSuzgec || karneSuzgec || asamaSuzgec !== null || kisiSuzgec || karneRisk);

  const karneGorunumu = (
    <>
      <div className="ot-kart ot-arac">
        <Seg
          deger={karneGorunum}
          onChange={setKarneGorunum}
          secenekler={[
            { value: "liste", label: "Liste" },
            { value: "sube", label: "Şubeye göre" },
          ]}
        />
        <label className="ot-ara">
          <Search size={15} strokeWidth={2} />
          <input value={karneArama} onChange={(e) => setKarneArama(e.target.value)} placeholder="Ad, sicil, görev, şube ara" />
        </label>
        <select className="ot-sec" value={karneRisk} onChange={(e) => setKarneRisk(e.target.value)} aria-label="Risk">
          <option value="">Risk: tümü</option>
          <option value="yuksek">Yüksek risk ({RISK_YUKSEK}+)</option>
          <option value="orta">Orta ({RISK_ORTA}–{RISK_YUKSEK - 1})</option>
          <option value="dusuk">Düşük</option>
        </select>
        <Lejant sol="Çalışanın kendi puanı" sag="Yöneticinin verdiği" />
        <span className="ot-bosluk" />
        <button type="button" className="ot-dg" onClick={karneExcel} disabled={suzulmusKarneler.length === 0}>
          <Download size={14} strokeWidth={2.2} /> Excel'e aktar
        </button>
      </div>

      {suzgecVar && (
        <div className="ot-suzgec">
          <span>
            Liste süzülmüş: <b>{suzulmusKarneler.length}</b> / {karneler.length} kişi
          </span>
          {magazaSuzgec && <Et renk="mavi" yok>{magazaSuzgec}</Et>}
          {kisiSuzgec && <Et renk="mavi" yok>{kisiSuzgec.etiket} · {kisiSuzgec.kodlar.length} kişi</Et>}
          {karneSuzgec === "risk" && <Et renk="kirmizi" yok>yalnızca risk durumundakiler</Et>}
          {karneSuzgec === "takip" && <Et renk="sari" yok>yalnızca izlenmesi gerekenler</Et>}
          {karneSuzgec === "iyi" && <Et renk="yesil" yok>yalnızca uyum sağlayanlar</Et>}
          {karneRisk && <Et renk="kirmizi" yok>risk: {karneRisk === "yuksek" ? "yüksek" : karneRisk === "orta" ? "orta" : "düşük"}</Et>}
          {asamaSuzgec !== null && <Et renk="mavi" yok>{ASAMALAR[asamaSuzgec].ad} dolduranlar</Et>}
          <span style={{ flex: 1 }} />
          <button type="button" className="ot-dg kucuk" onClick={suzgecleriKaldir}>
            Süzgeci kaldır · tüm {karneler.length} kişi
          </button>
        </div>
      )}

      <div className="ot-kart">
        <div className="ot-tablo-kap">
          {karneGorunum === "liste" ? (
            <Table
              size="small"
              rowKey="personelKodu"
              dataSource={suzulmusKarneler}
              pagination={suzulmusKarneler.length > 25 ? { pageSize: 25, showSizeChanger: false } : false}
              scroll={{ x: 1080 }}
              rowClassName={() => "ot-tik"}
              onRow={(k: any) => ({ onClick: () => karneAc(k.personelKodu) })}
              locale={{ emptyText: <div className="ot-bos-sat">{karneler.length === 0 ? "Henüz doldurulmuş form yok." : "Aramaya uyan kimse yok."}</div> }}
              columns={[
                {
                  title: "Çalışan",
                  key: "ad",
                  width: 240,
                  render: (_: unknown, k: any) => (
                    <KisiHucre kod={k.personelKodu} ad={k.adSoyad} alt={`Sicil ${k.personelKodu}${k.gorev ? ` · ${k.gorev}` : ""}`} />
                  ),
                },
                { title: "Mağaza", dataIndex: "subeAdi", width: 140, render: (v: string) => v || <span className="ot-soluk">—</span> },
                ...ASAMALAR.map((a, i) => ({
                  title: a.ad,
                  key: a.kod,
                  width: 110,
                  render: (_: unknown, k: any) => puanHucresi(k, i),
                })),
                { title: "Değişim", key: "degisim", width: 90, render: (_: unknown, k: any) => degisimYaz(k) },
                { title: "Risk", dataIndex: "riskSkoru", width: 120, render: (v: number | null) => <RiskEt v={v} /> },
                { title: "Durum", key: "durum", width: 220, render: (_: unknown, k: any) => karneDurumu(k) },
              ]}
            />
          ) : (
            <Table
              size="small"
              rowKey="sube"
              dataSource={karneSubeleri}
              pagination={karneSubeleri.length > 25 ? { pageSize: 25, showSizeChanger: false } : false}
              rowClassName={() => "ot-tik"}
              onRow={(g: any) => ({ onClick: () => setSubePencere(g.sube) })}
              locale={{ emptyText: <div className="ot-bos-sat">Henüz doldurulmuş form yok.</div> }}
              columns={[
                { title: "Şube", dataIndex: "sube", render: (v: string) => <b>{v}</b> },
                { title: "Personel", dataIndex: "kisiSayisi", align: "right" as const, width: 100 },
                {
                  title: "Riskli",
                  dataIndex: "riskli",
                  align: "right" as const,
                  width: 90,
                  render: (v: number) => (v ? <Et renk="kirmizi" yok>{v}</Et> : <span className="ot-soluk">—</span>),
                },
                {
                  title: "Takipte",
                  dataIndex: "takip",
                  align: "right" as const,
                  width: 90,
                  render: (v: number) => (v ? <Et renk="sari" yok>{v}</Et> : <span className="ot-soluk">—</span>),
                },
                {
                  title: "Ortalama",
                  dataIndex: "ortalama",
                  width: 260,
                  render: (v: number | null) => (
                    <div className="ot-yc" style={{ gridTemplateColumns: "1fr 44px", padding: 0 }}>
                      <OranCubugu oran={v ? (v / 5) * 100 : 0} />
                      <span className="v">{sayiYaz(v)}</span>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>
    </>
  );

  /* ================================================== MAĞAZA & YÖNETİCİ */
  const genelPuan = (k: any) => {
    const p = [k.calisanPuan, k.yoneticiPuan].filter((x) => x != null) as number[];
    return p.length === 0 ? null : Math.round((p.reduce((t, x) => t + x, 0) / p.length) * 10) / 10;
  };

  const sureEtiketi = (s?: number | null) =>
    s == null ? (
      <span className="ot-soluk">—</span>
    ) : (
      <Et renk={s <= 12 ? "yesil" : s <= 24 ? "sari" : "turuncu"} yok>
        {s < 1 ? "1 saatten az" : `${Math.round(s)} saat`}
      </Et>
    );

  const magazaGorunumu = (
    <>
      <div className="ot-kart ot-alt-bosluk">
        <div className="ot-kart-bas">
          <h3>Mağaza raporu</h3>
          <span>satıra tıklayınca mağazanın yeni çalışanları</span>
        </div>
        <div className="ot-tablo-kap" style={{ marginTop: 10 }}>
          <Table
            size="small"
            rowKey="sube"
            dataSource={rapor?.magazalar ?? []}
            pagination={(rapor?.magazalar ?? []).length > 15 ? { pageSize: 15, showSizeChanger: false } : false}
            rowClassName={() => "ot-tik"}
            onRow={(k: any) => ({ onClick: () => setSubePencere(k.sube) })}
            locale={{ emptyText: <div className="ot-bos-sat">Henüz veri yok.</div> }}
            columns={[
              { title: "Mağaza", dataIndex: "sube", render: (v: string) => <b>{v}</b> },
              {
                title: "Yeni çalışan",
                dataIndex: "kisiSayisi",
                align: "right" as const,
                width: 110,
                render: (v: number, k: any) => (
                  <Tooltip title={`${k.gonderim} gönderim`}>
                    <span>{v ?? 0}</span>
                  </Tooltip>
                ),
              },
              {
                title: "Tamamlanma",
                key: "oran",
                width: 220,
                render: (_: unknown, k: any) => (
                  <Tooltip title={`${k.tamamlanan}/${k.gonderim} form`}>
                    <div className="ot-yc" style={{ gridTemplateColumns: "1fr 44px", padding: 0 }}>
                      <OranCubugu oran={k.oran} />
                      <span className="v">%{k.oran}</span>
                    </div>
                  </Tooltip>
                ),
              },
              { title: "Çalışan mem.", dataIndex: "ortalama", align: "right" as const, width: 120, render: (v: number | null) => <PuanYaz v={v} /> },
              { title: "Yönetici değ.", dataIndex: "yoneticiOrt", align: "right" as const, width: 120, render: (v: number | null) => <PuanYaz v={v} /> },
              {
                title: "Erken ayrılma",
                dataIndex: "erkenAyrilma",
                align: "right" as const,
                width: 128,
                render: (v: number | null) =>
                  v == null ? <span className="ot-soluk">—</span> : <Et renk={v >= 25 ? "kirmizi" : v >= 15 ? "turuncu" : "yesil"} yok>%{v}</Et>,
              },
              {
                title: "Riskli",
                dataIndex: "riskli",
                align: "right" as const,
                width: 80,
                render: (v: number) => (!v ? <span className="ot-soluk">—</span> : <Et renk={v >= 3 ? "kirmizi" : "turuncu"} yok>{v}</Et>),
              },
            ]}
          />
        </div>

        {(() => {
          /* Yorum veriden türetilir: elle yazılmış sabit metin birkaç ay
             sonra gerçeği yansıtmayı bırakırdı. */
          const aday = (rapor?.magazalar ?? []).filter((m: any) => m.ortalama != null);

          if (aday.length === 0) return null;

          const enDusuk = aday[0];

          if (enDusuk.ortalama >= 3.5) return null;

          const yorumlar: string[] = [`${enDusuk.sube}: çalışan memnuniyeti ${sayiYaz(enDusuk.ortalama)}`];

          if (enDusuk.yoneticiOrt != null) yorumlar.push(`yönetici kendi ekibini ${sayiYaz(enDusuk.yoneticiOrt)} değerlendiriyor`);
          if (enDusuk.erkenAyrilma != null) yorumlar.push(`erken ayrılma %${enDusuk.erkenAyrilma}`);

          yorumlar.push(`tamamlanma %${enDusuk.oran}`);

          return (
            <div style={{ padding: "0 16px 16px" }}>
              <div className="ot-bilgi kritik">
                {yorumlar.join(" · ")}. Bu mağaza listede en düşük ortalamaya sahip; incelenmesi önerilir.
              </div>
            </div>
          );
        })()}
      </div>

      <div className="ot-kart">
        <div className="ot-kart-bas">
          <h3>Yönetici karşılaştırması</h3>
          <span>satıra tıklayınca kişi bazında karşılaştırma</span>
        </div>
        <div className="ot-tablo-kap" style={{ marginTop: 10 }}>
          <Table
            size="small"
            rowKey={(k: any) => `${k.sube}|${k.yonetici}`}
            dataSource={rapor?.yoneticiler ?? []}
            pagination={(rapor?.yoneticiler ?? []).length > 15 ? { pageSize: 15, showSizeChanger: false } : false}
            scroll={{ x: 1100 }}
            tableLayout="fixed"
            className="ot-saran-baslik"
            rowClassName={() => "ot-tik"}
            onRow={(k: any) => ({ onClick: () => setKarsilastirma(k) })}
            locale={{
              emptyText: <div className="ot-bos-sat">Karşılaştırma için her iki taraftan da doldurulmuş form gerekiyor.</div>,
            }}
            columns={[
              {
                title: "Yönetici",
                dataIndex: "yonetici",
                width: 180,
                render: (v: string, k: any) => (
                  <KisiHucre
                    ad={v}
                    alt={
                      k.kisiSayisi > 0
                        ? `${k.kisiSayisi} kişi değerlendirdi`
                        : k.formSayisi > 0
                        ? `${k.formSayisi} form · kişi kodu yok`
                        : "form göndermedi"
                    }
                  />
                ),
              },
              { title: "Mağaza", dataIndex: "sube", width: 112 },
              { title: "Çalışan memnuniyeti", dataIndex: "calisanPuan", align: "right" as const, width: 178, render: (v: number | null) => <PuanYaz v={v} /> },
              { title: "Yönetici değ.", dataIndex: "yoneticiPuan", align: "right" as const, width: 118, render: (v: number | null) => <PuanYaz v={v} /> },
              {
                /* İki tarafın ortalaması; tek taraf doluysa o. Fark altta
                   küçük yazar — büyük fark başlı başına bir işaret. */
                title: "Genel puan",
                key: "genel",
                align: "right" as const,
                width: 104,
                render: (_: unknown, k: any) => {
                  const g = genelPuan(k);
                  if (g == null) return <span className="ot-soluk">—</span>;
                  return (
                    <div>
                      <PuanYaz v={g} />
                      {k.fark != null && (
                        <div style={{ fontSize: 11, color: k.fark >= 1 ? RENK_TURUNCU_YAZI : "var(--ot-soluk)" }}>fark {sayiYaz(k.fark)}</div>
                      )}
                    </div>
                  );
                },
              },
              {
                title: (
                  <Tooltip title="Çalışanın anketinin açılmasından yöneticinin değerlendirmesine kadar geçen ortalama süre. Yalnızca bilgi içindir; genel puana etki etmez.">
                    <span>Yanıt süresi <span className="ot-yeni">YENİ</span></span>
                  </Tooltip>
                ),
                dataIndex: "yanitSuresi",
                align: "right" as const,
                width: 146,
                render: (v: number | null) => sureEtiketi(v),
              },
              {
                title: "Kanal",
                dataIndex: "kanal",
                width: 96,
                render: (v: string | null) => (v ? <KanalEt kanal={v} /> : <span className="ot-soluk">—</span>),
              },
              {
                title: "Erken ayrılma",
                dataIndex: "erkenAyrilma",
                align: "right" as const,
                width: 120,
                render: (v: number | null) =>
                  v == null ? <span className="ot-soluk">—</span> : <Et renk={v >= 25 ? "kirmizi" : v >= 15 ? "turuncu" : "yesil"} yok>%{v}</Et>,
              },
              {
                /* Durum genel puandan: 4 ve üstü iyi, 3,5–4 izlenmeli, altı
                   dikkat. Fark 1 ve üstündeyse hangi tarafın düşük verdiği
                   düz Türkçe yazılır. */
                title: "Durum",
                key: "durum",
                render: (_: unknown, k: any) => {
                  const g = genelPuan(k);
                  if (g == null) return <Et renk="gri">anket bekleniyor</Et>;

                  const not =
                    k.fark != null && k.fark >= 1 ? (
                      <Tooltip
                        title={
                          k.yon === "calisanDusuk"
                            ? "Çalışanlar kendi anketinde düşük, yönetici yüksek puan veriyor: çalışan deneyimi incelenmeli"
                            : "Çalışanlar memnun, yönetici düşük puan veriyor: yöneticinin değerlendirme ölçüsü konuşulmalı"
                        }
                      >
                        <span>
                          <Et renk={k.yon === "calisanDusuk" ? "kirmizi" : "turuncu"} yok>
                            {k.yon === "calisanDusuk" ? "çalışan düşük veriyor" : "yönetici düşük veriyor"}
                          </Et>
                        </span>
                      </Tooltip>
                    ) : null;

                  return (
                    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                      {g >= 4 ? <Et renk="yesil">İyi</Et> : g >= 3.5 ? <Et renk="sari">İzlenmeli</Et> : <Et renk="turuncu">Dikkat</Et>}
                      {not}
                    </span>
                  );
                },
              },
            ]}
          />
        </div>
        <div style={{ padding: "0 16px 16px", marginTop: 10 }}>
          <div className="ot-bilgi">
            Genel puan, çalışanın kendi anketi ile yöneticisinin değerlendirmesinin ortalamasıdır; yalnızca biri doluysa o.
            Durum bu puandan: 4 ve üstü iyi, 3,5–4 izlenmeli, altı dikkat. İki puan arasındaki fark 1'i geçiyorsa hangi tarafın
            düşük verdiği yazılır. Yanıt süresi yalnızca bilgi içindir; puana ve duruma etki etmez.
          </div>
        </div>
      </div>
    </>
  );

  /* ==================================================== TREND & ANALİZ */
  const analizGorunumu = !rapor ? (
    <div className="ot-kart">
      <Empty style={{ padding: 30 }} description="Rapor verisi alınamadı." />
    </div>
  ) : (
    <>
      <div className="ot-izgara ot-i2 ot-alt-bosluk">
        <div className="ot-kart">
          <div className="ot-kart-bas">
            <h3>Aşamalara göre memnuniyet trendi</h3>
            <span>5 üzerinden ortalama</span>
            <span className="ot-sag"><Lejant /></span>
          </div>
          <div className="ot-kart-ic">
            <TrendGrafik
              asamalar={rapor.asamalar ?? []}
              onSec={(i) => {
                const sira = ASAMALAR.findIndex((x) => x.kod === rapor.asamalar[i]?.asama);
                suzgecleriKaldir();
                setAsamaSuzgec(sira >= 0 ? sira : null);
                karneListesineGit();
              }}
            />

            {(() => {
              const dolu = (rapor.asamalar ?? []).filter((a: any) => a.calisan.ortalama != null);

              if (dolu.length < 2) return null;

              const enDusuk = dolu.reduce((m: any, a: any) => (a.calisan.ortalama < m.calisan.ortalama ? a : m));
              const fark = enDusuk.yonetici.ortalama != null ? enDusuk.yonetici.ortalama - enDusuk.calisan.ortalama : null;

              return (
                <div className={`ot-bilgi${enDusuk.calisan.ortalama < 3.5 ? " uyari" : ""}`} style={{ marginTop: 10 }}>
                  En düşük memnuniyet <b>{enDusuk.asamaAdi}</b> aşamasında (çalışan {sayiYaz(enDusuk.calisan.ortalama)}).
                  {fark != null && fark >= 0.3
                    ? ` Yönetici puanı aynı dönemde ${sayiYaz(enDusuk.yonetici.ortalama)}: fark burada açılıyor.`
                    : " Eğilimin kırıldığı aşama İK'nın araştırması gereken noktadır."}{" "}
                  <span className="ot-soluk">Noktaya tıklayınca o aşamayı dolduranlar açılır.</span>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="ot-kart">
          <div className="ot-kart-bas">
            <h3>En çok işaretlenen gelişim alanları</h3>
            <span>yöneticilerin yanıtlarından · {rapor.serbestYanit?.gelisim ?? 0} yanıt · tıklayınca yorumlar</span>
          </div>
          <div className="ot-kart-ic">
            {(rapor.gelisimAlanlari ?? []).length === 0 ? (
              <div className="ot-bos-sat">Yöneticilerin açık uçlu yanıtları henüz sınıflandırılabilecek kadar birikmedi.</div>
            ) : (
              (() => {
                const enCok = Math.max(...rapor.gelisimAlanlari.map((x: any) => x.oran), 1);

                return (
                  <>
                    {rapor.gelisimAlanlari.map((x: any) => (
                      <Tooltip key={x.konu} title={`${x.adet} yanıt`}>
                        <div className="ot-yc tik" onClick={() => setKonuDetay({ ...x, baslik: "Gelişim alanı" })}>
                          <span className="ad">{x.konu}</span>
                          <OranCubugu oran={(x.oran / enCok) * 100} />
                          <span className="v">%{x.oran}</span>
                        </div>
                      </Tooltip>
                    ))}
                    <div className="ot-bilgi" style={{ marginTop: 10 }}>
                      Eğitim planının doğrudan girdisi. En çok işaretlenen alan: <b>{rapor.gelisimAlanlari[0].konu}</b> — yanıtların{" "}
                      <b>%{rapor.gelisimAlanlari[0].oran}</b> kadarı bu başlıkta.
                    </div>
                  </>
                );
              })()
            )}
          </div>
        </div>
      </div>

      <div className="ot-izgara ot-i2 ot-alt-bosluk">
        <div className="ot-kart">
          <div className="ot-kart-bas">
            <h3>Ayrılma ile ilişki</h3>
            <span>değerlendirme sonucu → sonraki 6 ayda ayrılan</span>
          </div>
          <div className="ot-tablo-kap" style={{ marginTop: 10 }}>
            <Table
              size="small"
              rowKey="ad"
              pagination={false}
              dataSource={rapor.ayrilmaIliskisi ?? []}
              rowClassName={(k: any) => (k.kisi ? "ot-tik" : "")}
              onRow={(k: any) => ({
                onClick: () => {
                  if (!k.kisi) return;
                  suzgecleriKaldir();
                  setKisiSuzgec({ etiket: k.ad, kodlar: k.kisiler ?? [] });
                  karneListesineGit();
                },
              })}
              locale={{ emptyText: <div className="ot-bos-sat">Henüz yeterli veri yok.</div> }}
              columns={[
                {
                  title: "Değerlendirme sonucu",
                  dataIndex: "ad",
                  render: (v: string, k: any) => <span style={{ fontWeight: k.tur === "genel" ? 800 : 400 }}>{v}</span>,
                },
                { title: "Kişi", dataIndex: "kisi", align: "right" as const, width: 60 },
                {
                  title: "Sonraki 6 ayda ayrılan",
                  key: "cubuk",
                  width: 170,
                  render: (_: unknown, k: any) => (
                    <Tooltip title={`${k.ayrilan} kişi`}>
                      <div>
                        <OranCubugu oran={k.oran ?? 0} renk={k.tur === "iyi" ? RENK_CAL : (k.oran ?? 0) >= 30 ? RENK_TURUNCU : RENK_CAL} />
                      </div>
                    </Tooltip>
                  ),
                },
                {
                  title: "Oran",
                  dataIndex: "oran",
                  align: "right" as const,
                  width: 70,
                  render: (v: number | null) => (v == null ? <span className="ot-soluk">—</span> : <span className="ot-puan">%{v}</span>),
                },
              ]}
            />
          </div>
          {(() => {
            const satirlar = rapor.ayrilmaIliskisi ?? [];
            const genel = satirlar.find((x: any) => x.tur === "genel");
            const riskli = satirlar
              .filter((x: any) => x.tur !== "genel" && x.tur !== "iyi" && x.oran != null && x.kisi > 0)
              .sort((a: any, b: any) => b.oran - a.oran)[0];

            if (!genel || genel.oran == null || !riskli) return null;

            /* Kat sayısı virgüllü yazılır; rapor Türkçe okunuyor */
            const kat = genel.oran > 0 ? sayiYaz(Math.round((riskli.oran / genel.oran) * 10) / 10) : null;
            const katVar = genel.oran > 0 && riskli.oran > genel.oran;

            return (
              <div style={{ padding: "0 16px 16px", marginTop: 10 }}>
                <div className="ot-bilgi kritik">
                  "{riskli.ad}" grubunda ayrılma oranı <b>%{riskli.oran}</b>
                  {katVar ? ` — genel ortalamanın ${kat} katı` : ""}. Bu grup erken müdahale için hedef kitledir.
                </div>
              </div>
            );
          })()}
        </div>

        <div className="ot-kart">
          <div className="ot-kart-bas">
            <h3>Çalışanın gözünden Biçen</h3>
            <span>açık uçlu yanıtlardan · {(rapor.serbestYanit?.memnun ?? 0) + (rapor.serbestYanit?.istek ?? 0)} yanıt</span>
          </div>
          <div className="ot-kart-ic ot-izgara ot-i2">
            {[
              { baslik: "Olumlu", tam: "En çok memnun olunan", liste: rapor.memnunKonulari ?? [], renk: RENK_YESIL_YAZI },
              { baslik: "Olumsuz", tam: "En çok geliştirilmesi istenen", liste: rapor.istekKonulari ?? [], renk: RENK_TURUNCU_YAZI },
            ].map((b) => (
              <div key={b.baslik}>
                <div style={{ fontWeight: 800, color: b.renk, marginBottom: 6 }} title={b.tam}>{b.baslik}</div>
                {b.liste.length === 0 ? (
                  <div className="ot-soluk" style={{ fontSize: 13 }}>Henüz yeterli yanıt yok.</div>
                ) : (
                  b.liste.map((x: any) => (
                    <Tooltip key={x.konu} title={`${x.adet} yanıt · tıklayınca yorumlar`}>
                      <div className="ot-yc tik" style={{ gridTemplateColumns: "1fr 40px", padding: "3px 4px" }} onClick={() => setKonuDetay({ ...x, baslik: b.tam })}>
                        <span style={{ fontSize: 13 }}>{x.konu}</span>
                        <span className="v">%{x.oran}</span>
                      </div>
                    </Tooltip>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ot-kart">
        <div className="ot-kart-bas">
          <h3>Alan bazında çalışan – yönetici karşılaştırması</h3>
          <span>aynı alan iki taraftan; fark sağda · tıklayınca alanı oluşturan sorular</span>
          <span className="ot-sag"><Lejant /></span>
        </div>
        <div className="ot-kart-ic">
          {(rapor.alanlar ?? []).length === 0 ? (
            <div className="ot-bos-sat">Henüz doldurulmuş ölçek sorusu yok.</div>
          ) : (
            <>
              <div className="ot-fark" style={{ fontSize: 11, color: "var(--ot-soluk)", fontWeight: 800, letterSpacing: ".05em" }}>
                <span>ALAN</span>
                <span style={{ textAlign: "right" }}>ÇALIŞAN</span>
                <span>YÖNETİCİ</span>
                <span style={{ textAlign: "right" }}>FARK</span>
              </div>
              {rapor.alanlar.map((a: any) => {
                const f = a.calisan != null && a.yonetici != null ? Math.round((a.calisan - a.yonetici) * 10) / 10 : null;

                return (
                  <Tooltip key={a.alan} title={`${a.alan}: çalışan ${sayiYaz(a.calisan)} · yönetici ${sayiYaz(a.yonetici)} · ${a.adet} yanıt`}>
                    <div className="ot-fark tik" onClick={() => setAlanDetay(a)}>
                      <span>{a.alan}</span>
                      <div className="sol"><i style={{ width: `${((a.calisan ?? 0) / 5) * 100}%` }} /></div>
                      <div className="sg orta"><i style={{ width: `${((a.yonetici ?? 0) / 5) * 100}%` }} /></div>
                      <b style={{ textAlign: "right", color: f != null && Math.abs(f) >= 0.5 ? RENK_TURUNCU_YAZI : undefined }}>
                        {f == null ? "—" : `${f > 0 ? "+" : ""}${sayiYaz(f)}`}
                      </b>
                    </div>
                  </Tooltip>
                );
              })}
              {(() => {
                const ciftler = rapor.alanlar.filter((a: any) => a.calisan != null && a.yonetici != null);
                if (ciftler.length === 0) return null;
                const enBuyuk = ciftler.reduce((m: any, a: any) => (Math.abs(a.calisan - a.yonetici) > Math.abs(m.calisan - m.yonetici) ? a : m));
                if (Math.abs(enBuyuk.calisan - enBuyuk.yonetici) < 0.3) return null;

                return (
                  <div className="ot-bilgi" style={{ marginTop: 10 }}>
                    En büyük ayrışma <b>{enBuyuk.alan}</b> alanında:{" "}
                    {enBuyuk.yonetici > enBuyuk.calisan
                      ? `yöneticiler ${sayiYaz(enBuyuk.yonetici)} veriyor, çalışanlar ${sayiYaz(enBuyuk.calisan)} ile katılmıyor.`
                      : `çalışanlar ${sayiYaz(enBuyuk.calisan)} veriyor, yöneticiler ${sayiYaz(enBuyuk.yonetici)} ile daha sert değerlendiriyor.`}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </>
  );

  /* ======================================================= İCRA KURULU */
  const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  const icraGorunumu = (() => {
    const r = icraDonem === "6ay" ? rapor : icraRaporu;
    const donemYazi = r
      ? `${icraDonem === "6ay" ? "Son 6 ay" : icraDonem === "3ay" ? "Son 3 ay" : `${dayjs(r.bitis).year()} yılı`} (${AYLAR[dayjs(r.baslangic).month()]} – ${AYLAR[dayjs(r.bitis).month()]} ${dayjs(r.bitis).year()})`
      : "";

    const ortalamaAl = (alan: "calisan" | "yonetici") => {
      const p = (r?.asamalar ?? []).filter((a: any) => a[alan].ortalama != null && a[alan].tamamlanan > 0);
      const n = p.reduce((t: number, a: any) => t + a[alan].tamamlanan, 0);
      return n === 0 ? null : Math.round((p.reduce((t: number, a: any) => t + a[alan].ortalama * a[alan].tamamlanan, 0) / n) * 10) / 10;
    };

    const oranAl = (alan: "calisan" | "yonetici") => {
      const g = (r?.asamalar ?? []).reduce((t: number, a: any) => t + a[alan].gonderim, 0);
      const d = (r?.asamalar ?? []).reduce((t: number, a: any) => t + a[alan].tamamlanan, 0);
      return g === 0 ? null : Math.round((d * 100) / g);
    };

    const calisanOrt = ortalamaAl("calisan");
    const yoneticiOrt = ortalamaAl("yonetici");
    const genelAyrilma = (r?.ayrilmaIliskisi ?? []).find((x: any) => x.tur === "genel");

    /* En güçlü ve en zayıf alan: alan kırılımı iki tarafı birleştirdiği için */
    const alanlar = (r?.alanlar ?? []).filter((a: any) => a.calisan != null || a.yonetici != null);
    const alanPuan = (a: any) => {
      const p = [a.calisan, a.yonetici].filter((x) => x != null) as number[];
      return p.reduce((t, x) => t + x, 0) / p.length;
    };
    const siraliAlanlar = [...alanlar].sort((a, b) => alanPuan(a) - alanPuan(b));
    const enZayif = siraliAlanlar[0];
    const enGuclu = siraliAlanlar[siraliAlanlar.length - 1];

    /* Aksiyon maddeleri veriden türetilir; elle yazılmış sabit metin
       birkaç ay sonra gerçeği yansıtmayı bırakırdı. */
    const aksiyonlar: string[] = [];

    const dusukMagazalar = (r?.magazalar ?? []).filter((m: any) => m.ortalama !== null && m.ortalama < 3.5);
    if (dusukMagazalar.length > 0)
      aksiyonlar.push(
        `${dusukMagazalar.slice(0, 4).map((m: any) => m.sube).join(", ")}${dusukMagazalar.length > 4 ? ` ve ${dusukMagazalar.length - 4} birim daha` : ""}: çalışan memnuniyeti 3,5'in altında. Mağaza müdürleriyle görüşme.`
      );

    if ((r?.riskliSayi ?? 0) > 0) aksiyonlar.push(`${r.riskliSayi} çalışanın puanı 3,0'ın altında; İK görüşmesi önerilir.`);

    if ((r?.ikBildirimleri ?? []).length > 0)
      aksiyonlar.push(`${r.ikBildirimleri.length} formda İK'ya iletilmek istenen bir konu bildirildi.`);

    if ((r?.gelisimAlanlari ?? []).length > 0)
      aksiyonlar.push(`En çok işaretlenen gelişim alanı: ${r.gelisimAlanlari[0].konu} (%${r.gelisimAlanlari[0].oran}).`);

    if ((r?.kacanSayi ?? 0) > 0)
      aksiyonlar.push(`${r.kacanSayi} form süresi dolduğu için doldurulmadan kapandı; hatırlatma sıklığı gözden geçirilmeli.`);

    const dusukTamamlama = (r?.asamalar ?? []).filter((a: any) => a.yonetici.gonderim > 0 && a.yonetici.oran < 70);
    if (dusukTamamlama.length > 0)
      aksiyonlar.push("Yönetici formu tamamlanma oranı düşük: " + dusukTamamlama.map((a: any) => `${a.asamaAdi} (%${a.yonetici.oran})`).join(", "));

    const zayifSorular = (r?.sorular ?? []).filter((x: any) => x.ortalama < 3.2);
    if (zayifSorular.length > 0)
      aksiyonlar.push(`En düşük puanlı başlık: "${zayifSorular[0].soru}" (${sayiYaz(zayifSorular[0].ortalama)}/5).`);

    const yuksekAyrilma = (r?.yoneticiler ?? []).filter((y: any) => y.erkenAyrilma != null && y.erkenAyrilma >= 25);
    if (yuksekAyrilma.length > 0)
      aksiyonlar.push("Erken ayrılma %25'in üzerinde olan birimler: " + yuksekAyrilma.slice(0, 4).map((y: any) => y.sube).join(", "));

    const sms = (r?.kanallar ?? []).find((x: any) => x.kanal === "sms");
    if (sms?.gonderim > 0 && sms.kacan > 0)
      aksiyonlar.push(
        `SMS ile gönderilen anketlerde süresinde doldurmayanların oranı %${Math.round((sms.kacan / sms.gonderim) * 100)}: Biçen360 kurulumunun işe girişte yapılması.`
      );

    const yeterliVeri = (r?.toplamGonderim ?? 0) > 0;
    const yildizBas = (l: any[]) =>
      l.map((x: any) => (
        <div key={x.tur + x.soru} className="ot-yc" style={{ gridTemplateColumns: "1fr 40px", padding: "3px 0" }}>
          <span style={{ fontSize: 13 }}>
            {x.soru} <span className="ot-soluk" style={{ fontSize: 11.5 }}>· {x.tur === "calisan" ? "çalışan" : "yönetici"}, {x.adet} yanıt</span>
          </span>
          <span className="v">{sayiYaz(x.ortalama)}</span>
        </div>
      ));

    const toplamKarne = Math.max(1, karneler.length);

    return (
      <>
        <div className="ot-kart ot-arac">
          <select className="ot-sec" style={{ maxWidth: 260 }} value={icraDonem} onChange={(e) => setIcraDonem(e.target.value as any)} aria-label="Dönem">
            <option value="6ay">Son 6 ay</option>
            <option value="3ay">Son 3 ay</option>
            <option value="yil">{dayjs().year()} yılı</option>
          </select>
          <span className="ot-bosluk" />
          <button
            type="button"
            className="ot-dg"
            onClick={() => {
              /* Yalnızca özet sayfası basılsın: kopyası gövdenin altına
                 alınır, yazdırırken panelin geri kalanı gizlenir. */
              const kaynak = document.querySelector(".ot-icra-sayfa");
              if (!kaynak) return;

              document.getElementById("ot-yazdir-kok")?.remove();

              const kok = document.createElement("div");
              kok.id = "ot-yazdir-kok";
              kok.className = "ot";
              kok.appendChild(kaynak.cloneNode(true));
              document.body.appendChild(kok);
              document.body.classList.add("ot-yazdir");

              const temizle = () => {
                kok.remove();
                document.body.classList.remove("ot-yazdir");
                window.removeEventListener("afterprint", temizle);
              };

              window.addEventListener("afterprint", temizle);
              window.print();
            }}
          >
            <Printer size={14} strokeWidth={2.2} /> Yazdır
          </button>
        </div>

        <div className="ot-icra-sayfa">
          <div className="ot-icra-ust">
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".08em", color: "var(--ot-yesil-koyu)" }}>
                İNSAN KAYNAKLARI · İCRA KURULU
              </div>
              <h2>Yeni Çalışan Deneyimi — yönetim özeti</h2>
            </div>
            <div className="ot-sag">
              {donemYazi}
              <br />
              Hazırlanma: {dayjs().format("DD.MM.YYYY")}
            </div>
          </div>

          {!r ? (
            <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
          ) : !yeterliVeri ? (
            <Empty style={{ margin: "40px 0" }} description="Bu dönemde gönderim yapılmamış. Form gönderimi başladıkça bu sayfa kendiliğinden dolar." />
          ) : (
            <>
              <div className="ot-izgara ot-i4" style={{ marginBottom: 18 }}>
                <div className="ot-bilgi">
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ot-ikincil)" }}>Yeni çalışan</div>
                  <div className="ot-buyuk">{r.yeniBaslayan ?? 0}</div>
                  <div style={{ fontSize: 12, color: "var(--ot-soluk)" }}>dönemde anket gönderilen</div>
                </div>
                <div className="ot-bilgi">
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ot-ikincil)" }}>Anket tamamlama</div>
                  <div className="ot-buyuk">{oranAl("calisan") == null ? "—" : `%${oranAl("calisan")}`}</div>
                  <div style={{ fontSize: 12, color: "var(--ot-soluk)" }}>
                    çalışan · yönetici {oranAl("yonetici") == null ? "—" : `%${oranAl("yonetici")}`} · genel %{r.genelOran}
                  </div>
                </div>
                <div className="ot-bilgi">
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ot-ikincil)" }}>Ortalama memnuniyet</div>
                  <div className="ot-buyuk">{sayiYaz(calisanOrt)}</div>
                  <div style={{ fontSize: 12, color: "var(--ot-soluk)" }}>
                    5 üzerinden · yönetici {sayiYaz(yoneticiOrt)}
                    {r.oncekiDonem?.ortalama != null && calisanOrt != null && (
                      <> · önceki dönem {sayiYaz(r.oncekiDonem.ortalama)} {calisanOrt > r.oncekiDonem.ortalama ? "▲" : calisanOrt < r.oncekiDonem.ortalama ? "▼" : "■"}</>
                    )}
                    {r.enps != null && <> · eNPS {r.enps > 0 ? `+${r.enps}` : r.enps}</>}
                  </div>
                </div>
                <div className="ot-bilgi">
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ot-ikincil)" }}>Sonraki 6 ayda ayrılan</div>
                  <div className="ot-buyuk">{genelAyrilma?.oran == null ? "—" : `%${genelAyrilma.oran}`}</div>
                  <div style={{ fontSize: 12, color: "var(--ot-soluk)" }}>
                    değerlendirilenlerden · {r.riskliSayi ?? 0} riskli çalışan
                  </div>
                </div>
              </div>

              <div className="ot-izgara ot-i2" style={{ marginBottom: 18 }}>
                <div>
                  <h4>En güçlü ve en zayıf alan</h4>
                  {alanlar.length === 0 ? (
                    <div className="ot-bilgi">Alan kırılımı için doldurulmuş ölçek sorusu gerekiyor.</div>
                  ) : (
                    <div className="ot-bilgi" style={{ lineHeight: 1.7 }}>
                      <b style={{ color: RENK_YESIL_YAZI }}>{enGuclu.alan}</b> — çalışan {sayiYaz(enGuclu.calisan)} · yönetici {sayiYaz(enGuclu.yonetici)}
                      <br />
                      <b style={{ color: RENK_TURUNCU_YAZI }}>{enZayif.alan}</b> — çalışan {sayiYaz(enZayif.calisan)} · yönetici {sayiYaz(enZayif.yonetici)}
                    </div>
                  )}

                  <h4 style={{ marginTop: 16 }}>Genel durum dağılımı</h4>
                  {[
                    { ad: "Uyum sağladı", d: "iyi", renk: RENK_CAL },
                    { ad: "İzlenmeli", d: "takip", renk: "#b77a00" },
                    { ad: "Riskli", d: "risk", renk: RENK_TURUNCU },
                  ].map((x) => (
                    <div
                      key={x.d}
                      className="ot-yc tik"
                      style={{ gridTemplateColumns: "110px 1fr 36px", padding: "3px 0" }}
                      onClick={() => {
                        suzgecleriKaldir();
                        setKarneSuzgec(x.d);
                        karneListesineGit();
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{x.ad}</span>
                      <OranCubugu oran={(durumSayisi(x.d) / toplamKarne) * 100} renk={x.renk} />
                      <span className="v">{durumSayisi(x.d)}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <h4>En zayıf başlıklar</h4>
                  {(r.sorular ?? []).length === 0 ? <div className="ot-soluk">Henüz yeterli yanıt yok.</div> : yildizBas((r.sorular ?? []).slice(0, 3))}
                  <h4 style={{ marginTop: 16 }}>En güçlü başlıklar</h4>
                  {(r.sorular ?? []).length === 0 ? <div className="ot-soluk">Henüz yeterli yanıt yok.</div> : yildizBas([...(r.sorular ?? [])].reverse().slice(0, 3))}
                </div>
              </div>

              <h4 style={{ marginBottom: 4 }}>İK'nın aksiyon alması gerekenler</h4>
              {aksiyonlar.length === 0 ? (
                <div className="ot-bilgi">Bu dönemde aksiyon gerektiren bir bulgu yok.</div>
              ) : (
                aksiyonlar.map((m, i) => (
                  <div key={i} className="ot-aksiyon">
                    <i>{i + 1}</i>
                    <span>{m}</span>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </>
    );
  })();

  /* ============================================================ ÇEKMECE */
  const karneKisi = karneDetay?.kisi;
  const karneTakip = karneKisi ? takipHaritasi.get(K(karneKisi.personelKodu)) : karneDetay?.kod ? takipHaritasi.get(K(karneDetay.kod)) : undefined;

  const cekmeceIcerigi = (() => {
    if (!karneDetay) return null;

    if (karneYukleniyor || karneDetay.yukleniyor)
      return (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      );

    const formlar: any[] = karneDetay.formlar ?? [];

    /* -------------------------------------------- birim formları görünümü */
    if (karneDetay.birim) {
      const asamalar = ASAMALAR.filter((a) => formlar.some((f) => f.asama === a.kod));

      return (
        <>
          <div className="ot-ck-bas">
            <span className="ot-av" style={{ background: "#2e6aa81f", color: RENK_YON }}><Store size={16} /></span>
            <div style={{ minWidth: 0 }}>
              <h2>{karneDetay.birim}</h2>
              <small>doldurulmuş formlar · yöneticinin değerlendirmeleri dahil</small>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="ot-dg hayalet" onClick={() => setKarneDetay(null)} aria-label="Kapat"><X size={16} /></button>
          </div>
          <div className="ot-ck-ic">
            {formlar.length === 0 && <Empty description="Bu birimde doldurulmuş form yok." />}
            {asamalar.map((a) => (
              <div key={a.kod} className="ot-ck-bolum">
                <h4>{a.ad}</h4>
                {formlar
                  .filter((f) => f.asama === a.kod)
                  .flatMap((f) =>
                    formlariOku(f.cevaplarJson).map((alt, j) => ({ f, alt, anahtar: `${f.id}-${j}` }))
                  )
                  .map(({ f, alt, anahtar }) => (
                    <details key={anahtar} className="ot-yanit">
                      <summary>
                        <span className="ot-nokta" style={{ background: f.tur === "calisan" ? RENK_CAL : RENK_YON }} />
                        {f.tur === "calisan"
                          ? `${f.adSoyad ?? "Çalışan"} · kendi anketi`
                          : `${f.adSoyad ?? "Yönetici"} · ${alt.adSoyad ? `${alt.adSoyad} için ` : ""}değerlendirmesi`}
                        <span className="ot-soluk" style={{ fontWeight: 500, fontSize: 12 }}>{tarihSaat(f.dolduruldu)}</span>
                        {f.tur === "calisan" && f.puan != null && (
                          <span style={{ marginLeft: "auto" }}><Et renk="yesil">{sayiYaz(f.puan)}</Et></span>
                        )}
                      </summary>
                      {alt.sorular.length === 0 ? (
                        <div className="q"><span className="ot-soluk">Yanıt ayrıntısı okunamadı.</span><span /></div>
                      ) : (
                        alt.sorular.map((c: any, i: number) => <YanitSatiri key={i} c={c} />)
                      )}
                    </details>
                  ))}
              </div>
            ))}
          </div>
        </>
      );
    }

    if (!karneKisi && formlar.length === 0) return <Empty style={{ padding: 40 }} description="Karne bulunamadı." />;

    const analiz = karneDetay.analiz ?? {};
    const puanlari = new Map<string, any>((analiz.asamaPuanlari ?? []).map((x: any) => [x.asama, x]));
    const ad = karneKisi?.adSoyad ?? formlar.find((f) => f.tur === "calisan")?.adSoyad ?? karneDetay.kod ?? "Çalışan";
    const kod = karneKisi?.personelKodu ?? karneDetay.kod;

    /* Aşamanın gelip gelmediği: formu varsa geldi; yoksa çalışma süresi
       o aşamanın penceresine ulaştı mı */
    const enAz = (a: (typeof ASAMALAR)[number]) => donemler.find((d: any) => d.donem === a.donem)?.enAz ?? a.enAz;
    const gelecekMi = (a: (typeof ASAMALAR)[number]) =>
      !formlar.some((f) => f.asama === a.kod) && karneKisi?.calismaGunu != null && karneKisi.calismaGunu < enAz(a);

    const varsayilanAsama =
      [...ASAMALAR].reverse().find((a) => formlar.some((f) => f.asama === a.kod))?.kod ??
      (karneTakip ? donemdenKod(karneTakip.donem) : null) ??
      "7g";
    const secAsama = karneAsamaSec ?? varsayilanAsama;

    const risk = analiz.riskSkoru as number | null | undefined;
    const g = gorusmesi(kod);

    const cForm = formlar.filter((f) => f.asama === secAsama && f.tur === "calisan").pop();
    /* Doldurulmuş değerlendirme öncelikli; yoksa açık davet (yanıt bekleniyor) */
    const yListe = formlar.filter((f) => f.asama === secAsama && f.tur === "yonetici");
    const yForm = yListe.filter((f) => f.dolduruldu).pop() ?? yListe.pop();

    /* Hatırlatma düğmeleri takip listesindeki güncel duruma göre */
    const tk = karneTakip?.k;
    const tkAsama = karneTakip ? donemdenKod(karneTakip.donem) : undefined;
    const mesgul = !!tk && yenidenGonderiliyor.startsWith(`${tk.personelKodu}|`);

    return (
      <>
        <div className="ot-ck-bas">
          <KisiAvatar kod={kod} ad={ad} boyut={38} />
          <div style={{ minWidth: 0 }}>
            <h2><PersonelAdi kod={kod}>{ad}</PersonelAdi></h2>
            <small>
              {[`Sicil ${kod}`, karneKisi?.subeAdi, karneKisi?.gorev, karneKisi?.girisTarihi ? `işe giriş ${tarih(karneKisi.girisTarihi)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <small>
              {[karneKisi?.telefon, karneKisi?.calismaGunu != null ? `${karneKisi.calismaGunu} gündür çalışıyor` : null].filter(Boolean).join(" · ")}
              {karneKisi && !karneKisi.calisiyor && (
                <span style={{ marginLeft: 6 }}>
                  <Et renk="kirmizi" yok>Ayrılmış{karneKisi.cikisTarihi ? ` · ${tarih(karneKisi.cikisTarihi)}` : ""}</Et>
                </span>
              )}
            </small>
          </div>
          <span style={{ flex: 1 }} />
          {tk && (
            <button type="button" className="ot-dg kucuk" onClick={() => notAc(tk, karneTakip!.donem)}>
              {tk.tamamlandi ? "Notu düzenle" : "Not ekle"}
            </button>
          )}
          <button type="button" className="ot-dg hayalet" onClick={() => setKarneDetay(null)} aria-label="Kapat">
            <X size={16} />
          </button>
        </div>

        <div className="ot-ck-ic">
          {/* ------------------------------------------------ aşamalar */}
          <div className="ot-ck-bolum">
            <h4>Aşamalar</h4>
            <div className="ot-zaman">
              {ASAMALAR.map((a) => {
                const p = puanlari.get(a.kod);
                const gelecek = gelecekMi(a);

                return (
                  <button
                    key={a.kod}
                    type="button"
                    className={`z${a.kod === secAsama ? " secili" : ""}${gelecek ? " gelecek" : ""}`}
                    onClick={() => !gelecek && setKarneAsamaSec(a.kod)}
                    disabled={gelecek}
                  >
                    <b>{a.ad}</b>
                    {gelecek ? (
                      <div className="p ot-soluk">henüz gelmedi</div>
                    ) : (
                      <div className="p">
                        <span><span className="ot-nokta" style={{ background: RENK_CAL }} />{sayiYaz(p?.calisan)}</span>
                        <span><span className="ot-nokta" style={{ background: RENK_YON }} />{sayiYaz(p?.yonetici)}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="ot-lejant" style={{ marginTop: 8 }}>
              <span><span className="ot-nokta" style={{ background: RENK_CAL }} />Çalışanın kendi puanı</span>
              <span><span className="ot-nokta" style={{ background: RENK_YON }} />Yöneticinin verdiği puan</span>
            </div>
          </div>

          {/* ---------------------------------------- risk ve görüşme */}
          <div className="ot-ck-bolum ot-izgara ot-i2">
            <div className="ot-kart">
              <div className="ot-kart-ic">
                <h4 style={{ margin: "0 0 8px", fontSize: 12, letterSpacing: ".06em", color: "var(--ot-soluk)" }}>ERKEN AYRILMA RİSKİ</h4>
                {risk == null ? (
                  <div className="ot-soluk" style={{ fontSize: 12.5 }}>Skor için en az bir doldurulmuş form gerekiyor.</div>
                ) : (
                  <div className="ot-risk">
                    <div
                      className="ot-halka"
                      style={{
                        background: risk >= RISK_YUKSEK ? "var(--ot-kirmizi-acik)" : risk >= RISK_ORTA ? "var(--ot-sari-acik)" : "var(--ot-yesil-acik)",
                        color: risk >= RISK_YUKSEK ? "var(--ot-kirmizi)" : risk >= RISK_ORTA ? "#7a5300" : "var(--ot-yesil-yazi)",
                      }}
                    >
                      {risk}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ot-ikincil)" }}>
                      <b style={{ color: "var(--ot-metin)" }}>{analiz.sonrakiAksiyon}</b>
                      <br />
                      {risk >= RISK_YUKSEK
                        ? "Puanların seyri, yöneticinin değerlendirmesi ve bildirilen konular erken ayrılma işaretine yakın."
                        : risk >= RISK_ORTA
                        ? "İzlenmeli: düşük puan ya da düşüş var."
                        : "Belirgin bir risk sinyali yok."}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="ot-kart">
              <div className="ot-kart-ic">
                <h4 style={{ margin: "0 0 8px", fontSize: 12, letterSpacing: ".06em", color: "var(--ot-soluk)" }}>GÖRÜŞME</h4>
                <GorusmeEt durum={g?.notDurumu} not={g?.notMetni} tarihi={g?.notTarihi} />
                {g && <div className="ot-soluk" style={{ fontSize: 12, marginTop: 4 }}>{donemAdi(g.donem)} · {tarih(g.notTarihi)}</div>}
                {tk && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className="ot-dg kucuk" onClick={() => notAc(tk, karneTakip!.donem)}>
                      {tk.tamamlandi ? "Notu düzenle" : "Not ekle"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ------------- oryantasyon + dönemsel değerlendirme (20.10.2026) */}
          <DonemselKarne
            kod={kod}
            oryantasyon={ASAMALAR.filter((a) => formlar.some((f) => f.asama === a.kod) || puanlari.has(a.kod)).map((a) => {
              const f = formlar.filter((x) => x.asama === a.kod).pop();
              const p = puanlari.get(a.kod);
              return {
                ad: a.ad,
                tarih: typeof f?.dolduruldu === "string" ? f.dolduruldu : f?.olusturma ?? null,
                calisan: p?.calisan ?? null,
                yonetici: p?.yonetici ?? null,
              };
            })}
          />

          {/* ------------------------------- anket ve bildirim geçmişi */}
          <div className="ot-ck-bolum">
            <h4>
              Anket ve bildirim geçmişi <span className="ot-yeni">YENİ</span>
            </h4>
            {(karneDetay.gecmis ?? []).length === 0 ? (
              <div className="ot-soluk" style={{ fontSize: 13 }}>Henüz anket gönderilmemiş.</div>
            ) : (
              (karneDetay.gecmis ?? []).map((x: any, i: number) => (
                <div key={i} className="ot-kayit">
                  <span className="s">{dayjs(x.zaman).format("DD.MM.YY HH:mm")}</span>
                  <span style={{ color: x.tur === "uyari" ? RENK_TURUNCU_YAZI : undefined }}>{x.metin}</span>
                </div>
              ))
            )}

            {tk && tkAsama && gonderebilir && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {tk.anketDurumu === "bekliyor" && (
                  <button type="button" className="ot-dg kucuk" disabled={mesgul} onClick={() => hatirlat(tk, tkAsama, "c")}>
                    <Smartphone size={13} /> Personele bildirimle hatırlat
                  </button>
                )}
                {(tk.anketDurumu === "suresiDoldu" || !tk.anketDurumu) && (
                  <button type="button" className="ot-dg kucuk" disabled={mesgul} onClick={() => yenidenGonder(tk, true, false, karneTakip!.donem)}>
                    <Send size={13} /> Kendisine {tk.anketDurumu ? "yeniden " : ""}gönder
                  </button>
                )}
                {tk.yoneticiAnketDurumu !== "dolduruldu" && (
                  <button type="button" className="ot-dg kucuk" disabled={mesgul} onClick={() => hatirlat(tk, tkAsama, "y")}>
                    <Store size={13} /> {tk.yoneticiAnketDurumu === "bekliyor" ? "Yöneticiye hatırlat" : "Yöneticiye gönder"}
                  </button>
                )}
                {mesgul && <Spin size="small" />}
              </div>
            )}
          </div>

          {/* -------------------------------------------- fark analizi */}
          <div className="ot-ck-bolum">
            <h4>Çalışan – yönetici fark analizi</h4>
            {(analiz.farkAnalizi ?? []).length === 0 ? (
              <div className="ot-soluk" style={{ fontSize: 13 }}>Karşılaştırma için ölçek yanıtı gerekiyor.</div>
            ) : (
              <>
                {analiz.farkAnalizi.map((a: any) => {
                  const f = a.calisan != null && a.yonetici != null ? Math.round((a.calisan - a.yonetici) * 10) / 10 : null;

                  return (
                    <Tooltip key={a.alan} title={`${a.alan}: çalışan ${sayiYaz(a.calisan)} · yönetici ${sayiYaz(a.yonetici)} · tıklayınca sorular`}>
                      <div className="ot-fark tik" onClick={() => setAlanDetay(a)}>
                        <span>{a.alan}</span>
                        <div className="sol"><i style={{ width: `${((a.calisan ?? 0) / 5) * 100}%` }} /></div>
                        <div className="sg orta"><i style={{ width: `${((a.yonetici ?? 0) / 5) * 100}%` }} /></div>
                        <b style={{ textAlign: "right", color: f != null && Math.abs(f) >= 0.8 ? RENK_TURUNCU_YAZI : undefined }}>
                          {f == null ? "—" : `${f > 0 ? "+" : ""}${sayiYaz(f)}`}
                        </b>
                      </div>
                    </Tooltip>
                  );
                })}
                <div className="ot-lejant" style={{ marginTop: 6 }}>
                  <span><span className="ot-nokta" style={{ background: RENK_CAL }} />Çalışan (sola)</span>
                  <span><span className="ot-nokta" style={{ background: RENK_YON }} />Yönetici (sağa)</span>
                  <span>Fark 0,8 ve üzeri turuncu</span>
                </div>
              </>
            )}
          </div>

          {/* ------------------------------------------------ İK özeti */}
          <div className="ot-ck-bolum">
            <h4>İK özeti</h4>
            {[
              ["Güçlü yönler", analiz.guclu ?? "—"],
              ["Gelişim alanı", analiz.gelisim ?? "—"],
              ["İK'ya bildirim", analiz.ikBildirim ? "Var" : "Yok"],
              ["Beklenti / gerçeklik farkı", analiz.beklentiFarki ? "Bildirdi" : "Yok"],
              ["Sonraki aksiyon", analiz.sonrakiAksiyon ?? "—"],
            ].map(([et, dg]) => (
              <div key={et} className="ot-kv">
                <span>{et}</span>
                <span style={{ color: et === "İK'ya bildirim" && dg === "Var" ? RENK_TURUNCU_YAZI : undefined }}>{dg}</span>
              </div>
            ))}
          </div>

          {/* ------------------------------------------ aşama yanıtları */}
          <div className="ot-ck-bolum">
            <h4>{asamaAdi(secAsama)} yanıtları</h4>
            {[
              { f: cForm, tur: "calisan" as const },
              { f: yForm, tur: "yonetici" as const },
            ].map(({ f, tur }) => {
              const sorular = f ? formlariOku(f.cevaplarJson).flatMap((x) => x.sorular) : [];
              const baslik =
                tur === "calisan"
                  ? `${ad} · kendi anketi`
                  : `${f?.adSoyad ?? karneDetay.yonetici?.ad ?? "Yönetici"} · değerlendirmesi`;
              const alt = !f
                ? tur === "calisan"
                  ? "bu aşamada anket gönderilmemiş"
                  : "bu aşamada değerlendirme yok"
                : f.dolduruldu
                ? `${tarihSaat(f.dolduruldu)}${tur === "yonetici" && f.kanal ? ` · ${f.kanal === "uygulama" ? "uygulamadan" : "SMS bağlantısından"}` : ""}`
                : f.gecerlilik && dayjs(f.gecerlilik).isBefore(dayjs())
                ? "süresi doldu, doldurulmadı"
                : "gönderildi, yanıt bekleniyor";

              return (
                <details key={tur} className="ot-yanit" open={tur === "calisan" && !!f?.dolduruldu}>
                  <summary>
                    <span className="ot-nokta" style={{ background: tur === "calisan" ? RENK_CAL : RENK_YON }} />
                    <span>
                      {baslik}
                      <span className="ot-soluk" style={{ display: "block", fontWeight: 500, fontSize: 11.5 }}>{alt}</span>
                    </span>
                    <span style={{ marginLeft: "auto" }}>
                      {f?.dolduruldu && f.puan != null ? (
                        <Et renk={f.puan < 3 ? "turuncu" : "yesil"}>{sayiYaz(f.puan)}</Et>
                      ) : (
                        <Et renk="gri">yanıt yok</Et>
                      )}
                    </span>
                  </summary>
                  {!f?.dolduruldu ? (
                    <div className="q"><span className="ot-soluk">{tur === "calisan" ? "Henüz doldurulmadı." : "Henüz değerlendirmedi."}</span><span /></div>
                  ) : sorular.length === 0 ? (
                    <div className="q"><span className="ot-soluk">Yanıt ayrıntısı okunamadı.</span><span /></div>
                  ) : (
                    sorular.map((c: any, i: number) => <YanitSatiri key={i} c={c} />)
                  )}
                </details>
              );
            })}
          </div>

          {/* --------------------------- yöneticiye sonradan gönderim */}
          {karneKisi && (
            <details className="ot-ac-kapa">
              <summary>
                <Store size={14} /> Yöneticisine değerlendirme gönder
                <span className="ot-soluk" style={{ fontWeight: 500, marginLeft: "auto", fontSize: 12 }}>
                  {karneDetay.yonetici?.bulundu ? karneDetay.yonetici.ad : "yönetici bulunamadı"}
                </span>
              </summary>
              <div>
                {/* Kimin geleceği gönderim öncesi görünsün: yanlış eşleşme
                    bildirim gittikten sonra fark edilmesin. */}
                {karneDetay.yonetici?.bulundu ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <b>{karneDetay.yonetici.ad}</b>
                    {karneDetay.yonetici.telefonSon && <span className="ot-soluk">···{karneDetay.yonetici.telefonSon}</span>}
                    <Et renk={karneDetay.yonetici.kaynak === "tanımlı" ? "yesil" : "turuncu"} yok>
                      {karneDetay.yonetici.kaynak === "tanımlı" ? "eşleştirmeden" : "ünvandan tahmin"}
                    </Et>
                  </div>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message="Yönetici bulunamadı"
                    description="Bu birimde uygun bir yönetici yok ya da cep numarası geçersiz. Yönetim → Form Ayarları'ndaki yönetici eşleştirmesinden tanımlayabilirsiniz."
                  />
                )}

                <div className="ot-soluk" style={{ marginTop: 6, fontSize: 12.5 }}>
                  {karneDetay.yonetici?.kaynak === "tanımlı"
                    ? "Bu kişi Form Ayarları'ndaki eşleştirmeden geliyor."
                    : "Ünvana göre tahmin edildi; doğru değilse Form Ayarları'ndan eşleştirin."}{" "}
                  SMS gitmez; değerlendirme yöneticinin Biçen360'ında (ana sayfa ve Ekibim) açılır, bildirim gider. Telefonu
                  bir personel kaydıyla eşleşmezse Ekibim'de bu kişiyi gören yöneticiye gider.
                </div>

                {/* Eşleşme tutmadığında hangi değerlerin karşılaştırıldığını
                    görmeden sebebi bulmak mümkün olmuyor. */}
                {karneDetay.yonetici?.kaynak !== "tanımlı" && karneDetay.yonetici?.tani && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--ot-soluk)" }}>Eşleşme neden tutmadı?</summary>
                    <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.9 }}>
                      <div>
                        Personelin birimi: <b>{karneDetay.yonetici.tani.personelBirim || "—"}</b>{" "}
                        <span className="ot-soluk">(anahtar: {karneDetay.yonetici.tani.birimAnahtar})</span>
                      </div>
                      <div>Personelin pozisyonu: <b>{karneDetay.yonetici.tani.personelPozisyon || "—"}</b></div>
                      <div>Kayıtlı eşleştirme sayısı: <b>{karneDetay.yonetici.tani.tanimSayisi}</b></div>
                      {(karneDetay.yonetici.tani.tanimlar ?? []).map((t: any, i: number) => (
                        <div key={i} className="ot-soluk">
                          · {t.birim || "—"} / {t.pozisyon || "(tümü)"} → {t.yoneticiKodu || "—"} (anahtar: {t.birimAnahtar})
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {ASAMALAR.map((a) => (
                    <button
                      key={a.kod}
                      type="button"
                      className="ot-dg kucuk"
                      disabled={yoneticiGonderiliyor === a.kod}
                      onClick={() => yoneticiyeGonder(karneKisi.personelKodu, a.kod)}
                    >
                      {yoneticiGonderiliyor === a.kod ? <Spin size="small" /> : <Send size={12} />} {a.ad}
                    </button>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      </>
    );
  })();

  /* ========================================================== YERLEŞİM */
  const sekmeler = [
    { key: "takip", label: "Takip listesi" },
    { key: "pano", label: "Pano" },
    { key: "karne", label: "Çalışan karneleri" },
    { key: "magaza", label: "Mağaza & yönetici" },
    { key: "analiz", label: "Trend & analiz" },
    { key: "icra", label: "İcra kurulu" },
  ];

  /* Yönetici karşılaştırma penceresindeki kişiler */
  const karsilastirmaKisileri = karneler.filter((k: any) => {
    if (!karsilastirma) return false;
    /* Yöneticinin değerlendirdiği kişiler; hiç form yoksa şubenin tamamı */
    const kodlar: string[] = karsilastirma.kisiler ?? [];
    if (kodlar.length > 0) return kodlar.some((x) => K(x) === K(k.personelKodu));
    return k.subeAdi === karsilastirma.sube;
  });

  const subeKisileri = subePencere ? karneler.filter((k: any) => (k.subeAdi || "Belirtilmemiş") === subePencere) : [];

  return (
    <div className="ot">
      <div className="ot-baslik">
        <div>
          <h1>Oryantasyon Takip</h1>
          <p>
            Yeni başlayan personelin 7. gün, 2. ay, 6. ay ve 1. yılda kendisinden ve yöneticisinden alınan değerlendirmeleri. Zamanı
            gelen kişi listelenir; arayıp notunuzu eklediğinizde listeden düşer.
          </p>
        </div>
      </div>

      <nav className="ot-sekmeler" aria-label="Oryantasyon Takip sekmeleri">
        {sekmeler.map((s) => (
          <button
            key={s.key}
            type="button"
            className={anaSekme === s.key ? "aktif" : ""}
            aria-current={anaSekme === s.key ? "page" : undefined}
            onClick={() => setAnaSekme(s.key)}
          >
            {s.label}
            {s.key === "takip" && toplamBekleyen > 0 && <span className="ot-rozet">{toplamBekleyen}</span>}
          </button>
        ))}
      </nav>

      {anaSekme === "takip" && takipGorunumu}
      {anaSekme === "pano" && panoGorunumu}
      {anaSekme === "karne" && karneGorunumu}
      {anaSekme === "magaza" && magazaGorunumu}
      {anaSekme === "analiz" && analizGorunumu}
      {anaSekme === "icra" && icraGorunumu}

      {/* ------------------------------------------------- karne çekmecesi */}
      <Drawer
        open={!!karneDetay}
        onClose={() => setKarneDetay(null)}
        width="min(640px, 100vw)"
        closable={false}
        title={null}
        rootClassName="ot-cekmece"
        styles={{ body: { padding: 0 }, mask: { background: "rgba(18,26,12,.38)" } }}
      >
        {cekmeceIcerigi}
      </Drawer>

      {/* ---------------------------------------------------- not penceresi */}
      <Modal
        open={!!notKisi}
        className="ot-modal"
        width={560}
        title={notKisi ? `${notKisi.ad} ${notKisi.soyad} · görüşme notu` : ""}
        onCancel={() => setNotKisi(null)}
        footer={[
          <button key="v" type="button" className="ot-dg" onClick={() => setNotKisi(null)}>Vazgeç</button>,
          <button key="k" type="button" className="ot-dg ana" disabled={kaydediliyor} onClick={notKaydet}>
            {kaydediliyor ? <Spin size="small" /> : null} Kaydet
          </button>,
        ]}
      >
        {notKisi && (
          <>
            <div className="ot-bilgi">
              {[donemAdi(notKisi.donem), notKisi.isGrubu, notKisi.pozisyon, notKisi.telefon].filter(Boolean).join(" · ")}
              <div className="ot-soluk" style={{ fontSize: 12, marginTop: 2 }}>
                {tarih(notKisi.girisTarihi)} tarihinde başladı ({notKisi.gecenGun} gün önce)
              </div>
            </div>
            <span className="ot-alan-et">Görüşme sonucu</span>
            <Secenekler deger={notDurumu} onChange={setNotDurumu} secenekler={DURUMLAR.map((d) => ({ value: d.value, label: d.label }))} />
            <label className="ot-alan-et" htmlFor="ot-not-metni">Notunuz</label>
            <textarea
              id="ot-not-metni"
              className="ot-girdi"
              placeholder="Personelin durumu, varsa sorunları ve alınacak aksiyonlar"
              value={notMetni}
              onChange={(e) => setNotMetni(e.target.value)}
            />
            <div className="ot-soluk" style={{ fontSize: 12, marginTop: 6 }}>
              Kaydedince kişi "Bekleyen" listesinden düşer, "Tümü"nde kalır.
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------- toplu gönderim penceresi */}
      <Modal
        open={topluAcik}
        className="ot-modal"
        width={760}
        title={`Toplu anket gönder · ${asamaAdi(topluAsama)}`}
        onCancel={() => setTopluAcik(false)}
        footer={[
          <button key="v" type="button" className="ot-dg" onClick={() => setTopluAcik(false)}>Vazgeç</button>,
          <button key="g" type="button" className="ot-dg ana" disabled={secilenler.length === 0 || topluIsleniyor} onClick={topluGonder}>
            {topluIsleniyor ? <Spin size="small" /> : null} {secilenler.length} kişiye gönder
          </button>,
        ]}
      >
        <span className="ot-alan-et" style={{ marginTop: 0 }}>Dönemi dolan ve henüz anket gönderilmemiş personel</span>
        <Secenekler
          deger={topluAsama}
          onChange={(v) => {
            setTopluAsama(v);
            bekleyenleriGetir(v);
          }}
          secenekler={ASAMALAR.map((a) => ({ value: a.kod, label: a.ad }))}
        />

        {(() => {
          const secili = bekleyenler.filter((x) => secilenler.includes(x.personelKodu));
          const girisYok = secili.filter((x) => x.girisYapmamis).length;

          return (
            <div className="ot-izgara ot-i2" style={{ margin: "12px 0" }}>
              <div className="ot-bilgi">
                <div className="ot-bilgi-bas"><Smartphone size={16} /> Biçen360 bildirimi</div>
                <div className="ot-buyuk">{secili.length - girisYok}</div>
                <div className="ot-soluk" style={{ fontSize: 12 }}>Ana sayfasında kart çıkar, bildirim gider</div>
              </div>
              <div className="ot-bilgi">
                <div className="ot-bilgi-bas"><User size={16} /> Biçen360'a giriş yapmamış</div>
                <div className="ot-buyuk">{girisYok}</div>
                <div className="ot-soluk" style={{ fontSize: 12 }}>Anket yine açılır; bildirim gidemez, giriş yapınca görür</div>
              </div>
            </div>
          );
        })()}

        <Table
          rowKey="personelKodu"
          size="small"
          loading={bekleyenYukleniyor}
          dataSource={bekleyenler}
          pagination={bekleyenler.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
          rowSelection={{
            selectedRowKeys: secilenler,
            onChange: setSecilenler,
            getCheckboxProps: (k: any) => ({ disabled: !gonderilebilir(k) }),
          }}
          locale={{ emptyText: <div className="ot-bos-sat">Bu aşamada gönderilmemiş kimse yok.</div> }}
          columns={[
            {
              title: "Personel",
              dataIndex: "adSoyad",
              render: (v: string, k: any) => (
                <div className="ot-ikili"><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi><small>{k.gorev}</small></div>
              ),
            },
            { title: "Şube", dataIndex: "subeAdi", width: 150 },
            { title: "Gün", dataIndex: "gun", width: 60, align: "right" as const },
            {
              title: "Biçen360",
              dataIndex: "girisYapmamis",
              width: 150,
              render: (v: boolean) =>
                v ? (
                  <Tooltip title="Biçen360'a hiç giriş yapmamış: anket açılır ama bildirim gidemez; giriş yapınca ana sayfasında görür">
                    <span><Et renk="turuncu">giriş yapmamış</Et></span>
                  </Tooltip>
                ) : (
                  <KanalEt kanal="uygulama" />
                ),
            },
          ]}
        />

        <div style={{ marginTop: 12 }}>
          <Checkbox checked={yoneticiyeDe} onChange={(e) => setYoneticiyeDe(e.target.checked)}>
            Mağaza müdürlerine de bildirim gönder
          </Checkbox>
          <div className="ot-soluk" style={{ fontSize: 12.5, marginTop: 6 }}>
            Yöneticilere: değerlendirme Biçen360'ta açılır, yönetici ana sayfasında ve Ekibim'de görür; yönetici başına <b>tek</b> bildirim
            gider (aynı gün ikinci kez gitmez). SMS gitmez. Daha önce gönderilmiş kişiler listeye girmez; düğmeye birden çok kez basmak
            ikinci bildirim göndermez.
          </div>
        </div>
      </Modal>

      {/* -------------------------------------- süresi dolanlara yeniden gönder */}
      <Modal
        open={yenidenAcik}
        className="ot-modal"
        width={600}
        title="Süresi dolanlara yeniden gönder"
        onCancel={() => setYenidenAcik(false)}
        footer={[
          <button key="v" type="button" className="ot-dg" onClick={() => setYenidenAcik(false)}>Vazgeç</button>,
          <button key="g" type="button" className="ot-dg ana" disabled={dolanlar.length === 0 || topluYenidenGonderiliyor} onClick={topluYenidenGonder}>
            {topluYenidenGonderiliyor ? <Spin size="small" /> : <RotateCw size={14} />} Yeniden gönder
          </button>,
        ]}
      >
        <p style={{ margin: "0 0 10px", color: "var(--ot-ikincil)" }}>
          {donemAdi(secilenDonem)} listesinde doldurulmadan süresi dolan <b>{dolanlar.length}</b> kayıt var. Anketi hâlâ açık
          olanlara ve dolduranlara gitmez. Anket Biçen360'ta yeniden açılır, süre baştan başlar; yöneticiye yönetici başına tek
          bildirim gider. SMS gitmez.
        </p>
        <table className="ot-duz">
          <thead>
            <tr><th>Personel</th><th>Kime</th><th>Kanal</th></tr>
          </thead>
          <tbody>
            {dolanlar.length === 0 ? (
              <tr><td colSpan={3} className="ot-bos-sat">Bu dönemde süresi dolmuş anket yok.</td></tr>
            ) : (
              dolanlar.map((k: any) => (
                <tr key={k.personelKodu}>
                  <td><PersonelAdi kod={k.personelKodu}>{k.ad} {k.soyad}</PersonelAdi></td>
                  <td>
                    {[k.anketDurumu === "suresiDoldu" ? "kendisi" : null, k.yoneticiAnketDurumu === "suresiDoldu" ? "yöneticisi" : null]
                      .filter(Boolean)
                      .join(" + ")}
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <KanalEt kanal="uygulama" />
                      {k.anketDurumu === "suresiDoldu" && !k.uygulamaKullaniyor && (
                        <Tooltip title="Biçen360'a giriş yapmamış: anket açılır, bildirim gidemez">
                          <span><Et renk="turuncu" yok>giriş yapmamış</Et></span>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Modal>

      {/* ------------------------------------------------- test gönderimi */}
      <Modal
        open={testAcik}
        className="ot-modal"
        width={560}
        title="Oryantasyon anketi — test gönderimi"
        onCancel={() => setTestAcik(false)}
        footer={[
          <button key="v" type="button" className="ot-dg" onClick={() => setTestAcik(false)}>Kapat</button>,
          <button key="g" type="button" className="ot-dg ana" disabled={sinamaIsleniyor} onClick={sinamaGonder}>
            {sinamaIsleniyor ? <Spin size="small" /> : <Send size={14} />} Test gönder
          </button>,
        ]}
      >
        <span className="ot-alan-et" style={{ marginTop: 0 }}>Aşama</span>
        <Secenekler deger={testAsama} onChange={setTestAsama} secenekler={ASAMALAR.map((a) => ({ value: a.kod, label: a.ad }))} />
        <span className="ot-alan-et">Form</span>
        <Secenekler
          deger={testTur}
          onChange={setTestTur}
          secenekler={[
            { value: "calisan", label: "Çalışan formu (personel gözünden)" },
            { value: "yonetici", label: "Yönetici formu (yönetici gözünden)" },
          ]}
        />
        <span className="ot-alan-et">Nereye</span>
        <Secenekler
          deger={testKanal}
          onChange={setTestKanal}
          secenekler={[
            { value: "uygulama", label: "Biçen360 uygulamasına" },
            { value: "sms", label: "SMS ile" },
          ]}
        />

        {testKanal === "uygulama" ? (
          <>
            <label className="ot-alan-et" htmlFor="ot-test-sicil">Personel sicili</label>
            <input
              id="ot-test-sicil"
              className="ot-girdi"
              placeholder="Sicil numarası"
              maxLength={20}
              value={testSicil}
              onChange={(e) => setTestSicil(e.target.value)}
            />
            <div className="ot-soluk" style={{ fontSize: 12, marginTop: 8 }}>
              {testHedefBilgi?.sicil
                ? `Varsayılan: kendi siciliniz (${testHedefBilgi.sicil})${testHedefBilgi.uygulamada ? "" : " · bu sicil Biçen360'a giriş yapmamış"}. `
                : "Kullanıcı kaydınızda sicil yok; Yönetim → Kullanıcılar'dan ekleyebilir ya da burada yazabilirsiniz. "}
              {testTur === "calisan"
                ? "Ana sayfada \"Oryantasyon anketiniz hazır (test)\" kartı çıkar."
                : "Ana sayfada \"Oryantasyon doldurulması bekleniyor\" kartında \"Test personeli\" çıkar."}{" "}
              72 saat açık kalır; test kayıtları raporlara girmez.
            </div>
          </>
        ) : (
          <>
            <label className="ot-alan-et" htmlFor="ot-test-tel">Telefon (SMS)</label>
            <input
              id="ot-test-tel"
              className="ot-girdi"
              placeholder="05xx xxx xx xx"
              maxLength={15}
              value={sinamaTelefon}
              onChange={(e) => setSinamaTelefon(e.target.value)}
            />
            <div className="ot-soluk" style={{ fontSize: 12, marginTop: 8 }}>
              Kendi numaranıza deneme bağlantısı gider (yalnızca test; gerçek gönderimler Biçen360'a gider). Bağlantı 72 saat
              geçerlidir; test kayıtları raporlara girmez.
            </div>
          </>
        )}

        {sinamaSonuc.length > 0 && (
          <div className="ot-bilgi" style={{ marginTop: 12 }}>
            {sinamaSonuc.map((x, i) => (
              <div key={i} style={{ fontSize: 12.5, marginTop: i ? 4 : 0, wordBreak: "break-all" }}>
                <Et renk={x.tur === "calisan" ? "yesil" : "mavi"} yok>{x.tur === "calisan" ? "personel" : "yönetici"}</Et>{" "}
                {x.kanal === "uygulama" ? <span>{x.adSoyad} · Biçen360</span> : <a href={x.adres} target="_blank" rel="noreferrer">{x.adres}</a>}
                <span className="ot-soluk"> · {tarihSaat(x.gecerlilik)} tarihine kadar geçerli</span>
              </div>
            ))}
            <div className="ot-soluk" style={{ fontSize: 12, marginTop: 6 }}>SMS beklemeden bağlantıya tıklayarak da açabilirsiniz.</div>
          </div>
        )}
      </Modal>

      {/* ------------------------------------ yönetici kişi bazında karşılaştırma */}
      <Modal
        open={!!karsilastirma}
        className="ot-modal"
        width={820}
        title={karsilastirma ? `${karsilastirma.sube} · ${karsilastirma.yonetici} — kişi bazında karşılaştırma` : ""}
        onCancel={() => setKarsilastirma(null)}
        footer={[
          <button
            key="b"
            type="button"
            className="ot-dg"
            onClick={() => {
              const sube = karsilastirma?.sube;
              setKarsilastirma(null);
              if (sube) magazaFormlariAc(sube);
            }}
          >
            Birimin tüm formları
          </button>,
          <button key="k" type="button" className="ot-dg" onClick={() => setKarsilastirma(null)}>Kapat</button>,
        ]}
      >
        {karsilastirma && (
          <>
            <div className="ot-izgara ot-i4" style={{ marginBottom: 12 }}>
              <div className="ot-bilgi">Çalışan mem.<div className="ot-buyuk" style={{ fontSize: 22 }}>{sayiYaz(karsilastirma.calisanPuan)}</div></div>
              <div className="ot-bilgi">Yönetici değ.<div className="ot-buyuk" style={{ fontSize: 22 }}>{sayiYaz(karsilastirma.yoneticiPuan)}</div></div>
              <div className="ot-bilgi">
                Yanıt süresi
                <div className="ot-buyuk" style={{ fontSize: 22 }}>
                  {karsilastirma.yanitSuresi == null ? "—" : `${Math.max(1, Math.round(karsilastirma.yanitSuresi))} sa`}
                </div>
              </div>
              <div className="ot-bilgi">Kanal<div style={{ marginTop: 6 }}>{karsilastirma.kanal ? <KanalEt kanal={karsilastirma.kanal} /> : "—"}</div></div>
            </div>

            {(karsilastirma.kisiler ?? []).length === 0 && karsilastirma.yoneticiPuan != null && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="Bu yöneticinin formunda kimin değerlendirildiği kayıtlı değil"
                description="Form kaydında kişi kodu bulunmadığı için puan kişiye bağlanamıyor; aşağıda şubenin tamamı listeleniyor. Yöneticinin bundan sonraki gönderimleri kişiye bağlı kaydedilir."
              />
            )}

            <Table
              size="small"
              rowKey="personelKodu"
              pagination={false}
              dataSource={karsilastirmaKisileri}
              rowClassName={() => "ot-tik"}
              onRow={(k: any) => ({
                onClick: () => {
                  setKarsilastirma(null);
                  karneAc(k.personelKodu);
                },
              })}
              locale={{ emptyText: <div className="ot-bos-sat">Bu dönemde değerlendirdiği kimse yok.</div> }}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  render: (v: string, k: any) => <div className="ot-ikili"><PersonelAdi kod={k.personelKodu}>{v || k.personelKodu}</PersonelAdi><small>{k.gorev}</small></div>,
                },
                {
                  title: "Aşama",
                  key: "asama",
                  width: 90,
                  render: (_: unknown, k: any) => {
                    const i = karneSirasi(k);
                    return i >= 0 ? ASAMALAR[i].ad : "—";
                  },
                },
                { title: "Çalışan", key: "c", align: "right" as const, width: 90, render: (_: unknown, k: any) => <PuanYaz v={sonDolu(k.puanlar)[0]} /> },
                { title: "Yönetici", key: "y", align: "right" as const, width: 90, render: (_: unknown, k: any) => <PuanYaz v={sonDolu(k.yoneticiPuanlar)[0]} /> },
                {
                  title: "Fark",
                  key: "f",
                  align: "right" as const,
                  width: 150,
                  render: (_: unknown, k: any) => {
                    const c = sonDolu(k.puanlar)[0];
                    const y = sonDolu(k.yoneticiPuanlar)[0];
                    if (c == null || y == null) return <span className="ot-soluk">—</span>;
                    const f = Math.round((c - y) * 10) / 10;

                    return (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {Math.abs(f) >= 0.6 && (
                          <Tooltip title={c < y ? "Çalışan düşük, yönetici yüksek — çalışan deneyimi" : "Çalışan memnun, yönetici sert — kalibrasyon"}>
                            <span><Et renk={c < y ? "kirmizi" : "turuncu"} yok>{c < y ? "deneyim" : "kalibrasyon"}</Et></span>
                          </Tooltip>
                        )}
                        <b style={{ color: Math.abs(f) >= 0.8 ? RENK_TURUNCU_YAZI : undefined }}>{`${f > 0 ? "+" : ""}${sayiYaz(f)}`}</b>
                      </span>
                    );
                  },
                },
                { title: "Risk", dataIndex: "riskSkoru", width: 120, render: (v: number | null) => <RiskEt v={v} /> },
              ]}
            />
            <div className="ot-soluk" style={{ fontSize: 12.5, marginTop: 10 }}>
              Fark 0,8 ve üzeri: yöneticinin gördüğü ile çalışanın yaşadığı ayrışıyor. Satıra tıklayınca kişinin karnesi açılır.
            </div>
          </>
        )}
      </Modal>

      {/* ------------------------------------------------ mağaza kişileri */}
      <Modal
        open={!!subePencere}
        className="ot-modal"
        width={820}
        title={subePencere ? `${subePencere} · yeni çalışanlar` : ""}
        onCancel={() => setSubePencere(null)}
        footer={[
          <button
            key="k"
            type="button"
            className="ot-dg"
            onClick={() => {
              const s = subePencere;
              setSubePencere(null);
              if (s) magazaFormlariAc(s);
            }}
          >
            Birimin tüm formları
          </button>,
          <button
            key="g"
            type="button"
            className="ot-dg"
            onClick={() => {
              const s = subePencere;
              setSubePencere(null);
              suzgecleriKaldir();
              setMagazaSuzgec(s);
              setKarneGorunum("liste");
              karneListesineGit();
            }}
          >
            Karnelerde göster
          </button>,
          <button key="x" type="button" className="ot-dg" onClick={() => setSubePencere(null)}>Kapat</button>,
        ]}
      >
        <Table
          size="small"
          rowKey="personelKodu"
          dataSource={subeKisileri}
          pagination={subeKisileri.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          rowClassName={() => "ot-tik"}
          onRow={(k: any) => ({
            onClick: () => {
              setSubePencere(null);
              karneAc(k.personelKodu);
            },
          })}
          locale={{ emptyText: <div className="ot-bos-sat">Bu mağazada karnesi olan personel yok.</div> }}
          columns={[
            {
              title: "Personel",
              dataIndex: "adSoyad",
              render: (v: string, k: any) => <div className="ot-ikili"><PersonelAdi kod={k.personelKodu}>{v || k.personelKodu}</PersonelAdi><small>{k.gorev}</small></div>,
            },
            {
              title: "Aşama",
              key: "asama",
              width: 90,
              render: (_: unknown, k: any) => {
                const i = karneSirasi(k);
                return i >= 0 ? ASAMALAR[i].ad : "—";
              },
            },
            { title: "Çalışan", key: "c", align: "right" as const, width: 90, render: (_: unknown, k: any) => <PuanYaz v={sonDolu(k.puanlar)[0]} /> },
            { title: "Yönetici", key: "y", align: "right" as const, width: 90, render: (_: unknown, k: any) => <PuanYaz v={sonDolu(k.yoneticiPuanlar)[0]} /> },
            { title: "Risk", dataIndex: "riskSkoru", width: 120, render: (v: number | null) => <RiskEt v={v} /> },
            { title: "Durum", key: "d", width: 200, render: (_: unknown, k: any) => karneDurumu(k) },
          ]}
        />
      </Modal>

      {/* -------------------------------------- alan ayrıntısı: sorular */}
      <Modal
        open={!!alanDetay}
        className="ot-modal"
        width={640}
        title={alanDetay ? `${alanDetay.alan} — alanı oluşturan sorular` : ""}
        onCancel={() => setAlanDetay(null)}
        footer={[<button key="k" type="button" className="ot-dg" onClick={() => setAlanDetay(null)}>Kapat</button>]}
      >
        <div className="ot-bilgi" style={{ marginBottom: 10 }}>
          Ortalama bu soruların 5'lik tabana çevrilmiş yanıtlarından gelir. Düşükten yükseğe sıralıdır; en üstteki soru alanı aşağı
          çeken sorudur.
        </div>
        {(alanDetay?.sorular ?? []).length === 0 ? (
          <div className="ot-bos-sat">Bu alanda soru kırılımı yok.</div>
        ) : (
          (alanDetay?.sorular ?? []).map((s: any) => (
            <div key={s.tur + s.soru} className="ot-kayit">
              <span className="s">
                <Et renk={s.tur === "calisan" ? "yesil" : "mavi"} yok>{s.tur === "calisan" ? "çalışan" : "yönetici"}</Et>
              </span>
              <span style={{ flex: 1 }}>
                {s.soru} <span className="ot-soluk" style={{ fontSize: 12 }}>· {s.adet} yanıt</span>
              </span>
              <PuanYaz v={s.ortalama} />
            </div>
          ))
        )}
      </Modal>

      {/* ------------------------------ konu ayrıntısı: serbest yanıtlar */}
      <Modal
        open={!!konuDetay}
        className="ot-modal"
        width={640}
        title={konuDetay ? `${konuDetay.baslik} · ${konuDetay.konu}` : ""}
        onCancel={() => setKonuDetay(null)}
        footer={[<button key="k" type="button" className="ot-dg" onClick={() => setKonuDetay(null)}>Kapat</button>]}
      >
        <div className="ot-bilgi" style={{ marginBottom: 10 }}>
          Yanıtların <b>%{konuDetay?.oran ?? 0}</b> kadarı bu başlıkta ({konuDetay?.adet ?? 0} yanıt). Sınıflandırma anahtar kelimeyle
          yapılır; yanlış konuya düşmüş bir yanıt görürseniz kelime kümesi güncellenebilir.
        </div>
        {(konuDetay?.ornekler ?? []).length === 0 ? (
          <div className="ot-bos-sat">Yanıt metni yok.</div>
        ) : (
          (konuDetay?.ornekler ?? []).map((o: any, i: number) => (
            <div key={i} className="ot-kayit">
              <span className="s">{o.asamaAdi ?? ""}</span>
              <span style={{ flex: 1 }}>
                “{o.metin}”
                <span className="ot-soluk" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>
                  {[o.adSoyad, o.subeAdi].filter(Boolean).join(" · ")}
                </span>
              </span>
              {o.personelKodu && (
                <button
                  type="button"
                  className="ot-dg kucuk"
                  onClick={() => {
                    setKonuDetay(null);
                    karneAc(o.personelKodu);
                  }}
                >
                  Karne
                </button>
              )}
            </div>
          ))
        )}
      </Modal>
    </div>
  );
}

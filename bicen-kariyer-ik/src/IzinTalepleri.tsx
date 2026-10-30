/**
 * İzin Talepleri
 * ---------------------------------------------------------------------------
 * Personelin uygulamadan gönderdiği izin talepleri ve üç aşamalı onay.
 *
 * Sıra: mağaza müdürü → bölge müdürü → İnsan Kaynakları. Her kullanıcı
 * yalnızca kendi aşamasındaki talepler için karar verebilir; diğerleri
 * bilgi amaçlı görünür. Bu ayrım "sırada" işaretiyle belirtilir.
 *
 * Görünüm Oryantasyon Takip'in diliyle (KPI kartları, yumuşak renkli
 * etiketler, kart listeler). Sınıflar "it-" ile başlar (IzinTalepleri.css).
 *
 * Talebin çekmecesinde dört sekme var: özet ve onay, evraklar (bütün
 * dosyalar, yeni sekmede açılır), geçmiş ve bildirimler (kime hangi
 * bildirimin ne zaman gittiği) ve personelin önceki talepleri. Geçmiş
 * /api/IzinTalep/{id}/Gecmis'ten, sayfadaki "Son bildirimler" akışı
 * /api/IzinTalep/SonHareketler'den geliyor.
 */

import { PersonelAdi } from "./personelKarti";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Upload,
  Switch,
  Table,
  Space,
  Spin,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import {
  AlarmClock,
  Ban,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  File,
  FileCheck2,
  FileImage,
  FilePlus2,
  FileText,
  FileType2,
  Hourglass,
  Inbox,
  Mail,
  MessageSquare,
  Monitor,
  Paperclip,
  Printer,
  RefreshCw,
  Search,
  Send,
  Settings2,
  SkipForward,
  Smartphone,
  Truck,
  Upload as UploadSimge,
  X,
  XCircle,
} from "lucide-react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

import Tablo from "./Tablo";
import { api } from "./api";
import { useUzman, uzmanSorgu } from "./uzmanFiltresi";
import { bekleyenKayit, gecisDinle } from "./gecis";
import RotasyonTalepleri from "./RotasyonTalepleri";
import { sekmedeAc } from "./sekmedeAc";
import AvansTalepleri from "./AvansTalepleri";
import DevamsizlikTakibi from "./DevamsizlikTakibi";
import FazlaMesaiTalepleri from "./FazlaMesaiTalepleri";
import DenklestirmeTalepleri from "./DenklestirmeTalepleri";
import ManuelGirisTalepleri from "./ManuelGirisTalepleri";
import { EksikDugmesi, useTalepEksikleri } from "./TalepEksik";
import "./IzinTalepleri.css";
import TaramaDugmesi from "./TaramaDugmesi";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

/* ========================================================================== */
/* Yardımcılar                                                                */
/* ========================================================================== */

/** Gün sayısı: 2 → "2", 2.5 → "2,5" */
const gun = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

/** Durum etiketinin rengi (it-e-*) ve kısa adı */
const DURUM_ET: Record<string, { renk: string; ad: string }> = {
  Bekliyor: { renk: "sari", ad: "Birim yöneticisinde" },
  "Mağaza Onayladı": { renk: "mavi", ad: "Bölge müdüründe" },
  "Bölge Onayladı": { renk: "mor", ad: "İK'da" },
  Onaylandı: { renk: "yesil", ad: "Onaylandı" },
  Reddedildi: { renk: "kirmizi", ad: "Reddedildi" },
};

/** Son onayda yüklenecek belge türleri */
const BELGE_TURLERI = [
  "İmzalı İzin Formu",
  "Doktor Raporu",
  "Evlilik Cüzdanı / Nikâh Belgesi",
  "Doğum Belgesi",
  "Ölüm Belgesi",
  "Diğer",
];

/** Saatlik ve yarım gün izinde süre ve saat aralığı */
const sureMetni = (k: any) =>
  k.baslangicSaat
    ? `${k.baslangicSaat}–${k.bitisSaat} · ${gun(k.saat)} saat`
    : k.yarimGun
    ? `${gun(k.gun)} gün · ${k.yarimGun}`
    : `${gun(k.gun)} gün`;

/** "12.10.2026 – 14.10.2026" (aynı günse tek tarih) */
const tarihAraligi = (cikis: string, donus: string) => {
  const c = dayjs(cikis);
  const d = dayjs(donus);

  if (d.isSame(c, "day")) return c.format("D MMM YYYY");
  if (d.isSame(c, "year")) return `${c.format(d.isSame(c, "month") ? "D" : "D MMM")} – ${d.format("D MMM YYYY")}`;

  return `${c.format("D MMM YYYY")} – ${d.format("D MMM YYYY")}`;
};

const tarihSaat = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—");

/** Göreli zaman: "az önce", "12 dk önce", "dün 14:20", "3 gün önce" */
const goreceli = (v?: string | null) => {
  if (!v) return "";

  const z = dayjs(v);
  const simdi = dayjs();
  const dk = simdi.diff(z, "minute");

  if (dk < 1) return "az önce";
  if (dk < 60) return `${dk} dk önce`;
  if (z.isSame(simdi, "day")) return `${Math.floor(dk / 60)} sa önce`;
  if (z.isSame(simdi.subtract(1, "day"), "day")) return `dün ${z.format("HH:mm")}`;

  const g = simdi.startOf("day").diff(z.startOf("day"), "day");

  if (g < 7 && g > 0) return `${g} gün önce`;

  return z.format(z.isSame(simdi, "year") ? "D MMM HH:mm" : "DD.MM.YYYY");
};

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

/** İzin türünün rengi: aynı tür her yerde aynı renkte */
const turRenk = (tur?: string | null) => {
  const t = String(tur ?? "").toLocaleLowerCase("tr");

  if (t.includes("yıllık")) return "yesil";
  if (t.includes("mazeret")) return "turuncu";
  if (t.includes("rapor") || t.includes("hastal")) return "kirmizi";
  if (t.includes("ücretsiz")) return "gri";
  if (t.includes("saat") || t.includes("yarım")) return "mavi";
  if (t.includes("doğum") || t.includes("evlilik") || t.includes("babalık")) return "mor";

  return "camgobegi";
};

/** Kişi simgesi: fotoğraf varsa o, yoksa baş harfler renkli zeminde */
function Avatar({ kod, ad, boyut = 36 }: { kod?: string | null; ad?: string | null; boyut?: number }) {
  const [hata, setHata] = useState(false);
  const adres = kod ? api.resimAdresi(kod) : "";
  const r = avRenk(ad || kod || "?");

  return (
    <span
      className="it-av"
      style={{ width: boyut, height: boyut, background: `${r}1f`, color: r, fontSize: Math.round(boyut * 0.36) }}
    >
      {adres && !hata ? (
        <img src={adres} alt="" loading="lazy" decoding="async" onError={() => setHata(true)} />
      ) : (
        basHarf(ad || kod)
      )}
    </span>
  );
}

/** Yumuşak renkli etiket */
function Et({ renk, yok, children, title }: { renk: string; yok?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`it-e it-e-${renk}${yok ? " yok" : ""}`} title={title}>
      {children}
    </span>
  );
}

const KANAL: Record<string, { ad: string; simge: typeof Smartphone; renk: string }> = {
  uygulama: { ad: "Uygulama", simge: Smartphone, renk: "yesil" },
  sms: { ad: "SMS", simge: MessageSquare, renk: "mavi" },
  eposta: { ad: "E-posta", simge: Mail, renk: "turuncu" },
  panel: { ad: "Panel", simge: Monitor, renk: "gri" },
};

/** Bildirimin gittiği kanal */
function KanalEt({ kanal }: { kanal?: string | null }) {
  if (!kanal) return null;

  const k = KANAL[kanal] ?? { ad: kanal, simge: BellRing, renk: "gri" };
  const S = k.simge;

  return (
    <span className={`it-kanal it-kanal-${k.renk}`}>
      <S size={11} strokeWidth={2.2} />
      {k.ad}
    </span>
  );
}

/* ========================================================================== */
/* Hareketler (geçmiş ve bildirimler)                                         */
/* ========================================================================== */

type Hareket = {
  id?: number | null;
  talepId: number;
  zaman: string;
  tur: string;
  baslik: string;
  metin?: string | null;
  kisi?: string | null;
  hedef?: string | null;
  kanal?: string | null;
  kaynak?: string;
  belgeId?: number | null;
  adSoyad?: string | null;
  talepTur?: string | null;
  subeAdi?: string | null;
  personelKodu?: string | null;
  durum?: string | null;
};

type Gecmis = { hareketler: Hareket[]; digerTalepler: any[] };

/** Hareketin simgesi ve rengi */
const hareketGorunum = (h: Hareket): { simge: typeof Clock; renk: string } => {
  const olumsuz = /reddetti|gönderilemedi|iptal/i.test(h.baslik ?? "");

  switch (h.tur) {
    case "olusturma":
      return { simge: FilePlus2, renk: "mavi" };
    case "karar":
      return /atlandı/i.test(h.baslik ?? "")
        ? { simge: SkipForward, renk: "gri" }
        : olumsuz
        ? { simge: XCircle, renk: "kirmizi" }
        : { simge: CheckCircle2, renk: "yesil" };
    case "bildirim":
      return { simge: BellRing, renk: "mor" };
    case "evrak":
      return { simge: Paperclip, renk: "camgobegi" };
    case "hatirlatma":
      return { simge: AlarmClock, renk: "sari" };
    case "form":
      return { simge: Mail, renk: olumsuz ? "kirmizi" : "turuncu" };
    case "asil":
      return { simge: Truck, renk: "mavi" };
    case "iptal":
      return { simge: Ban, renk: "kirmizi" };
    default:
      return { simge: Clock, renk: "gri" };
  }
};

function HareketSimge({ h, boyut = 28 }: { h: Hareket; boyut?: number }) {
  const g = hareketGorunum(h);
  const S = g.simge;

  return (
    <span className={`it-hs it-hs-${g.renk}`} style={{ width: boyut, height: boyut }}>
      <S size={Math.round(boyut * 0.5)} strokeWidth={2.2} />
    </span>
  );
}

/* ========================================================================== */
/* Onay akışı                                                                 */
/* ========================================================================== */

type AsamaDurum = "tamam" | "red" | "atlandi" | "sirada" | "bekliyor";

const ASAMALAR = [
  { alan: "magaza", ad: "Birim Yöneticisi", kisa: "Birim", yer: "Birim yöneticisinde" },
  { alan: "bolge", ad: "Bölge Müdürü", kisa: "Bölge", yer: "Bölgede" },
  { alan: "ik", ad: "İnsan Kaynakları", kisa: "İK", yer: "İK'da" },
] as const;

type AsamaKarti = {
  alan: string;
  ad: string;
  kisa: string;
  yer: string;
  durum: AsamaDurum;
  karar: string | null;
  kisi: string | null;
  not: string | null;
  tarih: string | null;
  /** Zincirli talepte adımın onaylayacak kişileri (sunucudan) */
  kisiler?: string[];
};

/**
 * Aşamaların durumu. Zincirli talepte (26.10.2026, avans onay tablosundaki
 * süreç) sunucu gerçek adımları `akis` olarak gönderiyor: Birim Yöneticisi →
 * (Bölge Müdürü) → Genel Müdür Yardımcısı → İnsan Kaynakları. Zinciri
 * olmayan eski taleplerde üç sabit aşama kolonlardan kuruluyor.
 */
const asamaDurumlari = (k: any): AsamaKarti[] => {
  if (Array.isArray(k.akis) && k.akis.length > 0)
    return k.akis.map((a: any) => ({
      alan: a.alan,
      ad: a.ad,
      kisa: a.kisa ?? a.ad,
      yer: a.yer ?? a.ad,
      durum: a.durum as AsamaDurum,
      karar: a.karar ?? null,
      kisi: a.kisi ?? null,
      not: a.not ?? null,
      tarih: a.tarih ?? null,
      kisiler: a.kisiler ?? [],
    }));

  const siradaki =
    k.durum === "Bekliyor" ? 0 : k.durum === "Mağaza Onayladı" ? 1 : k.durum === "Bölge Onayladı" ? 2 : -1;

  return ASAMALAR.map((a, i) => {
    const karar = k[`${a.alan}Karar`] as string | null;
    const durum: AsamaDurum =
      karar === "Onaylandı"
        ? "tamam"
        : karar === "Reddedildi"
        ? "red"
        : karar === "Atlandı"
        ? "atlandi"
        : i === siradaki
        ? "sirada"
        : "bekliyor";

    return {
      ...a,
      durum,
      karar,
      kisi: k[`${a.alan}Kisi`] as string | null,
      not: k[`${a.alan}Not`] as string | null,
      tarih: k[`${a.alan}Tarih`] as string | null,
    };
  });
};

/** Akışın tek satırlık özeti: "Bölge müdüründe bekliyor" */
const akisOzeti = (k: any) => {
  if (k.durum === "Onaylandı") return Array.isArray(k.akis) ? "Bütün aşamalar tamam" : "Üç aşama tamam";
  if (k.durum === "Reddedildi") {
    const r = asamaDurumlari(k).find((x) => x.durum === "red");
    return r ? `${r.yer} reddedildi` : "Reddedildi";
  }
  const s = asamaDurumlari(k).find((x) => x.durum === "sirada");
  if (!s) return k.durum;
  const adlar = asamaAdlari(k, s.alan);
  return `${s.kisa} onayı bekleniyor${adlar.length ? ` · ${adlar[0]}${adlar.length > 1 ? ` +${adlar.length - 1}` : ""}` : ""}`;
};

/** Aşamada karar verecek kişiler (sunucu: onay tablosu; zincirli talepte adımın kendi listesi) */
const asamaAdlari = (k: any, alan: string): string[] => {
  if (Array.isArray(k.akis)) {
    const a = k.akis.find((x: any) => x.alan === alan);
    return a?.tur === "ik" ? [] : a?.kisiler ?? [];
  }
  return alan === "magaza" ? k.onaylayicilar?.birim ?? [] : alan === "bolge" ? k.onaylayicilar?.bolge ?? [] : [];
};

/** Listedeki küçük onay izi: Birim → Bölge → İK */
function OnayIzi({ k }: { k: any }) {
  const a = asamaDurumlari(k);
  const ipucu = a
    .map(
      (x) =>
        `${x.ad}: ${
          x.durum === "tamam"
            ? `onayladı${x.kisi ? ` (${x.kisi})` : ""}`
            : x.durum === "red"
            ? `reddetti${x.kisi ? ` (${x.kisi})` : ""}`
            : x.durum === "atlandi"
            ? "atlandı"
            : x.durum === "sirada"
            ? "bekleniyor"
            : "—"
        }`
    )
    .join(" · ");

  return (
    <Tooltip title={ipucu}>
      <div className="it-oi">
        <div className="it-oi-serit">
          {a.map((x) => (
            <i key={x.alan} className={`it-oi-p ${x.durum}`} />
          ))}
        </div>
        <div className="it-oi-etiket">
          {a.map((x) => (
            <span key={x.alan} className={x.durum}>
              {x.kisa}
            </span>
          ))}
        </div>
      </div>
    </Tooltip>
  );
}

/* ========================================================================== */
/* İzin evrakı                                                                */
/* ========================================================================== */

/**
 * Evrakın üç adımı: personelin yüklediği imzalı form (ve destekleyici
 * belge), personelin ıslak imzalı aslını İK'ya göndermesi, İK'nın aslını
 * imzalayıp yüklemesi. Reddedilen talepte evrak yok.
 */
const evrakAdimlari = (k: any) => {
  const e = k?.evrak;

  if (!e || k.durum === "Reddedildi") return null;

  const personel = e.personelTamam ? "tamam" : e.gecikti ? "gecikti" : "bekliyor";
  const asil = e.asilGonderim ? "tamam" : e.personelTamam ? "bekliyor" : "yok";
  /* 13.10.2026: İK evrakı isteğe bağlı. Onaylanmış talepte yalnızca
     "evrak sonra yüklenecek" işaretlendiyse bekleniyor sayılır. */
  const ik = e.ikVar ? "tamam" : k.durum === "Onaylandı" ? (e.evrakSonra ? "gecikti" : "yok") : "bekliyor";

  return { personel, asil, ik, e } as { personel: string; asil: string; ik: string; e: any };
};

/** Evrak bekleyen talep: personel ya da İK tarafında eksik var */
const evrakBekliyor = (k: any) => {
  const a = evrakAdimlari(k);
  return !!a && (a.personel !== "tamam" || a.ik === "gecikti");
};

const ADIM_RENK: Record<string, string> = {
  tamam: "#5f8c10",
  bekliyor: "#c9d1c1",
  gecikti: "#e8481c",
  yok: "#e6e9e3",
};

/** Tablodaki küçük evrak izi: Personel · Aslı · İK */
function EvrakIzi({ k }: { k: any }) {
  const a = evrakAdimlari(k);

  if (!a) return <span className="it-soluk">—</span>;

  const ipucu = [
    `Personel evrakı: ${a.personel === "tamam" ? "yüklendi" : a.personel === "gecikti" ? "süre doldu" : "bekleniyor"}`,
    `Aslı: ${a.asil === "tamam" ? `gönderildi (${dayjs(a.e.asilGonderim).format("DD.MM")})` : "gönderilmedi"}`,
    `İK evrakı: ${a.ik === "tamam" ? "yüklendi" : a.ik === "gecikti" ? "onaylandı, evrak bekleniyor" : a.ik === "yok" ? "yüklenmedi (isteğe bağlı)" : "isteğe bağlı"}`,
  ].join(" · ");

  return (
    <Tooltip title={ipucu}>
      <div className="it-ei">
        {(["personel", "asil", "ik"] as const).map((x, i) => (
          <span key={x} className="it-ei-k">
            {i > 0 && <span className="it-ei-c" />}
            <span
              className="it-ei-n"
              style={{
                color: a[x] === "tamam" || a[x] === "gecikti" ? "#fff" : "#6b7280",
                background: ADIM_RENK[a[x]],
              }}
            >
              {x === "personel" ? "P" : x === "asil" ? "A" : "İK"}
            </span>
          </span>
        ))}
      </div>
    </Tooltip>
  );
}

/** Talebin bütün dosyaları: kalem evrakları, İK belgesi, eski mazeret belgesi, üretilen form */
type DosyaKaydi = {
  anahtar: string;
  ad: string;
  alt?: string | null;
  yol: string;
  kim: "Personel" | "İK" | "Sistem";
  kimAd?: string | null;
  zaman?: string | null;
  kalem?: string;
  dosyaAdi?: string | null;
};

const KALEM_AD: Record<string, string> = {
  form: "İmzalı form",
  destek: "Destekleyici belge",
  ik: "İK evrakı",
};

const dosyalariTopla = (k: any, formDahil = true): DosyaKaydi[] => {
  const l: DosyaKaydi[] = [];
  const dosyalar: any[] = k?.evrak?.dosyalar ?? [];
  const belgeIdleri = new Set(dosyalar.map((d) => d.belgeId));

  for (const d of dosyalar)
    l.push({
      anahtar: `e${d.id ?? d.belgeId}`,
      ad: d.tur || d.ozgunAd || "Dosya",
      alt: d.ozgunAd,
      yol: `/api/IzinTalep/${k.id}/Evrak/${d.belgeId}`,
      kim: d.kalem === "ik" ? "İK" : "Personel",
      kimAd: d.yukleyen,
      zaman: d.olusturma,
      kalem: d.kalem,
      dosyaAdi: d.ozgunAd,
    });

  if (k?.belgeId && !belgeIdleri.has(k.belgeId))
    l.push({
      anahtar: "ik-belge",
      ad: k.belgeTur ?? "İK belgesi",
      alt: k.belgeBaslik,
      yol: `/api/IzinTalep/${k.id}/Belge`,
      kim: "İK",
      zaman: k.ikTarih,
      kalem: "ik",
    });

  if (k?.mbBelgeId && !belgeIdleri.has(k.mbBelgeId) && k.mbBelgeId !== k.belgeId)
    l.push({
      anahtar: "mb-belge",
      ad: k.mbBelgeTur ?? "Mazeret belgesi",
      alt: "Personelin uygulamadan yüklediği belge",
      yol: `/api/IzinTalep/${k.id}/MazeretBelge`,
      kim: "Personel",
      kimAd: k.adSoyad,
      zaman: k.mbYukleme,
      kalem: "destek",
    });

  if (formDahil)
    l.push({
      anahtar: "form",
      ad: "Doldurulmuş izin formu",
      alt: "Sistemin hazırladığı form (PDF)",
      yol: `/api/IzinTalep/${k.id}/FormDosya`,
      kim: "Sistem",
      zaman: k.olusturma,
      dosyaAdi: "form.pdf",
    });

  return l;
};

/** Kayıttaki yüklenmiş dosya sayısı (üretilen form hariç) */
const dosyaSayisi = (k: any) => dosyalariTopla(k, false).length;

/** Dosya türü simgesi: uzantıdan */
function DosyaSimge({ ad, boyut = 20 }: { ad?: string | null; boyut?: number }) {
  const u = String(ad ?? "").split(".").pop()?.toLowerCase() ?? "";

  const [S, renk, et] =
    u === "pdf"
      ? [FileText, "kirmizi", "PDF"]
      : ["jpg", "jpeg", "png", "heic", "heif", "webp"].includes(u)
      ? [FileImage, "mavi", u === "jpeg" ? "JPG" : u.toUpperCase()]
      : ["doc", "docx"].includes(u)
      ? [FileType2, "lacivert", "DOC"]
      : [File, "gri", u ? u.toUpperCase().slice(0, 4) : "DOSYA"];

  return (
    <span className={`it-ds it-ds-${renk}`}>
      <S size={boyut} strokeWidth={1.8} />
      <small>{et}</small>
    </span>
  );
}

/* ========================================================================== */
/* Sayfa                                                                      */
/* ========================================================================== */

type Gorunum = "sirada" | "evrak" | "surecte" | "sonuclanan" | "tumu";
type DetaySekme = "ozet" | "evrak" | "gecmis" | "onceki";

const SAYFA_BOYU = 15;

/* Onayın kimde beklediği (07.10.2026): sırada ve süreçteki talepler
   İK'da / bölge müdüründe / birim yöneticisinde diye ayrı gruplarda */
type AsamaGrubu = "ik" | "bolge" | "birim";
const ASAMA_GRUBU: { k: AsamaGrubu; ad: string; alt: string }[] = [
  { k: "ik", ad: "İK onayında", alt: "Yöneticiler onayladı; karar İnsan Kaynakları'nda" },
  { k: "bolge", ad: "Bölge müdürü / GMY'de", alt: "Birim yöneticisi onayladı; bölge müdürünün ya da genel müdür yardımcısının kararı bekleniyor" },
  { k: "birim", ad: "Birim yöneticisinde", alt: "Henüz birim yöneticisi onaylamadı" },
];
const asamaGrubu = (k: any): AsamaGrubu | null =>
  k.durum === "Bölge Onayladı" ? "ik" : k.durum === "Mağaza Onayladı" ? "bolge" : k.durum === "Bekliyor" ? "birim" : null;

export default function IzinTalepleri() {
  /* İzin türü tanımları ayrı pencerede: talep listesini kalabalıklaştırmasın */
  const [turAcik, setTurAcik] = useState(false);

  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [gorunum, setGorunum] = useState<Gorunum>("sirada");
  const [asamaSec, setAsamaSec] = useState<"hepsi" | AsamaGrubu>("hepsi");
  const [sonuc, setSonuc] = useState<"hepsi" | "Onaylandı" | "Reddedildi">("hepsi");
  const [arama, setArama] = useState("");
  const [turSecim, setTurSecim] = useState<string | null>(null);
  const [aralik, setAralik] = useState<[Dayjs, Dayjs] | null>(null);
  const [buAyKarar, setBuAyKarar] = useState(false);
  const [sayfa, setSayfa] = useState(1);
  const [ilkYukleme, setIlkYukleme] = useState(true);

  const [detay, setDetay] = useState<any>(null);
  const [detaySekme, setDetaySekme] = useState<DetaySekme>("ozet");
  const [gecmisler, setGecmisler] = useState<Record<number, Gecmis | "yukleniyor" | "hata">>({});

  const [akis, setAkis] = useState<Hareket[] | null>(null);
  const [akisAcik, setAkisAcik] = useState(false);
  const [akisTumu, setAkisTumu] = useState(false);

  /* Vardiya düzeltme talepleri ayrı sekmede: farklı bir akış ve farklı
     bir onay mantığı; aynı listede karışıyorlar. */
  /* Personel Talepleri (06.10.2026): sayfa izinle birlikte avans ve
     rotasyon taleplerini de kategori olarak topluyor. */
  /* Bildirim merkezinden "sekme:avans" gibi tek seferlik yük gelebilir (gecis.ts) */
  const [sekme, setSekme] = useState<"izin" | "avans" | "fazlamesai" | "rotasyon" | "itiraz" | "devamsizlik" | "denklestirme">(() => {
    const y = bekleyenKayit("izintalep");
    const k = y?.startsWith("sekme:") ? y.slice(6) : null;
    return k === "avans" || k === "fazlamesai" || k === "rotasyon" || k === "itiraz" || k === "devamsizlik" || k === "denklestirme" ? k : "izin";
  });

  /* Sayfa açıkken bildirim merkezinden sekme değişikliği */
  useEffect(() => {
    const birak = gecisDinle((hedef) => {
      if (hedef !== "izintalep") return;
      const y = bekleyenKayit("izintalep");
      const k = y?.startsWith("sekme:") ? y.slice(6) : null;
      if (k === "izin" || k === "avans" || k === "fazlamesai" || k === "rotasyon" || k === "itiraz" || k === "devamsizlik" || k === "denklestirme") setSekme(k);
    });
    return () => {
      birak();
    };
  }, []);
  const [avansBekleyen, setAvansBekleyen] = useState(0);

  /* Eksik bildirimi (07.10.2026): satırdaki rozet ve düğme */
  const eksik = useTalepEksikleri("izin");
  const itirazEksik = useTalepEksikleri("itiraz");
  const [fmBekleyen, setFmBekleyen] = useState(0);
  const [denkBekleyen, setDenkBekleyen] = useState(0);
  const [rotBekleyen, setRotBekleyen] = useState(0);
  const [devBekleyen, setDevBekleyen] = useState(0);

  /* Uzman süzgeci (07.10.2026): başlıktaki "Diğer uzmanlar" seçicisi.
     Seçim yokken İK uzmanı yalnızca kendi şubelerini görür (sunucu). */
  const uzman = useUzman();

  useEffect(() => {
    api
      .al<{ bekleyen: number }>(`/api/Avans/Sayac${uzmanSorgu(uzman)}`)
      .then((d) => setAvansBekleyen(d?.bekleyen ?? 0))
      .catch(() => setAvansBekleyen(0));
    api
      .al<{ bekleyen: number }>(`/api/FazlaMesai/Sayac${uzmanSorgu(uzman)}`)
      .then((d) => setFmBekleyen(d?.bekleyen ?? 0))
      .catch(() => setFmBekleyen(0));
    api
      .al<{ bekleyen: number }>(`/api/Rotasyon/Sayac${uzmanSorgu(uzman)}`)
      .then((d) => setRotBekleyen(d?.bekleyen ?? 0))
      .catch(() => setRotBekleyen(0));
    api
      .al<{ esikUstu: number }>("/api/Devamsizlik/Liste")
      .then((d) => setDevBekleyen(d?.esikUstu ?? 0))
      .catch(() => setDevBekleyen(0));
  }, [uzman]);
  const [itirazlar, setItirazlar] = useState<any[]>([]);
  const [itirazYukleniyor, setItirazYukleniyor] = useState(false);
  /* Rapor aralığı (09.10.2026): sonuçlananlar bu aralıktan, bekleyenler her zaman */
  const [itirazAralik, setItirazAralik] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf("month"), dayjs()]);

  const itirazGetir = useCallback(async () => {
    setItirazYukleniyor(true);

    try {
      const d = await api.al<any>(
        `/api/Mobil/Itirazlar?bas=${itirazAralik[0].format("YYYY-MM-DD")}&bit=${itirazAralik[1].format("YYYY-MM-DD")}${uzmanSorgu(uzman, "ek")}`
      );
      setItirazlar(d?.kayitlar ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setItirazYukleniyor(false);
    }
  }, [message, uzman, itirazAralik]);

  useEffect(() => {
    if (sekme === "itiraz") itirazGetir();
  }, [sekme, itirazGetir]);

  const itirazKarar = (k: any, onay: boolean) => {
    let not = "";
    let saat: string = k.saat ?? "";

    modal.confirm({
      title: onay ? "Düzeltme onaylansın mı?" : "Düzeltme reddedilsin mi?",
      width: 460,
      content: (
        <div>
          <Paragraph style={{ fontSize: 13.5 }}>
            <b>{k.adSoyad}</b> · {dayjs(k.tarih).format("DD.MM.YYYY")} ·{" "}
            {k.tur} {k.saat}
            <br />
            <span style={{ color: "var(--metin-pasif)" }}>{k.sebep}</span>
          </Paragraph>

          {onay && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10 }}
                message="Onaylarsanız vardiya kaydı oluşturulur"
                description="Saati kontrol edip gerekirse düzeltin; kayıt yazdığınız saatle düşer. Elle eklendiği için konum doğrulaması taşımaz."
              />
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, marginRight: 8 }}>{k.tur} saati</span>
                <Input
                  defaultValue={k.saat}
                  placeholder="08:30"
                  style={{ width: 110 }}
                  onChange={(e) => (saat = e.target.value)}
                />
              </div>
            </>
          )}

          <TextArea
            rows={3}
            placeholder={onay ? "Açıklama (isteğe bağlı)" : "Ret sebebi (zorunlu)"}
            onChange={(e) => (not = e.target.value)}
          />
        </div>
      ),
      okText: onay ? "Onayla" : "Reddet",
      cancelText: "Vazgeç",
      okButtonProps: { danger: !onay },
      onOk: async () => {
        if (!onay && !not.trim()) {
          message.error("Ret sebebini yazınız.");
          return Promise.reject();
        }

        try {
          if (onay && !/^\d{1,2}:\d{2}$/.test(saat.trim())) {
            message.error("Saati 08:30 biçiminde giriniz.");
            return Promise.reject();
          }

          await api.gonder(`/api/Mobil/Itiraz/${k.id}/Karar`, {
            onay,
            not: not.trim(),
            saat: onay ? saat.trim() : null,
          });

          message.success(onay ? "Kayda işlendi." : "Reddedildi.");
          itirazGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };
  const [islemde, setIslemde] = useState(false);

  /** Son bildirimler akışı; gelmezse sayfa yine çalışır */
  const akisGetir = useCallback(async () => {
    try {
      const d = await api.al<{ hareketler: Hareket[] }>("/api/IzinTalep/SonHareketler?adet=30");
      setAkis(d?.hareketler ?? []);
    } catch {
      setAkis([]);
    }
  }, []);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(await api.al<any>(`/api/IzinTalep/Liste${uzmanSorgu(uzman)}`));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }

    akisGetir();
  }, [message, akisGetir, uzman]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* İlk açılışta sırada talep yoksa liste boş görünmesin: tümüne geç */
  useEffect(() => {
    if (!veri || !ilkYukleme) return;
    setIlkYukleme(false);
    if (!veri.bekleyen) setGorunum("surecte");
  }, [veri, ilkYukleme]);

  const kayitlar: any[] = veri?.kayitlar ?? [];

  /** Talebin geçmişini getirir (önbellekli; yenile=true ile tazelenir) */
  const gecmisGetir = useCallback(async (id: number, yenile = false) => {
    let atla = false;

    setGecmisler((g) => {
      if (!yenile && g[id] && g[id] !== "hata") atla = true;
      return atla ? g : { ...g, [id]: "yukleniyor" };
    });

    if (atla) return;

    try {
      const d = await api.al<Gecmis>(`/api/IzinTalep/${id}/Gecmis`);
      setGecmisler((g) => ({ ...g, [id]: { hareketler: d?.hareketler ?? [], digerTalepler: d?.digerTalepler ?? [] } }));
    } catch {
      setGecmisler((g) => ({ ...g, [id]: "hata" }));
    }
  }, []);

  useEffect(() => {
    if (detay?.id) gecmisGetir(detay.id);
  }, [detay?.id, gecmisGetir]);

  const talebiAc = (k: any, s: DetaySekme = "ozet") => {
    setDetaySekme(s);
    setDetay(k);
  };

  /** Akıştan ya da önceki taleplerden kimlikle açar */
  const kimlikleAc = (id: number, s: DetaySekme = "ozet") => {
    const k = kayitlar.find((x) => x.id === id);

    if (!k) {
      message.info("Bu talep listede yok (iptal edilmiş olabilir).");
      return;
    }

    talebiAc(k, s);
  };

  /* ------------------------------------------------------------- sayılar */
  const sayilar = useMemo(() => {
    const buAy = dayjs();
    const evrak = kayitlar.filter(evrakBekliyor);
    const geciken = evrak.filter((k) => evrakAdimlari(k)?.personel === "gecikti").length;
    const ikBekleyen = evrak.filter((k) => evrakAdimlari(k)?.ik === "gecikti").length;
    const onaylanan = kayitlar.filter((k) => k.durum === "Onaylandı");
    const reddedilen = kayitlar.filter((k) => k.durum === "Reddedildi");
    const sirada = kayitlar.filter((k) => k.sirada);
    const enEski = sirada.reduce((m: number, k) => Math.max(m, dayjs().diff(dayjs(k.olusturma), "day")), 0);

    return {
      sirada: veri?.bekleyen ?? sirada.length,
      enEski,
      evrak: evrak.length,
      geciken,
      ikBekleyen,
      surecte: kayitlar.filter((k) => !["Onaylandı", "Reddedildi"].includes(k.durum)).length,
      sonuclanan: onaylanan.length + reddedilen.length,
      onaylanan: onaylanan.length,
      buAyOnay: onaylanan.filter((k) => dayjs(k.ikTarih ?? k.olusturma).isSame(buAy, "month")).length,
      reddedilen: reddedilen.length,
      buAyRed: reddedilen.filter((k) =>
        dayjs(k.ikTarih ?? k.bolgeTarih ?? k.magazaTarih ?? k.olusturma).isSame(buAy, "month")
      ).length,
      tumu: kayitlar.length,
    };
  }, [kayitlar, veri]);

  const turler = useMemo(
    () => Array.from(new Set(kayitlar.map((k) => k.tur).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")),
    [kayitlar]
  );

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    const suzulen = kayitlar.filter((k) => {
      if (gorunum === "sirada" && !k.sirada) return false;

      if ((gorunum === "sirada" || gorunum === "surecte") && asamaSec !== "hepsi" && asamaGrubu(k) !== asamaSec)
        return false;

      if (gorunum === "evrak" && !evrakBekliyor(k)) return false;

      if (gorunum === "surecte" && ["Onaylandı", "Reddedildi"].includes(k.durum)) return false;

      if (gorunum === "sonuclanan") {
        if (!["Onaylandı", "Reddedildi"].includes(k.durum)) return false;
        if (sonuc !== "hepsi" && k.durum !== sonuc) return false;
      }

      if (buAyKarar) {
        const karar = k.ikTarih ?? k.bolgeTarih ?? k.magazaTarih;
        if (!karar || !dayjs(karar).isSame(dayjs(), "month")) return false;
      }

      if (turSecim && k.tur !== turSecim) return false;

      /* Tarih süzgeci: izin günleri seçilen aralıkla kesişiyor mu */
      if (aralik) {
        const [bas, bit] = aralik;
        if (dayjs(k.cikisTarihi).isAfter(bit, "day") || dayjs(k.donusTarihi).isBefore(bas, "day")) return false;
      }

      if (q) {
        const metin = `${k.adSoyad} ${k.subeAdi} ${k.gorev} ${k.tur} ${k.personelKodu ?? ""}`;
        if (!metin.toLocaleLowerCase("tr").includes(q)) return false;
      }

      return true;
    });

    /* Sırada ve süreçte: önce İK'dakiler, sonra bölge müdürü, sonra birim yöneticisi */
    if (gorunum === "sirada" || gorunum === "surecte") {
      const sira = (k: any) => ["ik", "bolge", "birim"].indexOf(asamaGrubu(k) ?? "birim");
      return suzulen.map((k, i) => ({ k, i })).sort((a, b) => sira(a.k) - sira(b.k) || a.i - b.i).map((x) => x.k);
    }

    return suzulen;
  }, [kayitlar, gorunum, sonuc, arama, turSecim, aralik, buAyKarar, asamaSec]);

  /* Aşama grubu sayıları (yalnızca görünüm süzgeciyle) */
  const asamaSayilari = useMemo(() => {
    const taban = kayitlar.filter((k) =>
      gorunum === "sirada" ? k.sirada : !["Onaylandı", "Reddedildi"].includes(k.durum)
    );
    return {
      ik: taban.filter((k) => asamaGrubu(k) === "ik").length,
      bolge: taban.filter((k) => asamaGrubu(k) === "bolge").length,
      birim: taban.filter((k) => asamaGrubu(k) === "birim").length,
    } as Record<AsamaGrubu, number>;
  }, [kayitlar, gorunum]);

  useEffect(() => setSayfa(1), [gorunum, sonuc, arama, turSecim, aralik, buAyKarar, asamaSec]);

  const sayfadakiler = liste.slice((sayfa - 1) * SAYFA_BOYU, sayfa * SAYFA_BOYU);
  const islemVar = sayfadakiler.some((k) => k.sirada);
  const suzgecVar = !!(arama || turSecim || aralik || buAyKarar);

  const suzgecleriTemizle = () => {
    setArama("");
    setTurSecim(null);
    setAralik(null);
    setBuAyKarar(false);
  };

  /**
   * Karar verir. Onayda açıklama isteğe bağlı, rette zorunlu — personel
   * neden reddedildiğini bilmezse aynı talebi tekrar açıyor.
   */
  /* Son onay: belge yüklenmeden verilemiyor, ayrı pencerede */
  const [belgeliOnay, setBelgeliOnay] = useState<any>(null);

  const karar = async (kayit: any, onay: boolean) => {
    if (onay && kayit.sonOnay) {
      setBelgeliOnay(kayit);
      return;
    }

    let not = "";

    const onaylandi = await new Promise<boolean>((coz) => {
      modal.confirm({
        title: onay ? "Talep onaylansın mı?" : "Talep reddedilsin mi?",
        width: 470,
        content: (
          <div>
            <Paragraph style={{ fontSize: 13.5 }}>
              <b>{kayit.adSoyad}</b> ·{" "}
              {dayjs(kayit.cikisTarihi).format("DD.MM.YYYY")} –{" "}
              {dayjs(kayit.donusTarihi).format("DD.MM.YYYY")} ·{" "}
              {gun(kayit.gun)} gün
            </Paragraph>

            <TextArea
              rows={3}
              placeholder={
                onay ? "Açıklama (isteğe bağlı)" : "Ret sebebi (zorunlu)"
              }
              onChange={(e) => (not = e.target.value)}
            />
          </div>
        ),
        okText: onay ? "Onayla" : "Reddet",
        cancelText: "Vazgeç",
        okButtonProps: { danger: !onay },
        onOk: () => {
          if (!onay && !not.trim()) {
            message.error("Ret sebebini yazınız.");
            return Promise.reject();
          }
          coz(true);
        },
        onCancel: () => coz(false),
      });
    });

    if (!onaylandi) return;

    setIslemde(true);

    try {
      const d = await api.gonder<any>(`/api/IzinTalep/${kayit.id}/Karar`, {
        onay,
        not: not.trim(),
      });

      message.success(
        d.durum === "Onaylandı"
          ? "Talep onaylandı ve izin kaydı oluşturuldu."
          : d.durum === "Reddedildi"
          ? "Talep reddedildi."
          : "Onayınız kaydedildi, bir sonraki aşamaya geçti."
      );

      setDetay(null);
      setGecmisler((g) => ({ ...g, [kayit.id]: undefined as any }));
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIslemde(false);
    }
  };

  /* ----------------------------------------------------- başlık ve KPI */
  const kpiler: {
    anahtar: string;
    et: string;
    d: ReactNode;
    alt: ReactNode;
    simge: typeof Clock;
    renk: string;
    secili: boolean;
    git: () => void;
  }[] = [
    {
      anahtar: "sirada",
      et: "Onayımı bekleyen",
      d: sayilar.sirada,
      alt:
        sayilar.sirada > 0 ? (
          <>
            en eskisi <b>{sayilar.enEski}</b> gündür bekliyor
          </>
        ) : (
          "sırada talep yok"
        ),
      simge: Hourglass,
      renk: "sari",
      secili: gorunum === "sirada",
      git: () => {
        suzgecleriTemizle();
        setGorunum("sirada");
      },
    },
    {
      anahtar: "evrak",
      et: "Evrak bekleyen",
      d: sayilar.evrak,
      alt: (
        <>
          {sayilar.geciken > 0 ? (
            <span className="it-kirmizi-yazi">
              <b>{sayilar.geciken}</b> süresi geçti
            </span>
          ) : (
            "süresi geçen yok"
          )}
          {sayilar.ikBekleyen > 0 && (
            <>
              {" "}
              · <b>{sayilar.ikBekleyen}</b> İK evrakı bekliyor
            </>
          )}
        </>
      ),
      simge: Paperclip,
      renk: "turuncu",
      secili: gorunum === "evrak",
      git: () => {
        suzgecleriTemizle();
        setGorunum("evrak");
      },
    },
    {
      anahtar: "onay",
      et: "Bu ay onaylanan",
      d: sayilar.buAyOnay,
      alt: (
        <>
          toplam <b>{sayilar.onaylanan}</b> onaylı talep
        </>
      ),
      simge: CheckCircle2,
      renk: "yesil",
      secili: gorunum === "sonuclanan" && sonuc === "Onaylandı" && buAyKarar,
      git: () => {
        suzgecleriTemizle();
        setGorunum("sonuclanan");
        setSonuc("Onaylandı");
        setBuAyKarar(true);
      },
    },
    {
      anahtar: "red",
      et: "Reddedilen",
      d: sayilar.reddedilen,
      alt: (
        <>
          bu ay <b>{sayilar.buAyRed}</b>
        </>
      ),
      simge: XCircle,
      renk: "kirmizi",
      secili: gorunum === "sonuclanan" && sonuc === "Reddedildi" && !buAyKarar,
      git: () => {
        suzgecleriTemizle();
        setGorunum("sonuclanan");
        setSonuc("Reddedildi");
      },
    },
  ];

  /* ----------------------------------------------------- bildirim akışı */
  const bugunAkis = (akis ?? []).filter((h) => dayjs(h.zaman).isSame(dayjs(), "day")).length;

  const AkisOge = ({ h }: { h: Hareket }) => (
    <button type="button" className="it-ak-oge" onClick={() => kimlikleAc(h.talepId, "gecmis")}>
      <HareketSimge h={h} boyut={30} />
      <span className="it-ak-ic">
        <span className="it-ak-bas">{h.baslik}</span>
        <span className="it-ak-kim">
          <b>{h.adSoyad ?? `Talep #${h.talepId}`}</b>
          {h.talepTur ? ` · ${h.talepTur}` : ""}
        </span>
        <span className="it-ak-alt">
          <KanalEt kanal={h.kanal} />
          {h.hedef && <span className="it-ak-hedef">→ {h.hedef}</span>}
          <span className="it-ak-zaman" title={tarihSaat(h.zaman)}>
            {goreceli(h.zaman)}
          </span>
        </span>
      </span>
    </button>
  );

  const akisKarti = (yan: boolean) => {
    const ogeler = akis ?? [];
    const gosterilen = akisTumu ? ogeler : ogeler.slice(0, yan ? 10 : 6);

    return (
      <div className={`it-kart it-akis${yan ? " yan" : " ust"}${!yan && !akisAcik ? " kapali" : ""}`}>
        <div
          className="it-kart-bas"
          onClick={yan ? undefined : () => setAkisAcik((a) => !a)}
          style={yan ? undefined : { cursor: "pointer" }}
        >
          <span className="it-kart-simge">
            <BellRing size={15} strokeWidth={2.2} />
          </span>
          <h3>Son bildirimler</h3>
          <span>{bugunAkis > 0 ? `bugün ${bugunAkis} hareket` : "kime ne gitti"}</span>
          {!yan && (
            <span className="it-sag">
              {!akisAcik && ogeler[0] && (
                <span className="it-ak-ozet">
                  <HareketSimge h={ogeler[0]} boyut={20} />
                  <b>{ogeler[0].adSoyad}</b> · {ogeler[0].baslik} · {goreceli(ogeler[0].zaman)}
                </span>
              )}
              <button type="button" className="it-dg kucuk hayalet">
                {akisAcik ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {akisAcik ? "Gizle" : "Göster"}
              </button>
            </span>
          )}
        </div>

        {(yan || akisAcik) && (
          <div className="it-ak-liste">
            {akis === null ? (
              <div className="it-bos">
                <Spin size="small" />
              </div>
            ) : ogeler.length === 0 ? (
              <div className="it-bos">
                <Inbox size={22} strokeWidth={1.6} />
                <div>Henüz bildirim hareketi yok.</div>
              </div>
            ) : (
              <>
                <div className="it-ak-izgara">
                  {gosterilen.map((h, i) => (
                    <AkisOge key={`${h.id ?? "s"}-${h.talepId}-${h.zaman}-${i}`} h={h} />
                  ))}
                </div>
                {ogeler.length > gosterilen.length || akisTumu ? (
                  <button type="button" className="it-ak-tumu" onClick={() => setAkisTumu((t) => !t)}>
                    {akisTumu ? "Daha az göster" : `Tümünü göster (${ogeler.length})`}
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ------------------------------------------------------- liste satırı */
  const satir = (k: any) => {
    const d = DURUM_ET[k.durum] ?? { renk: "gri", ad: k.durum };
    const n = dosyaSayisi(k);

    return (
      <div
        key={k.id}
        className={`it-satir${k.sirada ? " sirada" : ""}${detay?.id === k.id ? " secili" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          talebiAc(k);
        }}
      >
        <div className="it-s-kisi">
          <Avatar kod={k.personelKodu} ad={k.adSoyad} />
          <div>
            <b><PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi></b>
            <small>
              {k.gorev} · {k.subeAdi}
            </small>
          </div>
        </div>

        <div className="it-s-izin">
          <Et renk={turRenk(k.tur)} yok>
            {k.tur}
            {k.altTur ? ` · ${k.altTur}` : ""}
          </Et>
          {k.evrak?.formBekleniyor && k.durum === "Bekliyor" && (
            <span className="it-sirada-rozet" style={{ background: "#fff4e6", color: "#9a3412" }} title="Şube personeli: imzalı form yüklenmeden birim yöneticisi onaylayamaz">
              form bekleniyor
            </span>
          )}
          <div className="it-s-tarih">
            <CalendarDays size={13} strokeWidth={2} />
            {tarihAraligi(k.cikisTarihi, k.donusTarihi)}
          </div>
          <small>
            <b>{sureMetni(k)}</b> · talep {dayjs(k.olusturma).format("D MMM")}
          </small>
        </div>

        <div className="it-s-onay">
          <div className="it-s-durum">
            <Et renk={d.renk}>{d.ad}</Et>
            {k.sirada && (
              <span className="it-sirada-rozet" title="Onay sırası sizde">
                sırada
              </span>
            )}
          </div>
          <OnayIzi k={k} />
          {/* Sıra İK'da değilse kimde (09.10.2026) */}
          {(() => {
            const s = asamaDurumlari(k).find((x) => x.durum === "sirada");
            if (!s || s.alan === "ik") return null;
            const adlar = asamaAdlari(k, s.alan);
            return (
              <small className="it-sirada-kim" title={adlar.join(", ")}>
                Sırada: <b>{adlar.length ? adlar.join(", ") : `${s.ad} (kişi bulunamadı)`}</b>
              </small>
            );
          })()}
        </div>

        <div className="it-s-evrak">
          <EvrakIzi k={k} />
          <Tooltip title={n > 0 ? `${n} yüklenmiş dosya` : "Yüklenmiş dosya yok"}>
            <span className={`it-atac${n > 0 ? " var" : ""}`}>
              <Paperclip size={13} strokeWidth={2.2} />
              {n}
            </span>
          </Tooltip>
          {k.durum !== "Reddedildi" && (
            <EksikDugmesi tur="izin" talepId={k.id} e={eksik.harita[k.id]} yenile={eksik.yenile} yetkili={eksik.yetkili} />
          )}
        </div>

        <div className="it-s-islem">
          {k.sirada ? (
            <>
              <Button size="small" danger icon={<X size={13} strokeWidth={2.4} />} onClick={() => karar(k, false)}>
                Reddet
              </Button>
              <Button size="small" type="primary" icon={<Check size={13} strokeWidth={2.4} />} onClick={() => karar(k, true)}>
                Onayla
              </Button>
            </>
          ) : (
            <ChevronRight size={16} className="it-ok" />
          )}
        </div>
      </div>
    );
  };

  const GORUNUMLER: { deger: Gorunum; ad: string; sayi: number }[] = [
    { deger: "sirada", ad: "Sıradakiler", sayi: sayilar.sirada },
    { deger: "evrak", ad: "Evrak bekleyenler", sayi: sayilar.evrak },
    { deger: "surecte", ad: "Süreçte", sayi: sayilar.surecte },
  ];

  const bekleyenItiraz = itirazlar.filter((x) => x.durum === "Bekliyor").length;

  return (
    <div className="it">
      {turAcik && <IzinTurleri kapat={() => setTurAcik(false)} />}

      {belgeliOnay && (
        <BelgeliOnay
          kayit={belgeliOnay}
          kapat={() => setBelgeliOnay(null)}
          tamam={() => {
            setGecmisler((g) => ({ ...g, [belgeliOnay.id]: undefined as any }));
            setBelgeliOnay(null);
            setDetay(null);
            getir();
          }}
        />
      )}

      {/* ------------------------------------------------------- başlık */}
      <div className="it-baslik">
        <div>
          <h1>Personel Talepleri</h1>
          <p>
            {sekme === "denklestirme"
              ? "Denkleştirme: fazla çalışma ×1,5 alacak, erken çıkış / geç geliş borç, denkleştirme izni. Personel imzalı formu yükler, yönetici ve İK onaylar."
              : sekme === "devamsizlik"
              ? "Birim yöneticilerinin Biçen360'tan girdiği devamsızlıklar: eşiği aşanlar, personele bildirim ve SMS, notlar."
              : sekme === "avans"
              ? "Personelin uygulamadan gönderdiği avans talepleri: tutar, taksit ve ilk kesinti ayı İK onayında değiştirilebilir."
              : sekme === "rotasyon"
              ? "Şube değişikliği (rotasyon) talepleri: yönetici Biçen360'tan açar, personel yalnızca görür; yönetici isteğinde bölge müdürü, sonra İK onaylar."
              : "Personelin uygulamadan gönderdiği izinler, üç aşamalı onay (birim yöneticisi → bölge müdürü → İK), yüklenen evraklar ve gönderilen bildirimler."}
          </p>
        </div>
        {sekme === "izin" && (
          <div className="it-baslik-sag">
            <button type="button" className="it-dg" onClick={() => setTurAcik(true)}>
              <Settings2 size={15} strokeWidth={2} />
              İzin türleri
            </button>
            <button type="button" className="it-dg" onClick={getir} disabled={yukleniyor}>
              <RefreshCw size={15} strokeWidth={2} className={yukleniyor ? "it-don" : undefined} />
              Yenile
            </button>
          </div>
        )}
      </div>

      <div className="it-sekmeler">
        <button type="button" className={sekme === "izin" ? "aktif" : ""} onClick={() => setSekme("izin")}>
          Yıllık izin
          {sayilar.sirada > 0 && <span className="it-rozet">{sayilar.sirada}</span>}
        </button>
        <button type="button" className={sekme === "avans" ? "aktif" : ""} onClick={() => setSekme("avans")}>
          Avans
          {avansBekleyen > 0 && <span className="it-rozet">{avansBekleyen}</span>}
        </button>
        <button type="button" className={sekme === "fazlamesai" ? "aktif" : ""} onClick={() => setSekme("fazlamesai")}>
          Fazla mesai
          {fmBekleyen > 0 && <span className="it-rozet">{fmBekleyen}</span>}
        </button>
        <button type="button" className={sekme === "denklestirme" ? "aktif" : ""} onClick={() => setSekme("denklestirme")}>
          Denkleştirme
          {denkBekleyen > 0 && <span className="it-rozet">{denkBekleyen}</span>}
        </button>
        <button type="button" className={sekme === "rotasyon" ? "aktif" : ""} onClick={() => setSekme("rotasyon")}>
          Rotasyon
          {rotBekleyen > 0 && <span className="it-rozet">{rotBekleyen}</span>}
        </button>
        <button type="button" className={sekme === "itiraz" ? "aktif" : ""} onClick={() => setSekme("itiraz")}>
          Manuel giriş-çıkış
          {bekleyenItiraz > 0 && <span className="it-rozet">{bekleyenItiraz}</span>}
        </button>
        <button type="button" className={sekme === "devamsizlik" ? "aktif" : ""} onClick={() => setSekme("devamsizlik")}>
          Devamsızlık
          {devBekleyen > 0 && <span className="it-rozet">{devBekleyen}</span>}
        </button>
      </div>

      {/* Uzman süzgecinin kapsamı: İK uzmanı önce kendi şubelerini görür */}
      {veri?.kapsam?.aktif && (
        <div className="it-kapsam">
          <b>{veri.kapsam.subeler.length} şube</b> gösteriliyor
          {uzman ? " (sizin ve seçtiğiniz uzmanların şubeleri)" : " (size tanımlı şubeler)"}:{" "}
          <span>{veri.kapsam.subeler.slice(0, 8).join(", ")}{veri.kapsam.subeler.length > 8 ? ` +${veri.kapsam.subeler.length - 8}` : ""}</span>
          <small> · Diğer uzmanların personelini görmek için üstteki "Diğer uzmanlar" seçicisini kullanın.</small>
        </div>
      )}

      {sekme === "denklestirme" ? (
        <DenklestirmeTalepleri sayacDegisti={setDenkBekleyen} />
      ) : sekme === "devamsizlik" ? (
        <DevamsizlikTakibi sayacDegisti={setDevBekleyen} />
      ) : sekme === "avans" ? (
        <AvansTalepleri sayacDegisti={setAvansBekleyen} />
      ) : sekme === "fazlamesai" ? (
        <FazlaMesaiTalepleri sayacDegisti={setFmBekleyen} />
      ) : sekme === "rotasyon" ? (
        <RotasyonTalepleri sayacDegisti={setRotBekleyen} />
      ) : sekme === "itiraz" ? (
        <ManuelGirisTalepleri
          kayitlar={itirazlar}
          yukleniyor={itirazYukleniyor}
          yenile={itirazGetir}
          kararVer={itirazKarar}
          eksik={itirazEksik}
          aralik={itirazAralik}
          aralikDegisti={setItirazAralik}
        />
      ) : (
        <>
          {/* ------------------------------------------------------- KPI */}
          <div className="it-kpiler">
            {kpiler.map((x) => {
              const S = x.simge;
              return (
                <button
                  key={x.anahtar}
                  type="button"
                  className={`it-kpi it-kpi-${x.renk}${x.secili ? " secili" : ""}`}
                  onClick={x.git}
                >
                  <span className="it-kpi-ust">
                    <span className="et">{x.et}</span>
                    <span className={`it-kpi-simge it-hs-${x.renk}`}>
                      <S size={16} strokeWidth={2.2} />
                    </span>
                  </span>
                  <span className="d">{x.d}</span>
                  <span className="alt">{x.alt}</span>
                </button>
              );
            })}
          </div>

          <div className="it-ana">
            {/* Dar ekranda bildirim akışı listenin üstünde, açılır kapanır */}
            <div className="it-akis-ust-kap">{akisKarti(false)}</div>

            <div className="it-kart it-liste-kart">
              {/* --------------------------------------------- araç çubuğu */}
              <div className="it-arac">
                <div className="it-seg">
                  {GORUNUMLER.map((g) => (
                    <button
                      key={g.deger}
                      type="button"
                      className={gorunum === g.deger ? "aktif" : ""}
                      onClick={() => {
                        setGorunum(g.deger);
                        if (g.deger !== "sonuclanan") setBuAyKarar(false);
                      }}
                    >
                      {g.ad}
                      <span className="s">{g.sayi}</span>
                    </button>
                  ))}
                </div>

                {(gorunum === "sirada" || gorunum === "surecte") &&
                  asamaSayilari.ik + asamaSayilari.bolge + asamaSayilari.birim > 0 && (
                    <div className="it-seg ikincil">
                      <button type="button" className={asamaSec === "hepsi" ? "aktif" : ""} onClick={() => setAsamaSec("hepsi")}>
                        Hepsi
                      </button>
                      {ASAMA_GRUBU.filter((g) => asamaSayilari[g.k] > 0).map((g) => (
                        <button
                          key={g.k}
                          type="button"
                          title={g.alt}
                          className={asamaSec === g.k ? "aktif" : ""}
                          onClick={() => setAsamaSec(g.k)}
                        >
                          {g.ad}
                          <span className="s">{asamaSayilari[g.k]}</span>
                        </button>
                      ))}
                    </div>
                  )}

                {gorunum === "sonuclanan" && (
                  <div className="it-seg ikincil">
                    {(
                      [
                        ["hepsi", "Hepsi"],
                        ["Onaylandı", "Onaylanan"],
                        ["Reddedildi", "Reddedilen"],
                      ] as const
                    ).map(([v, ad]) => (
                      <button
                        key={v}
                        type="button"
                        className={`${sonuc === v ? "aktif" : ""} ${v === "Onaylandı" ? "y" : v === "Reddedildi" ? "k" : ""}`}
                        onClick={() => setSonuc(v)}
                      >
                        {ad}
                      </button>
                    ))}
                    {/* 13.10.2026: sonuçlananlar listede gizli; karttan açılıyor */}
                    <button
                      type="button"
                      title="Sıradakilere dön"
                      onClick={() => {
                        setGorunum("sirada");
                        setBuAyKarar(false);
                      }}
                    >
                      × Kapat
                    </button>
                  </div>
                )}
              </div>

              <div className="it-arac it-arac2">
                <label className="it-ara">
                  <Search size={15} strokeWidth={2} />
                  <input
                    value={arama}
                    placeholder="Ad soyad, sicil, şube ya da görev"
                    onChange={(e) => setArama(e.target.value)}
                  />
                  {arama && (
                    <button type="button" onClick={() => setArama("")} aria-label="Temizle">
                      <X size={13} />
                    </button>
                  )}
                </label>

                <Select
                  allowClear
                  placeholder="İzin türü"
                  value={turSecim ?? undefined}
                  onChange={(v) => setTurSecim(v ?? null)}
                  options={turler.map((t) => ({ value: t, label: t }))}
                  style={{ width: 170 }}
                />

                <RangePicker
                  value={aralik as any}
                  onChange={(v) => setAralik(v && v[0] && v[1] ? [v[0], v[1]] : null)}
                  format="DD.MM.YYYY"
                  placeholder={["İzin başı", "İzin sonu"]}
                  allowClear
                  style={{ width: 250 }}
                  presets={[
                    { label: "Bu ay", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
                    {
                      label: "Geçen ay",
                      value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")],
                    },
                    { label: "Son 3 ay", value: [dayjs().subtract(3, "month").startOf("day"), dayjs().endOf("day")] },
                    { label: "Bu yıl", value: [dayjs().startOf("year"), dayjs().endOf("year")] },
                  ]}
                />

                {buAyKarar && (
                  <span className="it-suzgec-et">
                    Bu ay karar verilenler
                    <button type="button" onClick={() => setBuAyKarar(false)} aria-label="Kaldır">
                      <X size={12} />
                    </button>
                  </span>
                )}

                {suzgecVar && (
                  <button type="button" className="it-dg kucuk hayalet" onClick={suzgecleriTemizle}>
                    Süzgeçleri temizle
                  </button>
                )}

                <span className="it-bosluk" />
                <span className="it-sayac">
                  <b>{liste.length}</b> talep
                </span>
              </div>

              {/* ------------------------------------------------ liste */}
              {yukleniyor && !veri ? (
                <div className="it-bos" style={{ padding: 50 }}>
                  <Spin />
                </div>
              ) : liste.length === 0 ? (
                <div className="it-bos" style={{ padding: "46px 20px" }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      gorunum === "sirada" && !suzgecVar
                        ? "Onayınızı bekleyen talep yok."
                        : gorunum === "evrak" && !suzgecVar
                        ? "Evrak bekleyen talep yok."
                        : "Bu süzgeçlerle talep bulunamadı."
                    }
                  />
                </div>
              ) : (
                <div className={`it-liste${islemVar ? " islemli" : ""}`}>
                  <div className="it-satir it-satir-bas">
                    <div>Personel</div>
                    <div>İzin</div>
                    <div>Onay akışı</div>
                    <div>
                      <Tooltip title="P: personelin yüklediği imzalı evrak · A: aslı İK'ya gönderildi · İK: ıslak imzalı evrak yüklendi · ataş: yüklenmiş dosya sayısı">
                        Evrak
                      </Tooltip>
                    </div>
                    <div />
                  </div>
                  {gorunum === "sirada" || gorunum === "surecte"
                    ? sayfadakiler.map((k, i) => {
                        const g = asamaGrubu(k);
                        const once = i > 0 ? asamaGrubu(sayfadakiler[i - 1]) : null;
                        const tanim = ASAMA_GRUBU.find((x) => x.k === g);
                        return (
                          <Fragment key={k.id}>
                            {tanim && g !== once && (
                              <div className={`it-grup-bas it-grup-${g}`}>
                                <b>{tanim.ad}</b>
                                <span>{tanim.alt}</span>
                                <em>{asamaSayilari[tanim.k]}</em>
                              </div>
                            )}
                            {satir(k)}
                          </Fragment>
                        );
                      })
                    : sayfadakiler.map(satir)}
                </div>
              )}

              {liste.length > SAYFA_BOYU && (
                <div className="it-sayfala">
                  <Pagination
                    size="small"
                    current={sayfa}
                    pageSize={SAYFA_BOYU}
                    total={liste.length}
                    showSizeChanger={false}
                    onChange={setSayfa}
                  />
                </div>
              )}
            </div>

            <div className="it-akis-yan-kap">{akisKarti(true)}</div>
          </div>

          {/* ------------------------------------------------------- detay */}
          <Drawer
            open={!!detay}
            onClose={() => setDetay(null)}
            width="min(740px, 100vw)"
            closable={false}
            title={null}
            rootClassName="it-cekmece"
            styles={{ body: { padding: 0 }, mask: { background: "rgba(18,26,12,.38)" } }}
          >
            {detay && (
              <TalepDetay
                k={detay}
                sekme={detaySekme}
                setSekme={setDetaySekme}
                gecmis={gecmisler[detay.id]}
                gecmisYenile={() => gecmisGetir(detay.id, true)}
                islemde={islemde}
                kapat={() => setDetay(null)}
                karar={(onay) => karar(detay, onay)}
                yukle={() => setBelgeliOnay({ ...detay, yalnizYukle: true })}
                formGonderildi={(adres) => {
                  getir();
                  gecmisGetir(detay.id, true);
                  setDetay({ ...detay, formEposta: adres, formGonderim: new Date().toISOString(), formHata: null });
                }}
                digerAc={(id) => kimlikleAc(id)}
                eksikDugme={
                  detay.durum !== "Reddedildi" ? (
                    <EksikDugmesi
                      tur="izin"
                      talepId={detay.id}
                      e={eksik.harita[detay.id]}
                      yenile={() => {
                        eksik.yenile();
                        gecmisGetir(detay.id, true);
                      }}
                      yetkili={eksik.yetkili}
                      buyuk
                    />
                  ) : null
                }
              />
            )}
          </Drawer>
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Talep çekmecesi                                                            */
/* ========================================================================== */

function TalepDetay({
  k,
  sekme,
  setSekme,
  gecmis,
  gecmisYenile,
  islemde,
  kapat,
  karar,
  yukle,
  formGonderildi,
  digerAc,
  eksikDugme,
}: {
  k: any;
  sekme: DetaySekme;
  setSekme: (s: DetaySekme) => void;
  gecmis: Gecmis | "yukleniyor" | "hata" | undefined;
  gecmisYenile: () => void;
  islemde: boolean;
  kapat: () => void;
  karar: (onay: boolean) => void;
  yukle: () => void;
  formGonderildi: (adres: string) => void;
  digerAc: (id: number) => void;
  eksikDugme?: ReactNode;
}) {
  const { message } = AntdApp.useApp();
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const d = DURUM_ET[k.durum] ?? { renk: "gri", ad: k.durum };
  const dosyalar = dosyalariTopla(k);
  const g = typeof gecmis === "object" && gecmis ? gecmis : null;
  const asama = asamaDurumlari(k).find((x) => x.durum === "sirada");

  const ac = (yol: string) => sekmedeAc(yol).catch((h: any) => message.error(h.message));

  const formGonder = async () => {
    setGonderiliyor(true);

    try {
      const c = await api.gonder<any>(`/api/IzinTalep/${k.id}/FormGonder`);
      message.success(`Form ${c.adres} adresine gönderildi.`);
      formGonderildi(c.adres);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const SEKMELER: { deger: DetaySekme; ad: string; sayi?: number | null }[] = [
    { deger: "ozet", ad: "Özet & Onay" },
    { deger: "evrak", ad: "Evraklar", sayi: dosyalar.length - 1 },
    { deger: "gecmis", ad: "Geçmiş & Bildirimler", sayi: g ? g.hareketler.length : null },
    { deger: "onceki", ad: "Önceki talepleri", sayi: g ? g.digerTalepler.length : null },
  ];

  return (
    <div className="it-ck">
      {/* ------------------------------------------------------- başlık */}
      <div className="it-ck-bas">
        <Avatar kod={k.personelKodu} ad={k.adSoyad} boyut={48} />
        <div className="it-ck-kim">
          <h2><PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi></h2>
          <small>
            {k.gorev} · {k.subeAdi}
            {k.personelKodu ? ` · sicil ${k.personelKodu}` : ""}
          </small>
          <div className="it-ck-etler">
            <Et renk={turRenk(k.tur)} yok>
              {k.tur}
              {k.altTur ? ` · ${k.altTur}` : ""}
            </Et>
            <Et renk={d.renk}>{d.ad}</Et>
            {k.evrak?.formBekleniyor && k.durum === "Bekliyor" && (
              <span className="it-sirada-rozet" style={{ background: "#fff4e6", color: "#9a3412" }}>
                imzalı form bekleniyor
              </span>
            )}
            {k.sirada && <span className="it-sirada-rozet">sırada</span>}
            {eksikDugme}
          </div>
        </div>
        <button type="button" className="it-dg hayalet it-kapat" onClick={kapat} aria-label="Kapat">
          <X size={18} />
        </button>
      </div>

      <div className="it-ck-ozet">
        <div>
          <span>İzin</span>
          <b>{tarihAraligi(k.cikisTarihi, k.donusTarihi)}</b>
        </div>
        <div>
          <span>{k.baslangicSaat ? "Saat" : "Süre"}</span>
          <b>{sureMetni(k)}</b>
        </div>
        <div>
          <span>Talep</span>
          <b>
            #{k.id} · {dayjs(k.olusturma).format("D MMM HH:mm")}
          </b>
        </div>
        <div>
          <span>Akış</span>
          <b>{akisOzeti(k)}</b>
        </div>
      </div>

      {k.sirada && (
        <div className="it-ck-karar">
          <div>
            <b>Onay sırası sizde</b>
            <span>
              {asama ? `${asama.ad} aşaması` : "Karar bekleniyor"}
              {k.sonOnay ? " · son onay: evrak isteğe bağlı" : ""}
            </span>
          </div>
          <Space size={8}>
            <Button danger loading={islemde} icon={<X size={14} strokeWidth={2.4} />} onClick={() => karar(false)}>
              Reddet
            </Button>
            <Button type="primary" loading={islemde} icon={<Check size={14} strokeWidth={2.4} />} onClick={() => karar(true)}>
              {k.sonOnay ? "Onayla…" : "Onayla"}
            </Button>
          </Space>
        </div>
      )}

      <div className="it-ck-sekmeler">
        {SEKMELER.map((s) => (
          <button key={s.deger} type="button" className={sekme === s.deger ? "aktif" : ""} onClick={() => setSekme(s.deger)}>
            {s.ad}
            {s.sayi != null && s.sayi > 0 && <span className="s">{s.sayi}</span>}
          </button>
        ))}
      </div>

      <div className="it-ck-ic">
        {sekme === "ozet" && (
          <>
            <div className="it-ck-bolum">
              <h4>Talep bilgileri</h4>
              <div className="it-bilgi">
                <div>
                  <span>Görev</span>
                  <b>{k.gorev || "—"}</b>
                </div>
                <div>
                  <span>Şube</span>
                  <b>{k.subeAdi || "—"}</b>
                </div>
                <div>
                  <span>İzin türü</span>
                  <b>
                    {k.tur}
                    {k.altTur ? ` · ${k.altTur}` : ""}
                  </b>
                </div>
                <div>
                  <span>{k.baslangicSaat ? "Saat aralığı" : "Süre"}</span>
                  <b>{sureMetni(k)}</b>
                </div>
                <div>
                  <span>İzine çıkış</span>
                  <b>{dayjs(k.cikisTarihi).format("DD.MM.YYYY dddd")}</b>
                </div>
                {!k.baslangicSaat && (
                  <div>
                    <span>Son izin günü</span>
                    <b>{dayjs(k.donusTarihi).format("DD.MM.YYYY dddd")}</b>
                  </div>
                )}
                <div>
                  <span>Yerine bakacak kişi</span>
                  <b>{k.yerineAd || "—"}</b>
                </div>
                <div>
                  <span>Talep tarihi</span>
                  <b>{tarihSaat(k.olusturma)}</b>
                </div>
              </div>

              {k.aciklama && (
                <div className="it-aciklama">
                  <span>Personelin açıklaması</span>
                  <p>{k.aciklama}</p>
                </div>
              )}
            </div>

            <div className="it-ck-bolum">
              <h4>Onay akışı</h4>
              <div className="it-akis-adim">
                {asamaDurumlari(k).map((a, i) => (
                  <div key={a.alan} className={`it-aa ${a.durum}`}>
                    <div className="it-aa-ust">
                      <span className="it-aa-n">
                        {a.durum === "tamam" ? (
                          <Check size={13} strokeWidth={3} />
                        ) : a.durum === "red" ? (
                          <X size={13} strokeWidth={3} />
                        ) : a.durum === "atlandi" ? (
                          <SkipForward size={12} strokeWidth={2.4} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <b>{a.ad}</b>
                    </div>
                    <div className="it-aa-durum">
                      {a.durum === "tamam"
                        ? "Onayladı"
                        : a.durum === "red"
                        ? "Reddetti"
                        : a.durum === "atlandi"
                        ? "Aşama atlandı"
                        : a.durum === "sirada"
                        ? "Karar bekleniyor"
                        : "Sırası gelmedi"}
                    </div>
                    {a.kisi && <div className="it-aa-kisi">{a.kisi}</div>}
                    {/* 09.10.2026: karar bekleyen aşamada onaylayacak kişiler */}
                    {!a.kisi && (a.durum === "sirada" || a.durum === "bekliyor") && (() => {
                      if (a.alan === "ik") return <div className="it-aa-kisi">İnsan Kaynakları uzmanı</div>;
                      const adlar = asamaAdlari(k, a.alan);
                      if (adlar.length > 0)
                        return (
                          <div className="it-aa-kisi" title={adlar.join(", ")}>
                            {a.durum === "sirada" ? "Bekleyen: " : "Onaylayacak: "}
                            {adlar.join(", ")}
                          </div>
                        );
                      /* Liste yüklendi ama kimse yok: talep bu aşamada takılır */
                      return k.onaylayicilar && a.durum === "sirada" ? (
                        <div className="it-aa-kisi" style={{ color: "#b42318" }}>
                          Onaylayacak kişi bulunamadı · onay tablosunu kontrol edin
                        </div>
                      ) : null;
                    })()}
                    {a.tarih && <div className="it-aa-tarih">{tarihSaat(a.tarih)}</div>}
                    {a.not && <div className="it-aa-not">“{a.not}”</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="it-ck-bolum">
              <h4>İzin formu</h4>
              <div className="it-form-kutu">
                <span className={`it-hs it-hs-${k.formHata && !k.formGonderim ? "kirmizi" : k.formGonderim ? "turuncu" : "gri"}`} style={{ width: 34, height: 34 }}>
                  <Mail size={16} strokeWidth={2.2} />
                </span>
                <div className="it-form-ic">
                  {k.formGonderim ? (
                    <>
                      <b>{k.formEposta}</b> adresine gönderildi
                      <small>{tarihSaat(k.formGonderim)}</small>
                      {k.formHata ? <small className="it-uyari-yazi">{k.formHata}</small> : null}
                    </>
                  ) : k.formHata ? (
                    <>
                      <b className="it-kirmizi-yazi">Gönderilemedi</b>
                      <small>
                        {k.formEposta}: {k.formHata}
                      </small>
                    </>
                  ) : (
                    <>
                      <b>Henüz gönderilmedi</b>
                      <small>Form talep açılınca şubeye ya da İK'ya e-postayla gider.</small>
                    </>
                  )}
                </div>
                <Space size={6} wrap>
                  <Button
                    size="small"
                    icon={<Printer size={13} />}
                    onClick={() => sekmedeAc(`/api/IzinTalep/${k.id}/Form`).catch((h: any) => message.error(h.message))}
                  >
                    Formu aç
                  </Button>
                  <Button size="small" icon={<Send size={13} />} loading={gonderiliyor} onClick={formGonder}>
                    Tekrar gönder
                  </Button>
                </Space>
              </div>
            </div>

            {g && g.hareketler.length > 0 && (
              <div className="it-ck-bolum">
                <h4>
                  Son hareketler
                  <button type="button" className="it-baglanti" onClick={() => setSekme("gecmis")}>
                    tümünü gör →
                  </button>
                </h4>
                <div className="it-mini-gecmis">
                  {[...g.hareketler]
                    .reverse()
                    .slice(0, 3)
                    .map((h, i) => (
                      <div key={i} className="it-mg">
                        <HareketSimge h={h} boyut={24} />
                        <span>
                          <b>{h.baslik}</b>
                          {h.hedef ? <> → {h.hedef}</> : null}
                        </span>
                        <small>{goreceli(h.zaman)}</small>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}

        {sekme === "evrak" && (
          <>
            <EvrakKarti k={k} yukle={yukle} onayla={k.sonOnay ? () => karar(true) : null} />

            <div className="it-ck-bolum">
              <h4>Bütün dosyalar</h4>
              <div className="it-dosyalar">
                {dosyalar.map((f) => (
                  <button key={f.anahtar} type="button" className="it-dosya" onClick={() => ac(f.yol)}>
                    <DosyaSimge ad={f.dosyaAdi ?? f.alt} />
                    <span className="it-dosya-ic">
                      <b>{f.ad}</b>
                      <small className="it-dosya-ad">{f.alt || (f.kalem ? KALEM_AD[f.kalem] : "")}</small>
                      <span className="it-dosya-alt">
                        <Et renk={f.kim === "İK" ? "mor" : f.kim === "Personel" ? "yesil" : "gri"}>{f.kim}</Et>
                        <small title={[f.kimAd, f.zaman && tarihSaat(f.zaman)].filter(Boolean).join(" · ")}>
                          {[f.kim !== "Sistem" ? f.kimAd : null, f.zaman ? dayjs(f.zaman).format("DD.MM.YYYY HH:mm") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </span>
                    <span className="it-dosya-ac">
                      <ExternalLink size={14} strokeWidth={2.2} />
                      Aç
                    </span>
                  </button>
                ))}
              </div>
              {dosyalar.length <= 1 && (
                <div className="it-not">
                  Henüz yüklenmiş dosya yok. Personel imzalı formu uygulamadan yükler; İK ıslak imzalı evrakı buradan
                  yükler.
                </div>
              )}
            </div>
          </>
        )}

        {sekme === "gecmis" && <GecmisSekmesi gecmis={gecmis} yenile={gecmisYenile} ac={ac} talepId={k.id} />}

        {sekme === "onceki" && (
          <div className="it-ck-bolum">
            <h4>Bu personelin geçmiş talepleri</h4>
            {!g ? (
              gecmis === "hata" ? (
                <Alert type="warning" showIcon message="Geçmiş talepler alınamadı." />
              ) : (
                <div className="it-bos">
                  <Spin size="small" />
                </div>
              )
            ) : g.digerTalepler.length === 0 ? (
              <div className="it-bos">
                <Inbox size={22} strokeWidth={1.6} />
                <div>Bu personelin başka izin talebi yok.</div>
              </div>
            ) : (
              <>
                <div className="it-onceki-ozet">
                  {(() => {
                    const onay = g.digerTalepler.filter((x) => x.durum === "Onaylandı");
                    const toplam = onay.reduce((t, x) => t + (Number(x.gun) || 0), 0);
                    return (
                      <>
                        <span>
                          <b>{g.digerTalepler.length}</b> talep
                        </span>
                        <span>
                          <b>{onay.length}</b> onaylı · <b>{gun(toplam)}</b> gün
                        </span>
                        <span>
                          <b>{g.digerTalepler.filter((x) => x.durum === "Reddedildi").length}</b> reddedilen
                        </span>
                      </>
                    );
                  })()}
                </div>
                <div className="it-onceki">
                  {g.digerTalepler.map((x) => {
                    const dd = DURUM_ET[x.durum] ?? { renk: "gri", ad: x.durum };
                    return (
                      <button key={x.id} type="button" className="it-onceki-oge" onClick={() => digerAc(x.id)}>
                        <span className="it-onceki-tarih">
                          <b>{dayjs(x.cikis).format("D MMM")}</b>
                          <small>{dayjs(x.cikis).format("YYYY")}</small>
                        </span>
                        <span className="it-onceki-ic">
                          <Et renk={turRenk(x.tur)} yok>
                            {x.tur}
                          </Et>
                          <small>
                            {tarihAraligi(x.cikis, x.donus)} · {sureMetni(x)}
                          </small>
                        </span>
                        <Et renk={dd.renk}>{dd.ad}</Et>
                        <ChevronRight size={15} className="it-ok" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Geçmiş ve bildirimler                                                      */
/* ========================================================================== */

const GECMIS_SUZGEC: { deger: string; ad: string; turler: string[] | null }[] = [
  { deger: "hepsi", ad: "Hepsi", turler: null },
  { deger: "karar", ad: "Kararlar", turler: ["olusturma", "karar", "iptal"] },
  { deger: "bildirim", ad: "Bildirimler", turler: ["bildirim", "hatirlatma", "form"] },
  { deger: "evrak", ad: "Evrak", turler: ["evrak", "asil"] },
];

function GecmisSekmesi({
  gecmis,
  yenile,
  ac,
  talepId,
}: {
  gecmis: Gecmis | "yukleniyor" | "hata" | undefined;
  yenile: () => void;
  ac: (yol: string) => void;
  talepId: number;
}) {
  const [suzgec, setSuzgec] = useState("hepsi");

  if (gecmis === "hata")
    return (
      <Alert
        type="warning"
        showIcon
        message="Geçmiş alınamadı."
        action={
          <Button size="small" onClick={yenile}>
            Tekrar dene
          </Button>
        }
      />
    );

  if (!gecmis || gecmis === "yukleniyor")
    return (
      <div className="it-bos" style={{ padding: 40 }}>
        <Spin />
      </div>
    );

  const tumu = gecmis.hareketler;
  const s = GECMIS_SUZGEC.find((x) => x.deger === suzgec);
  const gorunen = tumu.filter((h) => !s?.turler || s.turler.includes(h.tur));

  const bildirimSayisi = tumu.filter((h) => h.tur === "bildirim").length;
  const hatirlatmaSayisi = tumu.filter((h) => h.tur === "hatirlatma").length;
  const epostaSayisi = tumu.filter((h) => h.kanal === "eposta").length;

  /* En yeni üstte; gün değişiminde ara başlık */
  const sirali = [...gorunen].sort((a, b) => dayjs(b.zaman).valueOf() - dayjs(a.zaman).valueOf());
  const ogeler: { key: string; dot?: ReactNode; color?: string; children: ReactNode }[] = [];
  let sonGun = "";

  for (const [i, h] of sirali.entries()) {
    const g = dayjs(h.zaman).format("YYYY-MM-DD");

    if (g !== sonGun) {
      sonGun = g;
      ogeler.push({
        key: `g-${g}`,
        dot: <span className="it-tl-gun-nokta" />,
        children: (
          <div className="it-tl-gun">
            {dayjs(h.zaman).isSame(dayjs(), "day")
              ? "Bugün"
              : dayjs(h.zaman).isSame(dayjs().subtract(1, "day"), "day")
              ? "Dün"
              : dayjs(h.zaman).format("D MMMM YYYY, dddd")}
          </div>
        ),
      });
    }

    ogeler.push({
      key: `h-${h.id ?? "s"}-${i}`,
      dot: <HareketSimge h={h} boyut={30} />,
      children: (
        <div className={`it-tl ${h.tur}`}>
          <div className="it-tl-ust">
            <b>{h.baslik}</b>
            <span className="it-tl-saat" title={tarihSaat(h.zaman)}>
              {dayjs(h.zaman).format("HH:mm")}
            </span>
          </div>

          {(h.kisi || h.hedef || h.kanal) && (
            <div className="it-tl-meta">
              {h.kisi && (
                <span>
                  <span className="it-soluk">Yapan:</span> {h.kisi}
                </span>
              )}
              {h.hedef && (
                <span className="it-tl-hedef">
                  <span className="it-soluk">Alıcı:</span> {h.hedef}
                </span>
              )}
              <KanalEt kanal={h.kanal} />
            </div>
          )}

          {h.metin && <div className="it-tl-metin">{h.metin}</div>}

          {h.belgeId ? (
            <button
              type="button"
              className="it-baglanti"
              onClick={() => ac(`/api/IzinTalep/${talepId}/Evrak/${h.belgeId}`)}
            >
              <ExternalLink size={12} strokeWidth={2.2} /> Dosyayı aç
            </button>
          ) : null}
        </div>
      ),
    });
  }

  return (
    <div className="it-ck-bolum">
      <div className="it-gecmis-ust">
        <div className="it-seg kucuk">
          {GECMIS_SUZGEC.map((x) => (
            <button key={x.deger} type="button" className={suzgec === x.deger ? "aktif" : ""} onClick={() => setSuzgec(x.deger)}>
              {x.ad}
            </button>
          ))}
        </div>
        <span className="it-gecmis-sayi">
          <span>
            <BellRing size={13} /> <b>{bildirimSayisi}</b> bildirim
          </span>
          <span>
            <AlarmClock size={13} /> <b>{hatirlatmaSayisi}</b> hatırlatma
          </span>
          <span>
            <Mail size={13} /> <b>{epostaSayisi}</b> e-posta
          </span>
        </span>
      </div>

      {ogeler.length === 0 ? (
        <div className="it-bos">
          <Inbox size={22} strokeWidth={1.6} />
          <div>Bu türde hareket yok.</div>
        </div>
      ) : (
        <Timeline className="it-timeline" items={ogeler} />
      )}

      <div className="it-not">
        <FileCheck2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
        Hareket günlüğü devreye girmeden önceki olaylar talebin kayıtlarından (karar, form, evrak zamanları) kurulur;
        bu olaylarda alıcı ve kanal bilgisi eksik olabilir.
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Evrak kartı                                                                */
/* ========================================================================== */

/** Çekmecede evrak kartı: üç adım, dosyalar ve İK'nın işlemleri */
function EvrakKarti({ k, yukle, onayla }: { k: any; yukle: () => void; onayla: (() => void) | null }) {
  const { message } = AntdApp.useApp();
  const a = evrakAdimlari(k);

  if (!a)
    return (
      <div className="it-ck-bolum">
        <h4>Evrak adımları</h4>
        <div className="it-not">Reddedilen talepte evrak istenmez.</div>
      </div>
    );

  const e = a.e;
  const dosyalar = (kalem: string) => (e.dosyalar ?? []).filter((d: any) => d.kalem === kalem);

  const ac = (yol: string) => sekmedeAc(yol).catch((h: any) => message.error(h.message));

  const Dosya = ({ d }: { d: any }) => (
    <button type="button" className="it-baglanti" onClick={() => ac(`/api/IzinTalep/${k.id}/Evrak/${d.belgeId}`)}>
      <FileText size={12} style={{ marginRight: 2 }} />
      {d.tur || d.ozgunAd || "Dosya"}
    </button>
  );

  const adimlar = [
    {
      durum: a.personel,
      baslik: "Personel evrakı",
      alt:
        a.personel === "tamam"
          ? `Yüklendi · ${dayjs(e.personelYukleme ?? e.dosyalar?.[0]?.olusturma).format("DD.MM.YYYY HH:mm")}`
          : a.personel === "gecikti"
          ? `Süre doldu (${dayjs(e.son).format("DD.MM HH:mm")}) · yöneticisine bildirildi`
          : e.son
          ? `Bekleniyor · son gün ${dayjs(e.son).format("DD.MM.YYYY HH:mm")}`
          : "Bekleniyor",
      ic: (
        <div>
          {(e.gerekenler ?? []).map((g: any) => (
            <div key={g.kalem} className="it-gereken">
              <span className={g.yuklendi ? "tamam" : ""}>
                {g.yuklendi ? "✓" : "○"} {g.ad}
              </span>
              <div>
                {dosyalar(g.kalem).map((d: any) => (
                  <div key={d.id}>
                    <Dosya d={d} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      durum: a.asil,
      baslik: "Islak imzalı aslı",
      alt: e.asilGonderim
        ? `Personel gönderdiğini bildirdi · ${dayjs(e.asilGonderim).format("DD.MM.YYYY HH:mm")}`
        : "Personel henüz göndermedi",
      ic: null as ReactNode,
    },
    {
      durum: a.ik,
      baslik: "İnsan Kaynakları evrakı",
      alt: e.ikVar
        ? "Islak imzalı evrak yüklendi"
        : k.durum === "Onaylandı"
        ? "Talep onaylandı · evrak bekleniyor"
        : "Aslı gelince imzalayıp yükleyin",
      ic: (
        <div>
          {dosyalar("ik").map((d: any) => (
            <div key={d.id}>
              <Dosya d={d} />
            </div>
          ))}
          {!e.ikVar && k.belgeId ? (
            <button type="button" className="it-baglanti" onClick={() => ac(`/api/IzinTalep/${k.id}/Belge`)}>
              <FileText size={12} style={{ marginRight: 2 }} />
              {k.belgeTur ?? "Belge"}
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="it-ck-bolum">
      <h4>
        Evrak adımları
        <button type="button" className="it-baglanti" onClick={() => ac(`/api/IzinTalep/${k.id}/FormDosya`)}>
          Doldurulmuş formu aç
        </button>
      </h4>

      <div className="it-evrak-kart">
        {adimlar.map((x, i) => (
          <div key={i} className="it-ea">
            <div className="it-ea-sol">
              <span className={`it-ea-n ${x.durum}`}>
                {x.durum === "tamam" ? "✓" : x.durum === "gecikti" ? "!" : i + 1}
              </span>
              {i < adimlar.length - 1 && <span className="it-ea-cizgi" />}
            </div>
            <div className="it-ea-ic" style={{ paddingBottom: i < adimlar.length - 1 ? 14 : 0 }}>
              <b>{x.baslik}</b>
              <div className={`it-ea-alt${x.durum === "gecikti" ? " gecikti" : ""}`}>{x.alt}</div>
              {x.ic}
            </div>
          </div>
        ))}

        {k.durum !== "Reddedildi" && (onayla || !e.ikVar) && (
          <Space style={{ marginTop: 14 }} wrap>
            {onayla ? (
              <Button type="primary" onClick={onayla}>
                Onayla…
              </Button>
            ) : null}
            {!e.ikVar && (
              <Button icon={<UploadSimge size={14} />} onClick={yukle}>
                Islak imzalı evrakı yükle
              </Button>
            )}
          </Space>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Belge yükleyerek son onay                                                  */
/* ========================================================================== */

/**
 * Son onay: belge türü seçilip imzalı form ya da ilgili belge yüklenmeden
 * izin onaylanmıyor. Belge personelin belgelerine de (personele kapalı)
 * kaydoluyor. Talebe önceden belge yüklendiyse yeni dosya istenmez.
 */
function BelgeliOnay({ kayit, kapat, tamam }: { kayit: any; kapat: () => void; tamam: () => void }) {
  const { message } = AntdApp.useApp();

  const yalnizYukle = !!kayit.yalnizYukle;

  /* 13.10.2026: İK evrakı isteğe bağlı; "sonra" işaretlenirse talep
     "İK evrakı bekleniyor" listesine düşer */
  const [secim, setSecim] = useState<"yukle" | "sonra">("yukle");
  const [tur, setTur] = useState(BELGE_TURLERI[0]);
  const [dosya, setDosya] = useState<any>(null);
  const [not, setNot] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const a = evrakAdimlari(kayit);
  const e = a?.e;
  const varOlan = !!kayit.belgeId;
  const yukleniyor = yalnizYukle || secim === "yukle";
  const hazir = !yalnizYukle || !!dosya;

  const onayla = async () => {
    if (!hazir) {
      message.warning("Yüklenecek evrakı seçiniz.");
      return;
    }

    setIsleniyor(true);

    try {
      let belgeId: number | null = kayit.belgeId ?? null;

      if (yukleniyor && dosya) {
        const form = new FormData();
        form.append("tur", tur);
        form.append("dosya", dosya);

        const c = await api.dosyaGonder<any>(`/api/IzinTalep/${kayit.id}/Belge`, form);
        belgeId = c.belgeId;
      }

      if (yalnizYukle) {
        message.success("İK evrakı yüklendi.");
        tamam();
        return;
      }

      const d = await api.gonder<any>(`/api/IzinTalep/${kayit.id}/Karar`, {
        onay: true,
        not: not.trim(),
        belgeId: secim === "yukle" ? belgeId : null,
        evrakSonra: secim === "sonra",
      });

      message.success(
        d.durum === "Onaylandı"
          ? secim === "sonra"
            ? "Talep onaylandı; evrak bekleniyor olarak işaretlendi."
            : belgeId
            ? "Evrak yüklendi, talep onaylandı ve izin kaydı oluşturuldu."
            : "Talep onaylandı ve izin kaydı oluşturuldu."
          : "Onayınız kaydedildi."
      );
      tamam();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const SecimKutusu = ({ deger, baslik, alt, simge }: { deger: "yukle" | "sonra"; baslik: string; alt: string; simge: ReactNode }) => (
    <div className={`it-secim${secim === deger ? " secili" : ""}`} onClick={() => setSecim(deger)}>
      <span className="it-secim-simge">{simge}</span>
      <div>
        <div className="it-secim-bas">
          <span className="it-secim-radyo" />
          {baslik}
        </div>
        <div className="it-secim-alt">{alt}</div>
      </div>
    </div>
  );

  return (
    <Modal
      open
      width={620}
      className="it-modal"
      title={yalnizYukle ? "Islak imzalı evrakı yükle" : "Talebi onayla"}
      onCancel={kapat}
      okText={yalnizYukle ? "Yükle" : secim === "sonra" ? "Onayla · evrak sonra" : dosya ? "Yükle ve onayla" : "Onayla"}
      cancelText="Vazgeç"
      okButtonProps={{ disabled: !hazir, loading: isleniyor }}
      onOk={onayla}
    >
      <div className="it-mo-kisi">
        <Avatar kod={kayit.personelKodu} ad={kayit.adSoyad} boyut={38} />
        <div>
          <b><PersonelAdi kod={kayit.personelKodu}>{kayit.adSoyad}</PersonelAdi></b>
          <small>
            {kayit.tur} · {tarihAraligi(kayit.cikisTarihi, kayit.donusTarihi)} · {sureMetni(kayit)}
          </small>
        </div>
      </div>

      {e && (
        <div className="it-mo-evrak">
          <div>
            <b className={e.personelTamam ? "tamam" : "eksik"}>{e.personelTamam ? "✓" : "○"}</b> Personel evrakı{" "}
            {e.personelTamam ? "yüklendi" : e.gecikti ? "· süre doldu, yüklenmedi" : "· henüz yüklenmedi"}
          </div>
          <div>
            <b className={e.asilGonderim ? "tamam" : ""}>{e.asilGonderim ? "✓" : "○"}</b> Aslı{" "}
            {e.asilGonderim ? `gönderildi · ${dayjs(e.asilGonderim).format("DD.MM.YYYY")}` : "henüz gönderilmedi"}
          </div>
        </div>
      )}

      {!yalnizYukle && (
        <div className="it-secimler">
          <SecimKutusu
            deger="yukle"
            baslik="Onayla (evrak isteğe bağlı)"
            alt="Evrak elinizdeyse aşağıdan ekleyin; eklemeden de onaylayabilirsiniz."
            simge={<UploadSimge size={16} />}
          />
          <SecimKutusu
            deger="sonra"
            baslik="Onayla, evrak beklensin"
            alt={"Aslı gelince yüklemek istiyorsanız. Talep “İK evrakı bekleniyor” listesinde kalır."}
            simge={<Clock size={16} />}
          />
        </div>
      )}

      {yukleniyor && (
        <>
          {varOlan && !yalnizYukle && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Talepte yüklü İK evrakı var: ${kayit.belgeTur ?? "Belge"}`}
              description="Yeni dosya seçmezseniz bu evrakla onaylanır."
            />
          )}

          <div className="it-mo-etiket">Belge türü</div>
          <Select
            style={{ width: "100%", marginBottom: 12 }}
            value={tur}
            onChange={setTur}
            options={BELGE_TURLERI.map((x) => ({ value: x, label: x }))}
          />

          <Upload.Dragger
            multiple={false}
            maxCount={1}
            accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
            beforeUpload={(f: any) => {
              setDosya(f);
              return false;
            }}
            onRemove={() => setDosya(null)}
            fileList={dosya ? [{ uid: "1", name: dosya.name, status: "done" }] : []}
          >
            <p style={{ margin: "6px 0", color: "#5f8c10" }}>
              <UploadSimge size={22} />
            </p>
            <p style={{ margin: 0, fontSize: 13 }}>Dosyayı buraya sürükleyin ya da tıklayıp seçin {yalnizYukle ? "" : "(isteğe bağlı)"}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>Islak imzalı evrakın taraması ya da fotoğrafı</p>
          </Upload.Dragger>

          {/* Tarayıcıdaki evrakı doğrudan tarayıp ekler (07.10.2026) */}
          <div className="tarama-satir">
            <TaramaDugmesi boyut="small" ad="izin-evraki" onDosya={setDosya} />
            <span>Evrak tarayıcıdaysa taranıp PDF olarak eklenir.</span>
          </div>
        </>
      )}

      {!yalnizYukle && (
        <TextArea
          rows={2}
          placeholder="Açıklama (isteğe bağlı)"
          value={not}
          onChange={(e: any) => setNot(e.target.value)}
          style={{ marginTop: 12 }}
        />
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* İzin türleri                                                               */
/* ========================================================================== */

/**
 * İzin türlerinin tanımı: adı, bakiyeden düşüp düşmediği ve süre biçimi.
 *
 * Yarım gün ve saatlik izin eskiden yıllık izin talebinin içinde birer
 * seçenekti ve yıllık izin bakiyesinden düşüyordu. Artık kendi türleri;
 * bakiyeden düşmüyorlar. Personelin uygulamada göreceği liste burasıdır.
 */
export function IzinTurleri({ kapat }: { kapat: () => void }) {
  const { message } = AntdApp.useApp();

  const [turler, setTurler] = useState<any[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [duzenlenen, setDuzenlenen] = useState<any>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<any>("/api/IzinTuru");
      setTurler(c.turler ?? []);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async () => {
    try {
      await api.gonder("/api/IzinTuru", { id: 0, ...duzenlenen });
      message.success("Kaydedildi.");
      setDuzenlenen(null);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const SURE: Record<string, string> = {
    tam: "Tam gün",
    yarim: "Yarım gün",
    saat: "Saatlik",
  };

  return (
    <Modal open width={720} title="İzin türleri" onCancel={kapat} footer={null} className="it-modal">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Personelin uygulamada seçebileceği türler"
        description="Yalnızca 'bakiyeden düşer' işaretli türler yıllık izin bakiyesinden düşer. Yarım gün ve saatlik izin kendi türüdür; süre biçimi seçildiğinde talep ekranı buna göre saat ya da yarım gün sorar."
      />

      <Table
        rowKey="id"
        size="small"
        loading={yukleniyor}
        pagination={false}
        dataSource={turler}
        columns={[
          {
            title: "Tür",
            render: (_: unknown, t: any) => (
              <>
                <b style={{ opacity: t.aktif ? 1 : 0.5 }}>{t.ad}</b>
                {t.aciklama && <div style={{ fontSize: 11.5, color: "#6b7280" }}>{t.aciklama}</div>}
              </>
            ),
          },
          {
            title: "Süre biçimi",
            dataIndex: "sureTuru",
            width: 130,
            render: (d: string) => <Tag>{SURE[d] ?? d}</Tag>,
          },
          {
            title: "Bakiye",
            width: 160,
            render: (_: unknown, t: any) =>
              t.bakiyedenDuser ? <Tag color="orange">Yıllık izinden düşer</Tag> : <Tag color="green">Bakiyeden düşmez</Tag>,
          },
          {
            title: "Belge",
            width: 150,
            render: (_: unknown, t: any) =>
              t.belgeGerekli ? <Tag color="volcano">3 gün içinde istenir</Tag> : <Tag>İstenmez</Tag>,
          },
          {
            title: "Durum",
            dataIndex: "aktif",
            width: 90,
            render: (d: boolean) => (d ? <Tag color="green">Açık</Tag> : <Tag>Kapalı</Tag>),
          },
          {
            title: "",
            width: 90,
            render: (_: unknown, t: any) => (
              <Button size="small" onClick={() => setDuzenlenen(t)}>
                Düzenle
              </Button>
            ),
          },
        ]}
      />

      <Button
        type="dashed"
        block
        style={{ marginTop: 10 }}
        onClick={() => setDuzenlenen({ aktif: true, sureTuru: "tam", bakiyedenDuser: false, sira: 99 })}
      >
        ＋ İzin türü ekle
      </Button>

      <Modal
        open={!!duzenlenen}
        title={duzenlenen?.id ? "İzin türünü düzenle" : "Yeni izin türü"}
        okText="Kaydet"
        cancelText="Vazgeç"
        onCancel={() => setDuzenlenen(null)}
        onOk={kaydet}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="Ad — Ücretsiz İzin, Mazeret İzni…"
            value={duzenlenen?.ad}
            onChange={(e) => setDuzenlenen({ ...duzenlenen, ad: e.target.value })}
          />

          <Input
            placeholder="Açıklama (isteğe bağlı)"
            value={duzenlenen?.aciklama ?? ""}
            onChange={(e) => setDuzenlenen({ ...duzenlenen, aciklama: e.target.value })}
          />

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Süre biçimi</div>
            <Segmented
              value={duzenlenen?.sureTuru ?? "tam"}
              onChange={(v) => setDuzenlenen({ ...duzenlenen, sureTuru: String(v) })}
              options={[
                { value: "tam", label: "Tam gün" },
                { value: "yarim", label: "Yarım gün" },
                { value: "saat", label: "Saatlik" },
              ]}
            />
          </div>

          <Checkbox
            checked={!!duzenlenen?.bakiyedenDuser}
            onChange={(e) => setDuzenlenen({ ...duzenlenen, bakiyedenDuser: e.target.checked })}
          >
            Yıllık izin bakiyesinden düşer
          </Checkbox>

          <Checkbox
            checked={!!duzenlenen?.belgeGerekli}
            onChange={(e) => setDuzenlenen({ ...duzenlenen, belgeGerekli: e.target.checked })}
          >
            Onaylanınca personelden belge istenir (3 gün içinde uygulamadan yükler)
          </Checkbox>

          <Space>
            <Switch checked={duzenlenen?.aktif ?? true} onChange={(v) => setDuzenlenen({ ...duzenlenen, aktif: v })} />
            <span>{duzenlenen?.aktif === false ? "Kapalı — personel seçemez" : "Açık"}</span>
          </Space>
        </Space>
      </Modal>
    </Modal>
  );
}

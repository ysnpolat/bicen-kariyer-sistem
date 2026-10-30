/**
 * ---------------------------------------------------------------------------
 * Personeller
 * ---------------------------------------------------------------------------
 * Çalışan ve işten ayrılmış personel listesi. Veriler Mikro'dan
 * (MikroDesktop_2004BICEN) okunur. Personel kartındaki "Düzenle" ile
 * iletişim, görev ve adres bilgileri Mikro'ya, yol ücreti kariyer
 * sistemine yazılabilir (PersonelDuzenle.tsx, 02.10.2026).
 *
 * Görünüm onaylanan önizlemeden (personeller-onizleme.html, 02.10.2026):
 * özet kartları, süzgeç çubuğu, liste / kart görünümü ve sekmeli personel
 * kartı. Stiller Personeller.css içinde, "pl-" önekiyle.
 *
 * Durum 1 ise personel çalışıyor, diğer değerlerde işten ayrılmış sayılır ve
 * çıkış tarihi gösterilir.
 * ---------------------------------------------------------------------------
 */

import { OlcutBilgi, donemAyrinti } from "./perfOlcut";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Pagination,
  Popover,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import { tabloIndir } from "./raporExcel";
import {
  Accessibility,
  Star,
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bus,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  DoorOpen,
  Download,
  ExternalLink,
  FileText,
  FileWarning,
  HeartPulse,
  History,
  LayoutGrid,
  Link2,
  List,
  LogIn,
  LogOut,
  MessageSquare,
  Network,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Smartphone,
  SquarePen,
  Store,
  Trash2,
  TrendingUp,
  UserMinus,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";

import Tablo from "./Tablo";
import IsEmriAta from "./IsEmriAta";
import MaasSkala from "./MaasSkala";
import PersonelTakip from "./PersonelTakip";
import DonemselDegerlendirme from "./DonemselDegerlendirme";
import Organizasyon from "./Organizasyon";
import IzinOnaySureci from "./IzinOnaySureci";
import VardiyaPlanlari from "./VardiyaPlanlari";
import TopluVardiya from "./TopluVardiya";
import ResimYukle from "./ResimYukle";
import PersonelBelgeler from "./PersonelBelgeler";
import PersonelAvans from "./PersonelAvans";
import PersonelDegerlendirme from "./PersonelDegerlendirme";
import PersonelVardiya from "./PersonelVardiya";
import PersonelRaporlar from "./PersonelRaporlar";
import type { RaporDurumu } from "./PersonelRaporlar";
import {
  adminMi,
  api,
  fotografYukleme,
  oturumOku,
  yalnizcaFotograf,
  sekmeGizli,
} from "./api";
import BicenKartKutusu from "./BicenKartKutusu";
import MobilUygulamaKutusu from "./MobilUygulamaKutusu";
import PersonelDuzenle from "./PersonelDuzenle";
import { BedenSecici } from "./KiyafetBedeni";
import { HareketListesi, KaynakEtiketi, KaynakEtiketleri } from "./OkutmaKaynagi";
import { sayfayaGit } from "./gecis";
import "./Personeller.css";

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface Personel {
  personId: number;
  personelKodu: string;
  isGrubu: string;
  ad: string;
  soyad: string;
  telefon: string;
  kimlikNo: string;
  durum: number;
  sube: string;
  pozisyon: string;
  girisTarihi: string | null;
  cikisTarihi: string | null;

  /** Çıkış tarihi ileri bir güne yazılmış; kişi hâlâ çalışıyor */
  ayrilacak?: boolean;
  calismaGunu: number;

  /** Toplam kıdem (05.10.2026): ayrılıp dönenlerde önceki çalışmalar dahil */
  kidemGunu?: number;
  /** Kıdem esas tarihi: hak ediş düzeltmesi ya da işe giriş */
  kidemTarihi?: string | null;
  /** "bordro" (otomatik) | "elle" (İK) | null (işe giriş) */
  kidemKaynak?: string | null;
  calismaSayisi: number;
  engelli?: boolean;
  sakatDerece?: number;
  cikisSebebi: string | null;
  resimVar: boolean;
  resimSurumu?: number;
  ucret: number | null;
}

interface Veri {
  toplam: number;
  calisan: number;
  ayrilan: number;
  subeSayisi: number;
  resimsiz: number;
  subeler: string[];
  pozisyonlar: string[];
  personeller: Personel[];
  /** Personel kodu → yol ücreti (Yönetim → Yol Ücretleri). Ücret gizli rolde boş. */
  yolUcretleri?: Record<string, number>;
  /** Süzgeçlerden geçmiş ama durumla daraltılmamış sayılar (segment) */
  toplamCalisan?: number;
  toplamAyrilan?: number;
  /** Listede Biçen360 kullananların kodları; okunamadıysa null */
  uygulamaKullananlar?: string[] | null;
  /** Personel kodu → belge sayısı; belge yetkisi olmayan rolde null */
  belgeSayilari?: Record<string, number> | null;
  /** Bugün raporlu çalışanlar: personel kodu → rapor aralığı (03.10.2026) */
  raporlular?: Record<string, RaporDurumu> | null;
  /** İşe giriş evrağı eksik çalışanlar: personel kodu → eksik evrak adları */
  evrakEksikleri?: Record<string, string[]> | null;
}

/** IcerdekiPersonel: kimlik → bugünkü son hareket */
type Hareket = { zaman: string; iceride: boolean };

const BOS: Veri = {
  toplam: 0,
  calisan: 0,
  ayrilan: 0,
  subeSayisi: 0,
  resimsiz: 0,
  subeler: [],
  pozisyonlar: [],
  personeller: [],
};

/** Çalışma süresini okunur biçimde yazar */
const sureMetni = (gun: number): string => {
  if (!gun || gun < 0) return "—";
  if (gun < 30) return `${gun} gün`;

  const yil = Math.floor(gun / 365);
  const ay = Math.floor((gun % 365) / 30);

  if (yil === 0) return `${ay} ay`;
  return ay > 0 ? `${yil} yıl ${ay} ay` : `${yil} yıl`;
};

/** Toplam kıdem günü: sunucu hesaplamamışsa bu dönem */
const kidemGun = (p: { kidemGunu?: number; calismaGunu: number }) =>
  p.kidemGunu && p.kidemGunu > 0 ? p.kidemGunu : p.calismaGunu;

/** Kıdem önceki çalışmaları da içeriyor mu (esas tarih işe girişten önce) */
const oncekiDahil = (p: { kidemTarihi?: string | null; girisTarihi: string | null }) =>
  !!p.kidemTarihi && !!p.girisTarihi && dayjs(p.kidemTarihi).isBefore(dayjs(p.girisTarihi), "day");

/* ------------------------------------------------------------ yardımcılar */

/** Baş harf avatarı renkleri: kişiye göre sabit, sırayla dağılır */
const RENKLER: [string, string][] = [
  ["#eef6e1", "#3f6507"],
  ["#e9f0f8", "#2e6aa8"],
  ["#fff0ea", "#a33410"],
  ["#f1ecfb", "#6d4bc2"],
  ["#fff6dc", "#8a5c00"],
  ["#e7f6f3", "#1d7a68"],
];

const renkSec = (kod?: string | null): [string, string] =>
  RENKLER[[...(kod ?? "")].reduce((t, c) => t + c.charCodeAt(0), 0) % RENKLER.length];

const basHarfler = (ad?: string | null, soyad?: string | null) =>
  `${(ad ?? "").trim().charAt(0)}${(soyad ?? "").trim().charAt(0)}`.toLocaleUpperCase("tr") || "?";

const buyuk = (s?: string | null) => (s ?? "").toLocaleUpperCase("tr");

const tarihYaz = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY") : "—");

const paraYaz = (n: number) =>
  `${Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TL`;

/** Kesirli izin günü: 2,5 */
const gunYaz = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");

/** 5321112233 → 0532 111 22 33. Maskeli ya da başka biçimdeyse dokunulmaz. */
const telYaz = (t?: string | null) => {
  const ham = (t ?? "").trim();
  if (!ham || /[^\d\s()+-]/.test(ham)) return ham;

  const rakam = ham.replace(/\D/g, "");
  const tam = rakam.length === 10 && rakam[0] === "5" ? `0${rakam}` : rakam;

  return tam.length === 11 && tam[0] === "0"
    ? `${tam.slice(0, 4)} ${tam.slice(4, 7)} ${tam.slice(7, 9)} ${tam.slice(9)}`
    : ham;
};

/** "5 Ekim'e kadar": ay adına göre doğru ek */
const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AY_EKI = ["'a", "'a", "'a", "'a", "'a", "'a", "'a", "'a", "'e", "'e", "'a", "'a"];

const kadarMetni = (v?: string | null) => {
  if (!v) return "";
  const t = dayjs(v);
  return `${t.date()} ${AYLAR[t.month()]}${AY_EKI[t.month()]} kadar`;
};

/** "13–16 Tem" ya da "28 Haz – 2 Tem" */
/** Aramada Türkçe harf ve büyük/küçük farkı yok sayılır (21.10.2026) */
const trSade = (s: string) =>
  (s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const aralikYaz = (bas?: string | null, bit?: string | null) => {
  if (!bas) return "—";
  const a = dayjs(bas);
  const b = bit ? dayjs(bit) : a;

  if (a.isSame(b, "day")) return a.format("D MMM YYYY");
  if (a.isSame(b, "month")) return `${a.date()}–${b.format("D MMM YYYY")}`;
  return `${a.format("D MMM")} – ${b.format("D MMM YYYY")}`;
};

/** "04.05.1998" → yaş */
const yasHesapla = (metin?: string | null): number | null => {
  const p = (metin ?? "").split(".");
  if (p.length !== 3) return null;

  const d = dayjs(`${p[2]}-${p[1]}-${p[0]}`);
  if (!d.isValid()) return null;

  const yas = dayjs().diff(d, "year");
  return yas > 0 && yas < 100 ? yas : null;
};

/** Kıdem çubuğu 10 yılda dolar */
const KIDEM_TAVAN = 3650;

/** İlk 30 gün "Yeni" sayılır (oryantasyon dönemi) */
const YENI_GUN = 30;

/** İşe girişten bu yana kaçıncı gün; çalışmıyorsa null */
const kacinciGun = (p: { durum: number; girisTarihi: string | null }) =>
  p.durum === 1 && p.girisTarihi
    ? dayjs().startOf("day").diff(dayjs(p.girisTarihi).startOf("day"), "day") + 1
    : null;

/** Mikro'daki engellilik derecesi: büyük değerler yüzde olarak yazılmış */
const engelMetni = (d?: number) => (d && d > 3 ? `%${d}` : "Engelli");

/* ---------------------------------------------------------- bugün durumu */

type BugunTur = "magaza" | "rapor" | "izin" | "cikti" | "yok" | "ayrildi";

interface Bugun {
  tur: BugunTur;
  zaman?: string;
  izin?: any;
  rapor?: RaporDurumu;
}

const BUGUN_SIRA: Record<BugunTur, number> = { magaza: 0, rapor: 1, izin: 2, cikti: 3, yok: 4, ayrildi: 5 };

/** "Raporlu · 5 Ekim'e kadar" çipi: listede, kartlarda ve personel kartında */
function RaporCip({ rapor }: { rapor: RaporDurumu }) {
  return (
    <Tooltip
      title={`Raporlu · ${dayjs(rapor.baslangic).format("DD.MM")} – ${dayjs(rapor.bitis).format(
        "DD.MM.YYYY"
      )}${rapor.kaynak === "rapor" ? "" : " · izin kaydından"}. Norm kadroda mevcuda dahil.`}
    >
      <span className="pl-etiket pl-e-rapor">
        <HeartPulse size={13} strokeWidth={2.2} />
        Raporlu · {kadarMetni(rapor.bitis)}
      </span>
    </Tooltip>
  );
}

const saatYaz = (v?: string) => {
  if (!v) return "";
  const t = dayjs(v);
  return t.isSame(dayjs(), "day") ? t.format("HH:mm") : `dün ${t.format("HH:mm")}`;
};

function BugunCip({ b, p }: { b: Bugun; p: { cikisTarihi: string | null } }) {
  if (b.tur === "ayrildi")
    return (
      <span className="pl-etiket pl-e-gri">
        <LogOut size={13} strokeWidth={2.2} />
        Ayrıldı · {tarihYaz(p.cikisTarihi)}
      </span>
    );

  if (b.tur === "magaza")
    return (
      <Tooltip title="QR geçişe göre şu an mağazada · son giriş okutması">
        <span className="pl-etiket pl-e-yesil">
          <QrCode size={13} strokeWidth={2.2} />
          Mağazada{b.zaman ? ` · ${saatYaz(b.zaman)}` : ""}
        </span>
      </Tooltip>
    );

  if (b.tur === "rapor" && b.rapor) return <RaporCip rapor={b.rapor} />;

  if (b.tur === "izin")
    return (
      <Tooltip
        title={`İzinde · ${dayjs(b.izin?.izinCikis).format("DD.MM")} – ${dayjs(
          b.izin?.izinDonus
        ).format("DD.MM.YYYY")}`}
      >
        <span className="pl-etiket pl-e-mavi">
          <CalendarDays size={13} strokeWidth={2.2} />
          İzinde{b.izin?.izinDonus ? ` · ${kadarMetni(b.izin.izinDonus)}` : ""}
        </span>
      </Tooltip>
    );

  if (b.tur === "cikti")
    return (
      <Tooltip title="Bugünkü son okutması çıkış">
        <span className="pl-etiket pl-e-gri">
          <LogOut size={13} strokeWidth={2.2} />
          Çıktı · {saatYaz(b.zaman)}
        </span>
      </Tooltip>
    );

  return (
    <span className="pl-etiket pl-e-gri">
      <Clock size={13} strokeWidth={2.2} />
      Okutma yok
    </span>
  );
}

/* ---------------------------------------------------------------- avatar */

function Avatar({
  p,
  boyut = 42,
  nokta,
}: {
  p: { personelKodu: string; ad: string; soyad: string; resimVar?: boolean; resimSurumu?: number };
  boyut?: number;
  nokta?: BugunTur | null;
}) {
  const [hata, setHata] = useState(false);
  const adres = p.resimVar ? api.resimAdresi(p.personelKodu, p.resimSurumu) : "";
  const [zemin, yazi] = renkSec(p.personelKodu);

  return (
    <div
      className="pl-av"
      style={{ width: boyut, height: boyut, background: zemin, color: yazi, fontSize: Math.round(boyut * 0.33) }}
    >
      {adres && !hata ? (
        <img src={adres} alt="" loading="lazy" decoding="async" onError={() => setHata(true)} />
      ) : (
        basHarfler(p.ad, p.soyad)
      )}

      {nokta && nokta !== "ayrildi" && (
        <span
          className={`pl-nokta${
            nokta === "magaza"
              ? " pl-nokta-magaza"
              : nokta === "rapor"
              ? " pl-nokta-rapor"
              : nokta === "izin"
              ? " pl-nokta-izin"
              : ""
          }`}
        />
      )}
    </div>
  );
}

/** Kart içi başlık + gövde */
function PlKart({
  baslik,
  ikon,
  rozet,
  sag,
  children,
  className,
}: {
  baslik: ReactNode;
  ikon?: ReactNode;
  rozet?: ReactNode;
  sag?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`pl-kart${className ? ` ${className}` : ""}`}>
      <div className="pl-kart-bas">
        <h3>
          {ikon}
          {baslik}
        </h3>
        {rozet && <span className="pl-rozetli">{rozet}</span>}
        {sag && <div className="pl-sag">{sag}</div>}
      </div>
      <div className="pl-kart-ic">{children}</div>
    </div>
  );
}

const Alan = ({ t, v, genis }: { t: string; v: ReactNode; genis?: boolean }) => (
  <div className={`pl-alan${genis ? " pl-genis" : ""}`}>
    <span>{t}</span>
    <b>{v === null || v === undefined || v === "" ? "—" : v}</b>
  </div>
);

/** Liste görünümü tercihi tarayıcıda saklanır */
const GORUNUM_ANAHTARI = "pl-gorunum";

const gorunumOku = (): "tablo" | "kart" => {
  try {
    return localStorage.getItem(GORUNUM_ANAHTARI) === "kart" ? "kart" : "tablo";
  } catch {
    return "tablo";
  }
};

/* ========================================================================== */

/** Tek kart modu: başka bir sayfadan personel adına tıklanınca yalnızca kart açılır */
export interface KartModu {
  kod: string;
  kapat: () => void;
}

export default function Personeller({ kartModu }: { kartModu?: KartModu } = {}) {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [veri, setVeri] = useState<Veri>(BOS);

  const [arama, setArama] = useState("");
  const [sube, setSube] = useState<string | undefined>();
  const [pozisyon, setPozisyon] = useState<string | undefined>();
  const [durum, setDurum] = useState<"hepsi" | "calisan" | "ayrilan">("calisan");
  const [resimSuzgec, setResimSuzgec] = useState<"hepsi" | "var" | "yok">("hepsi");
  /* İşe giriş evrağı eksik olanlar (03.10.2026) */
  const [evrakEksikSuz, setEvrakEksikSuz] = useState(false);

  /* Tarih süzgeci: giriş veya çıkış tarihine göre daraltma */
  const [tarihTuru, setTarihTuru] = useState<"giris" | "cikis">("giris");
  const [tarihAralik, setTarihAralik] = useState<[Dayjs, Dayjs] | null>(null);
  const [tani, setTani] = useState<any[] | null>(null);

  /* Hızlı süzgeçler (çipler ve özet kartları) */
  const [izindeSuz, setIzindeSuz] = useState(false);
  const [raporluSuz, setRaporluSuz] = useState(false);
  const [uygYok, setUygYok] = useState(false);
  const [digerAcik, setDigerAcik] = useState(false);

  /* Liste / kart görünümü ve sayfalama */
  const [gorunum, setGorunumHam] = useState<"tablo" | "kart">(gorunumOku);
  const [sayfa, setSayfa] = useState(1);
  const [sayfaBoyu, setSayfaBoyu] = useState(50);

  const setGorunum = (g: "tablo" | "kart") => {
    setGorunumHam(g);
    try {
      localStorage.setItem(GORUNUM_ANAHTARI, g);
    } catch {
      /* gizli pencere: tercih saklanmaz */
    }
  };

  /* Satıra tıklanınca açılan personel detayı */
  const [detay, setDetay] = useState<any>(null);

  /* QR geçiş hareketleri; kişi numarası eşleşmezse boş kalır */
  const [gecis, setGecis] = useState<any>(null);

  /* O anda mağazada olan personelin kimlik numaraları ve bugünkü son
     hareketleri (saat). Liste "Bugün" sütunu buradan. */
  const [icerdekiler, setIcerdekiler] = useState<Set<string>>(new Set());
  const [hareketler, setHareketler] = useState<Record<string, Hareket>>({});
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);

  /* Personel kartının sekmesi */
  const [profilSekme, setProfilSekme] = useState("genel");
  const aktifKod = useRef<string | null>(null);

  /* Belgeler sekmesinin sayısı: liste yanıtından, belge eklenip
     silindiğinde bileşenden güncellenir */
  const [belgeSayisi, setBelgeSayisi] = useState<number | null>(null);

  /* Raporlar sekmesi (03.10.2026): sayı kart açılınca arka planda okunur.
     Sekmeden rapor eklenip kaldırıldığında bugünkü durum burada
     güncellenir; liste yeniden okunmadan çip ve özet kartı tutarlı kalır. */
  const [raporSayisi, setRaporSayisi] = useState<number | null>(null);
  const [raporDegisen, setRaporDegisen] = useState<Record<string, RaporDurumu | null>>({});

  /* Raporlar personel belgeleriyle aynı rollerde (sunucu da denetliyor) */
  const raporYetkisi = ["Admin", "IK", "IKYoneticisi"].includes(oturumOku()?.rol ?? "");

  /* Avans sekmesi (06.10.2026): avansları yöneten roller */
  const avansYetkisi = ["Admin", "IK", "IKYoneticisi", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");

  const raporDurumuYaz = (kod: string, d: RaporDurumu | null) =>
    setRaporDegisen((o) => ({ ...o, [kod.trim()]: d }));

  /* Personel kartından düzenleme (Mikro + yol ücreti) */
  const [duzenleAcik, setDuzenleAcik] = useState(false);

  /* Ad eşleştirmeleri (yalnızca yönetici) */
  const yonetici = adminMi(oturumOku());
  const [eslemeAcik, setEslemeAcik] = useState(false);
  const [eslemeYukleniyor, setEslemeYukleniyor] = useState(false);
  const [birimler, setBirimler] = useState<{ kod: string; ad: string; tur?: string }[]>([]);
  const [pozisyonlar, setPozisyonlar] = useState<string[]>([]);
  const [kaynakGruplar, setKaynakGruplar] = useState<string[]>([]);
  const [kaynakUnvanlar, setKaynakUnvanlar] = useState<string[]>([]);
  const [grupEsleme, setGrupEsleme] = useState<
    { kaynak: string; hedef: string }[]
  >([]);
  const [unvanEsleme, setUnvanEsleme] = useState<
    { kaynak: string; hedef: string }[]
  >([]);

  /* Yalnızca engelli kadrosundaki personeli listele */
  const [yalnizEngelli, setYalnizEngelli] = useState(false);

  /* Personel kaydındaki değişikliklerin geçmişi. Kartın "Çalışma geçmişi"
     sekmesinde de gösterilir; ayrı pencere de duruyor. */
  const [gecmisKod, setGecmisKod] = useState<string | null>(null);
  const [gecmis, setGecmis] = useState<any[]>([]);
  const [gecmisBas, setGecmisBas] = useState<string | null>(null);
  const [gecmisYukleniyor, setGecmisYukleniyor] = useState(false);
  const gecmisIcin = useRef<string | null>(null);

  /* Performans: puanlar biDb'de hesaplanıyor, burada yalnızca okunur.
     Kart açılınca arka planda okunur (hızlı bilgilerdeki puan için);
     ayrıntı hem sekmede hem ayrı pencerede. */
  const [perfKisi, setPerfKisi] = useState<any | null>(null);
  const [perf, setPerf] = useState<any | null>(null);
  const [perfYukleniyor, setPerfYukleniyor] = useState(false);
  const [perfDonem, setPerfDonem] = useState<string | undefined>();
  const perfIcin = useRef<string | null>(null);
  const perfIstek = useRef(0);

  /* Yıllık izin: bakiye ve izin geçmişi. undefined: okunuyor */
  const [izin, setIzin] = useState<any>(undefined);

  /* Listede "izinde" rozeti için: o an izinde olanların sicil listesi */
  const [izindekiler, setIzindekiler] = useState<Record<string, any>>({});

  /* Fotoğraf görevlisi yalnızca ad soyad, telefon ve fotoğraf görür */
  const sinirli = yalnizcaFotograf(oturumOku());

  useEffect(() => {
    api
      .al<any>("/api/Izin/Durum")
      .then((d) => {
        const harita: Record<string, any> = {};

        (d.kayitlar ?? [])
          .filter((k: any) => k.izinde)
          .forEach((k: any) => {
            harita[k.personelKodu] = k;
          });

        setIzindekiler(harita);
      })
      .catch(() => undefined);
  }, []);

  const izinGetir = useCallback(async (kod?: string) => {
    if (!kod) {
      setIzin(null);
      return;
    }

    setIzin(undefined);

    try {
      setIzin(
        await api.al<any>(`/api/Izin/Gecmis/${encodeURIComponent(kod)}`)
      );
    } catch {
      setIzin(null);
    }
  }, []);

  useEffect(() => {
    izinGetir(detay?.kisi?.personelKodu);
  }, [detay?.kisi?.personelKodu, izinGetir]);

  /** Performans verisini okur; sessizde hata kutusu çıkmaz */
  const perfGetir = useCallback(
    async (kisi: any, sessiz = false) => {
      const no = ++perfIstek.current;

      perfIcin.current = kisi?.personelKodu ?? null;
      setPerf(null);
      setPerfYukleniyor(true);

      try {
        const sorgu = new URLSearchParams();
        if (kisi.guid) sorgu.set("guid", kisi.guid);
        if (kisi.kimlikNo) sorgu.set("kimlik", kisi.kimlikNo);

        const d = await api.al<any>(`/api/Performans/Personel?${sorgu}`);
        if (no !== perfIstek.current) return;

        setPerf(d);

        /* En son dönem hazır seçili gelir */
        const ilk = (d?.donemler ?? [])[0];
        setPerfDonem(ilk ? `${ilk.yil}-${ilk.ay}` : undefined);
      } catch (hata: any) {
        if (no !== perfIstek.current) return;
        if (!sessiz) message.error(hata.message);
        setPerf({ bulundu: false, hata: hata.message, donemler: [] });
      } finally {
        if (no === perfIstek.current) setPerfYukleniyor(false);
      }
    },
    [message]
  );

  const performansAc = (kisi: any) => {
    setPerfKisi(kisi);
    if (perfIcin.current !== kisi?.personelKodu || !perf) perfGetir(kisi);
  };

  /** Değişiklik geçmişini okur (sekme ve ayrı pencere ortak) */
  const gecmisGetir = async (kod: string) => {
    gecmisIcin.current = kod;
    setGecmis([]);
    setGecmisBas(null);
    setGecmisYukleniyor(true);

    try {
      const d = await api.al<any>(
        `/api/Personel/Gecmis?kod=${encodeURIComponent(kod)}`
      );
      if (gecmisIcin.current !== kod) return;
      setGecmis(d.liste ?? []);
      setGecmisBas(d.izlemeBaslangici ?? null);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setGecmisYukleniyor(false);
    }
  };

  const gecmisAc = (kod: string) => {
    setGecmisKod(kod);
    if (gecmisIcin.current !== kod) gecmisGetir(kod);
  };

  const [agirliklar, setAgirliklar] = useState<
    { bolum: string; agirlik: number }[]
  >([]);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      const sorgu = new URLSearchParams();
      if (durum !== "hepsi") sorgu.set("durum", durum);
      if (resimSuzgec !== "hepsi") sorgu.set("resim", resimSuzgec);

      if (tarihAralik) {
        const onEk = tarihTuru === "giris" ? "giris" : "cikis";
        sorgu.set(`${onEk}Bas`, tarihAralik[0].format("YYYY-MM-DD"));
        sorgu.set(`${onEk}Bit`, tarihAralik[1].format("YYYY-MM-DD"));
      }

      setVeri(await api.al<Veri>(`/api/Personel?${sorgu.toString()}`));
      /* Taze liste raporlu bilgisini de getiriyor */
      setRaporDegisen({});
    } catch (h: any) {
      setHata(h.message);
      setVeri(BOS);
    } finally {
      setYukleniyor(false);
    }
  }, [durum, resimSuzgec, tarihTuru, tarihAralik]);

  useEffect(() => {
    /* Tek kart modunda liste okunmaz */
    if (!kartModu) getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getir]);

  /* İçeride olan personel listesi; QR geçişten gelir.
     Beş dakikada bir tazelenir, sistem kapalıysa sessizce boş kalır. */
  useEffect(() => {
    const yukle = () =>
      api
        .al<any>("/api/Personel/IcerdekiPersonel")
        .then((d) => {
          setIcerdekiler(new Set<string>(d?.kimlikler ?? []));
          setHareketler(d?.sonHareketler ?? {});
        })
        .catch(() => undefined);

    yukle();

    const zaman = window.setInterval(yukle, 5 * 60_000);
    return () => window.clearInterval(zaman);
  }, []);

  /* Biçen360 kullananlar; API eskiyse ya da okunamadıysa null (bilinmiyor) */
  const uygKume = useMemo(
    () =>
      veri.uygulamaKullananlar
        ? new Set(veri.uygulamaKullananlar.map((k) => k.trim()))
        : null,
    [veri.uygulamaKullananlar]
  );

  const uygulamadaMi = (kod?: string | null): boolean | null =>
    uygKume ? uygKume.has((kod ?? "").trim()) : null;

  /** Bugün raporlu mu: liste yanıtı + kartta yapılan değişiklikler */
  const raporluBul = (kod?: string | null): RaporDurumu | null => {
    const k = (kod ?? "").trim();
    if (!k) return null;
    if (k in raporDegisen) return raporDegisen[k];
    return veri.raporlular?.[k] ?? null;
  };

  /** Kişinin bugünkü durumu: mağazada, raporlu, izinde, çıktı, okutma yok */
  const bugunDurum = (p: {
    durum: number;
    personelKodu: string;
    kimlikNo?: string | null;
  }): Bugun => {
    if (p.durum !== 1) return { tur: "ayrildi" };

    const kimlik = (p.kimlikNo ?? "").trim();
    const h = kimlik ? hareketler[kimlik] : undefined;

    if (h?.iceride || (!h && kimlik && icerdekiler.has(kimlik)))
      return { tur: "magaza", zaman: h?.zaman };

    /* Raporlu, izinden önce: "Hastalık İzni (Rapor)" de izin kaydı ama
       kişinin raporlu olduğu ayrıca görünmeli */
    const rp = raporluBul(p.personelKodu);
    if (rp) return { tur: "rapor", rapor: rp };

    const iz = izindekiler[p.personelKodu];
    if (iz) return { tur: "izin", izin: iz };

    if (h && dayjs(h.zaman).isSame(dayjs(), "day")) return { tur: "cikti", zaman: h.zaman };

    return { tur: "yok" };
  };

  /* Süzme işlemi listede yapılır; her tuşta sunucuya gidilmez */
  const liste = useMemo(() => {
    const q = trSade(arama.trim());

    return veri.personeller.filter((p) => {
      if (sube && p.sube !== sube) return false;
      if (pozisyon && p.pozisyon !== pozisyon) return false;
      if (yalnizEngelli && !p.engelli) return false;
      if (izindeSuz && (p.durum !== 1 || !izindekiler[p.personelKodu] || raporluBul(p.personelKodu)))
        return false;
      if (raporluSuz && (p.durum !== 1 || !raporluBul(p.personelKodu))) return false;
      if (uygYok && uygKume && (p.durum !== 1 || uygKume.has((p.personelKodu ?? "").trim())))
        return false;
      if (evrakEksikSuz && !veri.evrakEksikleri?.[(p.personelKodu ?? "").trim()]) return false;

      if (q) {
        const metin = trSade(`${p.ad} ${p.soyad} ${p.personelKodu ?? ""} ${p.kimlikNo ?? ""} ${p.telefon ?? ""}`);
        if (!metin.includes(q)) return false;
      }

      return true;
    });
  }, [veri.personeller, arama, sube, pozisyon, yalnizEngelli, izindeSuz, izindekiler, uygYok, uygKume, raporluSuz, raporDegisen, veri.raporlular, evrakEksikSuz, veri.evrakEksikleri]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Süzgeç değişince ilk sayfaya dönülür */
  useEffect(() => {
    setSayfa(1);
  }, [arama, sube, pozisyon, durum, resimSuzgec, yalnizEngelli, izindeSuz, raporluSuz, uygYok, tarihAralik, evrakEksikSuz]);

  /* ------------------------------------------------------------ dışa aktar */

  /** Eşleştirme penceresini açar ve mevcut tanımları yükler */
  const eslemeAc = async () => {
    setEslemeAcik(true);
    setEslemeYukleniyor(true);

    try {
      const [esleme, form] = await Promise.all([
        api.al<any>("/api/Personel/Eslestirme"),
        api.al<any>("/api/Ayar/Form"),
      ]);

      setGrupEsleme(esleme.isGrubuEslemeleri ?? []);
      setUnvanEsleme(esleme.unvanEslemeleri ?? []);
      setAgirliklar(esleme.agirliklar ?? []);
      setKaynakGruplar(esleme.isGruplari ?? []);
      setKaynakUnvanlar(esleme.unvanlar ?? []);
      setBirimler(form.subeler ?? []);
      setPozisyonlar(form.bolumler ?? []);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setEslemeYukleniyor(false);
    }
  };

  const eslemeKaydet = async () => {
    setEslemeYukleniyor(true);
    try {
      await api.gonder("/api/Personel/Eslestirme", {
        isGrubuEslemeleri: grupEsleme.filter((x) => x.kaynak && x.hedef),
        unvanEslemeleri: unvanEsleme.filter((x) => x.kaynak && x.hedef),
        agirliklar: agirliklar.filter((x) => x.bolum),
      });

      message.success("Eşleştirmeler kaydedildi.");
      setEslemeAcik(false);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setEslemeYukleniyor(false);
    }
  };

  /** Personel satırına tıklanınca ayrıntıları getirir */
  const detayAc = async (kod: string) => {
    if (!kod) return;

    /* Başka bir kişiye geçildiyse kart ilk sekmeden açılır; kaydedip
       yeniden okununca kullanıcı bulunduğu sekmede kalır. */
    const yeniKisi = aktifKod.current !== kod;
    aktifKod.current = kod;

    if (yeniKisi) {
      setProfilSekme("genel");
      setBelgeSayisi(null);
      setRaporSayisi(null);

      /* Raporlar sekmesinin sayısı arka planda (yalnızca yetkili rollerde) */
      if (raporYetkisi)
        api
          .al<any>(`/api/PersonelRapor?kod=${encodeURIComponent(kod)}`)
          .then((d) => {
            if (aktifKod.current !== kod) return;
            setRaporSayisi((d?.raporlar ?? []).length);
            raporDurumuYaz(kod, d?.bugun ?? null);
          })
          .catch(() => undefined);
    }

    /* Düzenlemeden sonra değişiklik geçmişi yeniden okunmalı */
    gecmisIcin.current = null;

    setDetay((d: any) => (yeniKisi || !d ? { kisi: null } : d));
    setDuzenleAcik(false);
    setDetayYukleniyor(yeniKisi);

    try {
      const d = await api.al<any>(
        `/api/Personel/Detay?kod=${encodeURIComponent(kod)}`
      );

      if (aktifKod.current !== kod) return;

      setDetay(d);

      /* QR geçiş özeti detay yanıtıyla birlikte gelir; ayrı istek yok.
         Personel geçiş sisteminde yoksa null döner ve bölüm gösterilmez. */
      setGecis(d?.gecis ?? null);

      /* Hızlı bilgilerdeki puan için performans arka planda okunur */
      if (
        d?.kisi &&
        !yalnizcaFotograf(oturumOku()) &&
        !sekmeGizli(oturumOku(), "personeller.performans") &&
        perfIcin.current !== kod
      )
        perfGetir(d.kisi, true);
    } catch (h: any) {
      message.error(h.message);
      setDetay(null);
      aktifKod.current = null;
      kartModu?.kapat();
    } finally {
      setDetayYukleniyor(false);
    }
  };

  const detayKapat = () => {
    setDetay(null);
    aktifKod.current = null;
    kartModu?.kapat();
  };

  /* Tek kart modu: istenen kişinin kartı açılır */
  useEffect(() => {
    if (kartModu?.kod) detayAc(kartModu.kod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kartModu?.kod]);

  const disaAktar = () => {
    if (liste.length === 0) {
      message.info("Dışa aktarılacak kayıt yok.");
      return;
    }

    tabloIndir({
      baslik: "Personel Listesi",
      altBaslik: `${liste.length} personel`,
      sayfaAdi: "Personeller",
      dosyaAdi: "personeller",
      grupSutunu: 4,
      genelToplam: true,
      sutunlar: [
        { ad: "Ad Soyad", genislik: 28 },
        { ad: "Personel Kodu", genislik: 13 },
        { ad: "Kimlik No", genislik: 14 },
        { ad: "Telefon", genislik: 13 },
        { ad: "Şube", genislik: 24 },
        { ad: "Ünvan", genislik: 22 },
        { ad: "İşe Giriş", tip: "tarih" },
        { ad: "Çıkış", tip: "tarih" },
        { ad: "Durum", genislik: 11 },
        { ad: "Çalışma (gün)", tip: "sayi", toplam: false, veriCubugu: true },
        /* Maaş ve yol ücreti: rol yetkisinde ücret gizliyse sunucu
           boş gönderiyor, hücre de boş kalır */
        { ad: "Maaş", tip: "para", genislik: 14 },
        { ad: "Yol Ücreti", tip: "para", genislik: 13 },
        { ad: "Engelli", genislik: 9 },
        { ad: "Fotoğraf", genislik: 9 },
      ],
      satirlar: liste.map((p) => [
        `${p.ad} ${p.soyad}`, p.personelKodu, p.kimlikNo, p.telefon, p.sube, p.pozisyon,
        p.girisTarihi ?? null, p.cikisTarihi ?? null,
        p.durum === 1 ? "Çalışıyor" : "Ayrıldı", p.calismaGunu ?? null,
        p.ucret ?? null,
        veri.yolUcretleri?.[(p.personelKodu ?? "").trim()] ?? null,
        (p as any).engelli ? "Evet" : "Hayır", p.resimVar ? "Var" : "Yok",
      ]),
    });
  };

  /* ------------------------------------------------------------ özet kartları */

  const calisanlar = useMemo(
    () => veri.personeller.filter((p) => p.durum === 1),
    [veri.personeller]
  );

  const ayrilanlar = useMemo(
    () => veri.personeller.filter((p) => p.durum !== 1),
    [veri.personeller]
  );

  type Kpi = {
    anahtar: string;
    baslik: string;
    sayi: ReactNode;
    alt: string;
    ikon: ReactNode;
    renk: [string, string];
    secili?: boolean;
    tikla?: () => void;
    ipucu?: string;
  };

  const ayBasi = dayjs().startOf("month");

  const kpiler: Kpi[] =
    durum === "ayrilan"
      ? [
          {
            anahtar: "ayrilan",
            baslik: "Ayrılan",
            sayi: ayrilanlar.length,
            alt: `${new Set(ayrilanlar.map((p) => p.sube).filter(Boolean)).size} birimden`,
            ikon: <UserMinus size={16} strokeWidth={2} />,
            renk: ["#fff0ea", "#a33410"],
          },
          {
            anahtar: "buay",
            baslik: "Bu ay ayrılan",
            sayi: ayrilanlar.filter((p) => p.cikisTarihi && !dayjs(p.cikisTarihi).isBefore(ayBasi)).length,
            alt: `${ayBasi.format("MMMM")} çıkışları`,
            ikon: <LogOut size={16} strokeWidth={2} />,
            renk: ["#f1ecfb", "#6d4bc2"],
          },
          {
            anahtar: "yil",
            baslik: "Son 12 ay",
            sayi: ayrilanlar.filter(
              (p) => p.cikisTarihi && dayjs(p.cikisTarihi).isAfter(dayjs().subtract(12, "month"))
            ).length,
            alt: "son bir yılda ayrılan",
            ikon: <CalendarDays size={16} strokeWidth={2} />,
            renk: ["#e9f0f8", "#2e6aa8"],
          },
          {
            anahtar: "donen",
            baslik: "Birden çok dönem",
            sayi: ayrilanlar.filter((p) => p.calismaSayisi > 1).length,
            alt: "birden fazla kez işe alınmış",
            ikon: <History size={16} strokeWidth={2} />,
            renk: ["#e7f6f3", "#1d7a68"],
          },
          {
            anahtar: "sebep",
            baslik: "Sebebi girilmemiş",
            sayi: ayrilanlar.filter((p) => !p.cikisSebebi).length,
            alt: "çıkış sebebi boş",
            ikon: <AlertTriangle size={16} strokeWidth={2} />,
            renk: ["#fff6dc", "#8a5c00"],
          },
        ]
      : [
          {
            anahtar: "calisan",
            baslik: "Çalışan",
            sayi: calisanlar.length,
            alt: `${new Set(calisanlar.map((p) => p.sube).filter(Boolean)).size} birimde`,
            ikon: <Users size={16} strokeWidth={2} />,
            renk: ["#eef6e1", "#3f6507"],
          },
          {
            anahtar: "magaza",
            baslik: "Bugün mağazada",
            sayi: calisanlar.filter((p) => bugunDurum(p).tur === "magaza").length,
            alt: "QR'a göre şu an içeride",
            ikon: <QrCode size={16} strokeWidth={2} />,
            renk: ["#e7f6f3", "#1d7a68"],
          },
          {
            anahtar: "izinde",
            baslik: "İzinde",
            /* Raporlular ayrı kartta: "Hastalık İzni (Rapor)" iki kez sayılmasın */
            sayi: calisanlar.filter((p) => izindekiler[p.personelKodu] && !raporluBul(p.personelKodu)).length,
            alt: "bugün izinli",
            ikon: <CalendarDays size={16} strokeWidth={2} />,
            renk: ["#e9f0f8", "#2e6aa8"],
            secili: izindeSuz,
            tikla: () => {
              setIzindeSuz(!izindeSuz);
              setRaporluSuz(false);
            },
            ipucu: "İzinde olanları listele",
          },
          {
            anahtar: "raporlu",
            baslik: "Raporlu",
            sayi: veri.raporlular === null ? "—" : calisanlar.filter((p) => raporluBul(p.personelKodu)).length,
            alt: "bugün sağlık raporlu",
            ikon: <HeartPulse size={16} strokeWidth={2} />,
            renk: ["#fbeaf5", "#a0277d"],
            secili: raporluSuz,
            tikla: () => {
              setRaporluSuz(!raporluSuz);
              setIzindeSuz(false);
            },
            ipucu: "Bugün raporlu olanları listele · norm kadroda mevcuda dahil",
          },
          {
            anahtar: "buay",
            baslik: "Bu ay giren",
            sayi: calisanlar.filter((p) => p.girisTarihi && !dayjs(p.girisTarihi).isBefore(ayBasi)).length,
            alt: "oryantasyon döneminde",
            ikon: <LogIn size={16} strokeWidth={2} />,
            renk: ["#f1ecfb", "#6d4bc2"],
          },
          {
            anahtar: "uyg",
            baslik: "Biçen360 yok",
            sayi: uygKume
              ? calisanlar.filter((p) => !uygKume.has((p.personelKodu ?? "").trim())).length
              : "—",
            alt: "uygulamaya giriş yapmamış",
            ikon: <Smartphone size={16} strokeWidth={2} />,
            renk: ["#fff0ea", "#a33410"],
            secili: uygYok,
            tikla: uygKume ? () => setUygYok(!uygYok) : undefined,
            ipucu: "Biçen360'a giriş yapmamış çalışanları listele",
          },
        ];

  /* ------------------------------------------------------------------ tablo */

  const ikinciSuzgecSayisi = (resimSuzgec === "var" ? 1 : 0) + (tarihAralik ? 1 : 0);

  const hazirlik = (p: Personel) => {
    const uyg = uygulamadaMi(p.personelKodu);
    const belge = veri.belgeSayilari ? veri.belgeSayilari[(p.personelKodu ?? "").trim()] ?? 0 : null;
    const evrakEksik = veri.evrakEksikleri?.[(p.personelKodu ?? "").trim()];
    const calisiyor = p.durum === 1;

    return (
      <div className="pl-simgeler">
        <Tooltip title={p.resimVar ? "Fotoğraf var" : "Fotoğraf yüklenmemiş"}>
          <span className={`pl-simge ${p.resimVar ? "pl-s-var" : calisiyor ? "pl-s-uyari" : ""}`}>
            <UserRound size={15} strokeWidth={2} />
          </span>
        </Tooltip>

        {uyg !== null && (
          <Tooltip title={uyg ? "Biçen360 kullanıyor" : "Biçen360'a giriş yapmamış"}>
            <span className={`pl-simge ${uyg ? "pl-s-var" : calisiyor ? "pl-s-uyari" : ""}`}>
              <Smartphone size={15} strokeWidth={2} />
            </span>
          </Tooltip>
        )}

        {belge !== null && (
          <Tooltip title={belge > 0 ? `${belge} belge` : "Belge yüklenmemiş"}>
            <span className={`pl-simge ${belge > 0 ? "pl-s-var" : calisiyor ? "pl-s-uyari" : ""}`}>
              <FileText size={15} strokeWidth={2} />
              {belge > 1 && <sup>{belge > 99 ? "99+" : belge}</sup>}
            </span>
          </Tooltip>
        )}

        {evrakEksik && evrakEksik.length > 0 && (
          <Tooltip
            title={
              <div>
                <b>{evrakEksik.length} işe giriş evrakı eksik</b>
                <div style={{ fontSize: 12, marginTop: 2 }}>{evrakEksik.join(" · ")}</div>
              </div>
            }
          >
            <span className="pl-simge pl-s-evrak">
              <FileWarning size={15} strokeWidth={2} />
              <sup>{evrakEksik.length}</sup>
            </span>
          </Tooltip>
        )}
      </div>
    );
  };

  const kisiEtiketleri = (p: Personel) => {
    const gun = kacinciGun(p);

    return (
      <>
        {gun !== null && gun <= YENI_GUN && (
          <Tooltip title={`İşe girişinin ${gun}. günü · ${tarihYaz(p.girisTarihi)}`}>
            <span className="pl-etiket pl-e-mor">Yeni</span>
          </Tooltip>
        )}

        {p.engelli && (
          <Tooltip
            title={`Engellilik derecesi: ${p.sakatDerece ?? "—"}. Norm kadroda yarım kadro sayılır.`}
          >
            <span className="pl-etiket pl-e-sari">
              <Accessibility size={12} strokeWidth={2.2} />
              {engelMetni(p.sakatDerece)}
            </span>
          </Tooltip>
        )}

        {p.calismaSayisi > 1 && (
          <Tooltip title={`Bu kişi ${p.calismaSayisi} kez işe alınmış`}>
            <span className="pl-etiket pl-e-mavi">{p.calismaSayisi}. kez</span>
          </Tooltip>
        )}
      </>
    );
  };

  const tumSutunlar: ColumnsType<Personel> = [
    {
      title: "Personel",
      key: "ad",
      render: (_v, p) => (
        <div className="pl-kisi">
          <Avatar p={p} nokta={bugunDurum(p).tur} />

          <div className="pl-kisi-metin">
            <b title={`${p.ad} ${p.soyad}`}>{buyuk(`${p.ad} ${p.soyad}`)}</b>
            <small>
              {[p.personelKodu && `Sicil ${p.personelKodu}`, p.kimlikNo]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>

          <div className="pl-kisi-etiket">{kisiEtiketleri(p)}</div>
        </div>
      ),
      sorter: (a, b) =>
        `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, "tr"),
    },
    {
      title: "Şube · Ünvan",
      key: "sube",
      width: 180,
      sorter: (a, b) =>
        (a.sube ?? "").localeCompare(b.sube ?? "", "tr") ||
        (a.pozisyon ?? "").localeCompare(b.pozisyon ?? "", "tr"),
      render: (_v, p) => (
        <div className="pl-sube">
          <Store size={15} strokeWidth={2} color="#9aa39a" />
          <div>
            <span title={p.sube}>{p.sube || "—"}</span>
            <small title={p.pozisyon}>{p.pozisyon || "—"}</small>
          </div>
        </div>
      ),
    },
    {
      title: "Kıdem",
      key: "kidem",
      width: 132,
      sorter: (a, b) => kidemGun(a) - kidemGun(b),
      render: (_v, p) => (
        <div className="pl-kidem">
          <Tooltip
            title={
              oncekiDahil(p)
                ? `Önceki çalışmalar dahil ${kidemGun(p)} gün · bu dönem ${sureMetni(p.calismaGunu)} (${tarihYaz(p.girisTarihi)} girişli)`
                : `${kidemGun(p)} gün`
            }
          >
            <b>{sureMetni(kidemGun(p))}</b>
          </Tooltip>
          <div className="pl-cubuk">
            <i style={{ width: `${Math.min(100, ((kidemGun(p) || 0) / KIDEM_TAVAN) * 100)}%` }} />
          </div>
          <small>
            {oncekiDahil(p) ? `esas ${tarihYaz(p.kidemTarihi ?? null)}` : tarihYaz(p.girisTarihi)}
          </small>
        </div>
      ),
    },
    {
      title: "Bugün",
      key: "bugun",
      width: 196,
      /* Duruma göre; aynı durumdakiler çıkış tarihine göre (ayrılanlar
         listesinde eski "İşten Çıkış" sıralamasının yerini tutar) */
      sorter: (a, b) =>
        BUGUN_SIRA[bugunDurum(a).tur] - BUGUN_SIRA[bugunDurum(b).tur] ||
        dayjs(a.cikisTarihi ?? 0).valueOf() - dayjs(b.cikisTarihi ?? 0).valueOf(),
      render: (_v, p) => (
        <div style={{ minWidth: 0 }}>
          <BugunCip b={bugunDurum(p)} p={p} />

          {p.durum !== 1 ? (
            <div className="pl-bugun-alt" title={p.cikisSebebi ?? ""}>
              {p.cikisSebebi || "sebep belirtilmemiş"}
            </div>
          ) : (
            p.ayrilacak &&
            p.cikisTarihi && (
              /* Çıkışı ileri tarihli: kişi hâlâ çalışıyor. Tarihi sade
                 yazmak, listede ayrılmış biriyle aynı görünmesine yol
                 açıyordu. */
              <Tooltip title="Çıkış tarihi geldiğinde ayrılacak; şu an çalışıyor.">
                <div className="pl-bugun-alt pl-turuncu">
                  Ayrılacak · {tarihYaz(p.cikisTarihi)}
                </div>
              </Tooltip>
            )
          )}
        </div>
      ),
    },
    {
      title: "Telefon",
      dataIndex: "telefon",
      key: "telefon",
      width: 128,
      render: (v: string) =>
        v ? <span className="pl-tel">{telYaz(v)}</span> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Hazırlık",
      key: "hazirlik",
      width: 112,
      render: (_v, p) => hazirlik(p),
    },
    {
      title: "",
      key: "ok",
      width: 32,
      render: () => (
        <span className="pl-ok">
          <ChevronRight size={17} strokeWidth={2} />
        </span>
      ),
    },
  ];

  /* Sınırlı rolde yalnızca personel ve telefon sütunları gösterilir.
     Veriler zaten sunucuda ayıklanıyor; bu görsel bir sadeleştirme. */
  const sutunlar = sinirli
    ? tumSutunlar.filter((x: any) => ["ad", "telefon", "ok"].includes(x.key))
    : tumSutunlar;

  const listeBasligi =
    durum === "calisan" ? "Çalışan personel" : durum === "ayrilan" ? "Ayrılan personel" : "Tüm personel";

  const sayfaMetni = (t: number, a: [number, number]) => `${a[0]}–${a[1]} / ${t} personel`;

  /* ------------------------------------------------------- personel kartı */

  const kisi = detay?.kisi;
  const kod: string = kisi?.personelKodu ?? "";
  const izinGizli = sekmeGizli(oturumOku(), "personeller.izin");
  const perfGizli = sekmeGizli(oturumOku(), "personeller.performans");
  const notGizli = sekmeGizli(oturumOku(), "personeller.notlar");

  /* Yıllık izin özeti. Kalan = girilen − kullanılan − planlı. Planlı,
     henüz başlamamış izinlerdir; bakiyeyi düşürür ama "kullanıldı"
     sayılmaz. */
  const izinOzet = useMemo(() => {
    if (!izin?.bakiye) return null;

    const bugun = dayjs();

    const kayitlar = (izin.kayitlar ?? []).filter((x: any) => x.bakiyedenDuser);

    /* Çizelgeden aktarılan kullanım bakiyede tutulur; tarihi olmadığı
       için izin kaydı olarak yazılmaz. */
    const kullanilan =
      (Number(izin.bakiye.aktarilanKullanim) || 0) +
      kayitlar
        .filter((x: any) => dayjs(x.cikisTarihi).isBefore(bugun))
        .reduce((t: number, x: any) => t + Number(x.gun), 0);

    const planli = kayitlar
      .filter((x: any) => !dayjs(x.cikisTarihi).isBefore(bugun))
      .reduce((t: number, x: any) => t + Number(x.gun), 0);

    /* Alan adı sunucuda "hakedilen" olarak değişti; eski ad okunduğu için
       kartlarda NaN çıkıyordu. */
    const hakedilen = Number(izin.bakiye.hakedilen) || 0;
    const devir = Number(izin.bakiye.devir) || 0;
    const kalan = hakedilen + devir - kullanilan - planli;

    /* Hak ediş esas tarihinin bir sonraki yıl dönümü */
    let sonrakiHakedis: Dayjs | null = null;
    if (izin.hakedis?.tarih) {
      const esas = dayjs(izin.hakedis.tarih);
      let t = esas.year(bugun.year());
      if (!t.isAfter(bugun, "day")) t = t.add(1, "year");
      sonrakiHakedis = t;
    }

    return { hakedilen, devir, kullanilan, planli, kalan, toplam: hakedilen + devir, sonrakiHakedis };
  }, [izin]);

  const kalanRengi = (k: number) => (k <= 0 ? "#cf1322" : k <= 3 ? "#d46b08" : "#5f8c10");

  /* Son performans dönemi: hızlı bilgi ve sekme */
  const perfBu = perfIcin.current === kod ? perf : null;
  const sonDonem = perfBu?.bulundu ? (perfBu.donemler ?? [])[0] : null;
  const donemToplam = (d: any) => (d?.magazaToplam ?? 0) + (d?.yetkinlikToplam ?? 0);
  const donemAdi = (d: any) => `${d.yil}/${String(d.ay).padStart(2, "0")}`;

  /* Sekme açılınca gereken veri okunur */
  useEffect(() => {
    if (!kod) return;
    if (profilSekme === "calisma" && gecmisIcin.current !== kod) gecmisGetir(kod);
    if (profilSekme === "perf" && perfIcin.current !== kod && kisi) perfGetir(kisi, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilSekme, kod]);

  const yolGorunur =
    !!kisi && (detay.yolUcreti != null || (detay.duzenlenebilir && kisi.ucret != null));

  /** Performans dönem kartları (sekme ve ayrı pencere ortak) */
  const perfDonemKartlari = () =>
          /* Yalnızca seçili dönem gösterilir: bütün aylar alt alta
             gelince ekran uzuyor ve hangi döneme baktığınız kayboluyor. */
          perf.donemler
            .filter(
              (d: any) =>
                !perfDonem || `${d.yil}-${d.ay}` === perfDonem
            )
            .map((d: any, i: number) => {
              /* Bir önceki dönem: karşılaştırma listedeki sıraya göre
                 yapılır, takvim ayına göre değil. Değerlendirme her ay
                 yapılmayabiliyor; "bir önceki dönem" her durumda doğru. */
              const sira = perf.donemler.findIndex(
                (x: any) => x.yil === d.yil && x.ay === d.ay
              );

              const onceki = perf.donemler[sira + 1];

              const simdiToplam =
                (d.magazaToplam ?? 0) + (d.yetkinlikToplam ?? 0);

              const oncekiToplam = onceki
                ? (onceki.magazaToplam ?? 0) + (onceki.yetkinlikToplam ?? 0)
                : null;

              const fark =
                oncekiToplam === null ? null : simdiToplam - oncekiToplam;

              return (
            <Card
              key={i}
              size="small"
              style={{ marginBottom: 14 }}
              title={
                <Space size={8} wrap>
                  <Text strong>
                    {d.yil} / {String(d.ay).padStart(2, "0")}
                  </Text>
                  {d.gorevAdi && <Tag color="blue">{d.gorevAdi}</Tag>}
                  {d.subeAdi && <Tag>{d.subeAdi}</Tag>}
                </Space>
              }
              extra={
                <Space size={6}>
                  {d.sirketSirasi > 0 && (
                    <Tooltip title="Şirket genelindeki sıralaması">
                      <Tag color="purple">#{d.sirketSirasi}</Tag>
                    </Tooltip>
                  )}
                  {fark !== null && (
                    <Tooltip
                      title={`Önceki dönem (${onceki.yil}/${String(
                        onceki.ay
                      ).padStart(2, "0")}): ${oncekiToplam} puan`}
                    >
                      <Tag
                        color={fark > 0 ? "green" : fark < 0 ? "red" : undefined}
                      >
                        {fark > 0 ? `▲ +${fark}` : fark < 0 ? `▼ ${fark}` : "değişmedi"}
                      </Tag>
                    </Tooltip>
                  )}
                  <Tag color="green">{simdiToplam} puan</Tag>
                </Space>
              }
            >
              {[
                /* 24.10.2026: ölçütler pozisyona göre (sunucu ayrinti); yoksa eski liste */
                { baslik: "Mağaza Performansı", olcutler: donemAyrinti(perf, d)?.magaza ?? perf.magazaOlcutleri, toplam: d.magazaToplam, agirlik: donemAyrinti(perf, d)?.magazaAgirlik },
                { baslik: "Yetkinlik Ölçütleri", olcutler: donemAyrinti(perf, d)?.yetkinlik ?? perf.yetkinlikOlcutleri, toplam: d.yetkinlikToplam, agirlik: donemAyrinti(perf, d)?.yetkinlikAgirlik },
              ].filter((b) => !donemAyrinti(perf, d) || b.olcutler.length > 0).map((bolum) => {
                /* Boş hücre "veri girilmedi" demek; 0 ise "puan alamadı".
                   İkisini ayırmazsak girilmemiş ölçüt sıfır almış gibi
                   görünür ve haksız bir tablo çıkar. */
                const dolu = bolum.olcutler.filter(
                  (o: string) => d[o] !== null && d[o] !== undefined && d[o] !== ""
                );

                const bos = bolum.olcutler.length - dolu.length;

                return (
                  <div key={bolum.baslik} style={{ marginBottom: 14 }}>
                    <Space size={8} style={{ marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 13 }}>
                        {bolum.baslik}
                        {bolum.agirlik ? <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}> (ortalamanın %{bolum.agirlik}'ünü oluşturur)</Text> : null}
                      </Text>
                      <Tag>{bolum.toplam ?? 0} puan</Tag>
                      {bos > 0 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {bos} ölçütün verisi girilmemiş
                        </Text>
                      )}
                    </Space>

                    {dolu.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        Bu dönem için veri girilmemiş.
                      </Text>
                    ) : (
                      dolu.map((o: string) => (
                        <div
                          key={o}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "5px 0",
                            borderBottom: "1px solid #f0f2ee",
                            fontSize: 13,
                          }}
                        >
                          <span>
                            {o}
                            <OlcutBilgi s={donemAyrinti(perf, d)?.satirlar?.[o]} puan={d[o]} />
                          </span>

                          <Space size={8}>
                            {/* Önceki dönemle fark: hangi ölçütte ilerleme
                                olduğu satır satır görünsün. Önceki dönemde
                                veri yoksa karşılaştırma yapılmaz — boşu
                                sıfır sayıp "düşüş" göstermek yanlış olur. */}
                            {onceki &&
                              onceki[o] !== null &&
                              onceki[o] !== undefined &&
                              onceki[o] !== "" &&
                              (() => {
                                const f = Number(d[o]) - Number(onceki[o]);

                                if (f === 0)
                                  return (
                                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                                      aynı
                                    </Text>
                                  );

                                return (
                                  <Text
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: f > 0 ? "#5f8c10" : "#cf1322",
                                    }}
                                  >
                                    {f > 0 ? `▲ +${f}` : `▼ ${f}`}
                                  </Text>
                                );
                              })()}

                            <b
                              style={{
                                color: Number(d[o]) > 0 ? "#5f8c10" : "#e8481c",
                              }}
                            >
                              {d[o]}
                            </b>
                          </Space>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </Card>
              );
            });

  const profil = () => {
    if (!kisi) return null;

    const [zemin, yazi] = renkSec(kod);
    const bugun = bugunDurum(kisi);
    const yeniGun = kacinciGun(kisi);
    const adSoyad = `${kisi.ad ?? ""} ${kisi.soyad ?? ""}`.trim();
    const notlar: any[] = detay.basvuruNotlari ?? [];
    const donemler: any[] = detay.gecmis ?? [];
    const cikislar = donemler.filter((g) => g.cikisTarihi);
    const belgeAdet = belgeSayisi ?? veri.belgeSayilari?.[kod.trim()] ?? null;

    /* ------------------------------------------------ hızlı bilgiler */
    const hizli: {
      anahtar: string;
      baslik: string;
      deger: ReactNode;
      alt: ReactNode;
      tikla?: () => void;
    }[] = [];

    if (!sinirli) {
      hizli.push({
        anahtar: "kidem",
        baslik: "Kıdem",
        /* 16.10.2026: ayrılıp dönenlerde toplam kıdemin yanında son
           girişten bu yana geçen süre ayrı bir rozetle görünsün. */
        deger: oncekiDahil(kisi) ? (
          <>
            {sureMetni(kidemGun(kisi))}
            <em>toplam</em>
          </>
        ) : (
          sureMetni(kidemGun(kisi))
        ),
        alt: oncekiDahil(kisi) ? (
          <span
            className="pl-kidem-donem"
            title={`Son giriş ${tarihYaz(kisi.girisTarihi)} · önceki çalışmalar toplam kıdeme dahil`}
          >
            <i>Son girişten beri</i>
            <b>{sureMetni(kisi.calismaGunu)}</b>
            {kisi.girisTarihi && <s>{tarihYaz(kisi.girisTarihi)}</s>}
          </span>
        ) : kisi.girisTarihi
          ? `${tarihYaz(kisi.girisTarihi)} girişli`
          : "giriş tarihi yok",
      });

      if (kisi.durum === 1 && !izinGizli)
        hizli.push({
          anahtar: "izin",
          baslik: "Kalan izin",
          deger: izinOzet ? (
            <span style={{ color: kalanRengi(izinOzet.kalan) }}>{gunYaz(izinOzet.kalan)} gün</span>
          ) : (
            "—"
          ),
          alt: izinOzet
            ? `${gunYaz(izinOzet.toplam)} gün hak ediş + devir`
            : izin === undefined
            ? "okunuyor…"
            : "izin hak edişi girilmemiş",
          tikla: () => setProfilSekme("izin"),
        });

      if (kisi.ucret > 0)
        hizli.push({
          anahtar: "ucret",
          baslik: "Ücret",
          deger: paraYaz(kisi.ucret),
          alt: detay.skala
            ? detay.skala.durum === "ust"
              ? "skalanın üzerinde"
              : detay.skala.durum === "alt"
              ? "skalanın altında"
              : "skala içinde"
            : "net · Mikro",
        });

      if (yolGorunur)
        hizli.push({
          anahtar: "yol",
          baslik: "Yol ücreti",
          deger: (
            <>
              {detay.yolUcreti != null ? paraYaz(detay.yolUcreti) : "—"}
              {detay.duzenlenebilir && (
                <Tooltip title="Yol ücretini düzenle">
                  <button
                    type="button"
                    className="pl-kalem"
                    aria-label="Yol ücretini düzenle"
                    onClick={() => setDuzenleAcik(true)}
                  >
                    <SquarePen size={13} strokeWidth={2.1} />
                  </button>
                </Tooltip>
              )}
            </>
          ),
          alt: "aylık",
        });

      if (!perfGizli)
        hizli.push({
          anahtar: "perf",
          baslik: "Performans",
          deger: sonDonem ? (
            <>
              {donemToplam(sonDonem)}
              <em>puan</em>
            </>
          ) : perfYukleniyor ? (
            "…"
          ) : (
            "—"
          ),
          alt: sonDonem
            ? `${donemAdi(sonDonem)}${sonDonem.sirketSirasi > 0 ? ` · şirkette #${sonDonem.sirketSirasi}` : ""}`
            : perfYukleniyor
            ? "okunuyor…"
            : "değerlendirme yok",
          tikla: () => setProfilSekme("perf"),
        });
    }

    /* --------------------------------------------------------- sekmeler */
    const sekmeler: { k: string; ad: string; ikon: ReactNode; say?: ReactNode }[] = [
      { k: "genel", ad: "Genel", ikon: <UserRound size={15} strokeWidth={2} /> },
      ...(!sinirli && kisi.durum === 1 && !izinGizli
        ? [
            {
              k: "izin",
              ad: "İzin",
              ikon: <CalendarDays size={15} strokeWidth={2} />,
              say: izinOzet ? `${gunYaz(izinOzet.kalan)} gün` : undefined,
            },
          ]
        : []),
      /* Raporlar: belgelerle aynı rollerde. Ayrılmış personelde de
         görünür (geçmiş raporlar). */
      ...(!sinirli && raporYetkisi
        ? [
            {
              k: "rapor",
              ad: "Raporlar",
              ikon: <HeartPulse size={15} strokeWidth={2} />,
              say: raporSayisi ? raporSayisi : undefined,
            },
          ]
        : []),
      {
        k: "belge",
        ad: "Belgeler",
        ikon: <FileText size={15} strokeWidth={2} />,
        say: belgeAdet ? belgeAdet : undefined,
      },
      ...(!sinirli && avansYetkisi
        ? [{ k: "avans", ad: "Avans", ikon: <Wallet size={15} strokeWidth={2} /> }]
        : []),
      ...(!sinirli
        ? [
            {
              k: "calisma",
              ad: "Çalışma geçmişi",
              ikon: <History size={15} strokeWidth={2} />,
              say: donemler.length > 1 ? donemler.length : undefined,
            },
          ]
        : []),
      ...(!sinirli && !perfGizli
        ? [{ k: "perf", ad: "Performans ve değerlendirme", ikon: <TrendingUp size={15} strokeWidth={2} /> }]
        : []),
      { k: "uyg", ad: "Biçen360 & Kart", ikon: <Smartphone size={15} strokeWidth={2} /> },
      ...(!sinirli && !notGizli
        ? [
            {
              k: "not",
              ad: "Notlar",
              ikon: <MessageSquare size={15} strokeWidth={2} />,
              say: notlar.length || undefined,
            },
          ]
        : []),
    ];

    const sekme = sekmeler.some((s) => s.k === profilSekme) ? profilSekme : "genel";

    /* ------------------------------------------------------------ hero */
    const hero = (
      <div className="pl-hero">
        <div className="pl-hero-arac">
          {/* Bu personelle ilgili bir işi bir kişiye ata: ünvan
              düzeltmesi, evrak eksiği, kayıt hatası… */}
          {!sinirli && (
            <IsEmriAta
              ekran="personel"
              kayitId={kod}
              kayitBaslik={`${adSoyad} (${kod})`}
              onerilenBaslik={`Personel: ${adSoyad}`}
            />
          )}

          {detay.duzenlenebilir && (
            <Tooltip title="Bilgileri düzenle · Mikro'ya yazılır">
              <button
                type="button"
                className="pl-hero-btn pl-hero-duzenle"
                onClick={() => setDuzenleAcik(true)}
              >
                <SquarePen size={15} strokeWidth={2.1} />
                Düzenle
              </button>
            </Tooltip>
          )}

          <button
            type="button"
            className="pl-hero-btn pl-hero-kapat"
            aria-label="Kapat"
            title="Kapat"
            onClick={detayKapat}
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>

        <div className="pl-hero-ic">
          <div className="pl-foto">
            {detay.resim ? (
              <img src={detay.resim} alt={adSoyad} />
            ) : (
              <div className="pl-foto-bos" style={{ background: zemin, color: yazi }}>
                {basHarfler(kisi.ad, kisi.soyad)}
                <small>Fotoğraf yok</small>
              </div>
            )}

            {/* Fotoğraf Mikro'ya yazılır; yedekli ve geri alınabilir */}
            {fotografYukleme(oturumOku()) && (
              <ResimYukle
                gorunum="kaplama"
                personelKodu={kod}
                personelAdi={adSoyad}
                yuklendi={() => {
                  /* Detay yeniden okunur; liste de tazelenir ki küçük
                     görsel eskisinde kalmasın. */
                  detayAc(kod);
                  getir();
                }}
              />
            )}
          </div>

          <div className="pl-hero-metin">
            <h2>{buyuk(adSoyad)}</h2>
            <div className="pl-rol">
              {[kisi.pozisyon, kisi.isGrubu || kisi.sube].filter(Boolean).join(" · ") || "—"}
            </div>

            <div className="pl-hero-etiketler">
              {kisi.durum === 1 ? (
                <span className="pl-etiket pl-parlak">
                  <Check size={13} strokeWidth={2.6} />
                  Çalışıyor
                </span>
              ) : (
                <span className="pl-etiket pl-parlak pl-kirmizi">
                  <LogOut size={13} strokeWidth={2.2} />
                  Ayrıldı{kisi.cikisTarihi ? ` · ${tarihYaz(kisi.cikisTarihi)}` : ""}
                </span>
              )}

              {kisi.durum === 1 && !sinirli && <BugunCip b={bugun} p={kisi} />}

              {/* Mağazada okutmuş ama raporlu görünüyorsa ikisi de görünsün */}
              {kisi.durum === 1 && !sinirli && bugun.tur !== "rapor" && raporluBul(kod) && (
                <RaporCip rapor={raporluBul(kod)!} />
              )}

              {kod && <span className="pl-etiket">Sicil {kod}</span>}

              {yeniGun !== null && yeniGun <= YENI_GUN && (
                <span className="pl-etiket">Yeni · {yeniGun}. gün</span>
              )}

              {kisi.engelli && (
                <Tooltip title="Norm kadroda 0,5 sayılır">
                  <span className="pl-etiket">
                    <Accessibility size={13} strokeWidth={2.2} />
                    Engellilik · {kisi.sakatDerece}
                  </span>
                </Tooltip>
              )}

              {detay.calismaSayisi > 1 && (
                <span className="pl-etiket">
                  {kisi.durum === 1
                    ? `${detay.calismaSayisi}. kez çalışıyor`
                    : `${detay.calismaSayisi} dönem çalışmış`}
                </span>
              )}

              {/* Çıkış tarihi ileri bir güne yazılmışsa kişi hâlâ çalışıyor
                  ama ayrılığı planlanmış demektir. */}
              {detay.ayrilacak && (
                <span className="pl-etiket pl-dikkat">
                  {detay.ayrilacak.kalanGun === 1
                    ? "Yarın ayrılıyor"
                    : `${detay.ayrilacak.kalanGun} gün sonra ayrılıyor`}
                </span>
              )}
            </div>
          </div>
        </div>

        {hizli.length > 0 ? (
          <div
            className="pl-hizli"
            style={{ gridTemplateColumns: `repeat(${hizli.length}, minmax(0, 1fr))` }}
          >
            {hizli.map((h) => (
              <div
                key={h.anahtar}
                className={h.tikla ? "pl-tik" : undefined}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  h.tikla?.();
                }}
              >
                <span>{h.baslik}</span>
                <b>{h.deger}</b>
                <small>{h.alt}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="pl-hero-bosluk" />
        )}
      </div>
    );

    /* ------------------------------------------------------------ genel */
    const ek = (alan: string) =>
      (detay.ekBilgiler ?? []).find((b: any) => b.alan === alan)?.deger as string | undefined;

    const dogum = ek("Doğum Tarihi");
    const yas = yasHesapla(dogum);
    const meslek = ek("Meslek");
    const adres = ek("Adres");
    const digerEk = (detay.ekBilgiler ?? []).filter(
      (b: any) => !["İşe Giriş", "Doğum Tarihi", "Meslek", "Adres"].includes(b.alan)
    );

    const eksikler =
      kisi.durum === 1 && !sinirli
        ? [
            !detay.resim && !kisi.resimVar && "fotoğraf yüklenmemiş",
            uygulamadaMi(kod) === false && "Biçen360'a giriş yapmamış",
            !kisi.telefon && "cep telefonu yok",
            !izinGizli && izin !== undefined && !izin?.bakiye && "izin hak edişi girilmemiş",
          ].filter(Boolean)
        : [];

    const sonHareket = gecis?.sonHareket;

    const genel = (
      <>
        {eksikler.length > 0 && (
          <div className="pl-uyari">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <div>
              <b>Eksikler:</b> {eksikler.join(" · ")}
            </div>
          </div>
        )}

        {detay.iseGirisEvrak && detay.iseGirisEvrak.eksik > 0 && (
          <div className="pl-uyari pl-turuncu">
            <FileWarning size={16} strokeWidth={2.2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pl-uyari-baslik">
                {detay.iseGirisEvrak.eksik} işe giriş evrakı eksik ·{" "}
                {detay.iseGirisEvrak.tamam + detay.iseGirisEvrak.gerekmiyor}/
                {detay.iseGirisEvrak.toplam} tamam
              </div>
              <div className="pl-uyari-metin">{detay.iseGirisEvrak.eksikler.join(" · ")}</div>
            </div>
            <Button size="small" onClick={() => setProfilSekme("belge")}>
              Evraklara git
            </Button>
          </div>
        )}

        {/* GYRSM / RSM (09.10.2026): kart GYRSM'den (MikroDesktop_2004BICEN)
            okunuyor; çalışan personelin RSM'de (MikroDesktop_BICEN) kaydı
            yoksa ya da orada çıkışı yapılmışsa uyarı. RSM salt okunur. */}
        {detay.rsm && detay.kisi?.durum === 1 && detay.rsm.var !== null && !detay.rsm.aktif && (
          <div className="pl-uyari pl-turuncu">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pl-uyari-baslik">
                {detay.rsm.var ? detay.rsm.mesaj.toLocaleUpperCase("tr") : "RSM'DE YOK"} · GYRSM'de mevcut ({detay.kisi.personelKodu})
              </div>
              <div className="pl-uyari-metin">
                {detay.rsm.var
                  ? `Personel GYRSM'de çalışıyor görünüyor ama RSM'de (MikroDesktop_BICEN) ${detay.rsm.kod ?? ""} sicilinin çıkışı yapılmış.`
                  : "Personelin GYRSM'de (MikroDesktop_2004BICEN) kaydı var, RSM'de (MikroDesktop_BICEN) T.C. kimlik numarasıyla kaydı bulunamadı. Resmî kaydın açılması gerekiyor."}
              </div>
            </div>
          </div>
        )}

        {detay.ayrilacak && (
          <div className="pl-uyari pl-turuncu">
            <LogOut size={16} strokeWidth={2.2} />
            <div>
              <div className="pl-uyari-baslik">
                İşten ayrılacak · {dayjs(detay.ayrilacak.cikisTarihi).format("DD.MM.YYYY")}
              </div>
              <div className="pl-uyari-metin">
                {detay.ayrilacak.kalanGun === 1
                  ? "Çıkışına bir gün kaldı. Zimmet teslimi ve çıkış mülakatı planlanmalı."
                  : `Çıkışına ${detay.ayrilacak.kalanGun} gün kaldı. Yerine alım planlanmalı.`}
              </div>
            </div>
          </div>
        )}

        <div className={`pl-izgara ${sinirli ? "" : "pl-i12"}`}>
          <PlKart
            baslik="Kişisel ve iletişim"
            ikon={<UserRound size={16} strokeWidth={2} />}
            sag={
              <>
                <span className="pl-mikro">Mikro</span>
                {detay.duzenlenebilir && (
                  <button
                    type="button"
                    className="pl-btn pl-btn-ince"
                    onClick={() => setDuzenleAcik(true)}
                  >
                    <SquarePen size={14} strokeWidth={2.1} />
                    Düzenle
                  </button>
                )}
              </>
            }
          >
            <div className="pl-alanlar">
              <Alan t="Ad Soyad" v={adSoyad} />
              {!sinirli && <Alan t="TC Kimlik" v={kisi.kimlikNo} />}
              {!sinirli && (
                <Alan
                  t="Doğum tarihi"
                  v={
                    dogum ? (
                      <>
                        {dogum}
                        {yas !== null && <small> · {yas} yaş</small>}
                      </>
                    ) : null
                  }
                />
              )}
              <Alan t="Cep telefonu" v={telYaz(kisi.telefon)} />
              {!sinirli && <Alan t="Adres" v={adres} genis />}
              {!sinirli && digerEk.map((b: any, i: number) => (
                <Alan key={i} t={b.alan} v={b.deger} />
              ))}
            </div>
          </PlKart>

          {!sinirli && (
            <PlKart
              baslik="Görev"
              ikon={<Store size={16} strokeWidth={2} />}
              sag={<span className="pl-mikro">Mikro</span>}
            >
              <div className="pl-alanlar">
                <Alan t="Şube / iş grubu" v={kisi.isGrubu} />
                <Alan t="Ünvan" v={kisi.pozisyon} />
                {kisi.sube && kisi.sube !== kisi.isGrubu && <Alan t="Çalıştığı şube" v={kisi.sube} />}
                {meslek && meslek !== kisi.pozisyon && <Alan t="Meslek (Mikro)" v={meslek} />}
                <Alan t="İşe giriş" v={kisi.girisTarihi ? tarihYaz(kisi.girisTarihi) : null} />
                {oncekiDahil(kisi) && (
                  <Alan
                    t="Toplam kıdem"
                    v={
                      <>
                        {sureMetni(kidemGun(kisi))}
                        <small> · esas {tarihYaz(kisi.kidemTarihi ?? null)}</small>
                      </>
                    }
                  />
                )}
                {kisi.durum === 1 ? (
                  <Alan t="Bu dönem" v={sureMetni(kisi.calismaGunu)} />
                ) : (
                  <Alan
                    t="Çıkış"
                    v={
                      <>
                        {tarihYaz(kisi.cikisTarihi)}
                        <small> · {kisi.cikisSebebi || "sebep belirtilmemiş"}</small>
                      </>
                    }
                  />
                )}
                <Alan
                  t="Toplam çalışma"
                  v={
                    <>
                      {sureMetni(detay.toplamGun)}
                      {detay.calismaSayisi > 1 && <small> · {detay.calismaSayisi} dönem</small>}
                    </>
                  }
                />
                <Alan t="Sicil" v={kod} />
                <Alan t="Kıyafet bedeni" v={<BedenSecici sicil={kod} />} />
                {kisi.engelli && (
                  <Alan
                    t="Engellilik derecesi"
                    v={
                      <>
                        {kisi.sakatDerece}
                        <Tag color="purple">norm kadroda 0,5</Tag>
                      </>
                    }
                  />
                )}
              </div>

              {kisi.sonDegisiklik && (
                <div className="pl-kart-dip">
                  Mikro'da son değişiklik: {dayjs(kisi.sonDegisiklik).format("DD.MM.YYYY HH:mm")}
                  {kisi.sonDegistiren ? ` · ${kisi.sonDegistiren}` : ""}
                </div>
              )}
            </PlKart>
          )}
        </div>

        {!sinirli && (kisi.ucret > 0 || yolGorunur || kisi.durum === 1 || gecis) && (
          <div className="pl-izgara pl-i3">
            {kisi.ucret > 0 && (
              <PlKart
                baslik="Ücret"
                ikon={<Banknote size={16} strokeWidth={2} />}
                sag={<span className="pl-mikro">Mikro</span>}
              >
                <div className="pl-buyuk">
                  {paraYaz(kisi.ucret)}
                  {detay.skala && (
                    <Tag
                      color={
                        detay.skala.durum === "ust" ? "red" : detay.skala.durum === "alt" ? "gold" : "green"
                      }
                    >
                      {detay.skala.durum === "ust"
                        ? "skalanın üzerinde"
                        : detay.skala.durum === "alt"
                        ? "skalanın altında"
                        : "skala içinde"}
                    </Tag>
                  )}
                </div>
                <div className="pl-buyuk-alt">
                  {detay.skala
                    ? `Skala aralığı: ${Number(detay.skala.altSinir).toLocaleString("tr-TR")} – ${Number(
                        detay.skala.ustSinir
                      ).toLocaleString("tr-TR")} TL`
                    : "Net · Mikro personel kartı"}
                </div>
              </PlKart>
            )}

            {/* Yol ücreti kariyer sisteminde (KRY_PERSONEL_YOL); ücret
                gizli rolde sunucu boş gönderir. */}
            {yolGorunur && (
              <PlKart
                baslik="Yol ücreti"
                ikon={<Bus size={16} strokeWidth={2} />}
                sag={
                  detay.duzenlenebilir && (
                    <Tooltip title="Yol ücretini düzenle">
                      <button
                        type="button"
                        className="pl-btn pl-btn-ince pl-btn-ikon"
                        aria-label="Yol ücretini düzenle"
                        onClick={() => setDuzenleAcik(true)}
                      >
                        <SquarePen size={14} strokeWidth={2.1} />
                      </button>
                    </Tooltip>
                  )
                }
              >
                <div className="pl-buyuk">
                  {detay.yolUcreti != null ? paraYaz(detay.yolUcreti) : "—"}
                </div>
                <div className="pl-buyuk-alt">Aylık · kariyer sisteminde tutulur</div>
              </PlKart>
            )}

            {(kisi.durum === 1 || gecis) && (
            <PlKart baslik="Son vardiya okutması" ikon={<QrCode size={16} strokeWidth={2} />}>
              <div className="pl-buyuk">
                {sonHareket
                  ? dayjs(sonHareket.gecisZamani).isSame(dayjs(), "day")
                    ? dayjs(sonHareket.gecisZamani).format("HH:mm")
                    : dayjs(sonHareket.gecisZamani).format("DD.MM HH:mm")
                  : "—"}
                {gecis && (
                  <Tag color={gecis.icerideMi ? "green" : "default"}>
                    {gecis.icerideMi ? "Mağazada" : "Mağazada değil"}
                  </Tag>
                )}
              </div>
              <div className="pl-buyuk-alt">
                {sonHareket ? (
                  <>
                    {dayjs(sonHareket.gecisZamani).isSame(dayjs(), "day")
                      ? "Bugün"
                      : dayjs(sonHareket.gecisZamani).format("DD.MM.YYYY")}
                    {sonHareket.gecisNoktasi ? ` · ${sonHareket.gecisNoktasi}` : ""}{" "}
                    {sonHareket.kaynak && <KaynakEtiketi kaynak={sonHareket.kaynak} kucuk />}
                  </>
                ) : gecis ? (
                  "Hareket kaydı yok"
                ) : (
                  "QR geçiş sisteminde kaydı bulunmuyor"
                )}
              </div>
            </PlKart>
            )}
          </div>
        )}

        {/* QR geçiş günleri; sistem kapalıysa gecis null döner */}
        {!sinirli && gecis && (
          <PlKart
            className="pl-kart-gecis"
            baslik="QR geçiş · son 7 gün"
            ikon={<DoorOpen size={16} strokeWidth={2} />}
            sag={
              <>
                {/* Son giriş çıkışsız kaldı: personel çıkışı okutmamış */}
                {!gecis.icerideMi && gecis.cikisOkutulmadi && (
                  <Tag color="gold">Son girişin çıkışı okutulmadı</Tag>
                )}
                {/* İzindeyse sebebi belli olsun: "mağazada değil" tek başına
                    devamsızlık gibi okunuyor. */}
                {izindekiler[kod] && <Tag color="orange">İzinde</Tag>}
              </>
            }
          >
            {gecis.gunler?.length > 0 ? (
              <div className="pl-gecis">
                {gecis.gunler.slice(0, 7).map((g: any) => (
                  <div className="pl-gecis-gun" key={g.tarih}>
                    <span>{dayjs(g.tarih).format("DD.MM ddd")}</span>

                    <span className="pl-gecis-saat">
                      {g.ilkGiris ? <b>{dayjs(g.ilkGiris).format("HH:mm")}</b> : <i>—</i>}
                      <u>→</u>
                      {g.sonCikis ? <b>{dayjs(g.sonCikis).format("HH:mm")}</b> : <i>—</i>}
                    </span>

                    <Tooltip title={<HareketListesi hareketler={g.hareketler} />}>
                      <span className="pl-gecis-adet">{g.hareketSayisi} hareket</span>
                    </Tooltip>

                    <span>
                      <KaynakEtiketleri kaynaklar={g.kaynaklar} kucuk />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pl-bos-ic">Son bir haftada geçiş kaydı bulunmuyor.</div>
            )}
          </PlKart>
        )}
      </>
    );

    /* ------------------------------------------------------------- izin */
    const izinSayfasi = (
      <button
        type="button"
        className="pl-btn pl-btn-ince"
        onClick={() => {
          detayKapat();
          sayfayaGit("yillikizin", kod);
        }}
      >
        <ExternalLink size={14} strokeWidth={2} />
        İzin Yönetimi'nde aç
      </button>
    );

    const izinKayitlari: any[] = izin?.kayitlar ?? [];
    const bugunGun = dayjs().startOf("day");
    const yaklasan = izinKayitlari
      .filter((x) => !dayjs(x.cikisTarihi).isBefore(bugunGun))
      .sort((a, b) => dayjs(a.cikisTarihi).valueOf() - dayjs(b.cikisTarihi).valueOf())
      .slice(0, 3);
    const gecmisIzin = izinKayitlari
      .filter((x) => dayjs(x.cikisTarihi).isBefore(bugunGun))
      .slice(0, Math.max(2, 5 - yaklasan.length));

    const izinSekmesi = (
      <>
        <div className="pl-izgara pl-i12 pl-esit">
          <PlKart
            baslik="Yıllık izin bakiyesi"
            ikon={<CalendarDays size={16} strokeWidth={2} />}
            sag={izinSayfasi}
          >
            {izin === undefined ? (
              <div className="pl-bos">
                <Spin />
              </div>
            ) : !izinOzet ? (
              /* Bakiye girilmemişse de bölüm görünür: kullanıcı burada
                 eksikliği fark edip girebilmeli. */
              <div className="pl-uyari pl-mavi pl-sifir">
                <CalendarDays size={16} strokeWidth={2} />
                <div>
                  <div className="pl-uyari-baslik">İzin hak edişi girilmemiş</div>
                  <div className="pl-uyari-metin">
                    Bu personelin kalan izin günü henüz sisteme girilmedi. Yıllık İzin
                    sayfasından girebilirsiniz.
                  </div>
                </div>
              </div>
            ) : (
              (() => {
                const t = izinOzet.toplam || 1;
                const kal = Math.max(0, izinOzet.kalan) / t;
                const pla = izinOzet.planli / t;
                const a1 = Math.min(360, kal * 360);
                const a2 = Math.min(360, a1 + pla * 360);

                return (
                  <>
                    <div className="pl-bakiye">
                      <div
                        className="pl-halka"
                        style={{
                          background: `conic-gradient(${kalanRengi(izinOzet.kalan)} 0deg ${a1}deg, #2e6aa8 ${a1}deg ${a2}deg, #e6eae1 ${a2}deg 360deg)`,
                        }}
                      >
                        <div>
                          <b style={{ color: kalanRengi(izinOzet.kalan) }}>{gunYaz(izinOzet.kalan)}</b>
                          <small>GÜN KALDI</small>
                        </div>
                      </div>

                      <div className="pl-alanlar">
                        <Alan t="Hak edilen" v={`${gunYaz(izinOzet.hakedilen)} gün`} />
                        <Alan t="Devir" v={`${gunYaz(izinOzet.devir)} gün`} />
                        <Alan t="Kullanılan" v={`${gunYaz(izinOzet.kullanilan)} gün`} />
                        <Alan t="Planlı" v={`${gunYaz(izinOzet.planli)} gün`} />
                        {izinOzet.sonrakiHakedis && (
                          <Alan t="Sonraki hak ediş" v={izinOzet.sonrakiHakedis.format("DD.MM.YYYY")} />
                        )}
                        {izin.bakiye.tarih && (
                          <Alan
                            t="Bakiye girişi"
                            v={
                              <>
                                {tarihYaz(izin.bakiye.tarih)}
                                {izin.bakiye.giren && <small> · {izin.bakiye.giren}</small>}
                              </>
                            }
                          />
                        )}
                      </div>
                    </div>

                    <div className="pl-izin-lejant">
                      <span>
                        <i style={{ background: kalanRengi(izinOzet.kalan) }} />
                        Kalan
                      </span>
                      <span>
                        <i style={{ background: "#2e6aa8" }} />
                        Planlı
                      </span>
                      <span>
                        <i style={{ background: "#e6eae1" }} />
                        Kullanılan
                      </span>
                    </div>
                  </>
                );
              })()
            )}
          </PlKart>

          <PlKart
            baslik="Yaklaşan ve son izinler"
            ikon={<CalendarCheck size={16} strokeWidth={2} />}
            rozet="izin kayıtlarından"
          >
            {izin === undefined ? (
              <div className="pl-bos">
                <Spin />
              </div>
            ) : yaklasan.length + gecmisIzin.length === 0 ? (
              <div className="pl-bos-ic">Henüz izin kaydı yok.</div>
            ) : (
              <div className="pl-zaman">
                {yaklasan.map((x) => (
                  <div className="pl-z pl-mavi" key={`y${x.id}`}>
                    <b>
                      {x.tur} · {aralikYaz(x.cikisTarihi, x.donusTarihi)}
                    </b>
                    <small>
                      {dayjs(x.cikisTarihi).isAfter(dayjs()) ? "Planlı" : "Devam ediyor"} ·{" "}
                      {gunYaz(Number(x.gun))} gün
                      {!x.bakiyedenDuser && " · bakiyeden düşmez"}
                    </small>
                  </div>
                ))}
                {gecmisIzin.map((x) => (
                  <div className={`pl-z${x.bakiyedenDuser ? "" : " pl-gri"}`} key={`g${x.id}`}>
                    <b>
                      {x.tur} · {aralikYaz(x.cikisTarihi, x.donusTarihi)}
                    </b>
                    <small>
                      Kullanıldı · {gunYaz(Number(x.gun))} gün
                      {!x.bakiyedenDuser && " · bakiyeden düşmez"}
                      {x.giren ? ` · ${x.giren}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </PlKart>
        </div>

        {izin?.bakiye && (
          <PlKart
            baslik="İzin hareketleri"
            ikon={<History size={16} strokeWidth={2} />}
            rozet={izinKayitlari.length > 0 ? `${izinKayitlari.length} kayıt` : undefined}
          >
            {izinKayitlari.length === 0 ? (
              <div className="pl-bos-ic">Henüz izin kaydı yok.</div>
            ) : (
              <Tablo
                className="pl-tbl"
                rowKey="id"
                size="small"
                dataSource={izinKayitlari}
                pagination={false}
                scroll={{ y: 320 }}
                columns={[
                  {
                    title: "Çıkış",
                    dataIndex: "cikisTarihi",
                    width: 105,
                    render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
                  },
                  {
                    title: "Dönüş",
                    dataIndex: "donusTarihi",
                    width: 105,
                    render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
                  },
                  {
                    title: "İşe Başlama",
                    dataIndex: "baslamaTarihi",
                    width: 115,
                    render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—"),
                  },
                  {
                    title: "Gün",
                    dataIndex: "gun",
                    width: 70,
                    align: "right" as const,
                    render: (v: number) => <b>{gunYaz(Number(v))}</b>,
                  },
                  {
                    title: "Tür",
                    dataIndex: "tur",
                    width: 170,
                    render: (v: string, k: any) => (
                      <span>
                        <Tag color={k.bakiyedenDuser ? "green" : undefined}>{v}</Tag>
                        {k.baslangicSaat && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {k.baslangicSaat}–{k.bitisSaat}
                          </Text>
                        )}
                        {k.yarimGun && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {k.yarimGun}
                          </Text>
                        )}
                      </span>
                    ),
                  },
                  {
                    title: "Giren",
                    dataIndex: "giren",
                    ellipsis: true,
                    render: (v: string) => v || "—",
                  },
                ]}
              />
            )}
          </PlKart>
        )}
      </>
    );

    /* -------------------------------------------------- çalışma geçmişi */
    const kd = detay.kidem;
    const bordroDonemleri: any[] = kd?.donemler ?? [];

    const calismaSekmesi = (
      <>
        {detay.izinHak && (detay.izinHak.sonraki || (detay.izinHak.gecmis ?? []).length > 0) && (
          <PlKart
            baslik="Yıllık izin hak ediş"
            ikon={<CalendarCheck size={16} strokeWidth={2} />}
            rozet="Yıl dönümünde bakiyeye otomatik yüklenir · 1–5 yıl 14, 6–14 yıl 20, 15+ yıl 26 gün · 18 altı / 50+ yaş en az 20"
            sag={
              detay.izinHak.sonraki ? (
                <span className="pl-rozetli">
                  {detay.izinHak.sonraki.kalanGun <= 0
                    ? "bugün"
                    : `${detay.izinHak.sonraki.kalanGun} gün sonra`}{" "}
                  · +{detay.izinHak.sonraki.gun} gün
                </span>
              ) : undefined
            }
          >
            {detay.izinHak.sonraki && (
              <div className="pl-alanlar">
                <Alan t="Sonraki yıl dönümü" v={tarihYaz(detay.izinHak.sonraki.tarih)} />
                <Alan t="Dolacak kıdem yılı" v={`${detay.izinHak.sonraki.kidemYili}. yıl`} />
                <Alan
                  t="Yüklenecek hak"
                  v={`${detay.izinHak.sonraki.gun} gün${detay.izinHak.sonraki.yasIstisnasi ? ` (yaş ${detay.izinHak.sonraki.yas}, en az 20)` : ""}`}
                />
              </div>
            )}

            {(detay.izinHak.gecmis ?? []).length > 0 && (
              <div className="pl-zaman" style={{ marginTop: 10 }}>
                {(detay.izinHak.gecmis as any[]).map((g) => (
                  <div key={g.kidemYili} className={`pl-z${g.durum === "atlandı" ? " pl-gri" : ""}`}>
                    <b>
                      {g.kidemYili}. yıl · {tarihYaz(g.yildonumu)}
                      {g.durum === "atlandı" ? (
                        <span className="pl-etiket pl-e-gri">İK elle girmiş · atlandı</span>
                      ) : (
                        <span className="pl-etiket pl-e-yesil">
                          +{g.gun} gün {g.durum === "düzeltildi" ? "· İş Kanunu süresine düzeltildi" : "yüklendi"}
                        </span>
                      )}
                    </b>
                    <small>
                      hak edilen {g.oncekiBaslangic ?? 0} → {g.yeniBaslangic ?? 0} · devir {g.oncekiDevir ?? 0} →{" "}
                      {g.yeniDevir ?? 0}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </PlKart>
        )}

        {bordroDonemleri.length > 0 && (
          <PlKart
            baslik="Kıdem"
            ikon={<History size={16} strokeWidth={2} />}
            rozet="Bordrodaki bütün girişler · aynı T.C."
            sag={
              <span className="pl-rozetli">
                {sureMetni(kidemGun(kisi))}
                {kd?.kaynak === "elle" ? " · İK düzeltmesi" : kd?.kaynak === "bordro" ? " · otomatik" : ""}
              </span>
            }
          >
            <div className="pl-alanlar">
              <Alan t="İlk işe giriş" v={kd?.ilkGiris ? tarihYaz(kd.ilkGiris) : null} />
              <Alan
                t="Çalışılmayan ara süre"
                v={kd?.bosGun ? `${kd.bosGun} gün · ${(kd.aralar ?? []).length} ara dönem` : "yok"}
              />
              <Alan t="Kıdem esas tarihi" v={kd?.tarih ? tarihYaz(kd.tarih) : null} />
            </div>

            {kd?.kaynak === "elle" && kd?.bosGun > 0 && kd?.tarih && kd?.ilkGiris &&
              !dayjs(kd.ilkGiris).add(kd.bosGun, "day").isSame(dayjs(kd.tarih), "day") && (
                <div className="pl-uyari pl-turuncu" style={{ marginTop: 10 }}>
                  <AlertTriangle size={16} strokeWidth={2.2} />
                  <div>
                    <b>İK düzeltmesi bordrodan farklı.</b> Bordroya göre esas tarih{" "}
                    {tarihYaz(dayjs(kd.ilkGiris).add(kd.bosGun, "day").format("YYYY-MM-DD"))} olmalı.
                    Yıllık İzin → hak ediş tarihi penceresinden "Bordrodan getir" ile güncelleyebilirsiniz.
                  </div>
                </div>
              )}

            <div className="pl-zaman" style={{ marginTop: 10 }}>
              {[...bordroDonemleri]
                .sort((a, b) => dayjs(b.giris).valueOf() - dayjs(a.giris).valueOf())
                .map((g: any, i: number) => (
                  <div key={`${g.kod}-${i}`} className={`pl-z${g.cikis ? " pl-gri" : ""}`}>
                    <b>
                      {tarihYaz(g.giris)} – {g.cikis ? tarihYaz(g.cikis) : "devam ediyor"}
                      {g.kod && <span className="pl-etiket pl-e-gri">Sicil {g.kod}</span>}
                      {!g.cikis && <span className="pl-etiket pl-e-yesil">Devam</span>}
                    </b>
                    <small>
                      {sureMetni(
                        Math.max(0, dayjs(g.cikis ?? undefined).diff(dayjs(g.giris), "day") + (g.cikis ? 1 : 0))
                      )}
                    </small>
                  </div>
                ))}
            </div>
          </PlKart>
        )}

        <PlKart
          baslik="Çalışma dönemleri"
          ikon={<History size={16} strokeWidth={2} />}
          rozet="Mikro kayıtları · geri dönüşler dahil"
          sag={
            <span className="pl-rozetli">
              {donemler.length} dönem · toplam {sureMetni(detay.toplamGun)}
            </span>
          }
        >
          {/* Kişi birden çok kez ayrıldıysa tüm çıkışlar görünür */}
          {cikislar.length > 1 && (
            <div className="pl-uyari pl-turuncu">
              <AlertTriangle size={16} strokeWidth={2.2} />
              <div>
                <b>Birden fazla kez işten ayrılmış</b> · {cikislar.length} çıkış kaydı
              </div>
            </div>
          )}

          {donemler.length === 0 ? (
            <div className="pl-bos-ic">Dönem kaydı yok.</div>
          ) : (
            <div className="pl-zaman">
              {donemler.map((g: any, i: number) => (
                <div
                  key={`${g.personelKodu}-${i}`}
                  className={`pl-z${!g.cikisTarihi || g.ayrilacak ? "" : g.cikisSebebi ? " pl-turuncu" : " pl-gri"}`}
                >
                  <b>
                    {[g.isGrubu || g.sube, g.pozisyon].filter(Boolean).join(" · ") || "—"}
                    {g.personelKodu && (
                      <span className="pl-etiket pl-e-gri">Sicil {g.personelKodu}</span>
                    )}
                    {!g.cikisTarihi && <span className="pl-etiket pl-e-yesil">Devam</span>}
                    {g.ayrilacak && <span className="pl-etiket pl-e-turuncu">Ayrılacak</span>}
                  </b>
                  <small>
                    {tarihYaz(g.girisTarihi)} – {g.cikisTarihi ? tarihYaz(g.cikisTarihi) : "devam ediyor"} ·{" "}
                    {sureMetni(g.calismaGunu)}
                    {g.cikisTarihi && ` · ${g.cikisSebebi || "sebep belirtilmemiş"}`}
                  </small>
                </div>
              ))}
            </div>
          )}
        </PlKart>

        <PlKart
          baslik="Değişiklik geçmişi"
          ikon={<SquarePen size={16} strokeWidth={2} />}
          rozet="Mikro alanları · saatlik karşılaştırma"
          sag={
            <button type="button" className="pl-btn pl-btn-ince" onClick={() => gecmisAc(kod)}>
              <ExternalLink size={14} strokeWidth={2} />
              Ayrı pencerede aç
            </button>
          }
        >
          <p className="pl-aciklama">
            Mikro alan bazlı geçmiş tutmadığı için değişiklikler saatlik karşılaştırmayla
            yakalanır.{" "}
            {gecmisBas
              ? `İzleme ${dayjs(gecmisBas).format("DD.MM.YYYY")} tarihinde başladı; öncesi görünmez.`
              : "İzleme henüz yeni başladı."}{" "}
            Aynı saat içinde yapılıp geri alınan değişiklikler kaydedilmez.
          </p>

          {gecmisYukleniyor ? (
            <div className="pl-bos">
              <Spin />
            </div>
          ) : gecmis.length === 0 ? (
            <div className="pl-bos-ic">Bu personel için kayıtlı değişiklik yok.</div>
          ) : (
            <div className="pl-zaman">
              {gecmis.map((g, i) => (
                <div className="pl-z pl-gri" key={i}>
                  <b>
                    {g.alan}
                    {g.kullanici && <span className="pl-etiket pl-e-gri">{g.kullanici}</span>}
                  </b>
                  <div className="pl-degisim">
                    <del>{g.eskiDeger || "boş"}</del> → <strong>{g.yeniDeger || "boş"}</strong>
                  </div>
                  <small>{dayjs(g.tarih).format("DD.MM.YYYY HH:mm")}</small>
                </div>
              ))}
            </div>
          )}
        </PlKart>
      </>
    );

    /* -------------------------------------------------------- performans */
    const perfDonemSecici = (perfBu?.donemler ?? []).length > 0 && (
      <Select
        size="small"
        style={{ width: 130 }}
        placeholder="Dönem"
        value={perfDonem}
        onChange={setPerfDonem}
        options={perfBu.donemler.map((d: any) => ({
          value: `${d.yil}-${d.ay}`,
          label: donemAdi(d).replace("/", " / "),
        }))}
      />
    );

    const perfSekmesi =
      perfYukleniyor || (!perfBu && !perfGizli) ? (
        <div className="pl-bos">
          <Spin />
        </div>
      ) : !perfBu?.bulundu ? (
        <div className="pl-kart pl-bos">
          <Empty
            description={perfBu?.hata ?? "Bu personel için performans değerlendirmesi bulunamadı."}
          />
        </div>
      ) : perfBu.donemler.length === 0 ? (
        <div className="pl-kart pl-bos">
          <Empty description="Henüz değerlendirme dönemi yok." />
        </div>
      ) : (
        (() => {
          const onceki = perfBu.donemler[1];
          const fark = onceki ? donemToplam(sonDonem) - donemToplam(onceki) : null;
          const son6 = perfBu.donemler.slice(0, 6).reverse();
          const enCok = Math.max(1, ...son6.map(donemToplam));
          /* Çubuklar sıfırdan değil, en düşüğün biraz altından başlar:
             72 ile 86 arasındaki fark görünsün. */
          const taban = Math.floor(Math.min(...son6.map(donemToplam)) * 0.75);

          return (
            <>
              <div className="pl-izgara pl-i2 pl-esit">
                <PlKart
                  baslik={`Son dönem · ${donemAdi(sonDonem)}`}
                  ikon={<TrendingUp size={16} strokeWidth={2} />}
                  sag={
                    <>
                      {sonDonem.gorevAdi && <Tag color="blue">{sonDonem.gorevAdi}</Tag>}
                      {sonDonem.subeAdi && <Tag>{sonDonem.subeAdi}</Tag>}
                    </>
                  }
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="pl-puan">{donemToplam(sonDonem)}</span>
                    <span className="pl-rozetli">puan</span>
                    {fark !== null && (
                      <Tooltip title={`Önceki dönem (${donemAdi(onceki)}): ${donemToplam(onceki)} puan`}>
                        <span
                          className={`pl-etiket ${fark > 0 ? "pl-e-yesil" : fark < 0 ? "pl-e-kirmizi" : "pl-e-gri"}`}
                        >
                          {fark > 0 ? `▲ +${fark}` : fark < 0 ? `▼ ${fark}` : "değişmedi"}
                        </span>
                      </Tooltip>
                    )}
                  </div>

                  <div className="pl-mini">
                    <div>
                      <span>Mağaza</span>
                      <b>{sonDonem.magazaToplam ?? 0} puan</b>
                    </div>
                    <div>
                      <span>Yetkinlik</span>
                      <b>{sonDonem.yetkinlikToplam ?? 0} puan</b>
                    </div>
                    <div>
                      <span>Şirket sırası</span>
                      <b>{sonDonem.sirketSirasi > 0 ? `#${sonDonem.sirketSirasi}` : "—"}</b>
                    </div>
                  </div>
                </PlKart>

                <PlKart
                  baslik={`Son ${son6.length} dönem`}
                  ikon={<TrendingUp size={16} strokeWidth={2} />}
                >
                  <div className="pl-perf">
                    {son6.map((d: any, i: number) => (
                      <div key={`${d.yil}-${d.ay}`}>
                        <b>{donemToplam(d)}</b>
                        <i
                          style={{
                            height: `${Math.max(6, ((donemToplam(d) - taban) / Math.max(1, enCok - taban)) * 100)}%`,
                            opacity: i === son6.length - 1 ? 1 : 0.45,
                          }}
                        />
                        <small>{dayjs(`${d.yil}-${String(d.ay).padStart(2, "0")}-01`).format("MMM YY")}</small>
                      </div>
                    ))}
                  </div>
                </PlKart>
              </div>

              <PlKart
                baslik="Dönem ayrıntısı"
                ikon={<SlidersHorizontal size={16} strokeWidth={2} />}
                sag={
                  <>
                    {perfDonemSecici}
                    <button
                      type="button"
                      className="pl-btn pl-btn-ince"
                      onClick={() => performansAc(kisi)}
                    >
                      <ExternalLink size={14} strokeWidth={2} />
                      Ayrı pencerede aç
                    </button>
                  </>
                }
              >
                {perfDonemKartlari()}
              </PlKart>
            </>
          );
        })()
      );

    /* ------------------------------------------------- Biçen360 ve kart */
    const uygSekmesi = (
      <div className="pl-izgara pl-i12 pl-uyg-alan">
        {/* Biçen360: uygulama girişi, cihaz ve eşleştirme kaldırma */}
        <MobilUygulamaKutusu sicil={kod} />
        {/* Biçen Kart: tanımlı kart ve güncel bakiye */}
        <BicenKartKutusu sicil={kod} adSoyad={adSoyad} />
      </div>
    );

    /* ------------------------------------------------------------ notlar */
    const notSekmesi = (
      <PlKart
        baslik="Başvuru notları"
        ikon={<MessageSquare size={16} strokeWidth={2} />}
        rozet={notlar.length > 0 ? `${notlar.length} not` : undefined}
      >
        <p className="pl-aciklama">
          Başvuru sürecinde İK'nın yazdığı notlar. Görüşmede ne konuşulduğu ve hangi
          şartlarla anlaşıldığı buradadır.
        </p>

        {notlar.length === 0 ? (
          <div className="pl-bos-ic">Bu personel için başvuru notu yok.</div>
        ) : (
          notlar.map((n: any, i: number) => (
            <div className="pl-not" key={i}>
              <b>{n.adSoyad || "—"}</b>
              <small>
                {dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}
                {n.basvuruNo && ` · ${n.basvuruNo}`}
              </small>
              <p>{n.metin}</p>
            </div>
          ))
        )}
      </PlKart>
    );

    return (
      <>
        {hero}

        <div className={`pl-govde${hizli.length === 0 ? " pl-govde-sade" : ""}`}>
          {sekmeler.length > 1 && (
            <div className="pl-psekme" role="tablist">
              {sekmeler.map((s) => (
                <button
                  key={s.k}
                  type="button"
                  role="tab"
                  aria-selected={sekme === s.k}
                  className={sekme === s.k ? "pl-aktif" : undefined}
                  onClick={() => setProfilSekme(s.k)}
                >
                  {s.ikon}
                  {s.ad}
                  {s.say !== undefined && <span className="pl-say">{s.say}</span>}
                </button>
              ))}
            </div>
          )}

          {sekme === "genel" && (
            <>
              {genel}
              {/* Haftanın vardiya planı (mağaza müdürünün gönderdiği) */}
              {!sinirli && kisi.durum === 1 && <PersonelVardiya personelKodu={kod} />}
            </>
          )}
          {sekme === "izin" && izinSekmesi}
          {sekme === "rapor" && (
            <PersonelRaporlar
              personelKodu={kod}
              personelAdi={adSoyad}
              sayiDegisti={setRaporSayisi}
              durumDegisti={(d) => raporDurumuYaz(kod, d)}
            />
          )}
          {sekme === "belge" && (
            <PersonelBelgeler
              personelKodu={kod}
              personelAdi={adSoyad}
              sayiDegisti={setBelgeSayisi}
            />
          )}
          {sekme === "avans" && <PersonelAvans personelKodu={kod} />}
          {sekme === "calisma" && calismaSekmesi}
          {sekme === "perf" && (
            <>
              <PersonelDegerlendirme personelKodu={kod} />
              <div className="pd-ayrac">AYLIK PERFORMANS AYRINTISI</div>
              {perfSekmesi}
            </>
          )}
          {sekme === "uyg" && uygSekmesi}
          {sekme === "not" && notSekmesi}
        </div>
      </>
    );
  };

  /* ----------------------------------------------------------------- liste */

  const digerFiltreler = (
    <div className="pl-pop-ic">
      <div>
        <label>Fotoğraf</label>
        <Select
          style={{ width: "100%" }}
          value={resimSuzgec}
          onChange={setResimSuzgec}
          options={[
            { value: "hepsi", label: "Fotoğraf: tümü" },
            { value: "var", label: "Fotoğrafı olanlar" },
            { value: "yok", label: "Fotoğrafı olmayanlar" },
          ]}
        />
      </div>

      <div>
        <label>Tarih aralığı</label>
        <Space.Compact block>
          <Select
            style={{ width: 110 }}
            value={tarihTuru}
            onChange={setTarihTuru}
            options={[
              { value: "giris", label: "İşe giriş" },
              { value: "cikis", label: "Çıkış" },
            ]}
          />
          <RangePicker
            value={tarihAralik as any}
            format="DD.MM.YYYY"
            placeholder={["Başlangıç", "Bitiş"]}
            style={{ width: "100%" }}
            onChange={(d) => setTarihAralik(d as [Dayjs, Dayjs] | null)}
          />
        </Space.Compact>
      </div>

      <div className="pl-pop-alt">
        <Button
          size="small"
          type="text"
          disabled={ikinciSuzgecSayisi === 0 && resimSuzgec === "hepsi"}
          onClick={() => {
            setResimSuzgec("hepsi");
            setTarihAralik(null);
          }}
        >
          Temizle
        </Button>
        <Button size="small" type="primary" onClick={() => setDigerAcik(false)}>
          Tamam
        </Button>
      </div>
    </div>
  );

  const sayfadakiler = liste.slice((sayfa - 1) * sayfaBoyu, sayfa * sayfaBoyu);

  const listeIcerik = hata ? (
    <div style={{ padding: 16 }}>
      <Alert
        type="error"
        showIcon
        message="Personel listesi alınamadı"
        action={
          <Button
            size="small"
            onClick={async () => {
              try {
                const sonuc = await api.al<any>("/api/Personel/Tani");
                setTani(sonuc.adimlar ?? []);
              } catch (h: any) {
                message.error(h.message);
              }
            }}
          >
            Bağlantıyı sına
          </Button>
        }
        description={
          <div>
            <pre className="pr-hata">{hata}</pre>
            <div style={{ fontSize: 12.5, marginTop: 8, color: "#6b7280" }}>
              Personel verisi Mikro veritabanından (MikroDesktop_2004BICEN) okunur.
              Sunucunun bu veritabanına erişebildiğinden ve
              <code> appsettings.json</code> dosyasındaki
              <code> ConnectionStrings:Personel</code> bilgisinin doğru olduğundan emin
              olunuz.
            </div>

            {tani && (
              <div className="pr-tani">
                <Text strong style={{ fontSize: 13 }}>
                  Bağlantı sınama sonucu
                </Text>
                {tani.map((a: any, i: number) => (
                  <div key={i} className="pr-tani-satir">
                    <b>{a.adim}</b>
                    <span>{a.sonuc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
      />
    </div>
  ) : yukleniyor ? (
    <div className="pl-bos">
      <Spin />
    </div>
  ) : liste.length === 0 ? (
    <div className="pl-bos">
      <Empty description="Gösterilecek personel bulunamadı." />
    </div>
  ) : gorunum === "tablo" ? (
    <Tablo<Personel>
      className="pl-tablo"
      rowKey="personId"
      columns={sutunlar}
      dataSource={liste}
      tableLayout="fixed"
      pagination={{
        current: sayfa,
        pageSize: sayfaBoyu,
        showSizeChanger: true,
        pageSizeOptions: ["25", "50", "100", "500"],
        locale: { items_per_page: "kayıt / sayfa" },
        showTotal: sayfaMetni,
        onChange: (s, b) => {
          setSayfa(b !== sayfaBoyu ? 1 : s);
          setSayfaBoyu(b);
        },
      }}
      rowClassName={(p) => (p.durum === 1 ? "" : "pl-ayrilan")}
      onRow={(p) => ({ onClick: () => detayAc(p.personelKodu) })}
    />
  ) : (
    <>
      <div className="pl-kartlar">
        {sayfadakiler.map((p) => {
          const b = bugunDurum(p);

          return (
            <button
              type="button"
              key={p.personId}
              className={`pl-pk${p.durum === 1 ? "" : " pl-ayrilan"}`}
              onClick={() => detayAc(p.personelKodu)}
            >
              <Avatar p={p} boyut={64} nokta={b.tur} />
              <b title={`${p.ad} ${p.soyad}`}>{buyuk(`${p.ad} ${p.soyad}`)}</b>
              <small>
                {[p.pozisyon, p.sube].filter(Boolean).join(" · ") || "—"}
              </small>
              <div className="pl-pk-alt">
                <BugunCip b={b} p={p} />
                {kisiEtiketleri(p)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pl-sayfalama">
        <Pagination
          size="small"
          current={sayfa}
          pageSize={sayfaBoyu}
          total={liste.length}
          showSizeChanger
          pageSizeOptions={["25", "50", "100", "500"]}
          locale={{ items_per_page: "kayıt / sayfa" }}
          showTotal={sayfaMetni}
          onChange={(s, b) => {
            setSayfa(b !== sayfaBoyu ? 1 : s);
            setSayfaBoyu(b);
          }}
        />
      </div>
    </>
  );

  const segmentSayisi = (s: "calisan" | "ayrilan" | "hepsi") => {
    const c = veri.toplamCalisan ?? (durum === "calisan" ? veri.calisan : undefined);
    const a = veri.toplamAyrilan ?? (durum === "ayrilan" ? veri.ayrilan : undefined);

    if (s === "calisan") return c;
    if (s === "ayrilan") return a;
    return c !== undefined && a !== undefined ? c + a : undefined;
  };

  /* Personel kartı ve ondan açılan pencereler: liste sayfasında ve
     her sayfadan açılan tek kart modunda (09.10.2026) ortak */
  const kartBolumu = (
    <>
      {/* ------------------------------------- personel bilgilerini düzenle */}
      {detay?.kisi && detay.duzenlenebilir && (
        <PersonelDuzenle
          acik={duzenleAcik}
          kod={detay.kisi.personelKodu}
          adSoyad={`${detay.kisi.ad ?? ""} ${detay.kisi.soyad ?? ""}`.trim()}
          pozisyonlar={veri.pozisyonlar ?? []}
          salt={[
            { etiket: "Personel Kodu", deger: detay.kisi.personelKodu },
            { etiket: "TC Kimlik No", deger: detay.kisi.kimlikNo },
            {
              etiket: "Doğum Tarihi",
              deger:
                (detay.ekBilgiler ?? []).find((b: any) => b.alan === "Doğum Tarihi")?.deger ?? "",
            },
            {
              etiket: "İşe Giriş",
              deger: detay.kisi.girisTarihi ? dayjs(detay.kisi.girisTarihi).format("DD.MM.YYYY") : "",
            },
            {
              etiket: "İşten Çıkış",
              deger: detay.kisi.cikisTarihi ? dayjs(detay.kisi.cikisTarihi).format("DD.MM.YYYY") : "",
            },
            ...(detay.kisi.cikisSebebi
              ? [{ etiket: "Çıkış Sebebi", deger: detay.kisi.cikisSebebi }]
              : []),
            ...(detay.kisi.ucret != null
              ? [
                  {
                    etiket: "Ücret",
                    deger: `${Number(detay.kisi.ucret).toLocaleString("tr-TR")} TL`,
                  },
                ]
              : []),
          ]}
          kapat={() => setDuzenleAcik(false)}
          kaydedildi={() => {
            /* Kart Mikro'dan yeniden okunur; liste de tazelenir ki satırda
               eski telefon / şube kalmasın. Sunucuda önbellek yok:
               TumPersonelleriGetir her istekte Mikro'yu sorguluyor. */
            detayAc(detay.kisi.personelKodu);
            getir();
          }}
        />
      )}

      {/* ------------------------------------------------- personel kartı */}
      <Drawer
        open={!!detay}
        onClose={detayKapat}
        width="min(1080px, 96vw)"
        rootClassName="pl-cekmece"
        closable={false}
        title={null}
      >
        {detayYukleniyor || !detay?.kisi ? (
          <div className="pl-yukleniyor">
            <Spin />
          </div>
        ) : (
          profil()
        )}
      </Drawer>
    </>
  );

  const ekCekmeceler = (
    <>
      {/* ------------------------------------------------- performans */}
      <Drawer
        open={!!perfKisi}
        onClose={() => setPerfKisi(null)}
        width="min(720px, 96vw)"
        title={
          perfKisi && (
            <Space size={8} wrap>
              <TrendingUp size={16} strokeWidth={2} />
              <Text strong>
                {perfKisi.ad} {perfKisi.soyad}
              </Text>
            </Space>
          )
        }
        extra={
          (perf?.donemler ?? []).length > 0 && (
            <Select
              size="small"
              style={{ width: 140 }}
              placeholder="Dönem"
              value={perfDonem}
              onChange={setPerfDonem}
              options={perf.donemler.map((d: any) => ({
                value: `${d.yil}-${d.ay}`,
                label: `${d.yil} / ${String(d.ay).padStart(2, "0")}`,
              }))}
            />
          )
        }
      >
        {perfYukleniyor ? (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <Spin />
          </div>
        ) : !perf?.bulundu ? (
          <Empty
            description={
              perf?.hata ??
              "Bu personel için performans değerlendirmesi bulunamadı."
            }
          />
        ) : perf.donemler.length === 0 ? (
          <Empty description="Henüz değerlendirme dönemi yok." />
        ) : (
          perfDonemKartlari()
        )}
      </Drawer>

      {/* ------------------------------------------- değişiklik geçmişi */}
      <Drawer
        open={!!gecmisKod}
        onClose={() => setGecmisKod(null)}
        width="min(620px, 96vw)"
        title={
          <Space size={8}>
            <History size={16} strokeWidth={2} />
            <Text strong>Değişiklik geçmişi</Text>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Bu geçmiş sistemin kendi karşılaştırmasından gelir"
          description={
            <span style={{ fontSize: 12.5 }}>
              Mikro alan bazlı geçmiş tutmadığı için değişiklikler saatlik
              karşılaştırmayla yakalanır.{" "}
              {gecmisBas
                ? `İzleme ${dayjs(gecmisBas).format("DD.MM.YYYY")} tarihinde başladı; öncesi görünmez.`
                : "İzleme henüz yeni başladı."}{" "}
              Aynı saat içinde yapılıp geri alınan değişiklikler kaydedilmez.
            </span>
          }
        />

        {gecmisYukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : gecmis.length === 0 ? (
          <Empty description="Bu personel için kayıtlı değişiklik yok." />
        ) : (
          <Timeline
            items={gecmis.map((g) => ({
              color: "green",
              children: (
                <div>
                  <Space size={6} wrap>
                    <Text strong style={{ fontSize: 13.5 }}>
                      {g.alan}
                    </Text>
                    {g.kullanici && <Tag>{g.kullanici}</Tag>}
                  </Space>

                  <div style={{ marginTop: 4 }}>
                    <Text delete type="secondary" style={{ fontSize: 13 }}>
                      {g.eskiDeger || "boş"}
                    </Text>
                    <Text style={{ fontSize: 13 }}> → </Text>
                    <Text strong style={{ fontSize: 13 }}>
                      {g.yeniDeger || "boş"}
                    </Text>
                  </div>

                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {dayjs(g.tarih).format("DD.MM.YYYY HH:mm")}
                  </Text>
                </div>
              ),
            }))}
          />
        )}
      </Drawer>
    </>
  );

  if (kartModu) return <>{kartBolumu}{ekCekmeceler}</>;

  return (
    <div className="ik-icerik">
      <Tabs
        defaultActiveKey="liste"
        destroyInactiveTabPane
        items={[
          {
            key: "liste",
            label: (
              <Space size={6}>
                <Users size={15} strokeWidth={2} />
                Personel Listesi
              </Space>
            ),
            children: (
              <div className="pl">
      {/* ------------------------------------------------------------ başlık */}
      <div className="pl-baslik">
        <div>
          <h1>Personeller</h1>
          <p>Mikro'daki personel kartları; izin, belge, Biçen360 ve vardiya bilgileriyle birlikte.</p>
        </div>

        <div className="pl-baslik-sag">
          <button type="button" className="pl-btn" onClick={getir} disabled={yukleniyor} title="Yenile">
            <RefreshCw size={15} strokeWidth={2} className={yukleniyor ? "pl-donen" : undefined} />
            Yenile
          </button>

          <button type="button" className="pl-btn" onClick={disaAktar}>
            <Download size={15} strokeWidth={2} />
            Excel
          </button>

          {yonetici && (
            <Tooltip title="Mikro iş grubu ve ünvan adlarını sistemdeki birim ve pozisyonlara bağlar">
              <button type="button" className="pl-btn" onClick={eslemeAc}>
                <Link2 size={15} strokeWidth={2} />
                Birim ve ünvan eşleştirmeleri
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------------- özet */}
      <div className="pl-kpi" style={{ ["--pl-kpi-sutun" as any]: kpiler.length }}>
        {kpiler.map((k) => {
          const ic = (
            <>
              <div className="pl-k-ust">
                <span className="pl-k-ik" style={{ background: k.renk[0], color: k.renk[1] }}>
                  {k.ikon}
                </span>
                {k.baslik}
              </div>
              <div className="pl-k-sayi">{yukleniyor ? <Spin size="small" /> : k.sayi}</div>
              <div className="pl-k-alt">{k.alt}</div>
            </>
          );

          return k.tikla ? (
            <Tooltip key={k.anahtar} title={k.ipucu}>
              <button
                type="button"
                className={`pl-k${k.secili ? " pl-secili" : ""}`}
                aria-pressed={!!k.secili}
                onClick={k.tikla}
              >
                {ic}
              </button>
            </Tooltip>
          ) : (
            <div key={k.anahtar} className="pl-k">
              {ic}
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ filtre */}
      <div className="pl-filtre">
        <div className="pl-filtre-satir">
        <div className="pl-seg" role="group" aria-label="Durum">
          {(
            [
              ["calisan", "Çalışan"],
              ["ayrilan", "Ayrılan"],
              ["hepsi", "Tümü"],
            ] as const
          ).map(([v, ad]) => {
            const n = segmentSayisi(v);

            return (
              <button
                key={v}
                type="button"
                className={durum === v ? "pl-aktif" : undefined}
                onClick={() => setDurum(v)}
              >
                {ad}
                {n !== undefined && <small>{n.toLocaleString("tr-TR")}</small>}
              </button>
            );
          })}
        </div>

        <Input
          className="pl-ara"
          allowClear
          placeholder="Ad, sicil, TC ya da telefon ara"
          prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />

        <Select
          className="pl-sec"
          allowClear
          showSearch
          placeholder="Tüm şubeler"
          value={sube}
          onChange={setSube}
          options={veri.subeler.map((x) => ({ value: x, label: x }))}
          popupMatchSelectWidth={false}
        />

        <Select
          className="pl-sec"
          allowClear
          showSearch
          placeholder="Tüm ünvanlar"
          value={pozisyon}
          onChange={setPozisyon}
          options={veri.pozisyonlar.map((x) => ({ value: x, label: x }))}
          popupMatchSelectWidth={false}
        />

        <div className="pl-filtre-sag">
          <Popover
            trigger="click"
            placement="bottomRight"
            open={digerAcik}
            onOpenChange={setDigerAcik}
            content={digerFiltreler}
            overlayClassName="pl-pop"
            arrow={false}
          >
            <button
              type="button"
              className={`pl-btn pl-btn-ince${ikinciSuzgecSayisi > 0 ? " pl-aktif" : ""}`}
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
              Diğer filtreler
              {ikinciSuzgecSayisi > 0 && <span className="pl-say">{ikinciSuzgecSayisi}</span>}
            </button>
          </Popover>

          <div className="pl-gorunum" role="group" aria-label="Görünüm">
            <Tooltip title="Liste">
              <button
                type="button"
                aria-label="Liste görünümü"
                className={`pl-btn pl-btn-ikon${gorunum === "tablo" ? " pl-aktif" : ""}`}
                onClick={() => setGorunum("tablo")}
              >
                <List size={16} strokeWidth={2} />
              </button>
            </Tooltip>
            <Tooltip title="Kartlar">
              <button
                type="button"
                aria-label="Kart görünümü"
                className={`pl-btn pl-btn-ikon${gorunum === "kart" ? " pl-aktif" : ""}`}
                onClick={() => setGorunum("kart")}
              >
                <LayoutGrid size={16} strokeWidth={2} />
              </button>
            </Tooltip>
          </div>
        </div>
        </div>

        <div className="pl-filtre-satir">
        <div className="pl-cipler">
          <button
            type="button"
            className={`pl-cip${izindeSuz ? " pl-acik" : ""}`}
            aria-pressed={izindeSuz}
            onClick={() => setIzindeSuz(!izindeSuz)}
          >
            <CalendarDays size={14} strokeWidth={2} />
            İzinde
          </button>

          {veri.raporlular !== null && (
            <button
              type="button"
              className={`pl-cip${raporluSuz ? " pl-acik" : ""}`}
              aria-pressed={raporluSuz}
              onClick={() => setRaporluSuz(!raporluSuz)}
            >
              <HeartPulse size={14} strokeWidth={2} />
              Raporlu
            </button>
          )}

          {veri.evrakEksikleri && Object.keys(veri.evrakEksikleri).length > 0 && (
            <Tooltip title="İşe giriş evrakı eksik olan çalışanlar">
              <button
                type="button"
                className={`pl-cip${evrakEksikSuz ? " pl-acik" : ""}`}
                aria-pressed={evrakEksikSuz}
                onClick={() => setEvrakEksikSuz(!evrakEksikSuz)}
              >
                <FileWarning size={14} strokeWidth={2} />
                Evrak eksik
                <span className="pl-cip-say">{Object.keys(veri.evrakEksikleri).length}</span>
              </button>
            </Tooltip>
          )}

          <button
            type="button"
            className={`pl-cip${resimSuzgec === "yok" ? " pl-acik" : ""}`}
            aria-pressed={resimSuzgec === "yok"}
            onClick={() => setResimSuzgec(resimSuzgec === "yok" ? "hepsi" : "yok")}
          >
            <UserRound size={14} strokeWidth={2} />
            Fotoğrafı yok
          </button>

          {uygKume && (
            <button
              type="button"
              className={`pl-cip${uygYok ? " pl-acik" : ""}`}
              aria-pressed={uygYok}
              onClick={() => setUygYok(!uygYok)}
            >
              <Smartphone size={14} strokeWidth={2} />
              Biçen360 yok
            </button>
          )}

          <Tooltip title="Engellilik derecesi 0'dan büyük olan personel">
            <button
              type="button"
              className={`pl-cip${yalnizEngelli ? " pl-acik" : ""}`}
              aria-pressed={yalnizEngelli}
              onClick={() => setYalnizEngelli(!yalnizEngelli)}
            >
              <Accessibility size={14} strokeWidth={2} />
              Engelli
            </button>
          </Tooltip>

          {(izindeSuz || raporluSuz || uygYok || yalnizEngelli || resimSuzgec !== "hepsi" || tarihAralik || sube || pozisyon || arama) && (
            <button
              type="button"
              className="pl-baglanti pl-temizle"
              onClick={() => {
                setIzindeSuz(false);
                setRaporluSuz(false);
                setUygYok(false);
                setYalnizEngelli(false);
                setResimSuzgec("hepsi");
                setTarihAralik(null);
                setSube(undefined);
                setPozisyon(undefined);
                setArama("");
              }}
            >
              Süzgeçleri temizle
            </button>
          )}
        </div>

        </div>
      </div>

      {/* ------------------------------------------------------------ içerik */}
      <div className="pl-liste">
        <div className="pl-liste-bas">
          <b>{listeBasligi}</b>
          <span>{yukleniyor ? "yükleniyor…" : `${liste.length.toLocaleString("tr-TR")} kişi`}</span>
          {tarihAralik && (
            <span className="pl-sag">
              {tarihTuru === "giris" ? "İşe giriş" : "Çıkış"}: {tarihAralik[0].format("DD.MM.YYYY")} –{" "}
              {tarihAralik[1].format("DD.MM.YYYY")}
            </span>
          )}
        </div>

        {listeIcerik}
      </div>

      {kartBolumu}
              </div>
            ),
          },
          {
            key: "takip",
            label: (
              <Space size={6}>
                <CalendarCheck size={15} strokeWidth={2} />
                Oryantasyon Takip
              </Space>
            ),
            children: <PersonelTakip />,
          },
          {
            key: "donemsel",
            label: (
              <Space size={6}>
                <Star size={15} strokeWidth={2} />
                Dönemsel Değerlendirme
              </Space>
            ),
            children: <DonemselDegerlendirme />,
          },
          {
            key: "organizasyon",
            label: (
              <Space size={6}>
                <Network size={15} strokeWidth={2} />
                Organizasyon Şeması
              </Space>
            ),
            children: <Organizasyon />,
          },
          {
            key: "izinonay",
            label: <span>İzin Onay Süreci</span>,
            children: <IzinOnaySureci />,
          },
          {
            key: "vardiyaplan",
            label: <span>Vardiya Planları</span>,
            children: <VardiyaPlanlari />,
          },
          /* Toplu vardiya: birim/departman personeline haftalık desen
             (sunucu ucu Admin, GMY, İK yöneticisi ve İK'ya açık) */
          ...(["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(oturumOku()?.rol ?? "")
            ? [
                {
                  key: "topluvardiya",
                  label: <span>Toplu Vardiya</span>,
                  children: <TopluVardiya />,
                },
              ]
            : []),
          {
            key: "maas",
            label: (
              <Space size={6}>
                <Wallet size={15} strokeWidth={2} />
                Maaş Skalası
              </Space>
            ),
            children: <MaasSkala />,
          },
        ]}
      />

      {/* ---------------------------------------------- ad eşleştirmeleri */}
      <Drawer
        open={eslemeAcik}
        onClose={() => setEslemeAcik(false)}
        width="min(820px, 96vw)"
        className="rp-cekmece"
        title={
          <Space size={8}>
            <Link2 size={16} strokeWidth={2} />
            <Text strong>Birim ve Ünvan Eşleştirmeleri</Text>
          </Space>
        }
        footer={
          <Space style={{ float: "right" }}>
            <Button onClick={() => setEslemeAcik(false)}>Vazgeç</Button>
            <Button type="primary" loading={eslemeYukleniyor} onClick={eslemeKaydet}>
              Kaydet
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Personel kaynağındaki adları sistemdeki karşılıklarına bağlayın"
          description={
            <span>
              Mikro'daki iş grubu adları sistemdeki birimlerle her zaman aynı
              değildir. Örneğin <b>HAL ŞOFÖRÜ</b> ayrı bir iş grubudur ancak
              Genel Müdürlük'e bağlıdır. Burada tanımladığınız eşleştirmeler,
              Norm Kadro ekranında bir pozisyona tıklandığında doğru personelin
              gelmesini sağlar.
            </span>
          }
        />

        {eslemeYukleniyor && kaynakGruplar.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : (
          <Tabs
            defaultActiveKey="grup"
            items={[
              {
                key: "grup",
                label: `İş Grubu → Birim (${grupEsleme.length})`,
                children: (
                  <>
                    {grupEsleme.map((e, sira) => (
                      <Row gutter={[8, 8]} align="middle" key={sira} style={{ marginBottom: 8 }}>
                        <Col xs={11}>
                          <Select
                            showSearch
                            allowClear
                            style={{ width: "100%" }}
                            placeholder="Kaynaktaki iş grubu"
                            value={e.kaynak || undefined}
                            options={kaynakGruplar.map((x) => ({ value: x, label: x }))}
                            onChange={(v) => {
                              const yeni = [...grupEsleme];
                              yeni[sira] = { ...yeni[sira], kaynak: v };
                              setGrupEsleme(yeni);
                            }}
                          />
                        </Col>

                        <Col xs={1} style={{ textAlign: "center" }}>
                          <ArrowRight size={14} strokeWidth={2} color="#9AA3AF" />
                        </Col>

                        <Col xs={10}>
                          <Select
                            showSearch
                            allowClear
                            optionFilterProp="label"
                            style={{ width: "100%" }}
                            placeholder="Sistemdeki birim"
                            value={e.hedef || undefined}
                            options={birimler
                              .filter((b) => b.kod)
                              .map((b) => ({
                                value: b.kod,
                                label: `${b.ad}${b.tur ? ` · ${b.tur}` : ""}`,
                              }))}
                            onChange={(v) => {
                              const yeni = [...grupEsleme];
                              yeni[sira] = { ...yeni[sira], hedef: v };
                              setGrupEsleme(yeni);
                            }}
                          />
                        </Col>

                        <Col xs={2}>
                          <Button
                            type="text"
                            danger
                            icon={<Trash2 size={15} strokeWidth={2} />}
                            onClick={() =>
                              setGrupEsleme(grupEsleme.filter((_x, i) => i !== sira))
                            }
                          />
                        </Col>
                      </Row>
                    ))}

                    <Button
                      icon={<Plus size={15} strokeWidth={2} />}
                      onClick={() => setGrupEsleme([...grupEsleme, { kaynak: "", hedef: "" }])}
                    >
                      Eşleştirme ekle
                    </Button>
                  </>
                ),
              },
              {
                key: "unvan",
                label: `Ünvan → Pozisyon (${unvanEsleme.length})`,
                children: (
                  <>
                    {unvanEsleme.map((e, sira) => (
                      <Row gutter={[8, 8]} align="middle" key={sira} style={{ marginBottom: 8 }}>
                        <Col xs={11}>
                          <Select
                            showSearch
                            allowClear
                            style={{ width: "100%" }}
                            placeholder="Kaynaktaki ünvan"
                            value={e.kaynak || undefined}
                            options={kaynakUnvanlar.map((x) => ({ value: x, label: x }))}
                            onChange={(v) => {
                              const yeni = [...unvanEsleme];
                              yeni[sira] = { ...yeni[sira], kaynak: v };
                              setUnvanEsleme(yeni);
                            }}
                          />
                        </Col>

                        <Col xs={1} style={{ textAlign: "center" }}>
                          <ArrowRight size={14} strokeWidth={2} color="#9AA3AF" />
                        </Col>

                        <Col xs={10}>
                          <Select
                            showSearch
                            allowClear
                            style={{ width: "100%" }}
                            placeholder="Sistemdeki pozisyon"
                            value={e.hedef || undefined}
                            options={pozisyonlar.map((x) => ({ value: x, label: x }))}
                            onChange={(v) => {
                              const yeni = [...unvanEsleme];
                              yeni[sira] = { ...yeni[sira], hedef: v };
                              setUnvanEsleme(yeni);
                            }}
                          />
                        </Col>

                        <Col xs={2}>
                          <Button
                            type="text"
                            danger
                            icon={<Trash2 size={15} strokeWidth={2} />}
                            onClick={() =>
                              setUnvanEsleme(unvanEsleme.filter((_x, i) => i !== sira))
                            }
                          />
                        </Col>
                      </Row>
                    ))}

                    <Button
                      icon={<Plus size={15} strokeWidth={2} />}
                      onClick={() => setUnvanEsleme([...unvanEsleme, { kaynak: "", hedef: "" }])}
                    >
                      Eşleştirme ekle
                    </Button>
                  </>
                ),
              },
              {
                key: "agirlik",
                label: `Kadro Ağırlığı (${agirliklar.length})`,
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Bir kişinin norm kadroda kaç kadro saydığını belirleyin"
                      description={
                        <span>
                          Varsayılan olarak tam zamanlı personel <b>1</b>, yarı
                          zamanlı (Part time) ve engelli kadrolar <b>0,5</b>{" "}
                          sayılır. Burada yalnızca bu varsayılandan farklı
                          davranmasını istediğiniz pozisyonları tanımlayın.
                        </span>
                      }
                    />

                    {agirliklar.map((a, sira) => (
                      <Row
                        gutter={[8, 8]}
                        align="middle"
                        key={sira}
                        style={{ marginBottom: 8 }}
                      >
                        <Col xs={15}>
                          <Select
                            showSearch
                            allowClear
                            style={{ width: "100%" }}
                            placeholder="Pozisyon"
                            value={a.bolum || undefined}
                            options={pozisyonlar.map((x: string) => ({
                              value: x,
                              label: x,
                            }))}
                            onChange={(v) => {
                              const yeni = [...agirliklar];
                              yeni[sira] = { ...yeni[sira], bolum: v };
                              setAgirliklar(yeni);
                            }}
                          />
                        </Col>

                        <Col xs={7}>
                          <Select
                            style={{ width: "100%" }}
                            value={a.agirlik}
                            options={[
                              { value: 1, label: "1 kadro (tam)" },
                              { value: 0.5, label: "0,5 kadro (yarım)" },
                            ]}
                            onChange={(v) => {
                              const yeni = [...agirliklar];
                              yeni[sira] = { ...yeni[sira], agirlik: v };
                              setAgirliklar(yeni);
                            }}
                          />
                        </Col>

                        <Col xs={2}>
                          <Button
                            danger
                            type="text"
                            icon={<Trash2 size={15} strokeWidth={2} />}
                            onClick={() =>
                              setAgirliklar(agirliklar.filter((_, i) => i !== sira))
                            }
                          />
                        </Col>
                      </Row>
                    ))}

                    <Button
                      icon={<Plus size={15} strokeWidth={2} />}
                      onClick={() =>
                        setAgirliklar([...agirliklar, { bolum: "", agirlik: 1 }])
                      }
                    >
                      Ağırlık ekle
                    </Button>
                  </>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {ekCekmeceler}
    </div>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Başvurular
 * ---------------------------------------------------------------------------
 * İK personeli başvuruları listeler, detayını görüntüler, değerlendirme notu
 * yazar, durumunu değiştirir ve görüşme talebi oluşturur.
 *
 * Görünüm onaylanan önizlemeye (basvurular-onizleme.html) göre: mini
 * göstergeler, süreç kartları, toplam şeridi, liste / pano ve geniş
 * başvuru kartı (çekmece). Stiller Basvurular.css içinde, "bv-" önekiyle.
 * ---------------------------------------------------------------------------
 */

import IseAlReferans, { eksikReferanslariKaydet, type ReferansDurumu } from "./IseAlReferans";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popover,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import {
  TriangleAlert,
  Lightbulb,
  Accessibility,
  CalendarClock,
  CalendarDays,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock,
  LogOut,
  Eye,
  FileText,
  History,
  Inbox,
  LayoutGrid,
  LineChart,
  List,
  MailWarning,
  MessageCircle,
  MoreHorizontal,
  Download,
  Pencil,
  Printer,
  RefreshCw,
  Plus,
  Search,
  Send,
  StickyNote,
  Store,
  FileSignature,
  SlidersHorizontal,
  ThumbsDown,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  Archive,
  ArrowLeftRight,
  X,
  SquareUser,
} from "lucide-react";

import Tablo from "./Tablo";
import IsEmriAta from "./IsEmriAta";
import { bekleyenKayit } from "./gecis";
import { uzmanDinle, uzmanOku } from "./uzmanFiltresi";
import { personelKartiAc, personelKartiAcilabilir } from "./personelKarti";
import FormOnizleme from "./FormOnizleme";
import IseGirisEvraklari from "./IseGirisEvraklari";
import type { EvrakOzeti } from "./IseGirisEvraklari";
import MikroSicilBolumu, { MikroSicilDurumu, sicilGovdesi } from "./MikroSicilBolumu";
import Referanslar from "./Referanslar";
import {
  DURUMLAR,
  api,
  islemYetkisi,
  kullaniciKimligi,
  oturumOku,
  yerelZaman,
  sekmeGizli,
} from "./api";
import { whatsappAc, whatsappMetni } from "./whatsapp";
import { formuIndir, listeyiIndir } from "./formIndir";
import "./Basvurular.css";

const { Text } = Typography;
const { TextArea } = Input;

interface Ozet {
  fotografVar?: boolean;
  id: number;
  basvuruNo: string;
  adSoyad: string;
  kimlikNo: string;
  telefon: string;
  eposta: string;
  subeAdi: string;
  bolumler: string;
  il: string;
  ilce: string;
  mahalle: string;
  durum: string;
  degerlendirmeNotu: string;
  gorusmeTarihi: string | null;
  gorusmeYeri: string;
  iseGirisTarihi: string | null;
  iseGirisBolum: string | null;
  olusturma: string;
  guncelleyen: string;
  mailGonderildi: boolean;
  notSayisi: number;
  oncekiBasvuruSayisi: number;
  testKaydi: boolean;
  bekleyenGun: number;
  durumGun: number;
  havuzdanDonusTarihi?: string | null;
  havuzdanDonusNotu?: string | null;
  havuzdanCikaran?: string | null;

  /** Arşive alınmış mı (yalnızca detayda gelir) */
  arsiv?: boolean;

  /** Aday formda engel durumu belirtmiş mi */
  engelVar?: boolean;

  /** İşe alındı ama Mikro'da aktif kaydı yok */
  mikroBekliyor?: boolean;

  /* Mikro'da kaydı var ama çıkışı yapılmış */
  mikrodaAyrildi?: boolean;
  mikroCikisTarihi?: string;
  mikroCikisNedeni?: string;

  /** Açık bir norm kadro pozisyonuna uygun mu */
  oneriVar?: boolean;
  oneriMetni?: string | null;

  /** Aday şu an Biçen'de çalışıyor mu (kimlik numarası eşleşmesi) */
  calisiyorMu?: boolean;
  /** Mikro personel kodu (eski ya da şu anki kaydı); personel kartı için */
  personelKodu?: string | null;
  calistigiSube?: string | null;
  calistigiUnvan?: string | null;
  islemsizGun: number;
  talepUcret: string | null;
  doldurmaGun: number | null;
  anlasilanUcret: number | null;
  yolUcreti: number | null;
  subeKodu: string;
  guncelleme: string | null;
  referansPuani: number | null;
}

interface Detay extends Ozet {
  gonderenIp?: string;
  tarayici?: string;
  veriJson: string;
  havuzdanDonusTarihi?: string | null;
  havuzdanDonusNotu?: string | null;
  havuzdanCikaran?: string | null;
  hareketler: {
    id: number;
    durum: string;
    aciklama: string;
    kullanici: string;
    tarih: string;
  }[];
  notlar: {
    id: number;
    metin: string;
    kullanici: string;
    adSoyad: string;
    tarih: string;
  }[];
  cikisMulakatlari?: any[];
  oncekiBasvurular: {
    veriJson?: string;
    iseGirisTarihi?: string;
    anlasilanUcret?: number;
    id: number;
    basvuruNo: string;
    durum: string;
    degerlendirmeNotu: string;
    subeAdi: string;
    bolumler: string;
    olusturma: string;
    notlar: {
      id: number;
      metin: string;
      adSoyad: string;
      kullanici: string;
      tarih: string;
    }[];
  }[];
}

/** /api/Basvuru/Ozet yanıtı. Son üç alan sonradan eklendi; eski sunucuda gelmez. */
interface OzetYaniti {
  toplam: number;
  bugun: number;
  durumlar: { durum: string; adet: number }[];
  gecikmisler?: { durum: string; adet: number }[];
  uzunBekleyen?: number;
  buHaftaGorusme?: number;
}

interface DagilimYaniti {
  subeler: { ad: string; adet: number }[];
  pozisyonlar: { ad: string; adet: number }[];
  sureler?: {
    ilkIslemGun: number | null;
    ilkIslemAdet: number;
    gorusmeGun: number | null;
    gorusmeAdet: number;
    iseAlimGun: number | null;
    iseAlimAdet: number;
    doldurmaGun: number | null;
    doldurmaAdet: number;
  };
}

/** Durum renkleri; süreç kartları, çipler, pano ve dağılım kullanır */
const DURUM_RENKLERI: Record<string, string> = {
  Yeni: "#1677ff",
  İncelendi: "#d46b08",
  Değerlendirmede: "#b58105",
  "Görüşme Talebi": "#6d4bc2",
  "Evrak Hazırlanıyor": "#2f54eb",
  "Onay Bekliyor": "#d4380d",
  "İşe Alındı": "#0f766e",
  Olumlu: "#5f8c10",
  Olumsuz: "#c62828",
};

/** Süreçteki aşamalar (kart sırasıyla) */
const ASAMALAR = [
  "Yeni",
  "İncelendi",
  "Değerlendirmede",
  "Görüşme Talebi",
  "Evrak Hazırlanıyor",
];

/** Sonuçlanmış durumlar: listede varsayılan olarak görünmezler */
const SONUCLANAN = ["İşe Alındı", "Olumlu", "Olumsuz"];

/** Adım çizgisi: durum → adım sırası ve her adımın hareket durumları */
const ADIMLAR = ["Başvuru", "İncelendi", "Değerlendirme", "Görüşme", "Evrak", "Sonuç"];

const ADIM_SIRASI: Record<string, number> = {
  Yeni: 0,
  İncelendi: 1,
  Değerlendirmede: 2,
  "Görüşme Talebi": 3,
  "Evrak Hazırlanıyor": 4,
  "Onay Bekliyor": 4,
  "İşe Alındı": 5,
  Olumlu: 5,
  Olumsuz: 5,
};

const ADIM_HAREKETLERI: string[][] = [
  ["Yeni"],
  ["İncelendi"],
  ["Değerlendirmede"],
  ["Görüşme Talebi"],
  ["Evrak Hazırlanıyor", "Onay Bekliyor"],
  SONUCLANAN,
];

/** Bekleme süresine göre renk: uzadıkça dikkat çeker */
const beklemeRengi = (gun: number): string => {
  if (gun <= 2) return "green";
  if (gun <= 7) return "gold";
  if (gun <= 14) return "orange";
  return "red";
};

const BEKLEME_SINIFI: Record<string, string> = {
  green: "bv-b-yesil",
  gold: "bv-b-sari",
  orange: "bv-b-turuncu",
  red: "bv-b-kirmizi",
};

/** Avatar zemin / yazı renkleri; kişiye göre sabit */
const AV_RENKLERI: [string, string][] = [
  ["#eef6e1", "#3f6507"],
  ["#e9f0f8", "#2e6aa8"],
  ["#fff0ea", "#a33410"],
  ["#f1ecfb", "#6d4bc2"],
  ["#fff6dc", "#8a5c00"],
  ["#e7f6f3", "#1d7a68"],
];

const avRengi = (anahtar: string | number) =>
  AV_RENKLERI[
    String(anahtar)
      .split("")
      .reduce((t, c) => t + c.charCodeAt(0), 0) % AV_RENKLERI.length
  ];

const basHarfler = (ad?: string | null) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr");

const buyuk = (s?: string | null) => (s ?? "").toLocaleUpperCase("tr");

const bolumListesi = (s?: string | null) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const sayiYaz = (n: number) => n.toLocaleString("tr-TR");

/** Form verisini güvenle çözer; bozuk JSON ekranı düşürmesin */
const formVerisi = (json?: string | null): any => {
  try {
    return JSON.parse(json || "{}") ?? {};
  } catch {
    return {};
  }
};

/** Formdaki "12.04.1995" ya da ISO tarihini çözer */
const tarihCoz = (s?: string | null) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  const t = m
    ? dayjs(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`)
    : dayjs(s);
  return t.isValid() ? t : null;
};

/** İş tecrübesi satırlarından yaklaşık toplam yıl (yalnızca yıllar okunur) */
const tecrubeYili = (liste: any[]): number | null => {
  const yil = (s?: string) => {
    const m = String(s ?? "").match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  };

  let toplam = 0;
  let bulundu = false;

  for (const t of liste ?? []) {
    const g = yil(t?.iseGirisTarihi);
    if (g == null) continue;
    const c = yil(t?.istenCikisTarihi) ?? dayjs().year();
    if (c >= g) {
      toplam += c - g;
      bulundu = true;
    }
  }

  return bulundu ? toplam : null;
};

/* -------------------------------------------------------------- küçük parçalar */

function Avatar({
  id,
  ad,
  foto,
  boyut,
}: {
  id: number;
  ad: string;
  foto?: string;
  boyut?: number;
}) {
  const [zemin, yazi] = avRengi(id);

  return (
    <span
      className="bv-av"
      style={{
        background: zemin,
        color: yazi,
        ...(boyut ? { width: boyut, height: boyut } : {}),
      }}
    >
      {basHarfler(ad)}
      {foto && (
        <img
          src={foto}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </span>
  );
}

/** Referans puanı (1-10) beş yıldızla; yanında puanın kendisi */
function Yildiz({ puan, yalin }: { puan?: number | null; yalin?: boolean }) {
  if (puan == null) return <span className="bv-tire">—</span>;

  const dolu = Math.max(0, Math.min(5, Math.round(puan / 2)));

  return (
    <Tooltip title={`Referans puanı ${puan}/10`}>
      <span className="bv-yildiz">
        {"★".repeat(dolu)}
        <s>{"★".repeat(5 - dolu)}</s>
        {!yalin && <small className={puan < 5 ? "bv-dusuk" : undefined}>{puan}/10</small>}
      </span>
    </Tooltip>
  );
}

function DurumCip({ durum }: { durum: string }) {
  const renk = DURUM_RENKLERI[durum] ?? "#6b7280";

  return (
    <span className="bv-durum" style={{ background: `${renk}17`, color: renk }}>
      <i style={{ background: renk }} />
      {durum || "—"}
    </span>
  );
}

function BeklemeRozeti({ gun }: { gun: number }) {
  return (
    <span className={`bv-bekle ${BEKLEME_SINIFI[beklemeRengi(gun)]}`}>
      {gun <= 0 ? "bugün" : `${gun} gün`}
    </span>
  );
}

/** Dağılım çubukları: ad · çubuk · adet (%) */
function DagilimListesi({
  satirlar,
  toplam,
  renk,
}: {
  satirlar: { ad: string; adet: number; renk?: string }[];
  toplam: number;
  renk: string;
}) {
  if (satirlar.length === 0) return <div className="bv-bos-ic">Kayıt yok.</div>;

  const enBuyuk = Math.max(...satirlar.map((x) => x.adet), 1);

  return (
    <div className="bv-dag" style={{ gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr) 74px" }}>
      {satirlar.map((s) => (
        <FragmentSatir key={s.ad} s={s} enBuyuk={enBuyuk} toplam={toplam} renk={renk} />
      ))}
    </div>
  );
}

function FragmentSatir({
  s,
  enBuyuk,
  toplam,
  renk,
}: {
  s: { ad: string; adet: number; renk?: string };
  enBuyuk: number;
  toplam: number;
  renk: string;
}) {
  return (
    <>
      <span title={s.ad}>{s.ad}</span>
      <div className="bv-dag-c">
        <i style={{ width: `${(s.adet / enBuyuk) * 100}%`, background: s.renk ?? renk }} />
      </div>
      <b>
        {sayiYaz(s.adet)}
        {toplam > 0 && (
          <Text type="secondary" style={{ fontSize: 11.5, fontWeight: 500, marginLeft: 5 }}>
            %{Math.round((s.adet / toplam) * 100)}
          </Text>
        )}
      </b>
    </>
  );
}

/** Uzun listede ilk N kalem, kalanı "Diğer" olarak toplanır */
const kisalt = (liste: { ad: string; adet: number }[], n: number, birim: string) => {
  if (liste.length <= n + 1) return liste;
  const kalan = liste.slice(n);
  return [
    ...liste.slice(0, n),
    {
      ad: `Diğer (${kalan.length} ${birim})`,
      adet: kalan.reduce((t, x) => t + x.adet, 0),
    },
  ];
};

const TARIH_ONAYARLARI: [string, string][] = [
  ["1", "Bugün"],
  ["7", "7 gün"],
  ["30", "30 gün"],
  ["0", "Tümü"],
];

/** Liste / pano tercihi tarayıcıda hatırlanır */
const GORUNUM_ANAHTARI = "bv-gorunum";

const gorunumOku = (): "tablo" | "pano" => {
  try {
    return localStorage.getItem(GORUNUM_ANAHTARI) === "pano" ? "pano" : "tablo";
  } catch {
    return "tablo";
  }
};

export default function Basvurular() {
  const { message, modal } = AntdApp.useApp();

  /* Bölge müdürü durum değiştiremez; yalnızca inceler ve not ekler */
  const yetkili = islemYetkisi(oturumOku());

  const [yukleniyor, setYukleniyor] = useState(false);
  const [kayitlar, setKayitlar] = useState<Ozet[]>([]);

  /* Geçmiş bir başvurunun form önizlemesi */
  const [eskiForm, setEskiForm] = useState<{
    baslik: string;
    veri: any;
  } | null>(null);
  const [toplam, setToplam] = useState(0);
  const [sayfa, setSayfa] = useState(1);
  const [sayfaBoyutu, setSayfaBoyutu] = useState(25);
  const [durum, setDurum] = useState<string | undefined>();
  const [arama, setArama] = useState("");

  /* Arama kutusundaki metin; Enter'a basılınca aramaya dönüşür */
  const [aramaKutusu, setAramaKutusu] = useState("");

  /* Arşivdekileri göster: normalde gizlidirler, geri almak için gerekli */
  const [arsivGoster, setArsivGoster] = useState(false);
  const [sube, setSube] = useState<string[]>([]);
  const [bolum, setBolum] = useState<string | undefined>();
  const [ilce, setIlce] = useState<string | undefined>();
  const [mahalle, setMahalle] = useState<string | undefined>();

  /* Tarih aralığı: verilince o günlerdeki bütün başvurular listelenir,
     sonuçlananlar da gizlenmez */
  const [tarihAraligi, setTarihAraligi] = useState<[any, any] | null>(null);

  /* Hangi tarih düğmesinin seçili olduğu ("0" = tümü, "ozel" = takvimden) */
  const [tarihOn, setTarihOn] = useState<string>("0");
  const [ozelTarihAcik, setOzelTarihAcik] = useState(false);

  /* Hızlı süzgeçler (çipler); sunucuda uygulanır */
  const [gecikmisSuz, setGecikmisSuz] = useState(false);
  const [mailSuz, setMailSuz] = useState(false);
  const [eskiSuz, setEskiSuz] = useState(false);

  const [digerAcik, setDigerAcik] = useState(false);
  const [gorunum, setGorunumHam] = useState<"tablo" | "pano">(gorunumOku);

  const setGorunum = (g: "tablo" | "pano") => {
    setGorunumHam(g);
    try {
      localStorage.setItem(GORUNUM_ANAHTARI, g);
    } catch {
      /* tarayıcı depolaması kapalıysa yalnızca bu oturumda geçerli */
    }
  };

  const [filtreler, setFiltreler] = useState<{
    ilceler: string[];
    mahalleler: { ilce: string; mahalle: string }[];
    subeler: { kod: string; ad: string }[];
    bolumler: string[];
  }>({ ilceler: [], mahalleler: [], subeler: [], bolumler: [] });

  const [yeniNot, setYeniNot] = useState("");
  const [notEkleniyor, setNotEkleniyor] = useState(false);
  const [ozet, setOzet] = useState<OzetYaniti | null>(null);

  /* İK uzmanı süzgeci: seçilen uzmana tanımlı şubelerin başvuruları.
     Sayaç kartları da aynı süzgeçle çekilir, ekran kendi içinde
     çelişmesin. */
  const [uzman, setUzman] = useState<string | undefined>(uzmanOku());

  /* Toplam/sonuçlanan şeridine tıklayınca açılan dağılım penceresi */
  const [dagilimAcik, setDagilimAcik] = useState(false);
  const [dagilimVeri, setDagilimVeri] = useState<DagilimYaniti | null>(null);
  const [dagilimYukleniyor, setDagilimYukleniyor] = useState(false);

  const [detay, setDetay] = useState<Detay | null>(null);

  /* Çekmecede açık başvurunun kimliği. Detay yeniden okunurken çekmece
     kapanmasın ve içerik titremesin diye detaydan ayrı tutulur. */
  const [cekmeceId, setCekmeceId] = useState<number | null>(null);
  const acikIdRef = useRef<number | null>(null);
  const [detaySekme, setDetaySekme] = useState("ozet");
  const [menuAcik, setMenuAcik] = useState(false);
  const [oncekiAcik, setOncekiAcik] = useState<boolean | null>(null);

  /* Referanslar sekmesinin sayacı ve hızlı bilgilerdeki puan */
  const [refBilgi, setRefBilgi] = useState<{
    sayi: number;
    gorusulen: number;
    puan: number | null;
  } | null>(null);

  /* Adayın eski çıkış mülakatının tam formu */
  const [mulakatDetay, setMulakatDetay] = useState<any | null>(null);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);
  const [not, setNot] = useState("");

  const [gorusmeAcik, setGorusmeAcik] = useState(false);
  const [gorusmeForm] = Form.useForm();

  /* Görüşme penceresi hangi başvuru için açıldı: çekmecedeki ya da
     listedeki satır (hızlı işlem) */
  const [gorusmeHedef, setGorusmeHedef] = useState<{ id: number; adSoyad: string } | null>(
    null
  );

  const [iseAlAcik, setIseAlAcik] = useState(false);
  /* İşe al penceresindeki evrak listesinin özeti (03.10.2026) */
  const [iseAlEvrak, setIseAlEvrak] = useState<EvrakOzeti | null>(null);
  /* Pencerede evrak değişince arkadaki başvuru kartındaki liste yenilensin */
  const [evrakSurum, setEvrakSurum] = useState(0);
  const [iseAlForm] = Form.useForm();
  /* Mikro sicil kartı (09.10.2026): İşe Al penceresinde isteğe bağlı */
  const [sicilForm] = Form.useForm();
  const [sicilAcik, setSicilAcik] = useState(false);
  const [sicilSurum, setSicilSurum] = useState(0);
  const iseAlSube = Form.useWatch("subeKodu", iseAlForm);
  const iseAlBolum = Form.useWatch("bolum", iseAlForm);
  const iseAlUcret = Form.useWatch("anlasilanUcret", iseAlForm);
  /* Zorunlu referans (21.10.2026) */
  const [refForm] = Form.useForm();
  const [refDurum, setRefDurum] = useState<ReferansDurumu | null>(null);
  const [refSurum, setRefSurum] = useState(0);

  const [birimAcik, setBirimAcik] = useState(false);
  const [birimForm] = Form.useForm();

  const [birimler, setBirimler] = useState<{ kod: string; ad: string; tur: string }[]>([]);
  const [birimTurleri, setBirimTurleri] = useState<
    { ad: string; bolumler: string[] }[]
  >([]);
  const [waSablonu, setWaSablonu] = useState<string>("");

  /* Genel Müdürlük adresi ve konum bağlantısı; WhatsApp davetine konur */
  const [gorusmeAdresi, setGorusmeAdresi] = useState<string>("");
  const [gorusmeHaritasi, setGorusmeHaritasi] = useState<string>("");

  /* Pozisyon bazında maaş skalaları; işe alım ücretinde kontrol edilir */
  const [skalalar, setSkalalar] = useState<
    { bolum: string; altSinir: number; ustSinir: number }[]
  >([]);
  const [profil, setProfil] = useState<any>(null);

  /* Daha önce çalışıp ayrılmış personel: kimlik numarasına göre eşlenir */
  const [eskiCalisanlar, setEskiCalisanlar] = useState<Record<string, any>>({});
  const [disaAktariliyor, setDisaAktariliyor] = useState(false);
  const onizlemeRef = useRef<HTMLDivElement>(null);

  /* Sayfanın kullanılabilir genişliği: 1280 ekranda yan menüyle birlikte
     içerik ~1000 piksele iniyor; sütunlar o zaman sıkışık ölçülere geçer
     ki tablo yatay kaydırma istemesin. */
  const kokRef = useRef<HTMLDivElement>(null);
  const [dar, setDar] = useState(false);

  useEffect(() => {
    const el = kokRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const gozlem = new ResizeObserver(([g]) => setDar(g.contentRect.width < 1100));
    gozlem.observe(el);

    return () => gozlem.disconnect();
  }, []);

  /** Tarih aralığı sorgu parametreleri (liste, özet ve dağılım ortak) */
  const tarihParametreleri = (sorgu: URLSearchParams) => {
    if (tarihAraligi?.[0] && tarihAraligi?.[1]) {
      sorgu.set("tarihBas", dayjs(tarihAraligi[0]).format("YYYY-MM-DD"));
      sorgu.set("tarihBit", dayjs(tarihAraligi[1]).format("YYYY-MM-DD"));
    }
  };

  /* ------------------------------------------------------------------ liste */

  const listeGetir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const sorgu = new URLSearchParams({
        sayfa: String(sayfa),
        adet: String(sayfaBoyutu),
      });
      /* Arama yapıldığında diğer süzgeçler uygulanmaz: aranan kişi hangi
         durumda, şubede ya da bölümde olursa olsun bulunsun. Süzgeçler
         listeyi daraltmak içindir; arama ise tüm kayıtlarda gezinmek
         içindir ve ikisi birleşince aranan kayıt görünmez oluyordu. */
      const aramaVar = arama.trim().length > 0;

      if (arsivGoster) sorgu.set("arsiv", "true");

      if (aramaVar) {
        sorgu.set("arama", arama.trim());
      } else {
        if (durum) sorgu.set("durum", durum);
        if (sube.length > 0) sorgu.set("subeKodu", sube.join(","));
        if (bolum) sorgu.set("bolum", bolum);
        if (ilce) sorgu.set("ilce", ilce);
        if (mahalle) sorgu.set("mahalle", mahalle);
        if (gecikmisSuz) sorgu.set("gecikmis", "true");
        if (mailSuz) sorgu.set("mailGitmedi", "true");
        if (eskiSuz) sorgu.set("eskiCalisan", "true");
      }

      tarihParametreleri(sorgu);

      if (uzman) sorgu.set("uzman", uzman);

      const sonuc = await api.al<{ toplam: number; kayitlar: Ozet[] }>(
        `/api/Basvuru/Liste?${sorgu.toString()}`
      );
      /* Hâlihazırda çalışan adaylar üste alınır: uzman bunları önce
         görsün, sıradan bir başvuru gibi aşağıda kaybolmasın. */
      setKayitlar(
        /* Önce Mikro girişi bekleyenler: eylem gerektiren tek grup onlar.
           Sonra hâlihazırda çalışanlar. */
        [...sonuc.kayitlar].sort(
          (a, b) =>
            /* Mikro girişi bekleyenler en üstte: yapılacak bir iş var.
               Ayrılanlar sıralamayı etkilemiyor, onlarda iş kalmadı. */
            Number(b.mikroBekliyor ?? false) - Number(a.mikroBekliyor ?? false) ||
            Number(b.calisiyorMu ?? false) - Number(a.calisiyorMu ?? false)
        )
      );
      setToplam(sonuc.toplam);

      /* Kartlar ve şerit de aynı tarih aralığına göre sayılsın; liste
         süzülüp kartlar tüm zamanı gösterirse ekran kendi içinde çelişir */
      const ozetSorgu = new URLSearchParams();
      if (uzman) ozetSorgu.set("uzman", uzman);
      tarihParametreleri(ozetSorgu);
      const ozetMetni = ozetSorgu.toString();

      setOzet(await api.al<OzetYaniti>(`/api/Basvuru/Ozet${ozetMetni ? `?${ozetMetni}` : ""}`));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sayfa,
    sayfaBoyutu,
    durum,
    sube,
    bolum,
    ilce,
    mahalle,
    arama,
    arsivGoster,
    uzman,
    message,
    tarihAraligi,
    gecikmisSuz,
    mailSuz,
    eskiSuz,
  ]);

  useEffect(() => {
    listeGetir();
  }, [listeGetir]);

  /* Süzgeç başlık çubuğunda; seçim değişince liste yeniden çekilir */
  useEffect(() => {
    const birak = uzmanDinle((kod) => {
      setUzman(kod);
      setSayfa(1);
    });

    return () => {
      birak();
    };
  }, []);

  /* Rotasyon ve işe alım için tanımlı birimler */
  useEffect(() => {
    api
      .al<any>("/api/Ayar/Form")
      .then((a) => {
        setBirimler(a.subeler ?? []);
        setBirimTurleri(a.birimTurleri ?? []);
        setWaSablonu(a.whatsappSablonu ?? "");
        setGorusmeAdresi(a.gorusmeAdresi ?? "");
        setGorusmeHaritasi(a.gorusmeHaritaAdresi ?? "");
      })
      .catch(() => undefined);

    // Mesaj imzası için kendi profil bilgilerimiz
    api
      .al<any>("/api/Auth/Profil")
      .then(setProfil)
      .catch(() => undefined);

    // Maaş skalaları
    api
      .al<any>("/api/Personel/MaasSkala")
      .then((d) => setSkalalar(d?.skalalar ?? []))
      .catch(() => undefined);

    // Eski çalışan işareti için kimlik numarası listesi
    api
      .al<any[]>("/api/Personel/EskiCalisanlar")
      .then((liste) => {
        const harita: Record<string, any> = {};
        (liste ?? []).forEach((k) => {
          if (k.kimlikNo) harita[String(k.kimlikNo).trim()] = k;
        });
        setEskiCalisanlar(harita);
      })
      .catch(() => undefined);
  }, []);

  /* Filtre kutuları için başvurularda geçen ilçe ve mahalleler */
  useEffect(() => {
    api
      .al<any>("/api/Basvuru/Filtreler")
      .then((f) =>
        setFiltreler({
          ilceler: f.ilceler ?? [],
          mahalleler: f.mahalleler ?? [],
          subeler: f.subeler ?? [],
          bolumler: f.bolumler ?? [],
        })
      )
      .catch(() => undefined);
  }, []);

  /* Dağılım penceresi açılınca şube / pozisyon dağılımı ve süreler okunur */
  useEffect(() => {
    if (!dagilimAcik) return;

    let iptal = false;
    const sorgu = new URLSearchParams();
    if (uzman) sorgu.set("uzman", uzman);
    tarihParametreleri(sorgu);

    setDagilimYukleniyor(true);
    api
      .al<DagilimYaniti>(`/api/Basvuru/Dagilim?${sorgu.toString()}`)
      .then((v) => {
        if (!iptal) setDagilimVeri(v);
      })
      .catch(() => {
        if (!iptal) setDagilimVeri(null);
      })
      .finally(() => {
        if (!iptal) setDagilimYukleniyor(false);
      });

    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dagilimAcik, uzman, tarihAraligi]);

  /* ------------------------------------------------------------------ detay */

  /* Bildirimden "Gör" ile gelindiyse ilgili başvuru kendiliğinden açılır.
     Kayıt tek seferliktir; sayfaya tekrar gelindiğinde açılmaz. */
  useEffect(() => {
    const id = bekleyenKayit("basvurular");

    if (id) detayAc(Number(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detayKapat = () => {
    acikIdRef.current = null;
    setCekmeceId(null);
    setDetay(null);
    setYeniNot("");
    setMenuAcik(false);
  };

  const detayAc = async (id: number) => {
    /* Başka bir başvuru açılıyorsa kart sıfırdan kurulur; aynı başvuru
       işlem sonrası yeniden okunuyorsa sekme ve kaydırma korunur. */
    const yeniKart = acikIdRef.current !== id;

    if (yeniKart) {
      acikIdRef.current = id;
      setDetay(null);
      setDetaySekme("ozet");
      setRefBilgi(null);
      setOncekiAcik(null);
      setMenuAcik(false);
    }

    setCekmeceId(id);
    setDetayYukleniyor(true);
    try {
      const kayit = await api.al<Detay>(`/api/Basvuru/${id}`);

      /* Bu arada başka bir kart açıldıysa eski yanıt yazılmaz */
      if (acikIdRef.current !== id) return;

      setDetay(kayit);
      setNot(kayit.degerlendirmeNotu ?? "");
    } catch (hata: any) {
      message.error(hata.message);
      if (yeniKart && acikIdRef.current === id) detayKapat();
    } finally {
      setDetayYukleniyor(false);
    }
  };

  /**
   * Durum değiştirir. Açıklama verilmezse değerlendirme notu gönderilir
   * (eski davranış). Başarılıysa true döner.
   */
  const durumDegistir = async (
    yeniDurum: string,
    bolum?: string,
    aciklama?: string
  ): Promise<boolean> => {
    if (!detay) return false;
    try {
      await api.gonder(`/api/Basvuru/${detay.id}/Durum`, {
        durum: yeniDurum,
        aciklama: aciklama ?? not,
        bolum,
      });
      message.success(
        yeniDurum === "Olumlu"
          ? "Başvuru olumlu olarak işaretlendi ve Aday Havuzu'na alındı."
          : `Başvuru "${yeniDurum}" durumuna alındı.`
      );
      await detayAc(detay.id);
      listeGetir();
      return true;
    } catch (hata: any) {
      message.error(hata.message);
      return false;
    }
  };

  /**
   * Listedeki satırdan "İnceledim". Açıklama gönderilmez: sunucu boş
   * açıklamayı değerlendirme notunun üzerine yazmıyor (COALESCE), boş
   * metin gönderilseydi not silinirdi.
   */
  const satirIncele = async (kayit: Ozet) => {
    try {
      await api.gonder(`/api/Basvuru/${kayit.id}/Durum`, { durum: "İncelendi" });
      message.success(`${kayit.adSoyad}: "İncelendi" durumuna alındı.`);
      listeGetir();
      if (acikIdRef.current === kayit.id) detayAc(kayit.id);
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /** Açık başvurunun formunu tek başına açılabilen HTML dosyası olarak indirir */
  const formIndir = async () => {
    if (!detay) return;
    try {
      const belge = onizlemeRef.current?.querySelector(".on-belge") as HTMLElement;
      await formuIndir(belge, detay.basvuruNo, detay.adSoyad);
      message.success("Form indirildi.");
    } catch (hata: any) {
      message.error(hata.message ?? "Form indirilemedi.");
    }
  };

  /** Filtreye uyan tüm başvuruları CSV olarak indirir */
  const listeDisaAktar = async () => {
    setDisaAktariliyor(true);
    try {
      const tumu: Ozet[] = [];
      for (let s = 1; s <= 5; s++) {
        const sorgu = new URLSearchParams({ sayfa: String(s), adet: "200" });

        /* Ekrandaki listeyle aynı kural: arama varsa süzgeçler uygulanmaz */
        if (arama.trim()) {
          sorgu.set("arama", arama.trim());
        } else {
          if (durum) sorgu.set("durum", durum);
          if (sube.length > 0) sorgu.set("subeKodu", sube.join(","));
          if (bolum) sorgu.set("bolum", bolum);
          if (ilce) sorgu.set("ilce", ilce);
          if (mahalle) sorgu.set("mahalle", mahalle);
          if (gecikmisSuz) sorgu.set("gecikmis", "true");
          if (mailSuz) sorgu.set("mailGitmedi", "true");
          if (eskiSuz) sorgu.set("eskiCalisan", "true");
        }

        const sonuc = await api.al<{ toplam: number; kayitlar: Ozet[] }>(
          `/api/Basvuru/Liste?${sorgu.toString()}`
        );
        tumu.push(...sonuc.kayitlar);
        if (tumu.length >= sonuc.toplam) break;
      }

      if (tumu.length === 0) {
        message.info("Dışa aktarılacak kayıt bulunamadı.");
        return;
      }

      listeyiIndir(tumu);
      message.success(`${tumu.length} başvuru dışa aktarıldı.`);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDisaAktariliyor(false);
    }
  };

  /**
   * Görüşme davetini WhatsApp üzerinden gönderir.
   * Mesaj, oturum açan personelin kendi WhatsApp hesabından iletilir.
   */
  const whatsappGonder = (kayit: Ozet) => {
    if (!kayit.telefon) {
      message.warning("Adayın telefon numarası kayıtlı değil.");
      return;
    }

    const metin = whatsappMetni(waSablonu, {
      adSoyad: kayit.adSoyad,
      basvuruNo: kayit.basvuruNo,
      gorusmeTarihi: kayit.gorusmeTarihi,
      gorusmeYeri: kayit.gorusmeYeri,
      aciklama: kayit.degerlendirmeNotu,
      uzmanAdSoyad: profil?.adSoyad,
      uzmanUnvan: profil?.unvan,
      uzmanTelefon: profil?.telefon,
      adres: gorusmeAdresi,
      konum: gorusmeHaritasi,
    });

    if (!whatsappAc(kayit.telefon, metin)) {
      message.error("Telefon numarası WhatsApp için uygun biçimde değil.");
    }
  };

  /** Adayla boş bir WhatsApp yazışması açar (görüşme yoksa) */
  const whatsappYaz = (telefon?: string | null) => {
    if (!telefon || !whatsappAc(telefon, "")) {
      message.error("Telefon numarası WhatsApp için uygun biçimde değil.");
    }
  };

  /** Satırdaki WhatsApp: görüşme varsa davet, yoksa yazışma */
  const satirWhatsapp = (kayit: Ozet) =>
    kayit.gorusmeTarihi ? whatsappGonder(kayit) : whatsappYaz(kayit.telefon);

  /** Girilen ücret, pozisyonun skalasına uyuyor mu? */
  const skalaKontrol = (bolum?: string, ucret?: number) => {
    if (!bolum || !ucret) return null;

    const sade = (m: string) =>
      m.toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ0-9 ]/g, " ").trim();

    const skala = skalalar.find((x) => sade(x.bolum) === sade(bolum));
    if (!skala) return null;

    if (skala.ustSinir > 0 && ucret > skala.ustSinir) {
      return {
        tur: "ust" as const,
        skala,
        fark: ucret - skala.ustSinir,
      };
    }

    if (skala.altSinir > 0 && ucret < skala.altSinir) {
      return {
        tur: "alt" as const,
        skala,
        fark: skala.altSinir - ucret,
      };
    }

    return null;
  };

  /** Pozisyonun maaş skalası (hızlı bilgilerde gösterilir) */
  const skalaBul = (bolumAdi?: string) => {
    const sade = (m?: string) => (m ?? "").toLocaleUpperCase("tr").trim();
    return skalalar.find((x) => sade(x.bolum) === sade(bolumAdi));
  };

  /** Adayı işe alınmış olarak işaretler; istenirse birimini de değiştirir */
  const iseAl = async () => {
    if (!detay) return;

    try {
      const d = await iseAlForm.validateFields();

      /* Mikro sicil bölümü açıksa onun alanları da doğrulanır */
      let sicil: Record<string, any> | null = null;
      if (sicilAcik) {
        try {
          sicil = sicilGovdesi(await sicilForm.validateFields());
        } catch (e: any) {
          if (e?.errorFields) {
            message.warning("Mikro sicil kartı bölümünde eksik ya da hatalı alan var.");
            sicilForm.scrollToField(e.errorFields[0]?.name, { behavior: "smooth", block: "center" });
            return;
          }
          throw e;
        }
      }

      /* Ücret pozisyonun skalası dışındaysa onay istenir */
      const uyari = skalaKontrol(d.bolum ?? detay.bolumler, d.anlasilanUcret);

      if (uyari) {
        const onaylandi = await new Promise<boolean>((coz) => {
          modal.confirm({
            title:
              uyari.tur === "ust"
                ? "Ücret skalanın üzerinde"
                : "Ücret skalanın altında",
            icon: <AlertTriangle size={20} strokeWidth={2} color="#d46b08" />,
            width: 460,
            content: (
              <div style={{ fontSize: 13.5 }}>
                <p style={{ marginTop: 4 }}>
                  <b>{uyari.skala.bolum}</b> pozisyonu için tanımlı aralık:{" "}
                  <b>
                    {uyari.skala.altSinir.toLocaleString("tr-TR")} –{" "}
                    {uyari.skala.ustSinir.toLocaleString("tr-TR")} TL
                  </b>
                </p>
                <p>
                  Girdiğiniz ücret{" "}
                  <b>{Number(d.anlasilanUcret).toLocaleString("tr-TR")} TL</b>,
                  aralığın{" "}
                  <b>
                    {uyari.fark.toLocaleString("tr-TR")} TL{" "}
                    {uyari.tur === "ust" ? "üzerinde" : "altında"}
                  </b>
                  .
                </p>
                <p style={{ marginBottom: 0 }}>Yine de devam etmek istiyor musunuz?</p>
              </div>
            ),
            okText: "Devam et",
            cancelText: "Vazgeç",
            okButtonProps: { danger: uyari.tur === "ust" },
            onOk: () => coz(true),
            onCancel: () => coz(false),
          });
        });

        if (!onaylandi) return;
      }

      /* Referans eksikse önce penceredeki referanslar kaydedilir */
      if (refDurum && refDurum.eksik > 0) {
        const yeni = await eksikReferanslariKaydet(detay.id, refForm, refDurum, d.bolum, d.subeKodu);
        if (!yeni) {
          message.warning(`Bu pozisyon için en az ${refDurum.gereken} referans gerekli. Eksik referansları yazınız.`);
          return;
        }
        setRefDurum(yeni);
        setRefSurum((x) => x + 1);
      }

      await api.gonder(`/api/Basvuru/${detay.id}/IseAl`, {
        iseGirisTarihi: yerelZaman(d.iseGirisTarihi),
        subeKodu: d.subeKodu ?? "",
        bolum: d.bolum ?? "",
        anlasilanUcret: d.anlasilanUcret ?? null,
        yolUcreti: d.yolUcreti ?? null,
        aciklama: d.aciklama ?? "",
        kartNo: String(d.kartNo ?? "").replace(/\D/g, ""),
        mikroSicil: sicil,
      });

      message.success(
        iseAlEvrak && iseAlEvrak.eksik > 0
          ? `İşe alım onaya gönderildi. ${iseAlEvrak.eksik} evrak eksik; personel kartında eksik olarak görünecek.`
          : sicil
          ? "İşe alım onaya gönderildi. Onaylanınca Mikro'da sicil kartı açılacak ve Biçen Kart sicile bağlanacak."
          : "İşe alım bilgileri kaydedildi ve yetkili onayına gönderildi. Biçen Kart, Mikro'ya işlenince personele bağlanacak."
      );
      setSicilSurum((x) => x + 1);
      setIseAlAcik(false);
      iseAlForm.resetFields();
      await detayAc(detay.id);
      listeGetir();
    } catch (hata: any) {
      if (hata?.errorFields) return;
      message.error(hata.message);
      setRefSurum((x) => x + 1);
    }
  };

  const iseAlAc = () => {
    setIseAlEvrak(null);
    refForm.resetFields();
    setRefDurum(null);
    setRefSurum((x) => x + 1);
    iseAlForm.setFieldsValue({
      iseGirisTarihi: dayjs(),
      subeKodu: undefined,
    });
    setSicilAcik(false);
    sicilForm.resetFields();
    setIseAlAcik(true);
  };

  /* İşe al dendikten sonra birim değişikliği rotasyon değil (13.10.2026) */
  const iseAlimSonrasi = detay?.durum === "Onay Bekliyor" || detay?.durum === "İşe Alındı";

  /** Rotasyon: adayın birimini değiştirir */
  const birimDegistir = async () => {
    if (!detay) return;
    try {
      const d = await birimForm.validateFields();

      await api.gonder(`/api/Basvuru/${detay.id}/Birim`, d);

      message.success(iseAlimSonrasi ? "İşe alım birimi güncellendi; rotasyon onayı açılmadı." : "Adayın birimi güncellendi.");
      setBirimAcik(false);
      birimForm.resetFields();
      await detayAc(detay.id);
      listeGetir();
    } catch (hata: any) {
      if (hata?.errorFields) return;
      message.error(hata.message);
    }
  };

  const birimAc = () => {
    setMenuAcik(false);
    birimForm.setFieldsValue({ subeKodu: undefined, aciklama: "" });
    setBirimAcik(true);
  };

  /** Başvuruya dahili not ekler (aday görmez) */
  const notEkle = async () => {
    if (!detay || !yeniNot.trim()) return;

    setNotEkleniyor(true);
    try {
      await api.gonder(`/api/Basvuru/${detay.id}/Not`, { metin: yeniNot.trim() });
      setYeniNot("");
      await detayAc(detay.id);
      listeGetir();
      message.success("Not eklendi.");
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setNotEkleniyor(false);
    }
  };

  const notSil = (notId: number) => {
    modal.confirm({
      title: "Not silinsin mi?",
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Basvuru/Not/${notId}`);
          if (detay) await detayAc(detay.id);
          listeGetir();
          message.success("Not silindi.");
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  const mailTekrarGonder = async () => {
    if (!detay) return;
    try {
      await api.gonder(`/api/Basvuru/${detay.id}/MailTekrar`);
      message.success("Bildirim maili gönderildi.");
      await detayAc(detay.id);
      listeGetir();
    } catch (hata: any) {
      modal.error({
        title: "Mail gönderilemedi",
        content: hata.message,
        okText: "Kapat",
      });
    }
  };

  /* Olumlu kararı verilirken pozisyon seçtirilir: aday birden çok
     pozisyona başvurmuş olabilir ve havuzda tek pozisyonla görünmeli. */
  const [olumluAcik, setOlumluAcik] = useState(false);
  const [olumluBolum, setOlumluBolum] = useState<string | undefined>();

  const olumluAc = () => {
    const adayinBolumleri = (detay?.bolumler ?? "")
      .split(",")
      .map((x: string) => x.trim())
      .filter(Boolean);

    /* Tek pozisyona başvurmuşsa seçim hazır gelir */
    setOlumluBolum(adayinBolumleri.length === 1 ? adayinBolumleri[0] : undefined);
    setOlumluAcik(true);
  };

  const olumluKaydet = async () => {
    if (!olumluBolum) {
      message.warning("Pozisyon seçiniz.");
      return;
    }

    setOlumluAcik(false);
    await durumDegistir("Olumlu", olumluBolum);
  };

  /* Arşivleme ve silme yalnızca 1 numaralı kullanıcıda. Silinen başvuru
     geri getirilemediği ve arşivlenen listeden kaybolduğu için, bu yetkinin
     dağıtılması "kayıt nereye gitti" sorusunu geri getirir. */
  const yoneticiMi = kullaniciKimligi(oturumOku()) === 1;

  const arsivle = (geriAl: boolean) => {
    if (!detay) return;
    setMenuAcik(false);

    modal.confirm({
      title: geriAl
        ? "Başvuru arşivden çıkarılsın mı?"
        : "Başvuru arşive alınsın mı?",
      content: geriAl
        ? "Başvuru yeniden listelerde görünür."
        : "Başvuru listelerde görünmez ama kaydı silinmez; istediğinizde geri alabilirsiniz.",
      okText: geriAl ? "Arşivden çıkar" : "Arşive al",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(
            `/api/Basvuru/${detay.id}/Arsiv?geriAl=${geriAl}`,
            {}
          );
          message.success(geriAl ? "Arşivden çıkarıldı." : "Arşive alındı.");
          detayKapat();
          listeGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  const kaliciSil = () => {
    if (!detay) return;
    setMenuAcik(false);

    modal.confirm({
      title: "Başvuru kalıcı olarak silinsin mi?",
      okText: "Evet, sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      content: (
        <div>
          <p style={{ marginTop: 0 }}>
            <b>{detay.adSoyad}</b> başvurusu ve bağlı tüm kayıtları (notlar,
            referanslar) silinir. <b>Bu işlem geri alınamaz.</b>
          </p>
          <p style={{ marginBottom: 0 }}>
            Kaydı saklamak ama listeden kaldırmak istiyorsanız silmek yerine
            arşivleyin.
          </p>
        </div>
      ),
      onOk: async () => {
        try {
          await api.sil(`/api/Basvuru/${detay.id}/Sahte`);
          message.success("Başvuru silindi.");
          detayKapat();
          listeGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* Olumsuz sebebi kendi penceresinde alınır: değerlendirme kutusuna
     yazılmasını beklemek, sebebi başka notlarla karıştırıyordu ve
     çoğu zaman boş bırakılıyordu. */
  const [olumsuzAcik, setOlumsuzAcik] = useState(false);
  const [olumsuzSebep, setOlumsuzSebep] = useState("");
  const [olumsuzIsleniyor, setOlumsuzIsleniyor] = useState(false);

  const OLUMSUZ_SEBEPLERI = [
    "Pozisyona uygun değil",
    "Deneyim yetersiz",
    "Ulaşılamadı",
    "Aday vazgeçti",
    "Ücret beklentisi uyuşmadı",
    "Lokasyon uygun değil",
    "Görüşmeye gelmedi",
    "Diğer",
  ];

  const olumsuzYap = () => {
    setOlumsuzSebep("");
    setOlumsuzAcik(true);
  };

  const olumsuzOnayla = async () => {
    if (!olumsuzSebep.trim()) {
      message.warning("Olumsuz sebebini yazınız.");
      return;
    }

    if (!detay) return;
    const id = detay.id;
    const sebep = olumsuzSebep.trim();

    setOlumsuzIsleniyor(true);

    try {
      /* Sunucu Olumsuz için açıklama istiyor. Değerlendirme notu boşsa
         sebep açıklama olarak gönderilir; önceden boş notla istek
         reddediliyor ama sebep yine de nota yazılıyordu. */
      const tamam = await durumDegistir(
        "Olumsuz",
        undefined,
        not.trim() ? not : `Olumsuz sebebi: ${sebep}`
      );

      if (!tamam) return;

      /* Sebep başvurunun not geçmişine ayrı bir kayıt olarak düşer */
      await api.gonder(`/api/Basvuru/${id}/Not`, {
        metin: `Olumsuz sebebi: ${sebep}`,
      });

      setOlumsuzAcik(false);
      if (acikIdRef.current === id) await detayAc(id);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setOlumsuzIsleniyor(false);
    }
  };

  /** Görüşme penceresini açar; düzenlemede mevcut tarih ve yer gelir */
  const gorusmeAc = (hedef: Ozet, duzenle = false) => {
    setGorusmeHedef({ id: hedef.id, adSoyad: hedef.adSoyad });

    if (duzenle) {
      const t = hedef.gorusmeTarihi ? dayjs(hedef.gorusmeTarihi) : null;
      gorusmeForm.setFieldsValue({
        tarih: t && t.isAfter(dayjs()) ? t : undefined,
        yer: hedef.gorusmeYeri || undefined,
      });
    }

    setGorusmeAcik(true);
  };

  const gorusmeKaydet = async () => {
    const id = gorusmeHedef?.id ?? detay?.id;
    if (!id) return;
    try {
      const d = await gorusmeForm.validateFields();
      await api.gonder(`/api/Basvuru/${id}/Gorusme`, {
        gorusmeTarihi: yerelZaman(d.tarih),
        gorusmeYeri: d.yer,
        aciklama: d.aciklama ?? "",
        adayaMailGonder: d.mailGonder !== false,
      });
      message.success("Görüşme talebi oluşturuldu.");
      setGorusmeAcik(false);
      gorusmeForm.resetFields();
      if (acikIdRef.current === id) await detayAc(id);
      listeGetir();
    } catch (hata: any) {
      if (hata?.errorFields) return;
      message.error(hata.message);
    }
  };

  /* ---------------------------------------------------------- yardımcılar */

  /** Aday daha önce çalışıp ayrılmış mı? */
  const eskiCalisan = (kimlikNo?: string | null) =>
    kimlikNo ? eskiCalisanlar[String(kimlikNo).trim()] : undefined;

  /** Rozet açıklaması: nerede, hangi pozisyonda, ne zamana kadar */
  const eskiCalisanParcalari = (kimlikNo?: string | null) => {
    const k = eskiCalisan(kimlikNo);
    if (!k) return "";

    return [
      k.sube,
      k.pozisyon,
      k.cikisTarihi
        ? `${dayjs(k.cikisTarihi).format("DD.MM.YYYY")} tarihinde ayrılmış`
        : "",
      k.cikisSebebi ? `Çıkış sebebi: ${k.cikisSebebi}` : "",
      k.calismaSayisi > 1 ? `${k.calismaSayisi} kez çalışmış` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const eskiCalisanMetni = (kimlikNo?: string | null) => {
    const p = eskiCalisanParcalari(kimlikNo);
    return p ? `Daha önce çalışmış: ${p}` : "";
  };

  /** Satırdaki etiketler: önceki tablonun bütün rozetleri */
  const adayEtiketleri = (k: Ozet): ReactNode[] => {
    const l: ReactNode[] = [];

    /* Engel durumu belirtmiş aday. Yazı yerine simge: liste
       kalabalıklaşmasın ve durum ekranda ilan gibi durmasın. */
    if (k.engelVar)
      l.push(
        <Tooltip key="engel" title="Aday formda engel durumu belirtmiş">
          <span className="bv-etiket bv-e-mavi" aria-label="Engel durumu belirtilmiş">
            <Accessibility size={12} strokeWidth={2.2} />
          </span>
        </Tooltip>
      );

    /* Mikro girişi yapılmamış işe alım: en görünür rozet */
    if (k.mikroBekliyor)
      l.push(
        <Tooltip
          key="mikro"
          title="İşe alındı olarak işaretlenmiş ama Mikro'da personel kaydı yok. Mikro'dan işe girişini yapınız."
        >
          <span className="bv-etiket bv-e-kirmizi">
            <TriangleAlert size={11} strokeWidth={2.5} /> Mikro girişi yok
          </span>
        </Tooltip>
      );

    if (k.mikrodaAyrildi)
      l.push(
        <Tooltip
          key="ayrildi"
          title={`Mikro'da işe girişi yapılmış ve çıkışı verilmiş.${
            k.mikroCikisTarihi
              ? ` Çıkış: ${dayjs(k.mikroCikisTarihi).format("DD.MM.YYYY")}`
              : ""
          }${k.mikroCikisNedeni ? ` · ${k.mikroCikisNedeni}` : ""}`}
        >
          <span className="bv-etiket bv-e-gri">
            Ayrıldı
            {k.mikroCikisTarihi ? ` · ${dayjs(k.mikroCikisTarihi).format("DD.MM.YY")}` : ""}
          </span>
        </Tooltip>
      );

    if (k.oneriVar)
      l.push(
        <Tooltip
          key="oneri"
          title={
            k.oneriMetni ? `Açık pozisyona uygun — ${k.oneriMetni}` : "Açık bir pozisyona uygun"
          }
        >
          <span className="bv-etiket bv-e-sari">
            <Lightbulb size={11} strokeWidth={2.5} /> Öneri
          </span>
        </Tooltip>
      );

    if (k.calisiyorMu)
      l.push(
        <Tooltip
          key="calisiyor"
          title={`Bu kişi hâlihazırda çalışıyor: ${k.calistigiSube ?? "birim bilinmiyor"}${
            k.calistigiUnvan ? ` · ${k.calistigiUnvan}` : ""
          }`}
        >
          <span className="bv-etiket bv-e-yesil">Çalışıyor</span>
        </Tooltip>
      );

    if (eskiCalisan(k.kimlikNo))
      l.push(
        <Tooltip key="eski" title={eskiCalisanMetni(k.kimlikNo)}>
          <span className="bv-etiket bv-e-sari">
            <Briefcase size={11} strokeWidth={2.5} /> Eski personel
          </span>
        </Tooltip>
      );

    if (k.oncekiBasvuruSayisi > 0)
      l.push(
        <Tooltip
          key="onceki"
          title={`Bu aday daha önce ${k.oncekiBasvuruSayisi} kez başvurmuş. Geçmişi detayda görebilirsiniz.`}
        >
          <span className="bv-etiket bv-e-turuncu">
            <History size={11} strokeWidth={2.5} /> {k.oncekiBasvuruSayisi}
          </span>
        </Tooltip>
      );

    if (!k.mailGonderildi)
      l.push(
        <Tooltip key="mail" title="Bildirim maili gitmedi">
          <span className="bv-etiket bv-e-kirmizi">
            <MailWarning size={11} strokeWidth={2.4} /> Mail gitmedi
          </span>
        </Tooltip>
      );

    if (k.testKaydi)
      l.push(
        <span key="test" className="bv-etiket bv-e-mor">
          Test
        </span>
      );

    return l;
  };

  /* ----------------------------------------------------------------- tablo */

  const sutunlar: ColumnsType<Ozet> = [
    {
      title: "Aday",
      dataIndex: "adSoyad",
      sorter: (a, b) => (a.adSoyad ?? "").localeCompare(b.adSoyad ?? "", "tr"),
      render: (v: string, k) => (
        <div className="bv-kisi">
          {/* Aday fotoğrafı ayrı uçtan çekilir; yoksa baş harfler gösterilir */}
          <Avatar id={k.id} ad={v} foto={k.fotografVar ? api.adayResmi(k.id) : undefined} />
          <div className="bv-kisi-metin">
            <b title={v}>{buyuk(v)}</b>
            <small>{[k.basvuruNo, k.telefon].filter(Boolean).join(" · ")}</small>
            <div className="bv-etiketler">{adayEtiketleri(k)}</div>
          </div>
        </div>
      ),
    },
    {
      title: "Pozisyon · Şube",
      key: "pozisyon",
      width: dar ? 176 : 200,
      sorter: (a, b) => (a.subeAdi ?? "").localeCompare(b.subeAdi ?? "", "tr"),
      render: (_v, k) => {
        const bolumler = bolumListesi(k.bolumler);
        const adres = [k.ilce, k.mahalle].filter(Boolean).join(" / ");
        const subeMetni = [k.subeAdi, adres].filter(Boolean).join(" · ") || "—";

        return (
          <>
            <div className="bv-poz">
              {/* İşe alım yapıldıysa başladığı pozisyon esas alınır */}
              {k.iseGirisBolum ? (
                <Tooltip title={`Başvurduğu pozisyon(lar): ${k.bolumler || "—"}`}>
                  <span className="bv-poz-giris">{k.iseGirisBolum} · işe giriş</span>
                </Tooltip>
              ) : bolumler.length === 0 ? (
                <span>—</span>
              ) : (
                <>
                  {bolumler.slice(0, 2).map((b) => (
                    <span key={b} title={b}>
                      {b}
                    </span>
                  ))}
                  {bolumler.length > 2 && (
                    <Tooltip title={bolumler.slice(2).join(", ")}>
                      <span>+{bolumler.length - 2}</span>
                    </Tooltip>
                  )}
                </>
              )}
            </div>
            <div className="bv-sube-satir">
              <Store size={13} strokeWidth={2} />
              <span title={subeMetni}>{subeMetni}</span>
            </div>
          </>
        );
      },
    },
    {
      title: "Durum",
      dataIndex: "durum",
      width: dar ? 156 : 176,
      sorter: (a, b) => (a.durum ?? "").localeCompare(b.durum ?? "", "tr"),
      render: (v: string, k) => (
        <div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <DurumCip durum={v} />
            {/* Olumlu bulunup havuza giden aday geri geldiyse uzman görsün */}
            {k.havuzdanDonusTarihi && (
              <Tooltip
                title={
                  `${dayjs(k.havuzdanDonusTarihi).format("DD.MM.YYYY HH:mm")} · ` +
                  (k.havuzdanCikaran ? `${k.havuzdanCikaran}: ` : "") +
                  (k.havuzdanDonusNotu ?? "")
                }
              >
                <span className="bv-etiket bv-e-turuncu">havuzdan döndü</span>
              </Tooltip>
            )}
          </div>
          {/* Bu durumda ne kadar süredir beklediği ve not sayısı */}
          <div className="bv-durum-alt">
            <span
              className={k.durumGun > 14 ? "bv-kirmizi" : k.durumGun > 7 ? "bv-turuncu" : undefined}
            >
              {k.durumGun > 0 ? `${k.durumGun} gündür bu durumda` : "bugün"}
            </span>
            {k.notSayisi > 0 && ` · ${k.notSayisi} not`}
          </div>
        </div>
      ),
    },
    {
      title: "Bekleme",
      dataIndex: "bekleyenGun",
      width: dar ? 100 : 108,
      /* Başvuru tarihine göre sıralamayla aynı sırayı verir (ters yönde) */
      sorter: (a, b) => a.bekleyenGun - b.bekleyenGun,
      render: (v: number, k) => (
        <>
          <Tooltip title="Başvurunun üzerinden geçen süre">
            <span>
              <BeklemeRozeti gun={v} />
            </span>
          </Tooltip>
          <Tooltip title="Başvuru tarihi">
            <span className="bv-kucuk">{dayjs(k.olusturma).format("DD.MM.YYYY")}</span>
          </Tooltip>
          {k.islemsizGun >= 3 && k.islemsizGun !== v && (
            <Tooltip title="Son işlemden bu yana geçen süre">
              <span className="bv-kucuk">{k.islemsizGun} gün işlemsiz</span>
            </Tooltip>
          )}
        </>
      ),
    },
    {
      title: dar ? (
        <Tooltip title="Ücret beklentisi">
          <span>Ücret</span>
        </Tooltip>
      ) : (
        "Ücret beklentisi"
      ),
      dataIndex: "talepUcret",
      width: dar ? 104 : 168,
      // Metinden sayı ayıklanarak sıralanır ("32.000 TL" gibi girişler için)
      sorter: (a, b) => {
        const say = (v: string | null) => Number((v ?? "").replace(/[^\d]/g, "")) || 0;
        return say(a.talepUcret) - say(b.talepUcret);
      },
      render: (v: string) =>
        v ? <span className="bv-ucret">{v}</span> : <span className="bv-tire">—</span>,
    },
    {
      title: "Referans",
      dataIndex: "referansPuani",
      width: dar ? 100 : 112,
      sorter: (a, b) => (a.referansPuani ?? -1) - (b.referansPuani ?? -1),
      render: (v: number | null) => <Yildiz puan={v} />,
    },
    {
      /* Not sayısına göre sıralama bu sütunda: not sayısı durum hücresinde
         yazıyor, sıralama düğmesi burada duruyor. */
      title: (
        <Tooltip title="Not sayısına göre sırala">
          <StickyNote size={13} strokeWidth={2} />
        </Tooltip>
      ),
      key: "islem",
      dataIndex: "notSayisi",
      width: yetkili ? 124 : 56,
      align: "right",
      sorter: (a, b) => a.notSayisi - b.notSayisi,
      render: (_v, k) => (
        <div className="bv-hizli-aks">
          {yetkili && k.durum === "Yeni" && (
            <Tooltip title="İnceledim">
              <button
                type="button"
                className="bv-hb"
                aria-label="İnceledim"
                onClick={(e) => {
                  e.stopPropagation();
                  satirIncele(k);
                }}
              >
                <Eye size={15} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
          {yetkili && !SONUCLANAN.includes(k.durum) && (
            <Tooltip title="Görüşme talebi">
              <button
                type="button"
                className="bv-hb"
                aria-label="Görüşme talebi"
                onClick={(e) => {
                  e.stopPropagation();
                  gorusmeAc(k);
                }}
              >
                <CalendarClock size={15} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
          {yetkili && k.telefon && !k.telefon.includes("*") && (
            <Tooltip
              title={k.gorusmeTarihi ? "Görüşme davetini WhatsApp'tan gönder" : "WhatsApp'tan yaz"}
            >
              <button
                type="button"
                className="bv-hb bv-hb-wa"
                aria-label="WhatsApp"
                onClick={(e) => {
                  e.stopPropagation();
                  satirWhatsapp(k);
                }}
              >
                <MessageCircle size={15} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
          <span className="bv-ok">
            <ChevronRight size={16} strokeWidth={2} />
          </span>
        </div>
      ),
    },
  ];

  /* ------------------------------------------------------------ özet hesapları */

  const seciliFiltreSayisi =
    (durum ? 1 : 0) +
    (sube.length > 0 ? 1 : 0) +
    (bolum ? 1 : 0) +
    (ilce ? 1 : 0) +
    (mahalle ? 1 : 0) +
    (tarihAraligi?.[0] && tarihAraligi?.[1] ? 1 : 0) +
    (gecikmisSuz ? 1 : 0) +
    (mailSuz ? 1 : 0) +
    (eskiSuz ? 1 : 0) +
    (arama ? 1 : 0);

  /* "Diğer filtreler" kutusundakiler; düğmede sayı olarak görünür */
  const digerFiltreSayisi =
    (ilce ? 1 : 0) +
    (mahalle ? 1 : 0) +
    (arsivGoster ? 1 : 0) +
    (durum && !ASAMALAR.includes(durum) && !SONUCLANAN.includes(durum) ? 1 : 0);

  const filtreleriTemizle = () => {
    setDurum(undefined);
    setSube([]);
    setBolum(undefined);
    setIlce(undefined);
    setMahalle(undefined);
    setTarihAraligi(null);
    setTarihOn("0");
    setGecikmisSuz(false);
    setMailSuz(false);
    setEskiSuz(false);
    setArama("");
    setAramaKutusu("");
    setSayfa(1);
  };

  const durumAdedi = (ad: string) =>
    ozet?.durumlar?.find((x) => x.durum === ad)?.adet ?? 0;

  const gecikmisAdedi = (ad: string) =>
    ozet?.gecikmisler?.find((x) => x.durum === ad)?.adet ?? 0;

  /* Sonuçlanmış durumlar listeden çıkarılır; "aktif" bunların dışındakiler */
  const aktifSayi = useMemo(() => {
    /* Olumlu da sonuçlanmış sayılır: aday havuzuna aktarıldığı için
       başvuru süreci kapanmıştır, listede de görünmez. Üçü birlikte
       "sonuçlandı", kalanlar süreçtedir. */
    return (ozet?.durumlar ?? [])
      .filter((d) => !SONUCLANAN.includes(d.durum))
      .reduce((t, d) => t + d.adet, 0);
  }, [ozet]);

  /* Şerit: sonuçlanan / toplam. "Sonuçlanan" tanımı kartlardaki
     "aktif" tanımıyla aynı kaynaktan gelsin diye buradan türetiliyor. */
  const ozetToplam = ozet?.toplam ?? 0;
  const sonuclananSayi = ozetToplam - aktifSayi;

  const sonuclanmaOrani =
    ozetToplam > 0 ? Math.round((sonuclananSayi / ozetToplam) * 100) : 0;

  /* Süreçtekiler ikiye ayrılır: üzerinde işlem yapılmış olanlar (incelendi,
     değerlendirmede, görüşme talebi, evrak hazırlanıyor) ile hiç
     dokunulmamış "Yeni" başvurular. */
  const islemdekiSayi = (ozet?.durumlar ?? [])
    .filter((d) =>
      [
        "İncelendi",
        "Değerlendirmede",
        "Görüşme Talebi",
        "Evrak Hazırlanıyor",
        "Onay Bekliyor",
      ].includes(d.durum)
    )
    .reduce((t, d) => t + d.adet, 0);

  /* "Yeni" doğrudan sayılır; listede olmayan durumlar Yeni'ye yazılmaz */
  const yeniSayi = durumAdedi("Yeni");

  const yuzde = (adet: number) => (ozetToplam > 0 ? (adet / ozetToplam) * 100 : 0);

  /* Dağılım penceresi: durumlar sabit sırayla, sıfır olanlar dahil
     (Onay Bekliyor ve tanımsız durumlar yalnızca varsa) */
  const durumDagilimi = useMemo(() => {
    const sirali = [...ASAMALAR, "Onay Bekliyor", ...SONUCLANAN];
    const satirlar = sirali
      .map((d) => ({ ad: d, adet: durumAdedi(d), renk: DURUM_RENKLERI[d] }))
      .filter((x) => x.adet > 0 || x.ad !== "Onay Bekliyor");

    (ozet?.durumlar ?? [])
      .filter((d) => !sirali.includes(d.durum))
      .forEach((d) => satirlar.push({ ad: d.durum || "Belirtilmemiş", adet: d.adet, renk: "#8a8f98" }));

    return satirlar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ozet]);

  const durumSec = (yeni?: string) => {
    setDurum((eski) => (eski === yeni ? undefined : yeni));
    setSayfa(1);
  };

  const tarihSec = (on: string) => {
    setTarihOn(on);
    const n = Number(on);
    setTarihAraligi(n > 0 ? [dayjs().subtract(n - 1, "day").startOf("day"), dayjs()] : null);
    setSayfa(1);
  };

  const donemMetni =
    tarihOn === "1"
      ? "bugün"
      : tarihOn === "7"
      ? "son 7 gün"
      : tarihOn === "30"
      ? "son 30 gün"
      : tarihAraligi?.[0] && tarihAraligi?.[1]
      ? `${dayjs(tarihAraligi[0]).format("DD.MM.YYYY")} – ${dayjs(tarihAraligi[1]).format("DD.MM.YYYY")}`
      : "tüm zamanlar";

  const tarihVar = !!(tarihAraligi?.[0] && tarihAraligi?.[1]);

  /* Pano sütunları: süreçteki beş aşama ve listede başka durum varsa o */
  const panoSutunlari = useMemo(() => {
    if (durum) return [durum];
    const ekstra = [...new Set(kayitlar.map((k) => k.durum))].filter(
      (d) => !ASAMALAR.includes(d)
    );
    return [...ASAMALAR, ...ekstra];
  }, [kayitlar, durum]);

  const listeBasligi = durum
    ? durum
    : tarihVar || arama
    ? "Başvurular"
    : "Süreçteki başvurular";

  const sayfaMetni = (t: number, aralik: [number, number]) =>
    `${aralik[0]}-${aralik[1]} / toplam ${t} başvuru`;

  const sayfaDegisti = (yeniSayfa: number, boyut: number) => {
    if (boyut !== sayfaBoyutu) {
      setSayfaBoyutu(boyut);
      setSayfa(1);
    } else {
      setSayfa(yeniSayfa);
    }
  };

  /* --------------------------------------------------------- liste içeriği */

  const listeIcerik =
    gorunum === "tablo" ? (
      <Tablo<Ozet>
        className="bv-tablo"
        rowKey="id"
        size="small"
        loading={yukleniyor}
        columns={sutunlar}
        dataSource={kayitlar}
        tableLayout="fixed"
        rowClassName={(k) => (k.mikroBekliyor ? "bv-satir-uyari" : "")}
        onRow={(k) => ({ onClick: () => detayAc(k.id) })}
        locale={{ emptyText: <Empty description="Gösterilecek başvuru bulunamadı." /> }}
        pagination={{
          current: sayfa,
          total: toplam,
          pageSize: sayfaBoyutu,
          showSizeChanger: true,
          pageSizeOptions: ["25", "50", "100", "500"],
          locale: { items_per_page: "kayıt / sayfa" },
          onChange: sayfaDegisti,
          showTotal: sayfaMetni,
        }}
      />
    ) : (
      <>
        {yukleniyor && kayitlar.length === 0 ? (
          <div className="bv-bos">
            <Spin />
          </div>
        ) : (
          <Spin spinning={yukleniyor}>
            <div className="bv-pano">
              {panoSutunlari.map((ad) => {
                const kartlar = kayitlar.filter((k) => k.durum === ad);
                const renk = DURUM_RENKLERI[ad] ?? "#8a8f98";

                return (
                  <div key={ad} className="bv-sutun">
                    <h4>
                      <i style={{ background: renk }} />
                      {ad}
                      <em>{kartlar.length}</em>
                    </h4>

                    {kartlar.length === 0 && <div className="bv-sutun-bos">Bu sayfada yok</div>}

                    {kartlar.map((k) => (
                      <button
                        type="button"
                        key={k.id}
                        className="bv-ak"
                        onClick={() => detayAc(k.id)}
                      >
                        <div className="bv-ak-ust">
                          <Avatar
                            id={k.id}
                            ad={k.adSoyad}
                            foto={k.fotografVar ? api.adayResmi(k.id) : undefined}
                          />
                          <div>
                            <b title={k.adSoyad}>{k.adSoyad}</b>
                            <small>
                              {[k.iseGirisBolum || bolumListesi(k.bolumler).join(", "), k.subeAdi]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </div>
                        </div>
                        <div className="bv-ak-alt">
                          <BeklemeRozeti gun={k.bekleyenGun} />
                          <Yildiz puan={k.referansPuani} yalin />
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </Spin>
        )}

        <div className="bv-sayfalama">
          <Pagination
            size="small"
            current={sayfa}
            pageSize={sayfaBoyutu}
            total={toplam}
            showSizeChanger
            pageSizeOptions={["25", "50", "100", "500"]}
            locale={{ items_per_page: "kayıt / sayfa" }}
            showTotal={sayfaMetni}
            onChange={sayfaDegisti}
          />
        </div>
      </>
    );

  /* --------------------------------------------------- diğer filtreler kutusu */

  const digerFiltreler = (
    <div className="bv-pop-ic">
      <div>
        <label className="bv-etk">Durum</label>
        <Select
          allowClear
          placeholder="Tüm durumlar"
          style={{ width: "100%" }}
          value={durum}
          onChange={(v) => {
            setDurum(v);
            setSayfa(1);
          }}
          options={DURUMLAR.map((d) => ({ value: d, label: d }))}
        />
      </div>

      <div>
        <label className="bv-etk">İlçe</label>
        <Select
          allowClear
          showSearch
          placeholder="Tüm ilçeler"
          style={{ width: "100%" }}
          value={ilce}
          onChange={(v) => {
            setIlce(v);
            setMahalle(undefined);
            setSayfa(1);
          }}
          options={filtreler.ilceler.map((x) => ({ value: x, label: x }))}
        />
      </div>

      <div>
        <label className="bv-etk">Mahalle / Semt</label>
        <Select
          allowClear
          showSearch
          placeholder="Tüm mahalleler"
          style={{ width: "100%" }}
          value={mahalle}
          onChange={(v) => {
            setMahalle(v);
            setSayfa(1);
          }}
          options={filtreler.mahalleler
            .filter((m) => m?.mahalle && (!ilce || m.ilce === ilce))
            .map((m) => ({
              value: m.mahalle,
              label: !ilce && m.ilce ? `${m.mahalle} (${m.ilce})` : m.mahalle,
            }))}
        />
      </div>

      {/* Arşivdekiler yalnızca yöneticide görünür: arşivden çıkarma
          yetkisi de onda. */}
      {yoneticiMi && (
        <Checkbox
          checked={arsivGoster}
          onChange={(e) => {
            setArsivGoster(e.target.checked);
            setSayfa(1);
          }}
        >
          Arşivdekileri göster
        </Checkbox>
      )}

      <div className="bv-pop-alt">
        <Button
          size="small"
          type="text"
          disabled={seciliFiltreSayisi === 0 && !arsivGoster}
          onClick={() => {
            filtreleriTemizle();
            setArsivGoster(false);
          }}
        >
          Filtreleri temizle
        </Button>
        <Button size="small" type="primary" onClick={() => setDigerAcik(false)}>
          Tamam
        </Button>
      </div>
    </div>
  );

  /* ============================================================ başvuru kartı */

  const satir = detay ? kayitlar.find((k) => k.id === detay.id) : undefined;

  const cekmeceIcerik = () => {
    if (!detay) {
      return (
        <div className="bv-yukleniyor">
          <Spin />
        </div>
      );
    }

    const veri = formVerisi(detay.veriJson);
    const bolumler = bolumListesi(detay.bolumler);
    const sonucMu = SONUCLANAN.includes(detay.durum);
    const eski = eskiCalisan(detay.kimlikNo);
    /* 26.10.2026: eski ya da şu an çalışan adayın personel kartı */
    const kartKodu: string | null = satir?.personelKodu || eski?.personelKodu || null;
    const kartAcilir = !!kartKodu && personelKartiAcilabilir();
    const mulakatGoster = !sekmeGizli(oturumOku(), "basvurular.mulakat");
    const mulakatlar = detay.cikisMulakatlari ?? [];
    const telefonMaskeli = (detay.telefon ?? "").includes("*");
    const [zemin, yazi] = avRengi(detay.id);

    const fotoAdresi = veri?.fotograf?.base64
      ? `data:${veri.fotograf.tur};base64,${veri.fotograf.base64}`
      : satir?.fotografVar
      ? api.adayResmi(detay.id)
      : "";

    /* ---------------------------------------------------------- hızlı bilgiler */
    const ilkSkala = bolumler.map(skalaBul).find(Boolean);
    const binYaz = (n: number) =>
      (n / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
    const tecrubeler: any[] = Array.isArray(veri.isTecrubesi) ? veri.isTecrubesi : [];
    const yil = tecrubeYili(tecrubeler);
    const egitim = [veri.egitimSeviyesi, veri.mezunOkul].filter(Boolean).join(" · ");
    const refPuan = refBilgi?.puan ?? satir?.referansPuani ?? null;

    const hizli: { anahtar: string; baslik: string; deger: ReactNode; alt?: ReactNode; ipucu?: string }[] = [
      {
        anahtar: "bekleme",
        baslik: "Bekleme",
        deger: detay.bekleyenGun > 0 ? `${detay.bekleyenGun} gün` : "bugün",
        alt:
          detay.islemsizGun > 0 && detay.islemsizGun !== detay.bekleyenGun
            ? `son işlemden ${detay.islemsizGun} gün`
            : !detay.gorusmeTarihi
            ? "henüz görüşme planlanmadı"
            : `başvuru ${dayjs(detay.olusturma).format("DD.MM.YYYY")}`,
        ipucu:
          `Başvuru ${detay.bekleyenGun} gün önce yapıldı` +
          (detay.islemsizGun > 0 && detay.islemsizGun !== detay.bekleyenGun
            ? ` · son işlemden bu yana ${detay.islemsizGun} gün geçti`
            : "") +
          (!detay.gorusmeTarihi ? " · henüz görüşme planlanmadı" : ""),
      },
      {
        anahtar: "ucret",
        baslik: "Ücret beklentisi",
        deger: detay.talepUcret || "—",
        alt: ilkSkala
          ? `${ilkSkala.bolum} skalası ${binYaz(ilkSkala.altSinir)}–${binYaz(ilkSkala.ustSinir)} bin`
          : "skala tanımlı değil",
      },
    ];

    if (tecrubeler.length > 0 || egitim) {
      hizli.push({
        anahtar: "tecrube",
        baslik: "Tecrübe",
        deger:
          tecrubeler.length === 0
            ? "Belirtilmemiş"
            : yil == null
            ? `${tecrubeler.length} iş yeri`
            : yil === 0
            ? "1 yıldan az"
            : `~${yil} yıl`,
        alt: egitim || `${tecrubeler.length} iş yeri`,
        ipucu: yil != null ? "İş tecrübesi tarihlerinden yaklaşık hesaplanır" : undefined,
      });
    }

    hizli.push({
      anahtar: "telefon",
      baslik: "Telefon",
      deger: <span style={{ fontSize: 15 }}>{detay.telefon || "—"}</span>,
      alt:
        detay.telefon && !telefonMaskeli ? (
          <button type="button" className="bv-wa-bag" onClick={() => whatsappYaz(detay.telefon)}>
            WhatsApp
          </button>
        ) : (
          detay.eposta || ""
        ),
    });

    hizli.push({
      anahtar: "referans",
      baslik: "Referans",
      deger: <Yildiz puan={refPuan} yalin />,
      alt: refBilgi
        ? refBilgi.sayi > 0
          ? `${refBilgi.sayi} referans · ${refBilgi.gorusulen} görüşüldü`
          : "referans eklenmemiş"
        : refPuan != null
        ? `${refPuan}/10`
        : "",
    });

    /* ------------------------------------------------------------- adımlar */
    const simdikiAdim = ADIM_SIRASI[detay.durum] ?? 0;
    const hareketTarihi = (durumlar: string[], enSon = false) => {
      const l = (detay.hareketler ?? [])
        .filter((h) => durumlar.includes(h.durum))
        .map((h) => dayjs(h.tarih))
        .sort((a, b) => a.valueOf() - b.valueOf());
      return l.length ? (enSon ? l[l.length - 1] : l[0]) : null;
    };

    const adimlar = ADIMLAR.map((ad, i) => {
      const tarih =
        i === 0
          ? dayjs(detay.olusturma)
          : i === 5
          ? sonucMu
            ? hareketTarihi([detay.durum], true)
            : null
          : hareketTarihi(ADIM_HAREKETLERI[i]);

      let sinif = "";
      if (i < simdikiAdim) sinif = tarih || i === 0 ? "bv-tamam" : "bv-atlandi";
      else if (i === simdikiAdim)
        sinif = sonucMu ? (detay.durum === "Olumsuz" ? "bv-tamam bv-olumsuz" : "bv-tamam") : "bv-simdi";

      const etiket =
        i === 5 && sonucMu
          ? detay.durum
          : i === 4 && detay.durum === "Onay Bekliyor"
          ? "Onay bekliyor"
          : ad;

      return { ad: etiket, tarih, sinif, i };
    }).map((a, i, l) => ({
      ...a,
      /* Bağlantı çizgisi yalnızca sonraki adıma gerçekten geçildiyse yeşil */
      cizgi:
        a.sinif.includes("bv-tamam") &&
        !!l[i + 1] &&
        (l[i + 1].sinif.includes("bv-tamam") || l[i + 1].sinif === "bv-simdi"),
    }));

    /* ------------------------------------------------------------- sekmeler */
    const sekmeler: { k: string; ad: string; ikon: ReactNode; say?: number }[] = [
      { k: "ozet", ad: "Özet", ikon: <UserRound size={15} strokeWidth={2} /> },
      { k: "form", ad: "Başvuru formu", ikon: <FileText size={15} strokeWidth={2} /> },
      {
        k: "not",
        ad: "Notlar",
        ikon: <StickyNote size={15} strokeWidth={2} />,
        say: detay.notlar?.length || undefined,
      },
      {
        k: "gecmis",
        ad: "İşlem geçmişi",
        ikon: <History size={15} strokeWidth={2} />,
        say: detay.hareketler?.length || undefined,
      },
      {
        k: "ref",
        ad: "Referanslar",
        ikon: <Users size={15} strokeWidth={2} />,
        say: refBilgi?.sayi || undefined,
      },
    ];

    const gizle = (k: string) => (detaySekme === k ? "" : " bv-sekme-gizli");

    const alan = (baslik: string, deger: ReactNode, genis = false) =>
      deger === null || deger === undefined || deger === "" ? null : (
        <div className={`bv-alan${genis ? " bv-genis" : ""}`} key={baslik}>
          <span>{baslik}</span>
          <b>{deger}</b>
        </div>
      );

    const dogum = tarihCoz(veri.dogumTarihi);
    const yas = dogum ? dayjs().diff(dogum, "year") : null;
    const adres = [veri.mahalle || detay.mahalle, veri.ilce || detay.ilce, veri.il || detay.il]
      .filter(Boolean)
      .join(" / ");

    const gorusme = detay.gorusmeTarihi ? dayjs(detay.gorusmeTarihi) : null;

    /* ------------------------------------------------------------------ çizim */
    return (
      <>
        {/* ----------------------------------------------------------- hero */}
        <div className="bv-hero ik-yazdirilamaz">
          <div className="bv-hero-arac">
            <button type="button" className="bv-hero-btn" onClick={formIndir}>
              <Download size={15} strokeWidth={2} />
              Formu indir
            </button>
            <button
              type="button"
              className="bv-hero-btn bv-hero-kapat"
              aria-label="Kapat"
              title="Kapat"
              onClick={detayKapat}
            >
              <X size={17} strokeWidth={2.2} />
            </button>
          </div>

          <div className="bv-hero-ic">
            <div className="bv-foto" style={{ color: yazi }}>
              <div className="bv-foto-bos" style={{ background: zemin }}>
                {basHarfler(detay.adSoyad)}
              </div>
              {fotoAdresi && (
                <img
                  src={fotoAdresi}
                  alt={detay.adSoyad}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
            </div>

            <div className="bv-hero-metin">
              <h2>{buyuk(detay.adSoyad)}</h2>
              <div className="bv-rol">
                {[detay.iseGirisBolum || bolumler.join(" · "), detay.subeAdi]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>

              <div className="bv-hero-etiketler">
                <span
                  className="bv-etiket bv-parlak"
                  style={{ color: DURUM_RENKLERI[detay.durum] ?? "#3f6507" }}
                >
                  {detay.durum}
                </span>
                <span className="bv-etiket">
                  {detay.durumGun > 0 ? `${detay.durumGun} gündür bu durumda` : "bugün bu duruma geçti"}
                </span>
                <span className="bv-etiket">Başvuru {detay.basvuruNo}</span>
                {eski && !satir?.calisiyorMu && (
                  kartAcilir ? (
                    <button type="button" className="bv-etiket bv-etiket-dugme" onClick={() => personelKartiAc(kartKodu)}
                      title="Personel kartını aç">
                      <SquareUser size={12} strokeWidth={2.2} /> Eski personel · kartı aç
                    </button>
                  ) : <span className="bv-etiket">Eski personel</span>
                )}
                {satir?.calisiyorMu && (
                  kartAcilir ? (
                    <button type="button" className="bv-etiket bv-etiket-dugme" onClick={() => personelKartiAc(kartKodu)}
                      title="Personel kartını aç">
                      <SquareUser size={12} strokeWidth={2.2} /> Şu an çalışıyor · kartı aç
                    </button>
                  ) : <span className="bv-etiket">Şu an çalışıyor</span>
                )}
                {detay.havuzdanDonusTarihi && <span className="bv-etiket bv-dikkat">Havuzdan döndü</span>}
                {satir?.mikroBekliyor && <span className="bv-etiket bv-dikkat">Mikro girişi yok</span>}
                {detay.arsiv && <span className="bv-etiket">Arşivde</span>}
                {detay.testKaydi && <span className="bv-etiket">Test kaydı</span>}
              </div>
            </div>
          </div>

          <div
            className="bv-hizli"
            style={{ gridTemplateColumns: `repeat(${hizli.length}, minmax(0, 1fr))` }}
          >
            {hizli.map((h) => (
              <Tooltip key={h.anahtar} title={h.ipucu}>
                <div>
                  <span>{h.baslik}</span>
                  <b>{h.deger}</b>
                  <small>{h.alt}</small>
                </div>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="bv-govde">
          {/* ------------------------------------------------------ adımlar */}
          <div className="bv-adimlar ik-yazdirilamaz">
            {adimlar.map((a) => (
              <div key={a.i} className={`bv-adim ${a.sinif}${a.cizgi ? " bv-cizgili" : ""}`}>
                <div className="bv-adim-n">
                  {a.sinif.includes("bv-olumsuz") ? (
                    <X size={14} strokeWidth={3} />
                  ) : a.sinif.includes("bv-tamam") ? (
                    "✓"
                  ) : (
                    a.i + 1
                  )}
                </div>
                <b title={a.ad}>{a.ad}</b>
                <small>
                  {a.tarih ? a.tarih.format("DD.MM") : a.sinif === "bv-atlandi" ? "atlandı" : "—"}
                </small>
              </div>
            ))}
          </div>

          {detay.guncelleyen && (
            <div className="bv-son-islem ik-yazdirilamaz">
              <UserCheck size={14} strokeWidth={2} />
              <span>
                Son işlemi yapan: <b>{detay.guncelleyen}</b>
                {detay.guncelleme && ` · ${dayjs(detay.guncelleme).format("DD.MM.YYYY HH:mm")}`}
              </span>
            </div>
          )}

          {/* ------------------------------------------------------- uyarılar */}
          {!detay.mailGonderildi && (
            <div className="bv-uyari bv-kirmizi ik-yazdirilamaz">
              <MailWarning size={16} strokeWidth={2} />
              <div className="bv-uyari-ic">Bu başvurunun bildirim maili gönderilemedi.</div>
              {yetkili && (
                <button type="button" className="bv-btn bv-btn-ince" onClick={mailTekrarGonder}>
                  <Send size={14} strokeWidth={2} />
                  Şimdi gönder
                </button>
              )}
            </div>
          )}

          {(eski || (mulakatGoster && mulakatlar.length > 0)) && (
            <div className="bv-uyari ik-yazdirilamaz">
              <Briefcase size={16} strokeWidth={2} />
              <div className="bv-uyari-ic">
                <b>Daha önce Biçen'de çalışmış</b>
                {eski
                  ? `: ${eskiCalisanParcalari(detay.kimlikNo)}`
                  : ` · ${mulakatlar.length} çıkış görüşmesi var`}
                {kartAcilir && (
                  <button type="button" className="bv-btn bv-btn-ince bv-kart-dugme" onClick={() => personelKartiAc(kartKodu)}>
                    <SquareUser size={14} strokeWidth={2} /> Personel kartını aç
                  </button>
                )}
                {eski && mulakatGoster && mulakatlar.length > 0 && (
                  <> · {mulakatlar.length} çıkış görüşmesi var</>
                )}

                {/* Eski çıkış mülakatları: neden ayrıldığı, ne söylediği */}
                {mulakatGoster &&
                  mulakatlar.map((m: any, i: number) => (
                    <div key={i} className="bv-mulakat">
                      <LogOut size={14} strokeWidth={2} style={{ marginTop: 3 }} />
                      <div>
                        <div>
                          {[
                            m.subeAdi,
                            m.gorev,
                            m.cikisTarihi
                              ? `Çıkış ${dayjs(m.cikisTarihi).format("DD.MM.YYYY")}`
                              : "",
                            m.uzmanAdi === "Çıkış anketi" ? "anket" : m.uzmanAdi,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {m.cikisNedeni && (
                          <div>
                            <b>Ayrılma sebebi:</b> {m.cikisNedeni}
                          </div>
                        )}
                        {(m.ozet || m.uzmanYorumu) && (
                          <div className="bv-uyari-alt">{m.ozet || m.uzmanYorumu}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="bv-btn bv-btn-ince"
                        onClick={() => setMulakatDetay(m)}
                      >
                        Mülakatı aç
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ----------------------------------------- önceki başvurular */}
          {detay.oncekiBasvurular?.length > 0 && (
            <div className="bv-uyari bv-turuncu ik-yazdirilamaz">
              <History size={16} strokeWidth={2} />
              <div className="bv-uyari-ic">
                <b>Bu aday daha önce {detay.oncekiBasvurular.length} kez başvuru yapmış</b>
                {(() => {
                  const acik = oncekiAcik ?? detay.oncekiBasvurular.length <= 2;

                  return (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="bv-baglanti"
                        onClick={() => setOncekiAcik(!acik)}
                      >
                        {acik ? "gizle" : "göster"}
                      </button>

                      {acik &&
                        detay.oncekiBasvurular.map((o) => (
                          <div key={o.id} className="bv-onceki">
                            <div className="bv-onceki-ust">
                              <DurumCip durum={o.durum} />
                              <b>{o.basvuruNo}</b>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {dayjs(o.olusturma).format("DD.MM.YYYY")}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {o.subeAdi}
                              </Text>
                              {o.veriJson && (
                                <button
                                  type="button"
                                  className="bv-baglanti"
                                  style={{ marginLeft: "auto" }}
                                  onClick={() =>
                                    setEskiForm({
                                      baslik: `${o.basvuruNo} · ${dayjs(o.olusturma).format(
                                        "DD.MM.YYYY"
                                      )}`,
                                      veri: formVerisi(o.veriJson),
                                    })
                                  }
                                >
                                  Başvuru formunu gör
                                </button>
                              )}
                            </div>

                            {o.bolumler && <div className="bv-onceki-satir">{o.bolumler}</div>}

                            {o.iseGirisTarihi && (
                              <div className="bv-onceki-satir">
                                İşe giriş: {dayjs(o.iseGirisTarihi).format("DD.MM.YYYY")}
                                {o.anlasilanUcret
                                  ? ` · ${Number(o.anlasilanUcret).toLocaleString("tr-TR")} TL`
                                  : ""}
                              </div>
                            )}

                            {o.degerlendirmeNotu && (
                              <div className="bv-onceki-satir">
                                <b>Değerlendirme:</b> {o.degerlendirmeNotu}
                              </div>
                            )}

                            {o.notlar?.map((n) => (
                              <div key={n.id} className="bv-onceki-satir">
                                <b>{n.adSoyad || n.kullanici}</b>{" "}
                                <span style={{ color: "#888" }}>
                                  ({dayjs(n.tarih).format("DD.MM.YYYY")})
                                </span>
                                : {n.metin}
                              </div>
                            ))}
                          </div>
                        ))}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {detay.havuzdanDonusTarihi && (
            <div className="bv-uyari bv-mavi ik-yazdirilamaz">
              <ArrowLeftRight size={16} strokeWidth={2} />
              <div className="bv-uyari-ic">
                <b>Bu başvuru aday havuzundan geri döndü</b>
                <div className="bv-uyari-alt">
                  {dayjs(detay.havuzdanDonusTarihi).format("DD.MM.YYYY HH:mm")}
                  {detay.havuzdanCikaran ? ` · ${detay.havuzdanCikaran}` : ""}
                  {detay.havuzdanDonusNotu && `\n${detay.havuzdanDonusNotu}`}
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- işlemler */}
          {yetkili ? (
            <div className="bv-aksiyon ik-yazdirilamaz">
              <button
                type="button"
                className="bv-btn bv-turuncu"
                onClick={() => durumDegistir("İncelendi")}
              >
                <Eye size={15} strokeWidth={2} />
                İnceledim
              </button>
              <button
                type="button"
                className="bv-btn"
                onClick={() => durumDegistir("Değerlendirmede")}
              >
                <RefreshCw size={15} strokeWidth={2} />
                Değerlendirmeye al
              </button>
              <button type="button" className="bv-btn bv-mor" onClick={() => gorusmeAc(detay)}>
                <CalendarClock size={15} strokeWidth={2} />
                Görüşme talebi
              </button>
              <button
                type="button"
                className="bv-btn bv-mavi"
                onClick={() => durumDegistir("Evrak Hazırlanıyor")}
              >
                <FileSignature size={15} strokeWidth={2} />
                Evrak hazırlanıyor
              </button>
              <span className="bv-ayir" />
              <button type="button" className="bv-btn bv-ana" onClick={() => olumluAc()}>
                <CheckCircle2 size={15} strokeWidth={2} />
                Olumlu
              </button>
              <button type="button" className="bv-btn bv-camgobegi" onClick={iseAlAc}>
                <UserCheck size={15} strokeWidth={2} />
                İşe al
              </button>
              <button type="button" className="bv-btn bv-kirmizi" onClick={olumsuzYap}>
                <ThumbsDown size={15} strokeWidth={2} />
                Olumsuz
              </button>

              <Popover
                trigger="click"
                placement="bottomRight"
                open={menuAcik}
                onOpenChange={setMenuAcik}
                overlayClassName="bv-pop"
                arrow={false}
                content={
                  <div className="bv-menu-ic">
                    <button type="button" onClick={birimAc}>
                      <ArrowLeftRight size={15} strokeWidth={2} />
                      Birim değiştir
                    </button>

                    {/* Bu başvuruyla ilgili bir işi bir kişiye ata. Bileşen
                        kendi düğmesini ve penceresini çiziyor; yetkisi
                        olmayan rollerde hiç görünmüyor. */}
                    <IsEmriAta
                      ekran="basvuru"
                      tip="text"
                      kayitId={String(detay.id)}
                      kayitBaslik={detay.adSoyad ?? ""}
                      onerilenBaslik={detay.adSoyad ? `Başvuru: ${detay.adSoyad}` : ""}
                    />

                    {yoneticiMi && (
                      <>
                        <hr />
                        <button type="button" onClick={() => arsivle(!!detay.arsiv)}>
                          <Archive size={15} strokeWidth={2} />
                          {detay.arsiv ? "Arşivden çıkar" : "Arşive al"}
                        </button>
                        <button type="button" className="bv-tehlike" onClick={kaliciSil}>
                          <Trash2 size={15} strokeWidth={2} />
                          Kalıcı sil
                        </button>
                      </>
                    )}
                  </div>
                }
              >
                <button
                  type="button"
                  className="bv-btn bv-btn-ikon bv-menu-dugme"
                  aria-label="Diğer işlemler"
                  title="Diğer işlemler"
                >
                  <MoreHorizontal size={16} strokeWidth={2} />
                </button>
              </Popover>
            </div>
          ) : (
            <div className="bv-uyari bv-mavi ik-yazdirilamaz">
              <Eye size={16} strokeWidth={2} />
              <div className="bv-uyari-ic">
                <b>Bu başvuruyu inceleyebilir ve not ekleyebilirsiniz.</b>
                <div className="bv-uyari-alt">
                  Durum değiştirme, işe alım ve görüşme işlemleri İnsan Kaynakları tarafından
                  yürütülür.
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------- Mikro sicil kartı durumu */}
          {yetkili && ["Onay Bekliyor", "İşe Alındı"].includes(detay.durum) && (
            <MikroSicilDurumu
              key={`${detay.id}-${sicilSurum}`}
              basvuruId={detay.id}
              iseAlindi={detay.durum === "İşe Alındı"}
              surum={sicilSurum}
            />
          )}

          {/* -------------------------------------- işe giriş evrakları */}
          {yetkili &&
            ["Evrak Hazırlanıyor", "Onay Bekliyor", "İşe Alındı"].includes(detay.durum) && (
              <div className="bv-kart bv-evrak ik-yazdirilamaz">
                <IseGirisEvraklari key={`${detay.id}-${evrakSurum}`} basvuruId={detay.id} kisiAdi={(detay as any).adSoyad} />
              </div>
            )}

          {/* ------------------------------------------------- görüşme kartı */}
          {gorusme && (
            <div
              className={`bv-gorusme ik-yazdirilamaz${gorusme.isBefore(dayjs(), "day") ? " bv-gecti" : ""}`}
            >
              <div className="bv-tarih-k">
                <b>{gorusme.format("D")}</b>
                <small>{gorusme.format("MMM")}</small>
              </div>
              <div className="bv-gorusme-metin">
                <b>
                  Görüşme · {gorusme.format("dddd")} {gorusme.format("HH:mm")}
                </b>
                <div>
                  {gorusme.format("DD.MM.YYYY")}
                  {detay.gorusmeYeri ? ` · ${detay.gorusmeYeri}` : ""}
                </div>
              </div>
              {yetkili && (
                <>
                  <button
                    type="button"
                    className="bv-btn bv-wa"
                    onClick={() => whatsappGonder(detay)}
                  >
                    <MessageCircle size={15} strokeWidth={2} />
                    WhatsApp'tan gönder
                  </button>
                  <Tooltip title="Yeni görüşme talebi / tarihi değiştir">
                    <button
                      type="button"
                      className="bv-btn bv-btn-ikon"
                      aria-label="Görüşmeyi değiştir"
                      onClick={() => gorusmeAc(detay, true)}
                    >
                      <Pencil size={15} strokeWidth={2} />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          )}

          {yetkili && detay.iseGirisTarihi && (
            <div className="bv-ise-giris ik-yazdirilamaz">
              <UserCheck size={15} strokeWidth={2} />
              <span>
                İşe giriş: {dayjs(detay.iseGirisTarihi).format("DD.MM.YYYY")} · {detay.subeAdi}
                {detay.iseGirisBolum ? ` · ${detay.iseGirisBolum}` : ""}
                {detay.doldurmaGun != null &&
                  ` · pozisyon ${detay.doldurmaGun} gün sonra dolduruldu`}
                {detay.anlasilanUcret != null &&
                  ` · ücret ${detay.anlasilanUcret.toLocaleString("tr-TR")} TL`}
                {detay.yolUcreti ? ` · yol ${detay.yolUcreti.toLocaleString("tr-TR")} TL` : ""}
              </span>
            </div>
          )}

          {/* ------------------------------------------------------ sekmeler */}
          <div className="bv-psekme ik-yazdirilamaz" role="tablist">
            {sekmeler.map((s) => (
              <button
                key={s.k}
                type="button"
                role="tab"
                aria-selected={detaySekme === s.k}
                className={detaySekme === s.k ? "bv-aktif" : undefined}
                onClick={() => setDetaySekme(s.k)}
              >
                {s.ikon}
                {s.ad}
                {s.say ? <span className="bv-say">{s.say}</span> : null}
              </button>
            ))}
          </div>

          {/* ----------------------------------------------------------- özet */}
          <div className={`bv-sekme-ic ik-yazdirilamaz${gizle("ozet")}`}>
            <div className="bv-izgara bv-i12">
              <div className="bv-kart">
                <div className="bv-kart-bas">
                  <h3>
                    <UserRound size={16} strokeWidth={2} />
                    Aday
                  </h3>
                  <span className="bv-sag bv-rozetli">
                    başvuru {dayjs(detay.olusturma).format("DD.MM.YYYY HH:mm")}
                  </span>
                </div>
                <div className="bv-kart-ic">
                  <div className="bv-alanlar">
                    {alan("Ad Soyad", detay.adSoyad)}
                    {alan(
                      "Yaş",
                      yas != null ? (
                        <>
                          {yas} <small>({dogum!.format("DD.MM.YYYY")})</small>
                        </>
                      ) : (
                        veri.dogumTarihi
                      )
                    )}
                    {alan(
                      "Telefon",
                      [detay.telefon, veri.cepTel2].filter(Boolean).join(" · ")
                    )}
                    {alan("E-posta", detay.eposta)}
                    {alan("Adres", adres)}
                    {alan("Eğitim", egitim)}
                    {alan("Askerlik", veri.askerlikDurumu)}
                    {alan(
                      "Ehliyet",
                      veri.ehliyetVarMi
                        ? `${veri.ehliyetVarMi}${
                            veri.ehliyetVarMi === "Evet" && veri.ehliyetSinifi
                              ? ` · ${veri.ehliyetSinifi}`
                              : ""
                          }`
                        : ""
                    )}
                    {alan(
                      "Medeni durum",
                      veri.medeniDurum
                        ? `${veri.medeniDurum}${
                            veri.medeniDurum === "Evli" && veri.cocukSayisi != null
                              ? ` · ${veri.cocukSayisi} çocuk`
                              : ""
                          }`
                        : ""
                    )}
                    {alan(
                      "Engel durumu",
                      veri.engelDurumuVarMi === "Evet"
                        ? [
                            (veri.engelTurleri ?? []).join(", "),
                            veri.engelOrani ? `%${veri.engelOrani}` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Var"
                        : veri.engelDurumuVarMi
                        ? "Yok"
                        : ""
                    )}
                    {alan(
                      "Şu an çalışıyor mu",
                      veri.halenCalisiyorMu
                        ? `${veri.halenCalisiyorMu}${
                            veri.halenCalistigiYer ? ` · ${veri.halenCalistigiYer}` : ""
                          }`
                        : ""
                    )}
                    {alan("İşe başlayabileceği tarih", veri.iseBaslamaTarihi)}
                    {alan(
                      "Bilgisayar bilgisi",
                      Array.isArray(veri.bilgisayarBilgisi) && veri.bilgisayarBilgisi.length
                        ? veri.bilgisayarBilgisi.join(", ")
                        : ""
                    )}
                    {alan(
                      "Tercih ettiği birim",
                      [detay.subeAdi, veri.birimTuru ? `(${veri.birimTuru})` : ""]
                        .filter(Boolean)
                        .join(" "),
                      true
                    )}
                    {alan("Başvurduğu pozisyonlar", bolumler.join(", "), true)}
                  </div>
                </div>
              </div>

              {yetkili ? (
                <div className="bv-kart">
                  <div className="bv-kart-bas">
                    <h3>
                      <Pencil size={16} strokeWidth={2} />
                      Değerlendirme notu
                    </h3>
                    <span className="bv-rozetli">aday görmez</span>
                  </div>
                  <div className="bv-kart-ic">
                    <TextArea
                      rows={4}
                      value={not}
                      onChange={(e) => setNot(e.target.value)}
                      placeholder="Değerlendirme notunuzu yazınız (aday tarafından görülmez)"
                      maxLength={1000}
                      showCount
                    />
                    <p className="bv-aciklama" style={{ marginTop: 26 }}>
                      Not, durum değiştirdiğinizde (İnceledim, Değerlendirmeye al, Olumlu…) işlem
                      açıklaması olarak kaydedilir.
                    </p>

                    {(detay.notlar ?? []).slice(0, 2).map((n) => (
                      <div key={n.id} className="bv-not">
                        <div className="bv-not-ust">
                          <b>{n.adSoyad || n.kullanici}</b>
                          <small>{dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}</small>
                        </div>
                        <p>{n.metin}</p>
                      </div>
                    ))}
                    {(detay.notlar?.length ?? 0) > 2 && (
                      <button
                        type="button"
                        className="bv-baglanti"
                        style={{ marginTop: 8 }}
                        onClick={() => setDetaySekme("not")}
                      >
                        Tüm notlar ({detay.notlar.length})
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bv-kart">
                  <div className="bv-kart-bas">
                    <h3>
                      <StickyNote size={16} strokeWidth={2} />
                      Notlar
                    </h3>
                    <span className="bv-sag">
                      <button
                        type="button"
                        className="bv-btn bv-btn-ince"
                        onClick={() => setDetaySekme("not")}
                      >
                        <Plus size={14} strokeWidth={2} />
                        Not ekle
                      </button>
                    </span>
                  </div>
                  <div className="bv-kart-ic">
                    {(detay.notlar ?? []).length === 0 ? (
                      <div className="bv-bos-ic">Henüz not yok.</div>
                    ) : (
                      (detay.notlar ?? []).slice(0, 3).map((n) => (
                        <div key={n.id} className="bv-not">
                          <div className="bv-not-ust">
                            <b>{n.adSoyad || n.kullanici}</b>
                            <small>{dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}</small>
                          </div>
                          <p>{n.metin}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bv-kart">
              <div className="bv-kart-bas">
                <h3>
                  <Briefcase size={16} strokeWidth={2} />
                  İş tecrübesi
                </h3>
                {tecrubeler.length > 0 && (
                  <span className="bv-sag bv-rozetli">{tecrubeler.length} iş yeri</span>
                )}
              </div>
              <div className="bv-kart-ic">
                {tecrubeler.length === 0 ? (
                  <div className="bv-bos-ic">İş tecrübesi belirtilmemiş.</div>
                ) : (
                  <div className="bv-zaman">
                    {tecrubeler.map((t: any, i: number) => (
                      <div key={i} className={`bv-z${i > 0 ? " bv-gri" : ""}`}>
                        <b>{[t.gorev, t.isyeriAdi].filter(Boolean).join(" · ") || "—"}</b>
                        <small>
                          {[
                            [t.iseGirisTarihi, t.istenCikisTarihi].filter(Boolean).join(" – "),
                            t.ayrilmaSebebi ? `ayrılma sebebi: ${t.ayrilmaSebebi}` : "",
                            t.netUcret ? `net ${t.netUcret}` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* --------------------------------------------------- başvuru formu */}
          {/* Her zaman çizilir (gizli sekmede de): "Formu indir" ve yazdırma
              önizlemedeki .on-belge öğesini kullanıyor. */}
          <div className={`bv-sekme-ic bv-form-alani${gizle("form")}`}>
            <div className="bv-kart">
              <div className="bv-form-arac ik-yazdirilamaz">
                <b>Başvuru formu</b>
                <span className="bv-rozetli">BİK-001 · aday ne gördüyse o</span>
                <span className="bv-sag">
                  <button type="button" className="bv-btn bv-btn-ince" onClick={formIndir}>
                    <Download size={14} strokeWidth={2} />
                    İndir
                  </button>
                  <button
                    type="button"
                    className="bv-btn bv-btn-ince"
                    onClick={() => window.print()}
                  >
                    <Printer size={14} strokeWidth={2} />
                    Yazdır
                  </button>
                </span>
              </div>
              <div className="bv-form-sayfa ik-onizleme">
                <div ref={onizlemeRef}>
                  <FormOnizleme basvuru={veri} />
                </div>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- notlar */}
          <div className={`bv-sekme-ic ik-yazdirilamaz${gizle("not")}`}>
            <div className="bv-kart">
              <div className="bv-kart-bas">
                <h3>
                  <StickyNote size={16} strokeWidth={2} />
                  Dahili notlar
                </h3>
                <span className="bv-sag bv-rozetli">
                  {yetkili
                    ? "Bu notlar yalnızca panel kullanıcılarına görünür, aday göremez."
                    : "Eklediğiniz notu yalnızca İnsan Kaynakları görebilir; aday göremez."}
                </span>
              </div>
              <div className="bv-kart-ic">
                <div className="bv-not-yaz">
                  <TextArea
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    value={yeniNot}
                    onChange={(e) => setYeniNot(e.target.value)}
                    placeholder="Not yazınız… (Ctrl+Enter ile ekleyin)"
                    maxLength={4000}
                    onPressEnter={(e) => {
                      if (e.ctrlKey) notEkle();
                    }}
                  />
                  <Button
                    type="primary"
                    loading={notEkleniyor}
                    disabled={!yeniNot.trim()}
                    icon={<Plus size={14} strokeWidth={2} />}
                    onClick={notEkle}
                  >
                    Not ekle
                  </Button>
                </div>

                {(detay.notlar ?? []).length === 0 ? (
                  <div className="bv-bos-ic">Henüz not eklenmemiş.</div>
                ) : (
                  detay.notlar.map((n) => (
                    <div key={n.id} className="bv-not">
                      <div className="bv-not-ust">
                        <b>{n.adSoyad || n.kullanici}</b>
                        <small>{dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}</small>
                        <Tooltip title="Notu sil">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<Trash2 size={14} strokeWidth={2} />}
                            onClick={() => notSil(n.id)}
                          />
                        </Tooltip>
                      </div>
                      <p>{n.metin}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* --------------------------------------------------- işlem geçmişi */}
          <div className={`bv-sekme-ic ik-yazdirilamaz${gizle("gecmis")}`}>
            <div className="bv-kart">
              <div className="bv-kart-bas">
                <h3>
                  <History size={16} strokeWidth={2} />
                  İşlem geçmişi
                </h3>
                {detay.guncelleyen && (
                  <span className="bv-sag bv-rozetli">
                    son işlem: {detay.guncelleyen}
                    {detay.guncelleme && ` · ${dayjs(detay.guncelleme).format("DD.MM.YYYY HH:mm")}`}
                  </span>
                )}
              </div>
              <div className="bv-kart-ic">
                <div className="bv-zaman">
                  {(detay.hareketler ?? []).map((h) => (
                    <div
                      key={h.id}
                      className="bv-z"
                      style={{ ["--bv-z-renk" as any]: DURUM_RENKLERI[h.durum] ?? "#7cb518" }}
                    >
                      <b>{h.durum}</b>
                      <small>
                        {dayjs(h.tarih).format("DD.MM.YYYY HH:mm")} · {h.kullanici}
                      </small>
                      {h.aciklama && <p>{h.aciklama}</p>}
                    </div>
                  ))}
                  <div className="bv-z bv-gri">
                    <b>Başvuru alındı</b>
                    <small>
                      {dayjs(detay.olusturma).format("DD.MM.YYYY HH:mm")} ·{" "}
                      {detay.mailGonderildi
                        ? "bildirim maili gönderildi"
                        : "bildirim maili gönderilemedi"}
                    </small>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------ referanslar */}
          {/* Her zaman çizilir: sekmedeki sayaç ve hızlı bilgilerdeki puan
              bileşenin okuduğu listeden gelir. */}
          <div className={`bv-sekme-ic bv-ref-alan ik-yazdirilamaz${gizle("ref")}`}>
            <Referanslar
              basvuruId={detay.id}
              onListe={(l) => {
                const puanlilar = l
                  .filter((r) => typeof r.puan === "number")
                  .sort((a, b) => dayjs(b.olusturma).valueOf() - dayjs(a.olusturma).valueOf());

                setRefBilgi({
                  sayi: l.length,
                  gorusulen: l.filter((r) => r.gorusulduMu).length,
                  puan: puanlilar[0]?.puan ?? null,
                });
              }}
              degisti={() => {
                /* 5'in altındaki puan başvuruyu olumsuz yapabiliyor */
                detayAc(detay.id);
                listeGetir();
              }}
            />
          </div>
        </div>
      </>
    );
  };

  /* =================================================================== sayfa */

  const ozelMetin =
    tarihOn === "ozel" && tarihAraligi?.[0] && tarihAraligi?.[1]
      ? `${dayjs(tarihAraligi[0]).format("DD.MM")} – ${dayjs(tarihAraligi[1]).format("DD.MM.YY")}`
      : "Özel aralık";

  const mini: {
    anahtar: string;
    sayi: ReactNode;
    ad: string;
    ikon: ReactNode;
    renk: [string, string];
    tikla?: () => void;
    secili?: boolean;
    ipucu?: string;
  }[] = [
    {
      anahtar: "bugun",
      sayi: ozet?.bugun ?? 0,
      ad: "bugün gelen",
      ikon: <Inbox size={19} strokeWidth={2} />,
      renk: AV_RENKLERI[1],
      tikla: () => tarihSec(tarihOn === "1" ? "0" : "1"),
      secili: tarihOn === "1",
      ipucu: "Bugün gelen başvuruları listele",
    },
    {
      anahtar: "surecte",
      sayi: aktifSayi,
      ad: "süreçte bekleyen",
      ikon: <Users size={19} strokeWidth={2} />,
      renk: AV_RENKLERI[0],
      tikla: () => {
        setDurum(undefined);
        setSayfa(1);
      },
      ipucu: "Sonuçlanmamış başvurular; durum süzgecini kaldırır",
    },
    {
      anahtar: "uzun",
      sayi: ozet?.uzunBekleyen ?? "—",
      ad: "7 günden uzun bekleyen",
      ikon: <Clock size={19} strokeWidth={2} />,
      renk: AV_RENKLERI[2],
      tikla: () => {
        setGecikmisSuz(!gecikmisSuz);
        setSayfa(1);
      },
      secili: gecikmisSuz,
      ipucu: "Başvurusunun üzerinden 7 günden fazla geçmiş, sonuçlanmamış başvurular",
    },
    {
      anahtar: "gorusme",
      sayi: ozet?.buHaftaGorusme ?? "—",
      ad: "bu hafta görüşme",
      ikon: <CalendarDays size={19} strokeWidth={2} />,
      renk: AV_RENKLERI[3],
      ipucu: "Görüşme tarihi bu hafta (pazartesi–pazar) olan başvurular",
    },
  ];

  const asamaKarti = (ad: string, sonuc: boolean) => {
    const renk = DURUM_RENKLERI[ad];
    const gec = gecikmisAdedi(ad);
    const onay = ad === "Evrak Hazırlanıyor" ? durumAdedi("Onay Bekliyor") : 0;
    const secili = durum === ad || (onay > 0 && durum === "Onay Bekliyor");

    return (
      <button
        type="button"
        key={ad}
        className={`bv-asama${sonuc ? " bv-sonuc" : ""}${secili ? " bv-secili" : ""}`}
        aria-pressed={durum === ad}
        title={durum === ad ? "Süzmeyi kaldırmak için tıklayın" : "Bu durumdakileri listele"}
        onClick={() => durumSec(ad)}
      >
        <div className="bv-asama-ad">
          <i style={{ background: renk }} />
          {ad}
        </div>
        <div className="bv-asama-sayi" style={{ color: renk }}>
          {sayiYaz(durumAdedi(ad))}
        </div>
        <div className="bv-asama-alt">
          {sonuc ? (
            donemMetni
          ) : onay > 0 ? (
            <span
              className="bv-onay"
              role="button"
              title={`${onay} başvuru işe alım onayı bekliyor; listelemek için tıklayın`}
              onClick={(e) => {
                e.stopPropagation();
                durumSec("Onay Bekliyor");
              }}
            >
              +{onay} onayda
            </span>
          ) : gec > 0 ? (
            <span className="bv-gec">{gec} gecikmiş</span>
          ) : ozet?.gecikmisler ? (
            "zamanında"
          ) : (
            "süzmek için tıklayın"
          )}
        </div>
        <span className="bv-asama-cubuk" style={{ background: renk }} />
      </button>
    );
  };

  /* Şeritte sonuçlanan bölümü üç renge ayrılır */
  /* Şerit: sonuçlanan (yeşil), işlemde (mavi), yeni (turuncu) */
  const seritSonuc = SONUCLANAN.reduce((t, d) => t + durumAdedi(d), 0);
  const seritParcalari = [
    { ad: "Sonuçlanan", adet: seritSonuc, renk: "#7cb518" },
    {
      ad: "İşlemde",
      adet: ["İncelendi", "Değerlendirmede", "Görüşme Talebi", "Evrak Hazırlanıyor", "Onay Bekliyor"].reduce(
        (t, d) => t + durumAdedi(d),
        0
      ),
      renk: "#1d8cc9",
    },
    { ad: "Yeni", adet: durumAdedi("Yeni"), renk: "#e8481c" },
  ];

  const sureler = dagilimVeri?.sureler;
  const sureSatirlari = sureler
    ? [
        { ad: "İlk işleme kadar", gun: sureler.ilkIslemGun, adet: sureler.ilkIslemAdet, ipucu: "Başvurudan sonraki ilk durum değişikliğine (genellikle İncelendi) kadar" },
        { ad: "Görüşmeye kadar", gun: sureler.gorusmeGun, adet: sureler.gorusmeAdet, ipucu: "Başvurudan ilk görüşme talebine kadar" },
        { ad: "İşe alıma kadar", gun: sureler.iseAlimGun, adet: sureler.iseAlimAdet, ipucu: "Başvurudan İşe Alındı kaydına kadar" },
        { ad: "Pozisyon doldurma", gun: sureler.doldurmaGun, adet: sureler.doldurmaAdet, ipucu: "İşe alımda kaydedilen doldurma süresi" },
      ].filter((x) => x.adet > 0 && x.gun != null)
    : [];

  return (
    <div className="ik-icerik">
      <div className="bv" ref={kokRef}>
        {/* ------------------------------------------------------------ başlık */}
        <div className="bv-baslik">
          <div>
            <h1>Başvurular</h1>
            <p>kariyer.bicen.com.tr'den gelen iş başvuruları; değerlendirmeden işe alıma kadar.</p>
          </div>

          <div className="bv-baslik-sag">
            <button type="button" className="bv-btn" onClick={() => setDagilimAcik(true)}>
              <LineChart size={15} strokeWidth={2} />
              Dağılım
            </button>
            <button
              type="button"
              className="bv-btn"
              onClick={listeGetir}
              disabled={yukleniyor}
              title="Yenile"
            >
              <RefreshCw
                size={15}
                strokeWidth={2}
                className={yukleniyor ? "bv-donen" : undefined}
              />
              Yenile
            </button>
            <Tooltip title="Süzgece uyan bütün başvuruları Excel'de açılabilen dosya olarak indirir">
              <button
                type="button"
                className="bv-btn"
                onClick={listeDisaAktar}
                disabled={disaAktariliyor}
              >
                {disaAktariliyor ? (
                  <Spin size="small" />
                ) : (
                  <Download size={15} strokeWidth={2} />
                )}
                Excel
              </button>
            </Tooltip>
          </div>
        </div>

        {/* ----------------------------------------------------- mini göstergeler */}
        <div className="bv-mini-satir">
          {mini.map((m) => {
            const ic = (
              <>
                <span className="bv-mini-ik" style={{ background: m.renk[0], color: m.renk[1] }}>
                  {m.ikon}
                </span>
                <div>
                  <b>{typeof m.sayi === "number" ? sayiYaz(m.sayi) : m.sayi}</b>
                  <span className="bv-mini-ad">{m.ad}</span>
                </div>
              </>
            );

            return (
              <Tooltip key={m.anahtar} title={m.ipucu}>
                {m.tikla ? (
                  <button
                    type="button"
                    className={`bv-mini-k${m.secili ? " bv-secili" : ""}`}
                    aria-pressed={!!m.secili}
                    onClick={m.tikla}
                  >
                    {ic}
                  </button>
                ) : (
                  <div className="bv-mini-k">{ic}</div>
                )}
              </Tooltip>
            );
          })}
        </div>

        {/* -------------------------------------------------------- süreç hattı */}
        <div className="bv-hat">
          {ASAMALAR.map((ad) => asamaKarti(ad, false))}
          <div className="bv-ayrac">
            <ChevronRight size={16} strokeWidth={2} />
          </div>
          {SONUCLANAN.map((ad) => asamaKarti(ad, true))}
        </div>

        {/* ------------------------------------------------ toplam / sonuçlanan */}
        <div
          className="bv-serit"
          role="button"
          tabIndex={0}
          onClick={() => setDagilimAcik(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setDagilimAcik(true);
          }}
        >
          {/* 20.10.2026: Sonuçlanan · İşlemde · Yeni; çubuk tüm genişliği
              dolduruyor, her parçanın içinde toplamın yüzdesi yazıyor. */}
          <div className="bv-serit-ust">
            <b>
              Toplam {sayiYaz(ozetToplam)} başvuru · {sayiYaz(seritSonuc)} sonuçlandı
            </b>
            <span>· {donemMetni}</span>
            <span className="bv-oran">%{Math.round(yuzde(seritSonuc))}</span>
          </div>

          <div className="bv-serit-cubuk">
            {seritParcalari
              .filter((p) => p.adet > 0)
              .map((p) => (
                <div
                  key={p.ad}
                  style={{ flex: `${p.adet} 1 0`, background: p.renk }}
                  title={`${p.ad}: ${sayiYaz(p.adet)} (%${Math.round(yuzde(p.adet))})`}
                >
                  {`%${Math.round(yuzde(p.adet))}`}
                </div>
              ))}
          </div>

          <div className="bv-serit-alt">
            <span style={{ color: seritParcalari[0].renk }}>
              <i style={{ background: seritParcalari[0].renk }} />
              Sonuçlanan: <b>{sayiYaz(seritSonuc)}</b>{" "}
              <span className="bv-soluk">
                (işe alındı {sayiYaz(durumAdedi("İşe Alındı"))} · olumlu {sayiYaz(durumAdedi("Olumlu"))} · olumsuz{" "}
                {sayiYaz(durumAdedi("Olumsuz"))})
              </span>
            </span>
            <span style={{ color: seritParcalari[1].renk }}>
              <i style={{ background: seritParcalari[1].renk }} />
              İşlemde: <b>{sayiYaz(seritParcalari[1].adet)}</b>{" "}
              <span className="bv-soluk">(%{Math.round(yuzde(seritParcalari[1].adet))} · incelendi · değerlendirmede · görüşme · evrak)</span>
            </span>
            <span style={{ color: seritParcalari[2].renk }}>
              <i style={{ background: seritParcalari[2].renk }} />
              Yeni: <b>{sayiYaz(seritParcalari[2].adet)}</b>
            </span>
            <span className="bv-sag">
              <LineChart size={14} strokeWidth={2} />
              Dağılım için tıklayın
            </span>
          </div>
        </div>

        {/* -------------------------------------------------------------- filtre */}
        <div className="bv-filtre">
          <div className="bv-filtre-satir">
            <Input
              className="bv-ara"
              allowClear
              placeholder="Ad, telefon, kimlik no, başvuru no ara · Enter"
              prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
              value={aramaKutusu}
              onChange={(e) => {
                setAramaKutusu(e.target.value);
                if (e.target.value === "") {
                  setArama("");
                  setSayfa(1);
                }
              }}
              onPressEnter={() => {
                setArama(aramaKutusu);
                setSayfa(1);
              }}
            />

            <Select
              className="bv-sec"
              mode="multiple"
              allowClear
              showSearch
              placeholder="Tüm şubeler"
              optionFilterProp="label"
              maxTagCount="responsive"
              value={sube}
              onChange={(v) => {
                setSube(v);
                setSayfa(1);
              }}
              popupMatchSelectWidth={false}
              options={filtreler.subeler
                .filter((x) => x?.kod)
                .map((x) => ({ value: x.kod, label: x.ad || x.kod }))}
            />

            <Select
              className="bv-sec"
              allowClear
              showSearch
              placeholder="Tüm pozisyonlar"
              value={bolum}
              onChange={(v) => {
                setBolum(v);
                setSayfa(1);
              }}
              popupMatchSelectWidth={false}
              options={filtreler.bolumler.map((x) => ({ value: x, label: x }))}
            />

            <div className="bv-seg" role="group" aria-label="Başvuru tarihi">
              {TARIH_ONAYARLARI.map(([v, ad]) => (
                <button
                  key={v}
                  type="button"
                  className={tarihOn === v ? "bv-aktif" : undefined}
                  onClick={() => tarihSec(v)}
                >
                  {ad}
                </button>
              ))}
              <Popover
                trigger="click"
                placement="bottomRight"
                open={ozelTarihAcik}
                onOpenChange={setOzelTarihAcik}
                overlayClassName="bv-pop"
                arrow={false}
                content={
                  <div className="bv-pop-ic" style={{ width: 290 }}>
                    <div>
                      <label className="bv-etk">Başvuru tarihi aralığı</label>
                      <DatePicker.RangePicker
                        style={{ width: "100%" }}
                        format="DD.MM.YYYY"
                        value={tarihAraligi as any}
                        placeholder={["Başlangıç", "Bitiş"]}
                        presets={[
                          { label: "Bugün", value: [dayjs().startOf("day"), dayjs()] },
                          { label: "Son 7 gün", value: [dayjs().subtract(6, "day"), dayjs()] },
                          { label: "Son 30 gün", value: [dayjs().subtract(29, "day"), dayjs()] },
                          { label: "Bu ay", value: [dayjs().startOf("month"), dayjs()] },
                          {
                            label: "Geçen ay",
                            value: [
                              dayjs().subtract(1, "month").startOf("month"),
                              dayjs().subtract(1, "month").endOf("month"),
                            ],
                          },
                        ]}
                        onChange={(v) => {
                          setTarihAraligi(v as any);
                          setTarihOn(v?.[0] && v?.[1] ? "ozel" : "0");
                          setSayfa(1);
                          if (v?.[0] && v?.[1]) setOzelTarihAcik(false);
                        }}
                      />
                    </div>
                    <div className="bv-filtre-not">
                      Tarih aralığı seçildiğinde o günlerdeki bütün başvurular (sonuçlananlar
                      dahil) listelenir; kartlar ve şerit de aynı aralığı sayar.
                    </div>
                  </div>
                }
              >
                <button type="button" className={tarihOn === "ozel" ? "bv-aktif" : undefined}>
                  <CalendarDays size={14} strokeWidth={2} />
                  {ozelMetin}
                </button>
              </Popover>
            </div>
          </div>

          <div className="bv-filtre-satir">
            <div className="bv-cipler">
              <button
                type="button"
                className={`bv-cip${gecikmisSuz ? " bv-acik" : ""}`}
                aria-pressed={gecikmisSuz}
                onClick={() => {
                  setGecikmisSuz(!gecikmisSuz);
                  setSayfa(1);
                }}
              >
                <Clock size={14} strokeWidth={2} />
                7+ gün bekleyen
              </button>
              <button
                type="button"
                className={`bv-cip${mailSuz ? " bv-acik" : ""}`}
                aria-pressed={mailSuz}
                onClick={() => {
                  setMailSuz(!mailSuz);
                  setSayfa(1);
                }}
              >
                <MailWarning size={14} strokeWidth={2} />
                Mail gitmedi
              </button>
              <Tooltip title="Mikro'da çıkışı yapılmış kaydı olan adaylar (Eski personel rozeti)">
                <button
                  type="button"
                  className={`bv-cip${eskiSuz ? " bv-acik" : ""}`}
                  aria-pressed={eskiSuz}
                  onClick={() => {
                    setEskiSuz(!eskiSuz);
                    setSayfa(1);
                  }}
                >
                  <History size={14} strokeWidth={2} />
                  Daha önce çalışmış
                </button>
              </Tooltip>

              {seciliFiltreSayisi > 0 && (
                <button type="button" className="bv-baglanti" onClick={filtreleriTemizle}>
                  Filtreleri temizle
                </button>
              )}

              {arama && seciliFiltreSayisi > 1 && (
                <span className="bv-filtre-not">
                  Arama yapılırken durum, şube, pozisyon ve çip süzgeçleri uygulanmaz.
                </span>
              )}
            </div>

            <div className="bv-filtre-sag">
              <Popover
                trigger="click"
                placement="bottomRight"
                open={digerAcik}
                onOpenChange={setDigerAcik}
                content={digerFiltreler}
                overlayClassName="bv-pop"
                arrow={false}
              >
                <button
                  type="button"
                  className={`bv-btn bv-btn-ince${digerFiltreSayisi > 0 ? " bv-aktif" : ""}`}
                >
                  <SlidersHorizontal size={14} strokeWidth={2} />
                  Diğer filtreler
                  {digerFiltreSayisi > 0 && <span className="bv-say">{digerFiltreSayisi}</span>}
                </button>
              </Popover>

              <div className="bv-gorunum" role="group" aria-label="Görünüm">
                <button
                  type="button"
                  className={`bv-btn bv-btn-ince${gorunum === "tablo" ? " bv-ana" : ""}`}
                  aria-pressed={gorunum === "tablo"}
                  onClick={() => setGorunum("tablo")}
                >
                  <List size={15} strokeWidth={2} />
                  Liste
                </button>
                <button
                  type="button"
                  className={`bv-btn bv-btn-ince${gorunum === "pano" ? " bv-ana" : ""}`}
                  aria-pressed={gorunum === "pano"}
                  onClick={() => setGorunum("pano")}
                >
                  <LayoutGrid size={15} strokeWidth={2} />
                  Pano
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- liste */}
        <div className="bv-liste">
          <div className="bv-liste-bas">
            <b>{listeBasligi}</b>
            {durum && (
              <button
                type="button"
                className="bv-kaldir"
                onClick={() => durumSec(undefined)}
                title="Durum süzgecini kaldır"
              >
                <X size={12} strokeWidth={2.4} />
                kaldır
              </button>
            )}
            <span>{yukleniyor ? "yükleniyor…" : `${sayiYaz(toplam)} başvuru`}</span>
            {tarihVar && <span>· {donemMetni}</span>}
            {arsivGoster && (
              <span className="bv-etiket bv-e-gri">
                <Archive size={11} strokeWidth={2.4} /> arşiv dahil
              </span>
            )}
            <Tooltip
              title={
                "Sonuçlanmış başvurular listede görünmez: Olumlu olanlar Aday Havuzu'na " +
                "aktarılır, İşe Alındı ve Olumsuz olanlar arşivde kalır. Görmek için üstteki " +
                "kartlara ya da durum filtresine tıklayınız."
              }
            >
              <span className="bv-sag">
                {arama
                  ? "Arama bütün başvurularda yapılır"
                  : tarihVar && !durum
                  ? "Seçili aralıktaki bütün başvurular (sonuçlananlar dahil)"
                  : !durum
                  ? "Sonuçlananlar (İşe Alındı, Olumlu, Olumsuz) üstteki kartlardan açılır"
                  : ""}
              </span>
            </Tooltip>
          </div>

          {listeIcerik}
        </div>
      </div>

      {/* ------------------------------------------- olumsuz sebep penceresi */}
      <Modal
        open={olumsuzAcik}
        onCancel={() => setOlumsuzAcik(false)}
        onOk={olumsuzOnayla}
        confirmLoading={olumsuzIsleniyor}
        okText="Olumsuz olarak işaretle"
        cancelText="Vazgeç"
        okButtonProps={{ danger: true, disabled: !olumsuzSebep.trim() }}
        width={480}
        title="Başvuru neden olumsuz?"
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          Sebep, başvurunun not geçmişine kaydedilir. Sonradan raporlanabilmesi
          için hazır seçeneklerden birini kullanmanız tercih edilir.
        </Text>

        <Space wrap size={[6, 6]} style={{ marginTop: 12 }}>
          {OLUMSUZ_SEBEPLERI.map((x) => (
            <Tag.CheckableTag
              key={x}
              checked={olumsuzSebep === x}
              onChange={() => setOlumsuzSebep(x)}
            >
              {x}
            </Tag.CheckableTag>
          ))}
        </Space>

        <TextArea
          rows={3}
          style={{ marginTop: 12 }}
          placeholder="Sebep ya da ek açıklama"
          value={olumsuzSebep}
          onChange={(e) => setOlumsuzSebep(e.target.value)}
        />
      </Modal>

      {/* -------------------------------------------- başvuru dağılımı */}
      <Modal
        open={dagilimAcik}
        onCancel={() => setDagilimAcik(false)}
        footer={null}
        width="min(880px, 94vw)"
        className="bv-modal"
        title={`Başvuru dağılımı · ${donemMetni}`}
      >
        {ozetToplam === 0 ? (
          <Empty description="Henüz başvuru bulunmuyor." />
        ) : (
          <>
            <div className="bv-dag-izgara">
              <div>
                <h4>Durumlara göre</h4>
                <DagilimListesi satirlar={durumDagilimi} toplam={ozetToplam} renk="#7cb518" />
              </div>

              <div>
                <h4>Şubelere göre</h4>
                {dagilimYukleniyor ? (
                  <Spin size="small" />
                ) : dagilimVeri ? (
                  <DagilimListesi
                    satirlar={kisalt(dagilimVeri.subeler ?? [], 6, "şube")}
                    toplam={(dagilimVeri.subeler ?? []).reduce((t, x) => t + x.adet, 0)}
                    renk="#7cb518"
                  />
                ) : (
                  <div className="bv-bos-ic">Şube dağılımı alınamadı.</div>
                )}
              </div>

              <div>
                <h4>Pozisyonlara göre</h4>
                {dagilimYukleniyor ? (
                  <Spin size="small" />
                ) : dagilimVeri ? (
                  <DagilimListesi
                    satirlar={kisalt(dagilimVeri.pozisyonlar ?? [], 6, "pozisyon")}
                    toplam={0}
                    renk="#2e6aa8"
                  />
                ) : (
                  <div className="bv-bos-ic">Pozisyon dağılımı alınamadı.</div>
                )}
              </div>

              {sureSatirlari.length > 0 && (
                <div>
                  <h4>Ortalama süreler</h4>
                  <div className="bv-alanlar">
                    {sureSatirlari.map((s) => (
                      <Tooltip key={s.ad} title={s.ipucu}>
                        <div className="bv-alan">
                          <span>{s.ad}</span>
                          <b>
                            {Number(s.gun).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün{" "}
                            <small>· {sayiYaz(s.adet)} başvuru</small>
                          </b>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bv-dag-not">
              Durum yüzdeleri toplam {sayiYaz(ozetToplam)} başvuruya göre hesaplanır. Birden çok
              pozisyona başvuran aday her pozisyonda ayrı sayılır.
            </div>
          </>
        )}
      </Modal>

      {/* --------------------------------------------------------- başvuru kartı */}
      <Drawer
        open={cekmeceId != null}
        onClose={detayKapat}
        width="min(1080px, 96vw)"
        rootClassName="bv-cekmece"
        closable={false}
        title={null}
      >
        {cekmeceId != null && (
          <Spin spinning={detayYukleniyor && !!detay} delay={250}>
            {cekmeceIcerik()}
          </Spin>
        )}
      </Drawer>

      {/* --------------------------------------------- geçmiş başvuru formu */}
      <Drawer
        open={!!eskiForm}
        onClose={() => setEskiForm(null)}
        width="min(900px, 96vw)"
        className="rp-cekmece"
        title={
          eskiForm && (
            <Space size={8}>
              <FileText size={16} strokeWidth={2} />
              <Text strong>Geçmiş Başvuru Formu</Text>
              <Tag>{eskiForm.baslik}</Tag>
            </Space>
          )
        }
      >
        {eskiForm && (
          <div className="ik-onizleme" style={{ background: "#fff", padding: 14 }}>
            <FormOnizleme basvuru={eskiForm.veri} />
          </div>
        )}
      </Drawer>

      {/* ------------------------------------------------------- olumlu karar */}
      <Modal
        open={olumluAcik}
        title="Olumlu Değerlendirme"
        okText="Olumlu yap"
        cancelText="Vazgeç"
        onCancel={() => setOlumluAcik(false)}
        onOk={olumluKaydet}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12, marginBottom: 14 }}
          message="Aday hangi pozisyon için olumlu bulundu?"
          description="Seçtiğiniz pozisyon başvuruya yazılır; aday Aday Havuzu'nda ve raporlarda bu pozisyonla görünür."
        />

        <Select
          showSearch
          style={{ width: "100%" }}
          placeholder="Pozisyon seçiniz"
          value={olumluBolum}
          onChange={setOlumluBolum}
          options={(detay?.bolumler ?? "")
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean)
            .map((x: string) => ({ value: x, label: x }))}
        />

        <div style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Listede adayın başvuruda seçtiği pozisyonlar görünür.
          </Text>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- işe alım */}
      <Modal
        open={iseAlAcik}
        title="İşe Alım Bilgileri"
        okText={
          iseAlEvrak && iseAlEvrak.eksik > 0
            ? `Eksik evrakla onaya gönder (${iseAlEvrak.eksik})`
            : "Kaydet ve onaya gönder"
        }
        cancelText="Vazgeç"
        onCancel={() => setIseAlAcik(false)}
        onOk={iseAl}
        width={1080}
        className="bv-isealpencere"
      >
        <div className="bv-iseal">
        <div className="bv-iseal-form">
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="Bu bilgiler yetkili onayına gönderilir"
          description="Kaydettiğinizde başvuru 'Onay Bekliyor' durumuna geçer. Onay verildiğinde işe alım tamamlanır."
        />

        {iseAlAcik && (
          <IseAlReferans
            basvuruId={detay?.id}
            bolum={iseAlBolum}
            subeKodu={iseAlSube}
            form={refForm}
            surum={refSurum}
            onDurum={setRefDurum}
          />
        )}

        <Form form={iseAlForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="iseGirisTarihi"
            label="İşe Giriş Tarihi"
            rules={[{ required: true, message: "İşe giriş tarihini seçiniz." }]}
          >
            <DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="kartNo"
            label="Biçen Kart Numarası"
            extra="Zorunlu. Personele verilecek kartın numarası; aday Mikro'ya işlenince kart kendiliğinden sicile bağlanır."
            validateTrigger="onBlur"
            rules={[
              { required: true, message: "Personele verilecek Biçen Kart numarasını giriniz." },
              {
                validator: async (_: any, v: string) => {
                  const no = String(v ?? "").replace(/\D/g, "");
                  if (!no) return;
                  if (no.length < 6) throw new Error("Kart numarası eksik.");
                  const c = await api.al<any>(`/api/BicenKart/KartDogrula?kartNo=${no}&basvuruId=${detay?.id ?? 0}`);
                  if (c?.hata) throw new Error(c.hata);
                },
              },
            ]}
          >
            <Input inputMode="numeric" placeholder="Kartın üzerindeki numara" maxLength={24} />
          </Form.Item>

          <Form.Item
            name="subeKodu"
            label="Çalışacağı Birim"
            extra={
              detay
                ? `Boş bırakılırsa başvurduğu birimde kalır: ${detay.subeAdi}`
                : undefined
            }
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Rotasyon yapılacaksa seçiniz"
              options={birimler.map((x) => ({
                value: x.kod,
                label: `${x.ad} · ${x.tur}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(o, y) => o.subeKodu !== y.subeKodu}
          >
            {({ getFieldValue }) => {
              /* Pozisyon listesi, çalışacağı birimin türünden gelir */
              const kod = getFieldValue("subeKodu") || detay?.subeKodu;
              const tur = birimler.find((x) => x.kod === kod)?.tur;
              const secenekler =
                birimTurleri.find((t) => t.ad === tur)?.bolumler ?? [];

              return (
                <Form.Item
                  name="bolum"
                  label="Başlayacağı Pozisyon"
                  extra="Başvurduğu pozisyondan farklı olabilir."
                  rules={[{ required: true, message: "Pozisyon seçiniz." }]}
                >
                  <Select
                    showSearch
                    placeholder={
                      detay?.bolumler
                        ? `Başvurduğu: ${detay.bolumler}`
                        : "Seçiniz"
                    }
                    options={secenekler.map((b) => ({ value: b, label: b }))}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Row gutter={12}>
            <Col xs={12}>
              <Form.Item
                noStyle
                shouldUpdate={(o, y) => o.bolum !== y.bolum}
              >
                {({ getFieldValue }) => {
                  const bolum = getFieldValue("bolum") ?? detay?.bolumler;
                  const sade = (m: string) =>
                    (m ?? "").toLocaleUpperCase("tr").trim();

                  const skala = skalalar.find(
                    (x) => sade(x.bolum) === sade(bolum?.split(",")[0])
                  );

                  return skala ? (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={
                        <span style={{ fontSize: 13 }}>
                          <b>{skala.bolum}</b> maaş aralığı:{" "}
                          <b>
                            {skala.altSinir.toLocaleString("tr-TR")} –{" "}
                            {skala.ustSinir.toLocaleString("tr-TR")} TL
                          </b>
                        </span>
                      }
                    />
                  ) : null;
                }}
              </Form.Item>

              <Form.Item
                name="anlasilanUcret"
                label="Anlaşılan Ücret"
                extra="Net aylık ücret"
                rules={[{ required: true, message: "Anlaşılan ücreti giriniz." }]}
              >
                <InputNumber
                  min={0}
                  max={9999999}
                  step={1000}
                  style={{ width: "100%" }}
                  addonAfter="TL"
                  formatter={(v?: number | string) =>
                    `${v ?? ""}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
                  }
                  parser={(v?: string) =>
                    Number((v ?? "").replace(/[^\d]/g, "")) as 0
                  }
                />
              </Form.Item>
            </Col>

            <Col xs={12}>
              <Form.Item
                name="yolUcreti"
                label="Yol Ücreti"
                extra="Aylık yol yardımı (yoksa boş bırakınız)"
              >
                <InputNumber
                  min={0}
                  max={999999}
                  step={100}
                  style={{ width: "100%" }}
                  addonAfter="TL"
                  formatter={(v?: number | string) =>
                    `${v ?? ""}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
                  }
                  parser={(v?: string) =>
                    Number((v ?? "").replace(/[^\d]/g, "")) as 0
                  }
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="aciklama"
            label="Açıklama"
            rules={[
              { required: true, message: "Açıklama giriniz." },
              { min: 3, message: "Açıklama en az 3 karakter olmalıdır." },
            ]}
            extra="İşe alım gerekçesi veya not; işlem geçmişine kaydedilir."
          >
            <TextArea
              rows={2}
              maxLength={300}
              placeholder="Örn: Görüşme olumlu, kasiyer kadrosuna alındı"
            />
          </Form.Item>
        </Form>
        </div>

        {/* İşe giriş evrakları (03.10.2026): yükleme anında kaydediliyor;
            pencere kapatılsa da yüklenenler kalır. Eksik evrak işe alımı
            durdurmuyor. */}
        <div className="bv-iseal-evrak">
          {iseAlAcik && detay && (
            <IseGirisEvraklari
              key={detay.id}
              basvuruId={detay.id}
              kisiAdi={(detay as any).adSoyad}
              kompakt
              degisti={(d) => {
                setIseAlEvrak(d.ozet);
                setEvrakSurum((x) => x + 1);
              }}
            />
          )}
        </div>
        </div>

        {/* Mikro sicil kartı (09.10.2026): onaylanınca GYRSM'de açılır */}
        {iseAlAcik && detay && (
          <MikroSicilBolumu
            basvuruId={detay.id}
            acik={sicilAcik}
            acikDegisti={setSicilAcik}
            form={sicilForm}
            subeKodu={iseAlSube || detay.subeKodu}
            bolum={iseAlBolum}
            ucret={iseAlUcret}
          />
        )}
      </Modal>

      {/* ------------------------------------------------------ birim değişimi */}
      <Modal
        open={birimAcik}
        title={iseAlimSonrasi ? "İşe alım birimini değiştir" : "Birim Değiştir (Rotasyon)"}
        okText="Değiştir"
        cancelText="Vazgeç"
        onCancel={() => setBirimAcik(false)}
        onOk={birimDegistir}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          {iseAlimSonrasi
            ? "Aday işe alındığı için bu bir rotasyon sayılmaz; işe başlayacağı birim düzeltilir. Onay bekleyen işe alım isteği de yeni birimle güncellenir."
            : "Adayın başvurduğu birim değiştirilir. Örneğin Atakent şubesine başvuran bir aday, ihtiyaç olan Halkalı şubesine yönlendirilebilir."}
        </Text>

        <Form form={birimForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="subeKodu"
            label="Yeni Birim"
            rules={[{ required: true, message: "Birim seçiniz." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Seçiniz"
              options={birimler.map((x) => ({
                value: x.kod,
                label: `${x.ad} · ${x.tur}`,
              }))}
            />
          </Form.Item>

          <Form.Item name="aciklama" label="Gerekçe">
            <TextArea rows={2} maxLength={300} placeholder="İsteğe bağlı" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ------------------------------------------------------- görüşme modalı */}
      <Modal
        open={gorusmeAcik}
        title={
          gorusmeHedef ? `Görüşme Talebi Oluştur · ${gorusmeHedef.adSoyad}` : "Görüşme Talebi Oluştur"
        }
        okText="Oluştur ve bildir"
        cancelText="Vazgeç"
        onCancel={() => setGorusmeAcik(false)}
        onOk={gorusmeKaydet}
      >
        <Form form={gorusmeForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="tarih"
            label="Görüşme Tarihi ve Saati"
            rules={[{ required: true, message: "Tarih ve saat seçiniz." }]}
          >
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format="DD.MM.YYYY HH:mm"
              style={{ width: "100%" }}
              disabledDate={(g) => !!g && g.isBefore(dayjs().startOf("day"))}
            />
          </Form.Item>

          <Form.Item
            name="yer"
            label="Görüşme Yeri"
            rules={[{ required: true, message: "Görüşme yerini yazınız." }]}
          >
            <Input placeholder="Örn: Genel Müdürlük - İnsan Kaynakları" maxLength={200} />
          </Form.Item>

          <Form.Item
            name="aciklama"
            label="Adaya İletilecek Not"
            extra={
              "Bu metin, adaya gönderilen davet mailinde \"Önemli Not\" başlığıyla " +
              "görünür. Başvurudaki dahili notlar adaya gönderilmez."
            }
          >
            <TextArea
              rows={3}
              maxLength={500}
              placeholder="Örn: Görüşmeye 10 dakika önce gelmenizi rica ederiz."
            />
          </Form.Item>

          <Form.Item
            name="mailGonder"
            valuePropName="checked"
            initialValue={true}
            extra="Adayın e-posta adresi kayıtlı değilse mail gönderilmez."
          >
            <Checkbox>Adaya bilgilendirme maili gönder</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* ------------------------------------- eski çıkış mülakatı formu */}
      <Modal
        open={!!mulakatDetay}
        onCancel={() => setMulakatDetay(null)}
        footer={null}
        width={620}
        title={
          mulakatDetay && (
            <Space size={8} wrap>
              <LogOut size={16} strokeWidth={2} />
              <Text strong>Çıkış Görüşmesi</Text>
              {mulakatDetay.cikisTarihi && (
                <Tag>
                  {dayjs(mulakatDetay.cikisTarihi).format("DD.MM.YYYY")}
                </Tag>
              )}
            </Space>
          )
        }
      >
        {mulakatDetay && (
          <div style={{ marginTop: 12 }}>
            <Space size={6} wrap style={{ marginBottom: 12 }}>
              {mulakatDetay.subeAdi && <Tag>{mulakatDetay.subeAdi}</Tag>}
              {mulakatDetay.gorev && (
                <Tag color="blue">{mulakatDetay.gorev}</Tag>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {mulakatDetay.uzmanAdi === "Çıkış anketi"
                  ? "Anket ile dolduruldu"
                  : `Görüşen: ${mulakatDetay.uzmanAdi ?? "—"}`}
              </Text>
            </Space>

            {mulakatDetay.cikisNedeni && (
              <div className="bd-mulakat-bolum">
                <b>Ayrılma sebebi</b>
                <div>{mulakatDetay.cikisNedeni}</div>
              </div>
            )}

            {mulakatDetay.ozet && (
              <div className="bd-mulakat-bolum">
                <b>Özet</b>
                <div>{mulakatDetay.ozet}</div>
              </div>
            )}

            {(() => {
              /* Sorular ve puanlar JSON olarak saklanıyor; eski kayıtlarda
                 biçim farklı olabildiği için hataya karşı korunur. */
              try {
                const veri = JSON.parse(mulakatDetay.sorularJson ?? "{}");

                const sorular = veri.sorular ?? veri.Sorular ?? [];
                const puanlar = veri.puanlar ?? veri.Puanlar ?? [];

                return (
                  <>
                    {sorular
                      .filter((x: any) => (x.cevap ?? x.Cevap ?? "").trim())
                      .map((x: any, i: number) => (
                        <div className="bd-mulakat-bolum" key={i}>
                          <b>{x.soru ?? x.Soru}</b>
                          <div>{x.cevap ?? x.Cevap}</div>
                        </div>
                      ))}

                    {puanlar.length > 0 && (
                      <div className="bd-mulakat-bolum">
                        <b>Değerlendirme</b>
                        {puanlar.map((x: any, i: number) => (
                          <div key={i} className="bd-mulakat-puan">
                            <span>{x.baslik ?? x.Baslik}</span>
                            <b>{x.puan ?? x.Puan} / 5</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              } catch {
                return null;
              }
            })()}

            {mulakatDetay.uzmanYorumu && (
              <div className="bd-mulakat-bolum">
                <b>Değerlendiren notu</b>
                <div>{mulakatDetay.uzmanYorumu}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Raporlar
 * ---------------------------------------------------------------------------
 * Üç sekme: başvuru raporu, günlük QR okutma ve personel başı ciro (bölge
 * müdürüne kapalı).
 *
 * Başvuru raporu (03.10.2026 yenilendi): arşivlenenler sayılmaz, her
 * başvuru kendi ayında sayılır (aynı kişinin sonraki başvurusu geçmiş ayı
 * değiştirmesin diye; kullanıcı kararı), görüşme ve olumlu kümeleri her kırılımda aynıdır, norm kadro
 * bölümü Norm Kadro ekranının ucunu (Havuz/NormRapor) kullanır. Ortak
 * kurallar sunucuda BasvuruTabani sınıfında.
 *
 * Grafikler ek bir kütüphane kullanmadan, CSS ile çizilmiştir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  App as AntdApp,
  DatePicker,
  Drawer,
  Select,
  Spin,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  DoorOpen,
  Download,
  FileText,
  Hourglass,
  Inbox,
  Layers,
  MapPin,
  Megaphone,
  RefreshCw,
  Target,
  Timer,
  TrendingUp,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";

import CiroVerimliligi from "./CiroVerimliligi";
import GecisRaporu from "./GecisRaporu";
import Tablo from "./Tablo";
import BasvuruDetayModal from "./BasvuruDetayModal";
import PozisyonPersoneli, { type PozisyonSecimi } from "./PozisyonPersoneli";
import { api, bolgeMuduruMu, oturumOku } from "./api";
import { kirilimIndir, listeyiIndir } from "./formIndir";
import { subeRaporuIndir, tabloIndir } from "./raporExcel";
import "./Rapor.css";

const { RangePicker } = DatePicker;

/* -------------------------------------------------------------------------- */
/* Türler                                                                      */
/* -------------------------------------------------------------------------- */

interface Genel {
  toplam: number;
  yeni: number;
  incelendi?: number;
  degerlendirmede: number;
  gorusmeTalebi: number;
  olumlu: number;
  evrakHazirlaniyor: number;
  onayBekliyor?: number;
  iseAlindi: number;
  olumsuz: number;
  epostaliAday: number;
  engelBeyanEden?: number;
}

interface Aylik {
  yil: number;
  ay: number;
  etiket: string;
  toplam: number;
  gorusme: number;
  olumlu: number;
  olumsuz: number;
}

interface Kirilim {
  anahtar: string;
  ad: string;
  toplam: number;
  gorusme: number;
  olumlu: number;
  olumsuz: number;
  iseAlindi?: number;
  bolge?: string | null;
  hedef: number;
}

interface NormKadro {
  kadroId: number;
  subeKodu: string;
  subeAdi: string;
  bolum: string;
  norm: number;
  mevcutPersonel: number;
  ihtiyac: number;
  fazla?: number;
  engelli?: number;
  basvuru: number;
  olumlu: number;
  iseAlinan: number;
  aciklama: string;
}

interface IseAlinan {
  id: number;
  basvuruNo: string;
  adSoyad: string;
  telefon: string;
  subeKodu?: string | null;
  subeAdi: string;
  bolumler: string;
  iseGirisTarihi: string | null;
  iseGirisBolum: string | null;
  anlasilanUcret: number | null;
  yolUcreti: number | null;
  talepUcret?: string | null;
  doldurmaGun?: number | null;
  olusturma: string;
}

interface Veri {
  birimTurleri: string[];
  iseAlinanlar: IseAlinan[];
  genel: Genel;
  aylik: Aylik[];
  subeler: Kirilim[];
  bolumler: Kirilim[];
  ilceler: Kirilim[];
  kaynaklar: Kirilim[];
  kaynakDigerleri: Kirilim[];
  basvurusuOlmayanSubeler: string[];
  basvurusuOlmayanBolumler: string[];
}

const BOS: Veri = {
  birimTurleri: [],
  iseAlinanlar: [],
  genel: {
    toplam: 0,
    yeni: 0,
    incelendi: 0,
    degerlendirmede: 0,
    gorusmeTalebi: 0,
    olumlu: 0,
    evrakHazirlaniyor: 0,
    onayBekliyor: 0,
    iseAlindi: 0,
    olumsuz: 0,
    epostaliAday: 0,
  },
  aylik: [],
  subeler: [],
  bolumler: [],
  ilceler: [],
  kaynaklar: [],
  kaynakDigerleri: [],
  basvurusuOlmayanSubeler: [],
  basvurusuOlmayanBolumler: [],
};

/** /api/Basvuru/Dagilim süreleri (Başvurular sayfasının dağılım penceresi) */
interface Sureler {
  ilkIslemGun: number | null;
  ilkIslemAdet: number;
  gorusmeGun: number | null;
  gorusmeAdet: number;
  iseAlimGun: number | null;
  iseAlimAdet: number;
  doldurmaGun: number | null;
  doldurmaAdet: number;
}

/** Çekmecede açılan başvuru listesinin süzgeci */
interface ListeSuzgeci {
  baslik: string;
  alt?: string;
  parametreler: Record<string, string>;
  /** Birim türü süzgeci uygulanmasın (norm kadro satırları) */
  birimTurusuz?: boolean;
}

type ListeAc = (s: ListeSuzgeci) => void;

/* -------------------------------------------------------------------------- */
/* Sabitler ve yardımcılar                                                     */
/* -------------------------------------------------------------------------- */

/** Durum renkleri: Başvurular sayfasındaki süreç kartlarıyla aynı */
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

/** Süreçteki aşamalar ve sonuç durumları (Başvurular sayfasının sırası) */
const ASAMALAR = [
  "Yeni",
  "İncelendi",
  "Değerlendirmede",
  "Görüşme Talebi",
  "Evrak Hazırlanıyor",
  "Onay Bekliyor",
];
const SONUCLANAN = ["Olumlu", "İşe Alındı", "Olumsuz"];

/** Sunucudaki BasvuruTabani kümeleriyle aynı */
const GORUSME_DURUMLARI = [
  "Görüşme Talebi",
  "Olumlu",
  "Evrak Hazırlanıyor",
  "Onay Bekliyor",
  "İşe Alındı",
];
const OLUMLU_DURUMLARI = ["Olumlu", "Evrak Hazırlanıyor", "Onay Bekliyor", "İşe Alındı"];

const sayi = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "—";
};

const yuzde = (pay: number, payda: number): number =>
  payda > 0 ? Math.round((pay / payda) * 100) : 0;

const durumAdedi = (g: Genel, durum: string): number => {
  switch (durum) {
    case "Yeni":
      return g.yeni ?? 0;
    case "İncelendi":
      return g.incelendi ?? 0;
    case "Değerlendirmede":
      return g.degerlendirmede ?? 0;
    case "Görüşme Talebi":
      return g.gorusmeTalebi ?? 0;
    case "Evrak Hazırlanıyor":
      return g.evrakHazirlaniyor ?? 0;
    case "Onay Bekliyor":
      return g.onayBekliyor ?? 0;
    case "Olumlu":
      return g.olumlu ?? 0;
    case "İşe Alındı":
      return g.iseAlindi ?? 0;
    case "Olumsuz":
      return g.olumsuz ?? 0;
    default:
      return 0;
  }
};

const Tire = () => <span className="rr-tire">—</span>;

/** Yatay oran çubuğu */
function Oran({ deger, toplam, renk }: { deger: number; toplam: number; renk: string }) {
  const o = yuzde(deger, toplam);
  return (
    <div className="rr-oran">
      <div className="rr-oran-cubuk">
        <i style={{ width: `${Math.min(100, o)}%`, background: renk }} />
      </div>
      <b>%{o}</b>
    </div>
  );
}

/** Bölüm başlığı: sayfadaki her ana bölümün üstünde aynı biçimde */
function Bolum({
  id,
  ikon,
  baslik,
  aciklama,
  sag,
}: {
  id: string;
  ikon?: ReactNode;
  baslik: string;
  aciklama?: string;
  sag?: ReactNode;
}) {
  return (
    <div id={id} className="rr-bolum">
      <div>
        <h2>
          {ikon}
          {baslik}
        </h2>
        {aciklama && <p>{aciklama}</p>}
      </div>
      {sag && <div className="rr-bolum-sag">{sag}</div>}
    </div>
  );
}

/** Boş durum */
function Bos({ metin, ikon }: { metin: string; ikon?: ReactNode }) {
  return (
    <div className="rr-bos">
      {ikon ?? <Inbox size={26} strokeWidth={1.6} />}
      <span>{metin}</span>
    </div>
  );
}

/** Kart içi yükleniyor iskeleti */
function Iskelet({ satir = 4 }: { satir?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
      {Array.from({ length: satir }).map((_, i) => (
        <div key={i} className="rr-iskelet" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  );
}

/** KPI kutusu */
function Kpi({
  ad,
  deger,
  ek,
  alt,
  renk,
  ikon,
  oran,
  tikla,
  ipucu,
}: {
  ad: string;
  deger: ReactNode;
  ek?: ReactNode;
  alt?: ReactNode;
  renk: string;
  ikon?: ReactNode;
  oran?: number;
  tikla?: () => void;
  ipucu?: string;
}) {
  const ic = (
    <>
      <div className="rr-kpi-ust">
        {ikon && (
          <span className="rr-kpi-ik" style={{ background: `${renk}17`, color: renk }}>
            {ikon}
          </span>
        )}
        <span>{ad}</span>
      </div>
      <div className="rr-kpi-deger" style={{ color: renk }}>
        {deger}
        {ek && <small>{ek}</small>}
      </div>
      <div className="rr-kpi-alt">{alt}</div>
      {oran !== undefined && (
        <div className="rr-kpi-cubuk">
          <i style={{ width: `${Math.min(100, Math.max(0, oran))}%`, background: renk }} />
        </div>
      )}
    </>
  );

  const kutu = tikla ? (
    <button type="button" className="rr-kpi" onClick={tikla}>
      {ic}
    </button>
  ) : (
    <div className="rr-kpi">{ic}</div>
  );

  return ipucu ? <Tooltip title={ipucu}>{kutu}</Tooltip> : kutu;
}

/** Kart */
function Kart({
  baslik,
  ikon,
  alt,
  sag,
  children,
  sifir,
  not,
  id,
}: {
  baslik: ReactNode;
  ikon?: ReactNode;
  alt?: ReactNode;
  sag?: ReactNode;
  children: ReactNode;
  sifir?: boolean;
  not?: ReactNode;
  id?: string;
}) {
  return (
    <div className="rr-kart" id={id}>
      <div className="rr-kart-bas">
        <b>
          {ikon}
          {baslik}
        </b>
        {alt && <span>{alt}</span>}
        {sag && <div className="rr-sag">{sag}</div>}
      </div>
      <div className={`rr-kart-ic${sifir ? " rr-sifir" : ""}`}>{children}</div>
      {not && <div className="rr-kart-not">{not}</div>}
    </div>
  );
}

const ExcelDugmesi = ({ tikla, metin = "Excel" }: { tikla: () => void; metin?: string }) => (
  <button type="button" className="rr-btn rr-btn-ince" onClick={tikla}>
    <Download size={14} strokeWidth={2} />
    {metin}
  </button>
);

/* -------------------------------------------------------------------------- */
/* Hazır tarih aralıkları                                                      */
/* -------------------------------------------------------------------------- */

const HAZIR_ARALIKLAR: { ad: string; aralik: () => [Dayjs, Dayjs] }[] = [
  { ad: "Bu ay", aralik: () => [dayjs().startOf("month"), dayjs()] },
  {
    ad: "Geçen ay",
    aralik: () => [
      dayjs().subtract(1, "month").startOf("month"),
      dayjs().subtract(1, "month").endOf("month"),
    ],
  },
  { ad: "Son 3 ay", aralik: () => [dayjs().subtract(2, "month").startOf("month"), dayjs()] },
  { ad: "Son 12 ay", aralik: () => [dayjs().subtract(11, "month").startOf("month"), dayjs()] },
  { ad: "Bu yıl", aralik: () => [dayjs().startOf("year"), dayjs()] },
];

const ayniGun = (a: Dayjs, b: Dayjs) => a.format("YYYY-MM-DD") === b.format("YYYY-MM-DD");

/* ========================================================================== */
/* Başvuru raporu                                                              */
/* ========================================================================== */

function BasvuruRaporu() {
  const { message } = AntdApp.useApp();
  const oturum = oturumOku();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<Veri>(BOS);
  const [hata, setHata] = useState<string | null>(null);
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>(HAZIR_ARALIKLAR[3].aralik());
  const [birimTuru, setBirimTuru] = useState<string>("Tümü");
  const [yenile, setYenile] = useState(0);

  /* Süreç süreleri: Başvurular sayfasının dağılım penceresiyle aynı uç */
  const [sureler, setSureler] = useState<Sureler | null>(null);

  /* Kırılım satırına tıklanınca açılan başvuru listesi */
  const [liste, setListe] = useState<ListeSuzgeci | null>(null);
  const [listeKayit, setListeKayit] = useState<any[]>([]);
  const [listeYukleniyor, setListeYukleniyor] = useState(false);
  const [acikBasvuru, setAcikBasvuru] = useState<number | null>(null);

  const basMetni = aralik[0].format("YYYY-MM-DD");
  const bitMetni = aralik[1].format("YYYY-MM-DD");
  const donemMetni = `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format("DD.MM.YYYY")}`;

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    const sorgu = new URLSearchParams({ bas: basMetni, bit: bitMetni });
    if (birimTuru && birimTuru !== "Tümü") sorgu.set("birimTuru", birimTuru);

    try {
      setVeri({ ...BOS, ...(await api.al<Veri>(`/api/Rapor?${sorgu.toString()}`)) });
    } catch (h: any) {
      setHata(h?.message ?? "Rapor alınamadı");
      message.error(h?.message ?? "Rapor alınamadı");
    } finally {
      setYukleniyor(false);
    }

    /* Süreler ayrı uçtan; gelmezse kart gizlenir, rapor etkilenmez */
    const s2 = new URLSearchParams({ tarihBas: basMetni, tarihBit: bitMetni });
    if (birimTuru && birimTuru !== "Tümü") s2.set("birimTuru", birimTuru);

    api
      .al<{ sureler?: Sureler }>(`/api/Basvuru/Dagilim?${s2.toString()}`)
      .then((d) => setSureler(d?.sureler ?? null))
      .catch(() => setSureler(null));
  }, [basMetni, bitMetni, birimTuru, message]);

  useEffect(() => {
    getir();
  }, [getir, yenile]);

  const g = veri.genel;

  /* ------------------------------------------------- çekmece listesi */

  const listeAc: ListeAc = useCallback(
    async (s) => {
      setListe(s);
      setListeKayit([]);
      setListeYukleniyor(true);

      try {
        const sorgu = new URLSearchParams({ bas: basMetni, bit: bitMetni, rapor: "true" });

        if (!s.birimTurusuz && birimTuru && birimTuru !== "Tümü") sorgu.set("birimTuru", birimTuru);

        Object.entries(s.parametreler).forEach(([k, v]) => sorgu.set(k, v));

        setListeKayit(await api.al<any[]>(`/api/Rapor/Basvurular?${sorgu.toString()}`));
      } catch (h: any) {
        message.error(h?.message ?? "Liste alınamadı");
      } finally {
        setListeYukleniyor(false);
      }
    },
    [basMetni, bitMetni, birimTuru, message]
  );

  /* --------------------------------------------------- hesaplamalar */

  const gorusmeSayisi = GORUSME_DURUMLARI.reduce((t, d) => t + durumAdedi(g, d), 0);
  const olumluSayisi = OLUMLU_DURUMLARI.reduce((t, d) => t + durumAdedi(g, d), 0);
  const surecteki = ASAMALAR.reduce((t, d) => t + durumAdedi(g, d), 0);
  const gunSayisi = Math.max(1, aralik[1].startOf("day").diff(aralik[0].startOf("day"), "day") + 1);

  const iseAlinanSubeSayisi = useMemo(() => {
    const h = new Map<string, number>();
    veri.iseAlinanlar.forEach((x) => {
      const k = (x.subeKodu ?? "").toLocaleUpperCase("tr");
      h.set(k, (h.get(k) ?? 0) + 1);
    });
    return h;
  }, [veri.iseAlinanlar]);

  /* -------------------------------------------------------- sütunlar */

  const kirilimSutunlari = (adBaslik: string, hedefVar = false): ColumnsType<Kirilim> => {
    const sutunlar: ColumnsType<Kirilim> = [
      {
        title: adBaslik,
        dataIndex: "ad",
        render: (v: string, k) => (
          <div className="rr-ad">
            {v || "—"}
            {k.bolge && <small>{k.bolge}</small>}
          </div>
        ),
      },
      {
        title: "Başvuru",
        dataIndex: "toplam",
        width: 92,
        align: "center",
        sorter: (a, b) => a.toplam - b.toplam,
        defaultSortOrder: "descend",
        render: (v: number) => <span className="rr-rozet rr-r-mavi">{sayi(v)}</span>,
      },
      {
        title: "Görüşme",
        dataIndex: "gorusme",
        width: 88,
        align: "center",
        sorter: (a, b) => a.gorusme - b.gorusme,
        render: (v: number) => (v > 0 ? <span className="rr-sayi">{sayi(v)}</span> : <Tire />),
      },
      {
        title: "Olumlu",
        dataIndex: "olumlu",
        width: 84,
        align: "center",
        sorter: (a, b) => a.olumlu - b.olumlu,
        render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-yesil">{sayi(v)}</span> : <Tire />),
      },
      {
        title: "İşe alındı",
        dataIndex: "iseAlindi",
        width: 92,
        align: "center",
        render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-camgobegi">{sayi(v)}</span> : <Tire />),
      },
      {
        title: "Olumsuz",
        dataIndex: "olumsuz",
        width: 86,
        align: "center",
        render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-kirmizi">{sayi(v)}</span> : <Tire />),
      },
      {
        title: "Olumlu oranı",
        key: "oran",
        width: 150,
        render: (_v, k) => <Oran deger={k.olumlu} toplam={k.toplam} renk="#7cb518" />,
      },
    ];

    if (hedefVar) {
      sutunlar.splice(4, 0, {
        title: "Açık kadro",
        dataIndex: "hedef",
        width: 108,
        align: "center",
        render: (v: number, k) =>
          v > 0 ? (
            <Tooltip title={`${k.olumlu} olumlu aday / ${sayi(v)} kişilik açık kadro (norm − mevcut)`}>
              <span className={`rr-rozet ${k.olumlu >= v ? "rr-r-yesil" : "rr-r-turuncu"}`}>
                {sayi(k.olumlu)} / {sayi(v)}
              </span>
            </Tooltip>
          ) : (
            <Tire />
          ),
      });
    }

    return sutunlar;
  };

  /* --------------------------------------------------------- dışa aktar */

  const iseAlinanIndir = () => {
    if (veri.iseAlinanlar.length === 0) {
      message.info("Dışa aktarılacak kayıt yok.");
      return;
    }

    /* Önceden genel kırılım şablonuyla aktarılıyor, bütün sayı sütunları
       0 çıkıyordu. Kişi listesi kendi sütunlarıyla yazılıyor. */
    tabloIndir({
      baslik: "İşe Alınanlar",
      altBaslik: `${donemMetni} · ${veri.iseAlinanlar.length} kişi · işe giriş tarihine göre`,
      sayfaAdi: "İşe Alınanlar",
      dosyaAdi: `ise-alinanlar-${aralik[0].format("YYYYMMDD")}-${aralik[1].format("YYYYMMDD")}`,
      genelToplam: true,
      sutunlar: [
        { ad: "Başvuru No", genislik: 18 },
        { ad: "Ad Soyad", genislik: 26 },
        { ad: "Telefon", genislik: 14 },
        { ad: "Birim", genislik: 24 },
        { ad: "Başladığı Pozisyon", genislik: 22 },
        { ad: "Başvurduğu Pozisyonlar", genislik: 30 },
        { ad: "Ücret Beklentisi", genislik: 16 },
        { ad: "Yol Ücreti", tip: "para", genislik: 12 },
        { ad: "İşe Giriş", tip: "tarih" },
        { ad: "Başvuru Tarihi", tip: "tarih" },
        { ad: "Doldurma (gün)", tip: "sayi", toplam: false },
      ],
      satirlar: veri.iseAlinanlar.map((x) => [
        x.basvuruNo,
        x.adSoyad,
        x.telefon,
        x.subeAdi,
        x.iseGirisBolum || (x.bolumler ?? "").split(",")[0]?.trim() || "",
        x.bolumler,
        x.talepUcret ?? "",
        x.yolUcreti ?? null,
        x.iseGirisTarihi ?? null,
        x.olusturma ?? null,
        x.doldurmaGun ?? null,
      ]),
    });
  };

  const kirilimDisaAktar = (kayit: Kirilim[], adBasligi: string, dosyaAdi: string) => {
    if (kayit.length === 0) {
      message.info("Dışa aktarılacak kayıt yok.");
      return;
    }
    kirilimIndir(kayit, adBasligi, dosyaAdi);
  };

  /* ---------------------------------------------------- aylık grafik */

  const enYuksekAy = useMemo(() => Math.max(1, ...veri.aylik.map((x) => x.toplam)), [veri.aylik]);
  const ayKisa = (a: Aylik) => (a.etiket ?? "").split(" ")[0]?.slice(0, 3) ?? "";

  /* ------------------------------------------------------- bölümler */

  const bolumler = veri.bolumler.filter((x) => x.toplam > 0);

  const gecisler: [string, string][] = [
    ["rr-genel", "Genel bakış"],
    ["rr-aylik", "Aylık seyir"],
    ["rr-isealinan", `İşe alınanlar (${veri.iseAlinanlar.length})`],
    ["rr-norm", "Norm kadro"],
    ["rr-subeler", `Şubeler (${veri.subeler.length})`],
    ["rr-bolumler", "Pozisyonlar"],
    ["rr-kaynak", "Kaynak ve ilçe"],
  ];

  const hazirSecili = HAZIR_ARALIKLAR.find((h) => {
    const [a, b] = h.aralik();
    return ayniGun(a, aralik[0]) && ayniGun(b, aralik[1]);
  })?.ad;

  return (
    <>
      {/* ------------------------------------------------------------ süzgeç */}
      <div className="rr-filtre">
        <RangePicker
          value={aralik}
          format="DD.MM.YYYY"
          allowClear={false}
          disabledDate={(d) => !!d && d > dayjs().endOf("day")}
          onChange={(d) => d?.[0] && d?.[1] && setAralik([d[0], d[1]])}
        />
        <div className="rr-seg" role="group" aria-label="Hazır tarih aralıkları">
          {HAZIR_ARALIKLAR.map((h) => (
            <button
              key={h.ad}
              type="button"
              className={hazirSecili === h.ad ? "rr-aktif" : undefined}
              onClick={() => setAralik(h.aralik())}
            >
              {h.ad}
            </button>
          ))}
        </div>
        <div className="rr-filtre-sag">
          <Select
            style={{ minWidth: 150 }}
            value={birimTuru}
            onChange={setBirimTuru}
            options={[
              { value: "Tümü", label: "Tüm birim türleri" },
              ...veri.birimTurleri.map((x) => ({ value: x, label: x })),
            ]}
          />
          <button
            type="button"
            className="rr-btn"
            onClick={() => setYenile((x) => x + 1)}
            disabled={yukleniyor}
          >
            <RefreshCw size={15} strokeWidth={2} className={yukleniyor ? "rr-donen" : undefined} />
            Yenile
          </button>
        </div>
      </div>

      <div className="rr-gecis">
        {gecisler.map(([id, ad]) => (
          <button
            key={id}
            type="button"
            onClick={() =>
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {ad}
          </button>
        ))}
      </div>

      {hata && (
        <div className="rr-uyari-serit rr-kirmizi">
          <AlertTriangle size={16} strokeWidth={2} />
          <div>
            Başvuru raporu alınamadı: {hata}{" "}
            <button type="button" className="rr-baglanti" onClick={() => setYenile((x) => x + 1)}>
              Tekrar dene
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- genel bakış */}
      <Bolum
        id="rr-genel"
        ikon={<BarChart3 size={17} strokeWidth={2} />}
        baslik="Genel bakış"
        aciklama={`${donemMetni} · ${
          birimTuru === "Tümü" ? "tüm birim türleri" : birimTuru
        } · arşivlenenler hariç · her başvuru kendi ayında sayılır`}
      />

      <Spin spinning={yukleniyor && g.toplam > 0}>
        <div className="rr-kpi-satir">
          <Kpi
            ad="Toplam başvuru"
            deger={sayi(g.toplam)}
            alt={`günde ortalama ${sayi(Math.round((g.toplam / gunSayisi) * 10) / 10)}`}
            renk="#1c2419"
            ikon={<Inbox size={16} strokeWidth={2} />}
            tikla={() => listeAc({ baslik: "Tüm başvurular", parametreler: {} })}
            ipucu="Dönemde gelen başvurular; tıklayınca liste açılır"
          />
          <Kpi
            ad="Görüşme oranı"
            deger={`%${yuzde(gorusmeSayisi, g.toplam)}`}
            alt={`${sayi(gorusmeSayisi)} başvuru görüşme aşamasına geldi`}
            renk={DURUM_RENKLERI["Görüşme Talebi"]}
            ikon={<Users size={16} strokeWidth={2} />}
            oran={yuzde(gorusmeSayisi, g.toplam)}
            tikla={() =>
              listeAc({
                baslik: "Görüşme aşamasına gelenler",
                parametreler: { durum: GORUSME_DURUMLARI.join(",") },
              })
            }
            ipucu="Görüşme talebi, olumlu, evrak, onay bekleyen ve işe alınanlar"
          />
          <Kpi
            ad="Olumlu sonuç"
            deger={`%${yuzde(olumluSayisi, g.toplam)}`}
            alt={`${sayi(olumluSayisi)} aday olumlu sonuçlandı`}
            renk="#5f8c10"
            ikon={<CheckCircle2 size={16} strokeWidth={2} />}
            oran={yuzde(olumluSayisi, g.toplam)}
            tikla={() =>
              listeAc({
                baslik: "Olumlu sonuçlananlar",
                alt: "havuz, evrak, onay bekleyen ve işe alınanlar",
                parametreler: { durum: OLUMLU_DURUMLARI.join(",") },
              })
            }
            ipucu="Havuzdaki (Olumlu), evrak hazırlanan, onay bekleyen ve işe alınanlar"
          />
          <Kpi
            ad="Olumsuz"
            deger={`%${yuzde(g.olumsuz, g.toplam)}`}
            alt={`${sayi(g.olumsuz)} başvuru olumsuz sonuçlandı`}
            renk="#c62828"
            ikon={<XCircle size={16} strokeWidth={2} />}
            oran={yuzde(g.olumsuz, g.toplam)}
            tikla={() => listeAc({ baslik: "Olumsuz sonuçlananlar", parametreler: { durum: "Olumsuz" } })}
          />
          <Kpi
            ad="Süreçte bekleyen"
            deger={sayi(surecteki)}
            alt={`%${yuzde(surecteki, g.toplam)} henüz sonuçlanmadı`}
            renk="#2e6aa8"
            ikon={<Hourglass size={16} strokeWidth={2} />}
            oran={yuzde(surecteki, g.toplam)}
            tikla={() =>
              listeAc({ baslik: "Süreçteki başvurular", parametreler: { durum: ASAMALAR.join(",") } })
            }
          />
          <Kpi
            ad="İşe giren"
            deger={sayi(veri.iseAlinanlar.length)}
            alt="işe giriş tarihi dönemde"
            renk="#0f766e"
            ikon={<UserCheck size={16} strokeWidth={2} />}
            tikla={() =>
              document.getElementById("rr-isealinan")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            ipucu="İşe giriş tarihi seçilen dönemde olan işe alımlar (Yönetim Raporu ve Norm Kadro ile aynı ölçüt)"
          />
        </div>

        {/* -------------------------------------------------- süreç hattı */}
        <div className="rr-hat">
          {[...ASAMALAR, "|", ...SONUCLANAN].map((ad) =>
            ad === "|" ? (
              <div key="ayrac" className="rr-ayrac">
                <TrendingUp size={15} strokeWidth={2} />
              </div>
            ) : (
              <button
                key={ad}
                type="button"
                className={`rr-asama${SONUCLANAN.includes(ad) ? " rr-sonuc" : ""}`}
                onClick={() =>
                  listeAc({ baslik: ad === "Olumlu" ? "Olumlu (havuzdaki adaylar)" : ad, parametreler: { durum: ad } })
                }
                title="Bu durumdakileri listele"
              >
                <div className="rr-asama-ad">
                  <i style={{ background: DURUM_RENKLERI[ad] }} />
                  {ad === "Olumlu" ? "Olumlu (havuz)" : ad}
                </div>
                <div className="rr-asama-sayi" style={{ color: DURUM_RENKLERI[ad] }}>
                  {sayi(durumAdedi(g, ad))}
                </div>
                <div className="rr-asama-alt">%{yuzde(durumAdedi(g, ad), g.toplam)} · toplamın</div>
                <span
                  className="rr-asama-cubuk"
                  style={{
                    width: `${yuzde(durumAdedi(g, ad), g.toplam)}%`,
                    background: DURUM_RENKLERI[ad],
                  }}
                />
              </button>
            )
          )}
        </div>
      </Spin>

      {/* ------------------------------------------------ huni ve süreler */}
      <div className="rr-izgara rr-izgara-12">
        <Kart
          baslik="Dönüşüm hunisi"
          ikon={<Target size={16} strokeWidth={2} />}
          alt="adıma tıklayınca liste açılır"
        >
          {g.toplam === 0 ? (
            yukleniyor ? <Iskelet satir={4} /> : <Bos metin="Seçilen aralıkta başvuru yok." />
          ) : (
            <div className="rr-huni">
              {[
                {
                  ad: "Başvuru",
                  alt: "dönemde gelen",
                  adet: g.toplam,
                  renk: "#2e6aa8",
                  durum: "",
                },
                {
                  ad: "Görüşme",
                  alt: "görüşme aşamasına gelen",
                  adet: gorusmeSayisi,
                  renk: DURUM_RENKLERI["Görüşme Talebi"],
                  durum: GORUSME_DURUMLARI.join(","),
                },
                {
                  ad: "Olumlu sonuç",
                  alt: "havuz, evrak, onay, işe alındı",
                  adet: olumluSayisi,
                  renk: "#7cb518",
                  durum: OLUMLU_DURUMLARI.join(","),
                },
                {
                  ad: "İşe alındı",
                  alt: "durumu İşe Alındı",
                  adet: g.iseAlindi,
                  renk: DURUM_RENKLERI["İşe Alındı"],
                  durum: "İşe Alındı",
                },
              ].map((a, i, dizi) => {
                const genislik = yuzde(a.adet, g.toplam);
                const onceki = i > 0 ? dizi[i - 1].adet : 0;

                return (
                  <button
                    key={a.ad}
                    type="button"
                    className="rr-huni-satir"
                    onClick={() =>
                      listeAc({
                        baslik: a.ad === "Başvuru" ? "Tüm başvurular" : a.ad,
                        parametreler: a.durum ? { durum: a.durum } : {},
                      })
                    }
                  >
                    <span className="rr-huni-ad">
                      {a.ad}
                      <small>{a.alt}</small>
                    </span>
                    <span className="rr-huni-alan">
                      <span
                        className="rr-huni-dolu"
                        style={{ width: `${Math.max(genislik, a.adet > 0 ? 3 : 0)}%`, background: a.renk }}
                      >
                        {genislik >= 12 ? `%${genislik}` : ""}
                      </span>
                    </span>
                    <span className="rr-huni-sayi">
                      <b>{sayi(a.adet)}</b>
                      <span>{i === 0 ? "tümü" : `önceki adım %${yuzde(a.adet, onceki)}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Kart>

        <Kart
          baslik="Süreç süreleri"
          ikon={<Timer size={16} strokeWidth={2} />}
          alt="ortalama, gün"
          not="Başvurular sayfasının dağılım penceresiyle aynı hesap: durum geçmişinden başvurudan ilgili işleme kadar geçen süre."
        >
          {(() => {
            const satirlar = sureler
              ? [
                  { ad: "İlk işleme kadar", gun: sureler.ilkIslemGun, adet: sureler.ilkIslemAdet },
                  { ad: "Görüşmeye kadar", gun: sureler.gorusmeGun, adet: sureler.gorusmeAdet },
                  { ad: "İşe alıma kadar", gun: sureler.iseAlimGun, adet: sureler.iseAlimAdet },
                  { ad: "Pozisyon doldurma", gun: sureler.doldurmaGun, adet: sureler.doldurmaAdet },
                ]
              : [];

            if (!sureler)
              return yukleniyor ? <Iskelet satir={3} /> : <Bos metin="Süre bilgisi alınamadı." ikon={<Clock3 />} />;

            return (
              <div className="rr-sure-liste">
                {satirlar.map((s) => (
                  <div key={s.ad} className="rr-sure">
                    <span>{s.ad}</span>
                    <b>
                      {s.gun == null || s.adet === 0 ? "—" : sayi(Math.round(Number(s.gun) * 10) / 10)}
                      {s.gun != null && s.adet > 0 && <small>gün</small>}
                    </b>
                    <i>{s.adet > 0 ? `${sayi(s.adet)} başvuruda ölçüldü` : "ölçülen kayıt yok"}</i>
                  </div>
                ))}
              </div>
            );
          })()}
        </Kart>
      </div>

      {/* -------------------------------------------------------- aylık seyir */}
      <Bolum
        id="rr-aylik"
        ikon={<TrendingUp size={17} strokeWidth={2} />}
        baslik="Aylık seyir"
        aciklama="Başvuruların aylara göre dağılımı; çubuk, o ay gelen başvuruların bugünkü durumunu gösterir"
      />
      <Kart baslik="Aylara göre başvurular" ikon={<BarChart3 size={16} strokeWidth={2} />} alt={donemMetni}>
        {veri.aylik.length === 0 || g.toplam === 0 ? (
          yukleniyor ? <Iskelet satir={5} /> : <Bos metin="Seçilen aralıkta başvuru yok." />
        ) : (
          <>
            <div className="rr-grafik-kap">
              <div
                className="rr-grafik"
                style={{ minWidth: veri.aylik.length > 14 ? veri.aylik.length * 30 : undefined }}
              >
                {veri.aylik.map((a) => {
                  const gorusmeOlumsuzHaric = Math.max(0, a.gorusme - a.olumlu);
                  const surecte = Math.max(0, a.toplam - a.gorusme - a.olumsuz);
                  const parca = (n: number) => (a.toplam > 0 ? `${(n / a.toplam) * 100}%` : "0%");

                  return (
                    <Tooltip
                      key={`${a.yil}-${a.ay}`}
                      title={
                        <span>
                          <b>{a.etiket}</b>
                          <br />
                          Başvuru: {a.toplam}
                          <br />
                          Görüşme aşaması: {a.gorusme}
                          <br />
                          Olumlu sonuç: {a.olumlu} (%{yuzde(a.olumlu, a.toplam)})
                          <br />
                          Olumsuz: {a.olumsuz}
                        </span>
                      }
                    >
                      <div className="rr-ay">
                        <div className="rr-ay-deger">{a.toplam > 0 ? sayi(a.toplam) : ""}</div>
                        <div className="rr-ay-alan">
                          <div
                            className="rr-ay-cubuk"
                            style={{ height: a.toplam > 0 ? `${(a.toplam / enYuksekAy) * 100}%` : "2px" }}
                          >
                            <i style={{ height: parca(a.olumlu), background: "#7cb518" }} />
                            <i style={{ height: parca(gorusmeOlumsuzHaric), background: "#9b82dd" }} />
                            <i style={{ height: parca(a.olumsuz), background: "#ef8a6a" }} />
                            <i style={{ height: parca(surecte), background: "#a9c4e2" }} />
                          </div>
                        </div>
                        <div className="rr-ay-etiket">
                          <b>{ayKisa(a)}</b>
                          {String(a.yil).slice(2)}
                        </div>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
            <div className="rr-gosterge">
              <span>
                <i style={{ background: "#7cb518" }} />
                Olumlu sonuç
              </span>
              <span>
                <i style={{ background: "#9b82dd" }} />
                Görüşmede
              </span>
              <span>
                <i style={{ background: "#ef8a6a" }} />
                Olumsuz
              </span>
              <span>
                <i style={{ background: "#a9c4e2" }} />
                Süreçte (görüşme öncesi)
              </span>
            </div>
          </>
        )}
      </Kart>

      {/* ------------------------------------------------------- işe alınanlar */}
      <Bolum
        id="rr-isealinan"
        ikon={<UserCheck size={17} strokeWidth={2} />}
        baslik="İşe alınanlar"
        aciklama="İşe giriş tarihi dönemde olan adaylar; pozisyon, ücret ve giriş tarihiyle"
      />
      <Kart
        baslik="Dönemde işe girenler"
        ikon={<UserCheck size={16} strokeWidth={2} />}
        alt={`${sayi(veri.iseAlinanlar.length)} kişi`}
        sag={<ExcelDugmesi tikla={iseAlinanIndir} />}
        sifir
      >
        <Tablo<IseAlinan>
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={veri.iseAlinanlar}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 980 }}
          locale={{ emptyText: <Bos metin="Seçilen aralıkta işe giren aday yok." /> }}
          columns={[
            {
              title: "Aday",
              dataIndex: "adSoyad",
              render: (v: string, k) => (
                <div className="rr-aday">
                  <b>{v}</b>
                  <small>{k.basvuruNo}</small>
                </div>
              ),
            },
            { title: "Telefon", dataIndex: "telefon", width: 125 },
            { title: "Birim", dataIndex: "subeAdi", width: 160, ellipsis: true },
            {
              title: "Başladığı pozisyon",
              dataIndex: "iseGirisBolum",
              width: 210,
              render: (v: string, k) => {
                /* İşe giriş pozisyonu girilmemişse başvurduğu pozisyon
                   gösterilir; farklıysa başvurduğu parantez içinde yazılır. */
                const basvurdugu = (k.bolumler ?? "")
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
                const pozisyon = v || basvurdugu[0];
                if (!pozisyon) return <Tire />;
                const farkli = v && !basvurdugu.includes(v);

                return (
                  <div className="rr-ad">
                    <span className="rr-rozet rr-r-camgobegi">{pozisyon}</span>
                    {farkli && basvurdugu.length > 0 && <small>başvurduğu: {basvurdugu.join(", ")}</small>}
                  </div>
                );
              },
            },
            {
              /* Anlaşılan ücret bu listeden kaldırıldı (03.10.2026, kullanıcı
                 isteği); yalnızca adayın beklentisi ve yol ücreti kalıyor. */
              title: "Ücret beklentisi",
              dataIndex: "talepUcret",
              width: 150,
              align: "right",
              render: (v: string, k) =>
                v || k.yolUcreti ? (
                  <div className="rr-ad" style={{ fontWeight: 500 }}>
                    {v ? <b>{v}</b> : <Tire />}
                    {k.yolUcreti ? <small>yol {k.yolUcreti.toLocaleString("tr-TR")} TL</small> : null}
                  </div>
                ) : (
                  <Tire />
                ),
            },
            {
              title: "İşe giriş",
              dataIndex: "iseGirisTarihi",
              width: 112,
              sorter: (a, b) =>
                dayjs(a.iseGirisTarihi ?? 0).valueOf() - dayjs(b.iseGirisTarihi ?? 0).valueOf(),
              defaultSortOrder: "descend",
              render: (v: string) =>
                v ? <span className="rr-rozet rr-r-camgobegi">{dayjs(v).format("DD.MM.YYYY")}</span> : <Tire />,
            },
            {
              title: "Başvuru",
              dataIndex: "olusturma",
              width: 100,
              render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
            },
            {
              title: "",
              key: "form",
              width: 128,
              render: (_v, k) => (
                <button type="button" className="rr-btn rr-btn-ince" onClick={() => setAcikBasvuru(k.id)}>
                  <FileText size={14} strokeWidth={2} />
                  Formu gör
                </button>
              ),
            },
          ]}
        />
      </Kart>

      {/* ----------------------------------------------------------- norm kadro */}
      <NormBolumu
        bas={basMetni}
        bit={bitMetni}
        donemMetni={donemMetni}
        iseAlinanSubeSayisi={iseAlinanSubeSayisi}
        listeAc={listeAc}
      />

      {/* -------------------------------------------------------------- şubeler */}
      <Bolum
        id="rr-subeler"
        ikon={<Building2 size={17} strokeWidth={2} />}
        baslik="Şubeler"
        aciklama="Şube bazında başvuru, görüşme ve sonuç; satıra tıklayınca başvurular açılır"
        sag={
          <ExcelDugmesi
            tikla={() => {
              if (veri.subeler.length === 0) {
                message.info("Dışa aktarılacak kayıt yok.");
                return;
              }
              subeRaporuIndir(veri.subeler as any, donemMetni);
            }}
          />
        }
      />
      <Kart
        baslik="Şube bazında başvurular"
        ikon={<Building2 size={16} strokeWidth={2} />}
        alt={`${veri.subeler.length} birim`}
        sifir
        not={
          veri.basvurusuOlmayanSubeler.length > 0 ? (
            <div>
              <b style={{ color: "#6b4a00" }}>
                <AlertTriangle size={14} strokeWidth={2} style={{ verticalAlign: -2, marginRight: 6 }} />
                Hiç başvuru almayan birimler ({veri.basvurusuOlmayanSubeler.length})
              </b>
              <div className="rr-etiketler">
                {veri.basvurusuOlmayanSubeler.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              Bu birimlerdeki QR kodların yerini ve görünürlüğünü kontrol etmekte fayda var.
            </div>
          ) : undefined
        }
      >
        <Tablo<Kirilim>
          rowKey="anahtar"
          size="small"
          loading={yukleniyor}
          columns={kirilimSutunlari("Şube")}
          dataSource={veri.subeler}
          pagination={false}
          scroll={{ x: 820 }}
          locale={{ emptyText: <Bos metin="Seçilen aralıkta başvuru yok." /> }}
          rowClassName={() => "rr-tik"}
          onRow={(k) => ({
            onClick: () =>
              listeAc({ baslik: k.ad || k.anahtar, parametreler: { subeKodu: k.anahtar || "__BOS__" } }),
          })}
        />
      </Kart>

      {/* ------------------------------------------------------------ bölümler */}
      <Bolum
        id="rr-bolumler"
        ikon={<Briefcase size={17} strokeWidth={2} />}
        baslik="Pozisyonlar"
        aciklama="Adayların başvurduğu pozisyonlar; aday birden fazla pozisyon seçebildiği için toplamlar başvuru sayısını aşabilir"
        sag={<ExcelDugmesi tikla={() => kirilimDisaAktar(bolumler, "Bölüm", "bolum_raporu")} />}
      />
      <Kart
        baslik="Pozisyon bazında başvurular"
        ikon={<Briefcase size={16} strokeWidth={2} />}
        alt="açık kadro: norm − mevcut (Norm Kadro ile aynı)"
        sifir
        not={
          veri.basvurusuOlmayanBolumler.length > 0 ? (
            <div>
              <b style={{ color: "#6b4a00" }}>
                <AlertTriangle size={14} strokeWidth={2} style={{ verticalAlign: -2, marginRight: 6 }} />
                Hiç başvuru gelmeyen pozisyonlar ({veri.basvurusuOlmayanBolumler.length})
              </b>
              <div className="rr-etiketler">
                {veri.basvurusuOlmayanBolumler.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              Bu pozisyonlar için ilan vermek veya başvuru formundaki bölüm listesini gözden geçirmek gerekebilir.
            </div>
          ) : undefined
        }
      >
        <Tablo<Kirilim>
          rowKey="anahtar"
          size="small"
          loading={yukleniyor}
          columns={kirilimSutunlari("Pozisyon", true)}
          dataSource={bolumler}
          pagination={false}
          scroll={{ x: 920 }}
          locale={{ emptyText: <Bos metin="Seçilen aralıkta başvuru yok." /> }}
          rowClassName={() => "rr-tik"}
          onRow={(k) => ({
            onClick: () => listeAc({ baslik: k.ad, parametreler: { bolum: k.anahtar } }),
          })}
        />
      </Kart>

      {/* ------------------------------------------------------ kaynak / ilçe */}
      <Bolum
        id="rr-kaynak"
        ikon={<Megaphone size={17} strokeWidth={2} />}
        baslik="Kaynak ve ilçe"
        aciklama="Adayların bizi nereden duyduğu ve geldikleri ilçeler; satıra tıklayınca adaylar açılır"
      />
      <div className="rr-izgara">
        {/* Başvuru kaynağı: hangi kanal aday getiriyor. Olumlu sütunu ayrı
            duruyor çünkü çok başvuru getiren kanal ille de iyi aday
            getirmiyor. */}
        <Kart
          baslik="Adaylar bizi nereden duydu"
          ikon={<Megaphone size={16} strokeWidth={2} />}
          sag={<ExcelDugmesi tikla={() => kirilimDisaAktar(veri.kaynaklar, "Kaynak", "kaynak_raporu")} />}
          sifir
        >
          <KucukKirilim
            kayitlar={veri.kaynaklar}
            ad="Kaynak"
            yukleniyor={yukleniyor}
            tikla={(k) => listeAc({ baslik: `Kaynak: ${k.ad}`, parametreler: { kaynak: k.anahtar } })}
          />
        </Kart>

        <Kart
          baslik="Adayların geldiği ilçeler"
          ikon={<MapPin size={16} strokeWidth={2} />}
          alt="ilk 15"
          sag={<ExcelDugmesi tikla={() => kirilimDisaAktar(veri.ilceler, "İlçe", "ilce_raporu")} />}
          sifir
        >
          <KucukKirilim
            kayitlar={veri.ilceler}
            ad="İlçe"
            yukleniyor={yukleniyor}
            tikla={(k) => listeAc({ baslik: `İlçe: ${k.ad}`, parametreler: { ilce: k.anahtar } })}
          />
        </Kart>
      </div>

      {veri.kaynakDigerleri.length > 0 && (
        <Kart
          baslik="“Diğer” olarak yazılanlar"
          ikon={<Layers size={16} strokeWidth={2} />}
          alt="listede karşılığı olmayıp adayların elle yazdıkları"
          sifir
          not="Sık tekrarlayanları Yönetim → Form Ayarları'ndan seçeneklere ekleyebilirsiniz."
        >
          <KucukKirilim
            kayitlar={veri.kaynakDigerleri}
            ad="Açıklama"
            yukleniyor={yukleniyor}
            tikla={(k) => listeAc({ baslik: `“${k.ad}” yazanlar`, parametreler: { kaynakDetay: k.anahtar } })}
          />
        </Kart>
      )}

      {/* --------------------------------------------- kırılım başvuru listesi */}
      <Drawer
        open={!!liste}
        onClose={() => {
          setListe(null);
          setListeKayit([]);
        }}
        width="min(1240px, 96vw)"
        className="rr-cekmece"
        title={
          liste && (
            <div>
              <div className="rr-cekmece-baslik">
                <b>{liste.baslik}</b>
                <span className="rr-rozet rr-r-mavi">
                  {listeYukleniyor ? "…" : `${sayi(listeKayit.length)} başvuru`}
                </span>
                {birimTuru !== "Tümü" && !liste.birimTurusuz && (
                  <span className="rr-rozet rr-r-gri">{birimTuru}</span>
                )}
              </div>
              <div className="rr-cekmece-alt">
                {liste.alt ? `${liste.alt} · ` : ""}
                {donemMetni}
              </div>
            </div>
          )
        }
        extra={
          <ExcelDugmesi
            tikla={() => {
              if (listeKayit.length === 0) {
                message.info("Dışa aktarılacak kayıt yok.");
                return;
              }
              listeyiIndir(listeKayit, "rapor_basvurulari");
            }}
          />
        }
      >
        <div className="rr-kart" style={{ marginBottom: 0 }}>
          <Tablo
            rowKey="id"
            size="small"
            loading={listeYukleniyor}
            columns={listeSutunlari(setAcikBasvuru)}
            dataSource={listeKayit}
            pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
            scroll={{ x: 1180 }}
            locale={{ emptyText: <Bos metin="Bu süzgece uyan başvuru yok." /> }}
          />
        </div>
      </Drawer>

      <BasvuruDetayModal basvuruId={acikBasvuru} kapat={() => setAcikBasvuru(null)} />
    </>
  );
}

/** Saat simgesi (boş süre kartı için) */
const Clock3 = () => <Timer size={26} strokeWidth={1.6} />;

/** Çekmecedeki başvuru listesi sütunları */
const listeSutunlari = (formAc: (id: number) => void): ColumnsType<any> => [
  {
    title: "Aday",
    dataIndex: "adSoyad",
    width: 210,
    fixed: "left",
    sorter: (a: any, b: any) => (a.adSoyad ?? "").localeCompare(b.adSoyad ?? "", "tr"),
    render: (v: string, k: any) => (
      <div className="rr-aday">
        <b>{v}</b>
        <small>{k.basvuruNo}</small>
      </div>
    ),
  },
  { title: "Telefon", dataIndex: "telefon", width: 125 },
  { title: "Şube", dataIndex: "subeAdi", width: 150, ellipsis: true },
  { title: "Pozisyonlar", dataIndex: "bolumler", ellipsis: true },
  {
    title: "Ücret beklentisi",
    dataIndex: "talepUcret",
    width: 135,
    render: (v: string) => (v ? <span className="rr-rozet rr-r-sari">{v}</span> : <Tire />),
  },
  {
    title: "Durum",
    dataIndex: "durum",
    width: 150,
    render: (v: string) => {
      const renk = DURUM_RENKLERI[v] ?? "#6b7280";
      return (
        <span className="rr-rozet" style={{ background: `${renk}17`, color: renk }}>
          {v}
        </span>
      );
    },
  },
  {
    title: "Başvuru",
    dataIndex: "olusturma",
    width: 100,
    sorter: (a: any, b: any) => dayjs(a.olusturma).valueOf() - dayjs(b.olusturma).valueOf(),
    render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
  },
  {
    title: "Son işlem",
    dataIndex: "guncelleyen",
    width: 150,
    render: (v: string, k: any) =>
      v ? (
        <div className="rr-aday">
          <span style={{ fontSize: 13 }}>{v}</span>
          {k.guncelleme && <small>{dayjs(k.guncelleme).format("DD.MM.YYYY HH:mm")}</small>}
        </div>
      ) : (
        <Tire />
      ),
  },
  {
    title: "",
    key: "form",
    width: 128,
    render: (_v: unknown, k: any) => (
      <button type="button" className="rr-btn rr-btn-ince" onClick={() => formAc(k.id)}>
        <FileText size={14} strokeWidth={2} />
        Formu gör
      </button>
    ),
  },
];

/** Kaynak / ilçe gibi kısa kırılım tabloları */
function KucukKirilim({
  kayitlar,
  ad,
  yukleniyor,
  tikla,
}: {
  kayitlar: Kirilim[];
  ad: string;
  yukleniyor: boolean;
  tikla: (k: Kirilim) => void;
}) {
  const enBuyuk = Math.max(1, ...kayitlar.map((x) => x.toplam));

  return (
    <Tablo<Kirilim>
      rowKey="anahtar"
      size="small"
      loading={yukleniyor}
      dataSource={kayitlar}
      pagination={false}
      scroll={{ x: 460 }}
      locale={{ emptyText: <Bos metin="Kayıt yok." /> }}
      rowClassName={() => "rr-tik"}
      onRow={(k) => ({ onClick: () => tikla(k) })}
      columns={[
        {
          title: ad,
          dataIndex: "ad",
          render: (v: string, k) => (
            <div className="rr-ad">
              {v}
              <div className="rr-oran-cubuk" style={{ marginTop: 4, maxWidth: 220 }}>
                <i style={{ width: `${(k.toplam / enBuyuk) * 100}%`, background: "#a9c4e2" }} />
              </div>
            </div>
          ),
        },
        {
          title: "Başvuru",
          dataIndex: "toplam",
          width: 84,
          align: "center",
          defaultSortOrder: "descend",
          sorter: (a, b) => a.toplam - b.toplam,
          render: (v: number) => <span className="rr-rozet rr-r-mavi">{sayi(v)}</span>,
        },
        {
          title: "Olumlu",
          dataIndex: "olumlu",
          width: 78,
          align: "center",
          render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-yesil">{sayi(v)}</span> : <Tire />),
        },
        {
          title: "Oran",
          key: "oran",
          width: 120,
          render: (_v, k) => <Oran deger={k.olumlu} toplam={k.toplam} renk="#7cb518" />,
        },
      ]}
    />
  );
}

/* ========================================================================== */
/* Norm kadro                                                                  */
/* ========================================================================== */

interface NormRaporSatiri {
  subeKodu: string;
  subeAdi: string;
  bolge?: string;
  norm: number;
  mevcut: number;
  fark: number;
  engelliCalisan: number;
  raporlu?: number;
  raporlular?: string[];
  ayrilacak?: number;
  ayrilacaklar?: string[];
  havuzdakiAday?: number;
  eksikler: { bolum: string; adet: number; gun?: number }[];
  fazlalar: { bolum: string; adet: number; gun?: number }[];
}

interface NormRaporYaniti {
  toplamNorm: number;
  toplamMevcut: number;
  toplamEngelli: number;
  toplamRaporlu?: number;
  toplamEksik: number;
  toplamFazla: number;
  toplamAyrilacak?: number;
  satirlar: NormRaporSatiri[];
}

interface NormGrubu {
  subeKodu: string;
  subeAdi: string;
  bolge?: string;
  norm: number;
  mevcut: number;
  eksik: number;
  fazla: number;
  engelli: number;
  raporlu: number;
  raporlular: string[];
  ayrilacak: number;
  ayrilacaklar: string[];
  acikPozisyonlar: { bolum: string; adet: number }[];
  iseAlinan: number;
  satirlar: NormKadro[];
}

const buyuk = (x?: string | null) => (x ?? "").trim().toLocaleUpperCase("tr");

/**
 * Norm kadro bölümü.
 *
 * Şube satırları ve kartlar Norm Kadro ekranının ucundan (Havuz/NormRapor)
 * gelir; o uç önce Mikro'dan mevcut sayılarını senkronlar. Pozisyon
 * satırları ve dönem sayıları (başvuru, havuz, işe giren) ondan SONRA
 * Rapor/NormKadro ucundan alınır; böylece iki ekran aynı norm / mevcut /
 * eksik / fazla / engelli / raporlu sayısını gösterir. Önceden raporlar
 * sayfası senkronsuz kadro tablosunu okuyor, engelli, raporlu ve ayrılacak
 * bilgisini hiç göstermiyor, şubesiz kadroyu toplamlara katmıyordu.
 */
function NormBolumu({
  bas,
  bit,
  donemMetni,
  iseAlinanSubeSayisi,
  listeAc,
}: {
  bas: string;
  bit: string;
  donemMetni: string;
  iseAlinanSubeSayisi: Map<string, number>;
  listeAc: ListeAc;
}) {
  const [normRapor, setNormRapor] = useState<NormRaporYaniti | null>(null);
  const [normHata, setNormHata] = useState<string | null>(null);
  const [kadro, setKadro] = useState<NormKadro[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [suzgec, setSuzgec] = useState<"sorun" | "eksik" | "hepsi">("sorun");
  const [yenile, setYenile] = useState(0);
  /* Pozisyona tıklanınca o pozisyondaki personel (09.10.2026) */
  const [pozisyon, setPozisyon] = useState<PozisyonSecimi | null>(null);

  /* Norm Kadro ucu Mikro senkronu yaptığı için ağır; tarih değişince
     yeniden çağrılmaz, yalnızca ilk açılışta ve "Yenile" ile. */
  const normSozu = useRef<Promise<NormRaporYaniti | null> | null>(null);
  const sonYenile = useRef(-1);

  useEffect(() => {
    let iptal = false;
    setYukleniyor(true);

    if (!normSozu.current || sonYenile.current !== yenile) {
      sonYenile.current = yenile;
      normSozu.current = api.al<NormRaporYaniti>("/api/Havuz/NormRapor").catch((h: any) => {
        if (!iptal) setNormHata(h?.message ?? "Norm Kadro verisi alınamadı");
        return null;
      });
    }

    (async () => {
      const nr = await normSozu.current;
      if (iptal) return;
      setNormRapor(nr);
      if (nr) setNormHata(null);

      try {
        const d = await api.al<{ satirlar: NormKadro[] }>(`/api/Rapor/NormKadro?bas=${bas}&bit=${bit}`);
        if (!iptal) setKadro(d?.satirlar ?? []);
      } catch {
        if (!iptal) setKadro([]);
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    })();

    return () => {
      iptal = true;
    };
  }, [bas, bit, yenile]);

  const gruplar = useMemo<NormGrubu[]>(() => {
    const kadroHaritasi = new Map<string, NormKadro[]>();
    kadro.forEach((k) => {
      const a = buyuk(k.subeKodu);
      if (!kadroHaritasi.has(a)) kadroHaritasi.set(a, []);
      kadroHaritasi.get(a)!.push(k);
    });

    if (normRapor) {
      return normRapor.satirlar.map((s) => ({
        subeKodu: s.subeKodu ?? "",
        subeAdi: s.subeAdi,
        bolge: s.bolge,
        norm: s.norm,
        mevcut: s.mevcut,
        eksik: (s.eksikler ?? []).reduce((t, x) => t + x.adet, 0),
        fazla: (s.fazlalar ?? []).reduce((t, x) => t + x.adet, 0),
        engelli: s.engelliCalisan ?? 0,
        raporlu: s.raporlu ?? 0,
        raporlular: s.raporlular ?? [],
        ayrilacak: s.ayrilacak ?? 0,
        ayrilacaklar: s.ayrilacaklar ?? [],
        acikPozisyonlar: (s.eksikler ?? []).map((x) => ({ bolum: x.bolum, adet: x.adet })),
        iseAlinan: iseAlinanSubeSayisi.get(buyuk(s.subeKodu)) ?? 0,
        satirlar: kadroHaritasi.get(buyuk(s.subeKodu)) ?? [],
      }));
    }

    /* Norm Kadro ucu alınamazsa kadro satırlarından gruplanır */
    return Array.from(kadroHaritasi.entries()).map(([kod, satirlar]) => ({
      subeKodu: satirlar[0]?.subeKodu ?? kod,
      subeAdi: satirlar[0]?.subeAdi ?? kod,
      norm: satirlar.reduce((t, x) => t + (x.norm ?? 0), 0),
      mevcut: satirlar.reduce((t, x) => t + (x.mevcutPersonel ?? 0), 0),
      eksik: satirlar.reduce((t, x) => t + (x.ihtiyac ?? 0), 0),
      fazla: satirlar.reduce((t, x) => t + (x.fazla ?? 0), 0),
      engelli: satirlar.reduce((t, x) => t + (x.engelli ?? 0), 0),
      raporlu: 0,
      raporlular: [],
      ayrilacak: 0,
      ayrilacaklar: [],
      acikPozisyonlar: satirlar.filter((x) => x.ihtiyac > 0).map((x) => ({ bolum: x.bolum, adet: x.ihtiyac })),
      iseAlinan: iseAlinanSubeSayisi.get(kod) ?? 0,
      satirlar,
    }));
  }, [normRapor, kadro, iseAlinanSubeSayisi]);

  const gorunen = useMemo(() => {
    if (suzgec === "eksik") return gruplar.filter((x) => x.eksik > 0);
    if (suzgec === "sorun") return gruplar.filter((x) => x.eksik > 0 || x.fazla > 0);
    return gruplar;
  }, [gruplar, suzgec]);

  const toplam = (f: (x: NormGrubu) => number) => gruplar.reduce((t, x) => t + f(x), 0);

  const ozet = normRapor
    ? {
        norm: normRapor.toplamNorm,
        mevcut: normRapor.toplamMevcut,
        eksik: normRapor.toplamEksik,
        fazla: normRapor.toplamFazla,
        engelli: normRapor.toplamEngelli,
        raporlu: normRapor.toplamRaporlu ?? 0,
        ayrilacak: normRapor.toplamAyrilacak ?? 0,
      }
    : {
        norm: toplam((x) => x.norm),
        mevcut: toplam((x) => x.mevcut),
        eksik: toplam((x) => x.eksik),
        fazla: toplam((x) => x.fazla),
        engelli: toplam((x) => x.engelli),
        raporlu: 0,
        ayrilacak: 0,
      };

  const donemIseGiren = toplam((x) => x.iseAlinan);
  const doluluk = ozet.norm > 0 ? Math.round((ozet.mevcut / ozet.norm) * 100) : 0;

  const pozisyonSutunlari = (grup: NormGrubu): ColumnsType<NormKadro> => [
    {
      title: "Pozisyon",
      dataIndex: "bolum",
      render: (v: string) => <span className="rr-ad">{v}</span>,
    },
    { title: "Norm", dataIndex: "norm", width: 72, align: "center", render: (v: number) => (v ? sayi(v) : <Tire />) },
    { title: "Mevcut", dataIndex: "mevcutPersonel", width: 78, align: "center", render: (v: number) => sayi(v) },
    {
      title: "Durum",
      key: "durum",
      width: 110,
      align: "center",
      render: (_v, k) =>
        k.ihtiyac > 0 ? (
          <span className="rr-rozet rr-r-turuncu">{sayi(k.ihtiyac)} eksik</span>
        ) : (k.fazla ?? 0) > 0 ? (
          <span className="rr-rozet rr-r-gri">+{sayi(k.fazla)} fazla</span>
        ) : (
          <span className="rr-rozet rr-r-yesil">Tam</span>
        ),
    },
    {
      title: "Engelli",
      dataIndex: "engelli",
      width: 74,
      align: "center",
      render: (v: number) => (v > 0 ? sayi(v) : <Tire />),
    },
    {
      title: "Başvuru",
      dataIndex: "basvuru",
      width: 84,
      align: "center",
      render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-mavi">{sayi(v)}</span> : <Tire />),
    },
    {
      title: "Havuzda",
      dataIndex: "olumlu",
      width: 84,
      align: "center",
      render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-yesil">{sayi(v)}</span> : <Tire />),
    },
    {
      title: "İşe giren",
      dataIndex: "iseAlinan",
      width: 90,
      align: "center",
      render: (v: number, k) =>
        v > 0 ? (
          <button
            type="button"
            className="rr-rozet rr-r-camgobegi"
            style={{ border: 0, cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              listeAc({
                baslik: `${grup.subeAdi} · ${k.bolum} · işe girenler`,
                alt: "işe giriş tarihi dönemde",
                birimTurusuz: true,
                parametreler: {
                  bolum: k.bolum,
                  iseGiris: "true",
                  ...(k.subeKodu ? { subeKodu: k.subeKodu } : {}),
                },
              });
            }}
          >
            {sayi(v)}
          </button>
        ) : (
          <Tire />
        ),
    },
  ];

  return (
    <>
      <Bolum
        id="rr-norm"
        ikon={<Users size={17} strokeWidth={2} />}
        baslik="Norm kadro"
        aciklama="Kadro sayıları Norm Kadro ekranıyla aynı kaynaktan (bugün itibarıyla, Mikro senkronu sonrası); başvuru ve işe giriş sayıları seçilen dönem için"
        sag={
          <button type="button" className="rr-btn rr-btn-ince" onClick={() => setYenile((x) => x + 1)} disabled={yukleniyor}>
            <RefreshCw size={14} strokeWidth={2} className={yukleniyor ? "rr-donen" : undefined} />
            Senkronla
          </button>
        }
      />

      {normHata && !normRapor && (
        <div className="rr-uyari-serit">
          <AlertTriangle size={16} strokeWidth={2} />
          <div>
            Norm Kadro verisine ulaşılamadı ({normHata}); kadro tablosundaki son senkron değerleri gösteriliyor.
            Raporlu ve ayrılacak bilgisi bu durumda gelmez.
          </div>
        </div>
      )}

      <div className="rr-kpi-satir rr-sekiz">
        <Kpi ad="Toplam norm" deger={sayi(ozet.norm)} alt="planlanan kadro" renk="#1c2419" />
        <Kpi
          ad="Mevcut personel"
          deger={sayi(ozet.mevcut)}
          alt={`normun %${doluluk}'i dolu`}
          renk="#2e6aa8"
          oran={doluluk}
        />
        <Kpi ad="Eksik personel" deger={sayi(ozet.eksik)} alt="pozisyon bazında" renk="#e8481c" />
        <Kpi
          ad="Fazla personel"
          deger={sayi(ozet.fazla)}
          alt="norm dışı / norm üstü"
          renk="#b77a00"
          ipucu="Fazla, eksikle aynı anda olabilir: bir şubede kasiyer eksikken manav fazlası bulunabilir; Norm Kadro ekranıyla aynı hesap"
        />
        <Kpi ad="Engelli çalışan" deger={sayi(ozet.engelli)} alt="mevcuda dahil" renk="#6d4bc2" />
        <Kpi
          ad="Raporlu"
          deger={sayi(ozet.raporlu)}
          alt="bugün sağlık raporlu"
          renk="#c41d7f"
          ipucu="Bugün sağlık raporlu olan çalışan; mevcuda dahildir, farkı değiştirmez"
        />
        <Kpi
          ad="Ayrılacak"
          deger={sayi(ozet.ayrilacak)}
          alt="çıkış tarihi ileri"
          renk="#a33410"
          ipucu="Çıkış tarihi ileri bir güne yazılmış personel; Norm Kadro ekranındaki kartla aynı sayı (hiçbir şubeye eşleşmeyenler dahil)"
        />
        <Kpi
          ad="Dönemde işe giren"
          deger={sayi(donemIseGiren)}
          alt="bu tablodaki birimler"
          renk="#0f766e"
          ipucu={`${donemMetni} arasında işe giriş tarihi olan alımlar`}
        />
      </div>

      <Kart
        baslik="Şube norm kadro ve ihtiyaç"
        ikon={<Users size={16} strokeWidth={2} />}
        alt={`${gorunen.length} / ${gruplar.length} birim`}
        sag={
          <div className="rr-seg">
            {(
              [
                ["sorun", "Eksik veya fazla"],
                ["eksik", "Eksik"],
                ["hepsi", "Tümü"],
              ] as const
            ).map(([d, ad]) => (
              <button key={d} type="button" className={suzgec === d ? "rr-aktif" : undefined} onClick={() => setSuzgec(d)}>
                {ad}
              </button>
            ))}
          </div>
        }
        sifir
        not="Şube satırını açarak pozisyon kırılımını, pozisyona tıklayarak o pozisyondaki personeli görebilirsiniz; dönemde gelen başvurular aynı pencereden açılır."
      >
        <Tablo<NormGrubu>
          rowKey={(k) => k.subeKodu || "__GENEL__"}
          size="small"
          loading={yukleniyor && gruplar.length === 0}
          dataSource={gorunen}
          pagination={false}
          scroll={{ x: 1120 }}
          locale={{
            emptyText: (
              <Bos
                metin={
                  gruplar.length === 0
                    ? "Norm kadro tanımı bulunamadı."
                    : "Bu süzgece uyan birim yok; kadrolar tam."
                }
              />
            ),
          }}
          expandable={{
            rowExpandable: (k) => k.satirlar.length > 0,
            expandedRowRender: (grup) => (
              <div className="rr-ic-tablo">
                <Tablo<NormKadro>
                  rowKey="kadroId"
                  size="small"
                  pagination={false}
                  dataSource={grup.satirlar}
                  rowClassName={() => "rr-tik"}
                  onRow={(k) => ({
                    onClick: () =>
                      setPozisyon({
                        subeAdi: grup.subeAdi,
                        subeKodu: k.subeKodu,
                        bolum: k.bolum,
                        norm: k.norm,
                        mevcut: k.mevcutPersonel,
                      }),
                  })}
                  columns={pozisyonSutunlari(grup)}
                />
              </div>
            ),
          }}
          columns={[
            {
              title: "Birim",
              dataIndex: "subeAdi",
              width: 200,
              render: (v: string, k) => (
                <div className="rr-ad">
                  {v}
                  <small>
                    {[k.bolge, `${k.satirlar.length} pozisyon`].filter(Boolean).join(" · ")}
                  </small>
                </div>
              ),
            },
            { title: "Norm", dataIndex: "norm", width: 70, align: "center", render: (v: number) => (v ? sayi(v) : <Tire />) },
            {
              title: "Mevcut",
              dataIndex: "mevcut",
              width: 78,
              align: "center",
              render: (v: number) => sayi(v),
            },
            {
              title: "Eksik",
              dataIndex: "eksik",
              width: 82,
              align: "center",
              sorter: (a, b) => a.eksik - b.eksik,
              defaultSortOrder: "descend",
              render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-turuncu">{sayi(v)}</span> : <Tire />),
            },
            {
              title: "Fazla",
              dataIndex: "fazla",
              width: 78,
              align: "center",
              sorter: (a, b) => a.fazla - b.fazla,
              render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-sari">+{sayi(v)}</span> : <Tire />),
            },
            {
              title: "Engelli",
              dataIndex: "engelli",
              width: 74,
              align: "center",
              render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-mor">{sayi(v)}</span> : <Tire />),
            },
            {
              title: "Raporlu",
              dataIndex: "raporlu",
              width: 78,
              align: "center",
              render: (v: number, k) =>
                v > 0 ? (
                  <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{k.raporlular.join("\n")}</span>}>
                    <span className="rr-rozet" style={{ background: "#fdeef6", color: "#c41d7f" }}>
                      {sayi(v)}
                    </span>
                  </Tooltip>
                ) : (
                  <Tire />
                ),
            },
            {
              title: "Ayrılacak",
              dataIndex: "ayrilacak",
              width: 84,
              align: "center",
              render: (v: number, k) =>
                v > 0 ? (
                  <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{k.ayrilacaklar.join("\n")}</span>}>
                    <span className="rr-rozet rr-r-kirmizi">{sayi(v)}</span>
                  </Tooltip>
                ) : (
                  <Tire />
                ),
            },
            {
              title: "Açık pozisyonlar",
              key: "acik",
              render: (_v, k) =>
                k.acikPozisyonlar.length === 0 ? (
                  <span className="rr-rozet rr-r-yesil">Kadro tam</span>
                ) : (
                  <div className="rr-cipler">
                    {k.acikPozisyonlar.slice(0, 4).map((x) => (
                      <span key={x.bolum} className="rr-cip">
                        <span>{x.bolum}</span>
                        <b>{sayi(x.adet)}</b>
                      </span>
                    ))}
                    {k.acikPozisyonlar.length > 4 && (
                      <span className="rr-rozet rr-r-gri">+{k.acikPozisyonlar.length - 4}</span>
                    )}
                  </div>
                ),
            },
            {
              title: "İşe giren",
              dataIndex: "iseAlinan",
              width: 86,
              align: "center",
              render: (v: number) => (v > 0 ? <span className="rr-rozet rr-r-camgobegi">{sayi(v)}</span> : <Tire />),
            },
          ]}
        />
      </Kart>

      <PozisyonPersoneli
        secim={pozisyon}
        kapat={() => setPozisyon(null)}
        basvurulariAc={(p) => {
          setPozisyon(null);
          listeAc({
            baslik: `${p.subeAdi} · ${p.bolum}`,
            alt: "dönemde gelen başvurular",
            birimTurusuz: true,
            parametreler: { bolum: p.bolum, ...(p.subeKodu ? { subeKodu: p.subeKodu } : {}) },
          });
        }}
      />
    </>
  );
}


/* ========================================================================== */
/* Sayfa                                                                       */
/* ========================================================================== */

type SekmeAnahtari = "basvuru" | "gecis" | "verimlilik";

/**
 * Raporlar sayfası.
 *
 * Bölge müdürü başvuru istatistiklerini de görür; sunucu tarafındaki şube
 * süzmesi verileri kendi şubeleriyle sınırlıyor. Ciro sekmesi kapalı:
 * mağaza cirosu bölge müdürünün yetkisi dışında.
 */
export default function Rapor() {
  const ciroGizli = bolgeMuduruMu(oturumOku());

  const sekmeler: { anahtar: SekmeAnahtari; ad: string; kisa: string; ikon: ReactNode }[] = [
    { anahtar: "basvuru", ad: "Başvuru raporu", kisa: "Başvuru", ikon: <BarChart3 size={15} strokeWidth={2} /> },
    { anahtar: "gecis", ad: "Günlük QR okutma", kisa: "QR okutma", ikon: <DoorOpen size={15} strokeWidth={2} /> },
    ...(ciroGizli
      ? []
      : [
          {
            anahtar: "verimlilik" as const,
            ad: "Personel başı ciro",
            kisa: "Ciro",
            ikon: <TrendingUp size={15} strokeWidth={2} />,
          },
        ]),
  ];

  const [aktif, setAktif] = useState<SekmeAnahtari>("basvuru");

  /* Açılmış sekmeler bellekte kalır (süzgeçleri kaybolmasın); açılmamış
     sekme hiç yüklenmez. */
  const [acilmis, setAcilmis] = useState<SekmeAnahtari[]>(["basvuru"]);

  const sec = (a: SekmeAnahtari) => {
    setAktif(a);
    setAcilmis((x) => (x.includes(a) ? x : [...x, a]));
  };

  const aciklama: Record<SekmeAnahtari, string> = {
    basvuru:
      "Başvuruların dönem özeti, dönüşüm, aylık seyir, işe alımlar, norm kadro ve kırılımlar; sayılar Başvurular ve Norm Kadro sayfalarıyla aynı tanımlarla hesaplanır.",
    gecis:
      "Seçilen günde QR okutan ve okutmayan personel; muaf, raporlu ve izinli olanlar okutma beklenenlere girmez (günlük okutma maili ile aynı).",
    verimlilik:
      "Şubelerin günlük cirosu mevcut personele ve norm kadroya bölünerek; kıyas dönemine göre değişimiyle.",
  };

  return (
    <div className="ik-icerik">
      <div className="rr">
        <div className="rr-baslik">
          <div>
            <h1>Raporlar</h1>
            <p>{aciklama[aktif]}</p>
          </div>
        </div>

        <div className="rr-sekmeler" role="tablist">
          {sekmeler.map((s) => (
            <button
              key={s.anahtar}
              type="button"
              role="tab"
              aria-selected={aktif === s.anahtar}
              className={aktif === s.anahtar ? "rr-aktif" : undefined}
              onClick={() => sec(s.anahtar)}
            >
              {s.ikon}
              <span className="rr-sekme-uzun">{s.ad}</span>
              <span className="rr-sekme-kisa">{s.kisa}</span>
            </button>
          ))}
        </div>

        {sekmeler.map((s) =>
          acilmis.includes(s.anahtar) ? (
            <div key={s.anahtar} role="tabpanel" hidden={aktif !== s.anahtar}>
              {s.anahtar === "basvuru" && <BasvuruRaporu />}
              {s.anahtar === "gecis" && <GecisRaporu />}
              {s.anahtar === "verimlilik" && <CiroVerimliligi />}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

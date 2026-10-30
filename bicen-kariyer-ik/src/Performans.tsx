/**
 * ---------------------------------------------------------------------------
 * İK Performans
 * ---------------------------------------------------------------------------
 * İK uzmanlarının seçilen dönemdeki işlem sayıları, dönüşümleri ve ortalama
 * tepki süreleri. Bölge bazında da özetlenir.
 *
 * Yalnızca yönetici rolündeki kullanıcılar erişebilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import {
  CalendarRange,
  Download,
  FileText,
  Gauge,
  MapPin,
  RefreshCw,
  ThumbsDown,
  Timer,
  TrendingUp,
  UserCircle2,
  Users,
} from "lucide-react";

import Tablo from "./Tablo";
import BasvuruDetayModal from "./BasvuruDetayModal";
import { api, durumRengi } from "./api";
import { RENK } from "./sabitler";
import { tabloIndir } from "./raporExcel";
import "./IkPerformans.css";
import IkTalepPerformans from "./IkTalepPerformans";

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

interface Uzman {
  kullaniciAdi: string;
  adSoyad: string;
  unvan: string;
  bolge: string;
  islem: number;
  inceleme: number;
  degerlendirme: number;
  gorusme: number;
  olumlu: number;
  evrakHazirlaniyor: number;
  iseAlinan: number;
  olumsuz: number;
  not: number;
  rotasyon: number;
  ortalamaDoldurmaDakika: number;
  eskiCalisanAlimi: number;
  ortalamaTalep: number;
  ortalamaAnlasilan: number;
  ucretliAlim: number;
  ortalamaTepkiSaat: number;
  ortalamaTepkiGun: number;
  enHizliSaat: number;
  enYavasSaat: number;
  ilgilenilenBasvuru: number;
  birimSayisi: number;
  sonuclanan: number;
  sonIslem: string | null;
}

interface Bolge {
  bolge: string;
  uzman: number;
  islem: number;
  inceleme: number;
  gorusme: number;
  olumlu: number;
  iseAlinan: number;
  olumsuz: number;
  sonuclanan: number;
  birimSayisi: number;
  ortalamaDoldurmaDakika: number;
  eskiCalisanAlimi: number;
  ortalamaTalep: number;
  ortalamaAnlasilan: number;
  ucretliAlim: number;
  ortalamaTepkiSaat: number;
}

/**
 * Süreyi okunur biçime çevirir.
 * 0.3 gün yerine "7 saat", 0.05 gün yerine "1 saat 12 dk" gösterilir.
 */
/**
 * Ücret alanındaki değeri sayıya çevirir.
 *
 * Alan serbest metin olduğu için adaylar farklı yazıyor: kimi "35.000",
 * kimi yalnızca "35" (35 bin kastederek), kimi "35000". Asgari ücretin
 * çok altındaki değerler bin cinsinden yazılmış sayılır ve 1000 ile
 * çarpılır; aksi hâlde "35 TL maaş" gibi anlamsız kayıtlar oluşuyor ve
 * pazarlık oranı hesaplanamıyordu.
 *
 * Eşik bilinçli olarak düşük tutuldu: gerçek bir aylık ücret hiçbir
 * durumda 1.000 TL'nin altında olmaz.
 */
const ucret = (deger: unknown): number => {
  const n = Number(deger);

  if (!Number.isFinite(n) || n <= 0) return 0;

  return n < 1000 ? n * 1000 : n;
};

/** Tutarı okunur biçimde yazar; boş ya da geçersizse tire döner. */
const tutar = (deger: unknown): string => {
  const n = ucret(deger);
  return n > 0 ? `${n.toLocaleString("tr-TR")} TL` : "—";
};

const sureMetni = (saat: number): string => {
  if (!saat || saat <= 0) return "—";

  if (saat < 1) {
    const dakika = Math.max(1, Math.round(saat * 60));
    return `${dakika} dakika`;
  }

  if (saat < 24) {
    const tam = Math.floor(saat);
    const dakika = Math.round((saat - tam) * 60);
    return dakika > 0 ? `${tam} saat ${dakika} dk` : `${tam} saat`;
  }

  const gun = Math.floor(saat / 24);
  const kalanSaat = Math.round(saat % 24);
  return kalanSaat > 0 ? `${gun} gün ${kalanSaat} saat` : `${gun} gün`;
};

/** Tepki süresine göre renk: hızlı yeşil, yavaş turuncu */
const tepkiRengi = (saat: number) => {
  if (saat <= 0) return "default";
  if (saat <= 4) return "green";
  if (saat <= 24) return "lime";
  if (saat <= 72) return "gold";
  return "orange";
};

/** Yatay oran çubuğu */
function Oran({ deger, toplam, renk }: { deger: number; toplam: number; renk: string }) {
  const oran = toplam > 0 ? Math.round((deger / toplam) * 100) : 0;
  return (
    <div className="rp-oran">
      <div className="rp-oran-cubuk">
        <div
          className="rp-oran-dolu"
          style={{ width: `${Math.min(100, oran)}%`, background: renk }}
        />
      </div>
      <span className="rp-oran-metin">%{oran}</span>
    </div>
  );
}

/** İK Performans: işe alım ve personel talepleri sekmeleri (21.10.2026) */
export default function Performans() {
  const [sekme, setSekme] = useState<"isealim" | "talep">(() => {
    try {
      return (localStorage.getItem("ikPerformansSekme") as any) === "talep" ? "talep" : "isealim";
    } catch {
      return "isealim";
    }
  });
  const sec = (k: "isealim" | "talep") => {
    setSekme(k);
    try {
      localStorage.setItem("ikPerformansSekme", k);
    } catch {
      /* yok sayılır */
    }
  };
  return (
    <div className="ik-icerik ip">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 20 }}>
          <Gauge size={18} strokeWidth={2.2} /> İK Performans
        </h2>
        <div className="ip-cipler">
          <button className={sekme === "isealim" ? "acik" : ""} onClick={() => sec("isealim")}>
            İşe alım
          </button>
          <button className={sekme === "talep" ? "acik" : ""} onClick={() => sec("talep")}>
            Personel talepleri
          </button>
        </div>
      </div>
      {sekme === "talep" ? <IkTalepPerformans /> : <IseAlimPerformansi />}
    </div>
  );
}

function IseAlimPerformansi() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [uzmanlar, setUzmanlar] = useState<Uzman[]>([]);
  const [bolgeler, setBolgeler] = useState<Bolge[]>([]);

  /* Özet sayılar sunucuda benzersiz hesaplanır; uzman satırlarını
     toplamak aynı başvuruyu birden çok kez sayıyordu. */
  const [ozetVerisi, setOzetVerisi] = useState<any>(null);
  const [genelTepki, setGenelTepki] = useState(0);

  /* Hiçbir bölgeye atanmamış şubeler; "Bölgesiz" kartının sebebi */
  const [bolgesizSubeler, setBolgesizSubeler] = useState<any[]>([]);
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(2, "month").startOf("month"),
    dayjs(),
  ]);

  /* Karta veya satıra tıklanınca açılan başvuru listesi */
  const [detay, setDetay] = useState<{
    baslik: string;
    alt: string;
    uzmanlar: string[];
  } | null>(null);
  const [liste, setListe] = useState<any[]>([]);
  const [listeYukleniyor, setListeYukleniyor] = useState(false);
  const [acikBasvuru, setAcikBasvuru] = useState<number | null>(null);

  /* Pozisyon bazında doldurma süreleri */
  const [doldurma, setDoldurma] = useState<any>(null);

  const [olumsuzlar, setOlumsuzlar] = useState<any>(null);

  /* Önceki eşit uzunluktaki dönem: kutulardaki "önceki döneme göre" kıyası */
  const [onceki, setOnceki] = useState<any>(null);
  const [oncekiDoldurma, setOncekiDoldurma] = useState<any>(null);

  const [uzSira, setUzSira] = useState<"ise" | "tepki" | "sonuc" | "basvuru">("ise");
  const [tabloGorunum, setTabloGorunum] = useState(false);
  const [hazirAralik, setHazirAralik] = useState<"ay" | "3ay" | "yil" | null>("3ay");

  /* Doldurma süresi ve olumsuz gerekçe kayıtlarının listesi */
  const [ekListe, setEkListe] = useState<{
    baslik: string;
    alt: string;
    tur: "doldurma" | "olumsuz";
    kayitlar: any[];
  } | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const sorgu = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
      });

      const sonuc = await api.al<{ uzmanlar: Uzman[]; bolgeler: Bolge[] }>(
        `/api/Rapor/Performans?${sorgu.toString()}`
      );

      setUzmanlar(sonuc.uzmanlar ?? []);
      setBolgeler(sonuc.bolgeler ?? []);
      setOzetVerisi(sonuc.ozet ?? null);
      setGenelTepki(Number(sonuc.genelTepkiSaat ?? 0));
      setBolgesizSubeler(sonuc.bolgesizSubeler ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    const sorgu = new URLSearchParams({
      bas: aralik[0].format("YYYY-MM-DD"),
      bit: aralik[1].format("YYYY-MM-DD"),
    });

    api
      .al<any>(`/api/Rapor/DoldurmaSureleri?${sorgu.toString()}`)
      .then(setDoldurma)
      .catch(() => setDoldurma(null));

    api
      .al<any>(`/api/Rapor/Olumsuzlar?${sorgu.toString()}`)
      .then(setOlumsuzlar)
      .catch(() => setOlumsuzlar(null));
  }, [aralik]);

  useEffect(() => {
    const gunSayisi = aralik[1].startOf("day").diff(aralik[0].startOf("day"), "day") + 1;
    const oBit = aralik[0].subtract(1, "day");
    const oBas = oBit.subtract(gunSayisi - 1, "day");
    const q = new URLSearchParams({ bas: oBas.format("YYYY-MM-DD"), bit: oBit.format("YYYY-MM-DD") });

    api.al<any>(`/api/Rapor/Performans?${q}`).then(setOnceki).catch(() => setOnceki(null));
    api.al<any>(`/api/Rapor/DoldurmaSureleri?${q}`).then(setOncekiDoldurma).catch(() => setOncekiDoldurma(null));
  }, [aralik]);

  /**
   * Kutu, huni, bölge ve uzman kartlarından açılan başvuru listesi.
   * Sayılar işlem geçmişinden hesaplandığı için liste de aynı ölçütle
   * sunucudan gelir; kutudaki sayı ile listedeki satır sayısı tutar.
   */
  const listeAc = async (
    baslik: string,
    alt: string,
    s: { asama?: string; bolge?: string; kullanici?: string; sirala?: "tepki" },
    sorumlular: string[] = []
  ) => {
    setDetay({ baslik, alt, uzmanlar: sorumlular });
    setListe([]);
    setPazarliklar([]);
    setListeYukleniyor(true);

    const temel = new URLSearchParams({
      bas: aralik[0].format("YYYY-MM-DD"),
      bit: aralik[1].format("YYYY-MM-DD"),
    });
    const q = new URLSearchParams(temel);
    if (s.asama) q.set("asama", s.asama);
    if (s.bolge) q.set("bolge", s.bolge);
    if (s.kullanici) q.set("kullanici", s.kullanici);

    try {
      let l = await api.al<any[]>(`/api/Rapor/PerformansListe?${q}`);
      if (s.sirala === "tepki")
        l = [...l].sort((a, b) => (b.tepkiSaat ?? -1) - (a.tepkiSaat ?? -1));
      setListe(l);

      if (s.kullanici && !s.kullanici.includes(",")) {
        try {
          const d = await api.al<any>(
            `/api/Rapor/Performans/${encodeURIComponent(s.kullanici)}?${temel}`
          );
          setPazarliklar(d.pazarliklar ?? []);
        } catch {
          setPazarliklar([]);
        }
      }
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setListeYukleniyor(false);
    }
  };

  /** Bölge veya uzman için başvuruları getirir */
  /* Seçili uzmanın ücret pazarlıkları */
  const [pazarliklar, setPazarliklar] = useState<any[]>([]);

  const detayAc = async (
    tur: "bolge" | "uzman",
    anahtar: string,
    baslik: string,
    alt: string,
    sorumlular: string[] = []
  ) => {
    setDetay({ baslik, alt, uzmanlar: sorumlular });
    setListeYukleniyor(true);

    try {
      const sorgu = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
      });

      if (tur === "bolge") sorgu.set("bolge", anahtar);
      if (tur === "uzman") sorgu.set("kullanici", anahtar);

      setListe(await api.al<any[]>(`/api/Rapor/Basvurular?${sorgu.toString()}`));

      /* Uzman detayında ücret pazarlıkları da gösterilir: tablodaki tek
         satırlık özet, hangi adayda ne kadar indirim yapıldığını
         göstermiyor. */
      if (tur === "uzman") {
        try {
          const d = await api.al<any>(
            `/api/Rapor/Performans/${encodeURIComponent(anahtar)}?${sorgu.toString()}`
          );
          setPazarliklar(d.pazarliklar ?? []);
        } catch {
          setPazarliklar([]);
        }
      } else {
        setPazarliklar([]);
      }
    } catch (hata: any) {
      message.error(hata.message);
      setListe([]);
    } finally {
      setListeYukleniyor(false);
    }
  };

  /**
   * Bölge kartına tıklanınca ilgili başvuruları açar.
   *
   * Tanımlı bölgelerde o bölgenin şubelerine gelen başvurular listelenir.
   * "Belirtilmemiş" kartında ise bölgesi olmayan uzmanların işlem yaptığı
   * başvurular gösterilir; çünkü bu grubun bağlı olduğu bir şube listesi yok.
   */
  const bolgeAc = (b: Bolge) => {
    if (b.bolge !== "Belirtilmemiş") {
      /* Bu bölgeden sorumlu uzmanlar başlıkta gösterilir */
      const sorumlular = uzmanlar
        .filter((x) =>
          (x.bolge ?? "")
            .split(",")
            .map((a) => a.trim())
            .includes(b.bolge)
        )
        .map((x) => x.adSoyad || x.kullaniciAdi);

      detayAc(
        "bolge",
        b.bolge,
        b.bolge,
        "Bölgedeki tüm başvurular",
        sorumlular
      );
      return;
    }

    const kullanicilar = uzmanlar
      .filter((x) => {
        const adlar = (x.bolge ?? "")
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a && a !== "Belirtilmemiş");
        return adlar.length === 0;
      })
      .map((x) => x.kullaniciAdi);

    if (kullanicilar.length === 0) {
      message.info("Bu grupta uzman bulunmuyor.");
      return;
    }

    detayAc(
      "uzman",
      kullanicilar.join(","),
      "Bölgesi Belirtilmemiş Uzmanlar",
      "Bu uzmanların işlem yaptığı başvurular",
      uzmanlar
        .filter((x) => kullanicilar.includes(x.kullaniciAdi))
        .map((x) => x.adSoyad || x.kullaniciAdi)
    );
  };

  const listeSutunlari: ColumnsType<any> = [
    {
      title: "Aday",
      dataIndex: "adSoyad",
      width: 200,
      fixed: "left",
      sorter: (a: any, b: any) =>
        (a.adSoyad ?? "").localeCompare(b.adSoyad ?? "", "tr"),
      render: (v: string, k: any) => (
        <div className="rp-aday">
          <Text strong>{v}</Text>
          <div className="rp-aday-no">{k.basvuruNo}</div>
        </div>
      ),
    },
    { title: "Telefon", dataIndex: "telefon", width: 125 },
    {
      title: "Birim",
      dataIndex: "subeAdi",
      width: 185,
      ellipsis: true,
      sorter: (a: any, b: any) =>
        (a.subeAdi ?? "").localeCompare(b.subeAdi ?? "", "tr"),
    },
    {
      title: "Pozisyon",
      dataIndex: "bolumler",
      width: 190,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v || "—"}</span>
        </Tooltip>
      ),
    },
    {
      title: "Ücret Beklentisi",
      dataIndex: "talepUcret",
      width: 145,
      render: (v: string) =>
        v ? <Tag color="gold">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Durum",
      dataIndex: "durum",
      width: 145,
      render: (v: string) => <Tag color={durumRengi(v)}>{v}</Tag>,
    },
    {
      title: "Tepki",
      dataIndex: "tepkiSaat",
      width: 120,
      sorter: (a: any, b: any) => (a.tepkiSaat ?? 0) - (b.tepkiSaat ?? 0),
      render: (v: number) =>
        v > 0 ? <Tag color={tepkiRengi(v)}>{sureMetni(v)}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Tarih",
      dataIndex: "olusturma",
      width: 110,
      render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
    },
    {
      title: "Son İşlemi Yapan",
      dataIndex: "guncelleyen",
      width: 165,
      render: (v: string, k: any) =>
        v ? (
          <div>
            <Text style={{ fontSize: 13 }}>{v}</Text>
            {k.guncelleme && (
              <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                {dayjs(k.guncelleme).format("DD.MM.YYYY HH:mm")}
              </div>
            )}
          </div>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      title: "",
      width: 110,
      render: (_v, k) => (
        <Button
          size="small"
          icon={<FileText size={14} strokeWidth={2} />}
          onClick={() => setAcikBasvuru(k.id)}
        >
          Formu gör
        </Button>
      ),
    },
  ];

  /* Özet sayılar sunucudan gelir. Uzman satırlarını toplamak yanlıştı:
     aynı başvuruya birden çok uzman dokunduğunda o başvuru her uzmanda
     sayılıyor ve toplam, sistemdeki başvuru sayısını aşıyordu. */
  const toplamIslem = Number(ozetVerisi?.ilgilenilen ?? 0);
  const toplamIseAlinan = Number(ozetVerisi?.iseAlinan ?? 0);
  const toplamGorusme = Number(ozetVerisi?.gorusme ?? 0);
  const toplamOlumsuz = Number(ozetVerisi?.olumsuz ?? 0);
  const ortalamaTepki = genelTepki;

  const toplamBasvuru = toplamIslem;

  const uzmanSutunlari: ColumnsType<Uzman> = [
    {
      title: "Uzman",
      dataIndex: "adSoyad",
      width: 200,
      fixed: "left",
      render: (v: string, k) => (
        <div>
          <Text strong>{v || k.kullaniciAdi}</Text>
          <div style={{ fontSize: 12, color: "#8a8f98" }}>
            {k.unvan || "İK Personeli"}
          </div>
        </div>
      ),
    },
    {
      title: "Bölge",
      dataIndex: "bolge",
      width: 170,
      render: (v: string) => {
        const adlar = (v ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x && x !== "Belirtilmemiş");

        if (adlar.length === 0) return <span style={{ color: "#bbb" }}>—</span>;

        return (
          <Space size={4} wrap>
            {adlar.map((x) => (
              <Tag key={x} color="blue" style={{ marginInlineEnd: 0 }}>
                {x}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: (
        <Tooltip title="Seçilen dönemde işlem yaptığı farklı başvuru sayısı. Aynı başvuruya kaç kez dokunulursa dokunulsun bir kez sayılır.">
          <span className="pf-baslik">Başvuru</span>
        </Tooltip>
      ),
      dataIndex: "ilgilenilenBasvuru",
      width: 105,
      align: "center",
      sorter: (a, b) => a.ilgilenilenBasvuru - b.ilgilenilenBasvuru,
      defaultSortOrder: "descend",
      render: (v: number) =>
        v ? <Tag color="blue">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: (
        <Tooltip title="İşlem yaptığı başvuruların ait olduğu farklı şube sayısı — kaç mağazadan başvuruyla ilgilendiği.">
          <span className="pf-baslik">Birim</span>
        </Tooltip>
      ),
      dataIndex: "birimSayisi",
      width: 90,
      align: "center",
      render: (v: number) => (
        <Tooltip title="İşlem yaptığı farklı şube/birim sayısı">
          <span>{v || "—"}</span>
        </Tooltip>
      ),
    },
    {
      title: (
        <Tooltip title="Başvuruyu inceleyip 'İncelendi' olarak işaretleme sayısı.">
          <span className="pf-baslik">İnceleme</span>
        </Tooltip>
      ),
      dataIndex: "inceleme",
      width: 100,
      align: "center",
      render: (v: number) =>
        v ? <Tag color="orange">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Görüşme",
      dataIndex: "gorusme",
      width: 100,
      align: "center",
      render: (v: number) =>
        v ? <Tag color="purple">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Olumlu",
      dataIndex: "olumlu",
      width: 95,
      align: "center",
      render: (v: number) =>
        v ? <Tag color="green">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "İşe Alınan",
      dataIndex: "iseAlinan",
      width: 105,
      align: "center",
      render: (v: number) =>
        v ? <Tag color="cyan">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: (
        <Tooltip title="Adayların ortalama ücret talebi ile anlaşılan ortalama ücret. Yeşil değer, talebin altında anlaşıldığını gösterir.">
          <span className="pf-baslik">Ücret Pazarlığı</span>
        </Tooltip>
      ),
      key: "ucret",
      width: 185,
      align: "center",
      sorter: (a, b) =>
        a.ortalamaAnlasilan - a.ortalamaTalep - (b.ortalamaAnlasilan - b.ortalamaTalep),
      render: (_v, k) => {
        if (!k.ortalamaTalep || !k.ortalamaAnlasilan) {
          return <span style={{ color: "#bbb" }}>—</span>;
        }

        const fark = k.ortalamaAnlasilan - k.ortalamaTalep;
        const yuzde = Math.round((fark / k.ortalamaTalep) * 100);

        return (
          <Tooltip
            title={`${k.ucretliAlim} işe alımın ortalaması · Talep ${k.ortalamaTalep.toLocaleString(
              "tr-TR"
            )} TL, anlaşılan ${k.ortalamaAnlasilan.toLocaleString("tr-TR")} TL`}
          >
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontSize: 12.5 }}>
                {k.ortalamaTalep.toLocaleString("tr-TR")} →{" "}
                <b>{k.ortalamaAnlasilan.toLocaleString("tr-TR")}</b>
              </div>
              <Tag
                color={fark > 0 ? "red" : fark < 0 ? "green" : "default"}
                style={{ marginInlineEnd: 0, marginTop: 2 }}
              >
                {fark > 0 ? "+" : ""}
                {yuzde}%
              </Tag>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: (
        <Tooltip title="İşe aldıklarından kaçı daha önce şirkette çalışmış. Kimlik numarası personel kayıtlarıyla karşılaştırılır.">
          <span className="pf-baslik">Eski Çalışan</span>
        </Tooltip>
      ),
      dataIndex: "eskiCalisanAlimi",
      width: 125,
      align: "center",
      sorter: (a, b) => a.eskiCalisanAlimi - b.eskiCalisanAlimi,
      render: (v: number, k) =>
        v > 0 ? (
          <Tooltip title={`${k.iseAlinan} işe alımın ${v} tanesi eski çalışan`}>
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              {v}
              {k.iseAlinan > 0 && (
                <span style={{ opacity: 0.75 }}>
                  {" "}
                  · %{Math.round((v / k.iseAlinan) * 100)}
                </span>
              )}
            </Tag>
          </Tooltip>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      title: "Olumsuz",
      dataIndex: "olumsuz",
      width: 100,
      align: "center",
      render: (v: number) =>
        v ? <Tag color="red">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: (
        <Tooltip title="Adayı başka bir birime yönlendirme sayısı.">
          <span className="pf-baslik">Rotasyon</span>
        </Tooltip>
      ),
      dataIndex: "rotasyon",
      width: 100,
      align: "center",
      render: (v: number) => (
        <Tooltip title="Adayı başka bir birime yönlendirme sayısı">
          <span>{v || "—"}</span>
        </Tooltip>
      ),
    },
    {
      title: "Not",
      dataIndex: "not",
      width: 80,
      align: "center",
      render: (v: number) => v || "—",
    },
    {
      title: (
        <Tooltip title="İlgilendiği başvurulardan kaçını sonuca bağladığı: olumlu, işe alındı veya olumsuz duruma getirdiği benzersiz başvuru sayısının oranı.">
          <span className="pf-baslik">Sonuçlandırma</span>
        </Tooltip>
      ),
      key: "sonuc",
      width: 165,
      render: (_v, k) => (
        <Tooltip
          title={`${k.sonuclanan} başvuru sonuçlandırıldı (olumlu, işe alınan veya olumsuz)`}
        >
          <div>
            <Oran
              deger={Math.min(k.sonuclanan, k.ilgilenilenBasvuru)}
              toplam={k.ilgilenilenBasvuru || 1}
              renk={RENK.yesil}
            />
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <Tooltip title="Açılan bir pozisyonun, işe alım yapılana kadar kaç gün açık kaldığının ortalaması. Norm kadroda eksiğin başladığı tarihten işe giriş tarihine kadar ölçülür.">
          <span className="pf-baslik">Ort. Doldurma</span>
        </Tooltip>
      ),
      dataIndex: "ortalamaDoldurmaDakika",
      width: 145,
      align: "center",
      sorter: (a, b) => a.ortalamaDoldurmaDakika - b.ortalamaDoldurmaDakika,
      render: (v: number) =>
        v > 0 ? (
          <Tag
            color={v <= 1440 * 15 ? "green" : v <= 1440 * 30 ? "gold" : "orange"}
          >
            {sureMetni(v / 60)}
          </Tag>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      title: (
        <Tooltip title="Başvurunun sisteme gelmesinden, bu kişinin aynı başvuruya ilk dokunuşuna kadar geçen sürelerin ortalaması. Kısa olması iyidir.">
          <span className="pf-baslik">Ort. Tepki</span>
        </Tooltip>
      ),
      dataIndex: "ortalamaTepkiSaat",
      width: 145,
      align: "center",
      sorter: (a, b) => a.ortalamaTepkiSaat - b.ortalamaTepkiSaat,
      render: (v: number, k) =>
        v > 0 ? (
          <Tooltip
            title={
              <span>
                Başvurunun sisteme gelmesinden bu kişinin o başvuruya ilk
                dokunuşuna kadar geçen ortalama süre.
                <br />
                En hızlı: {sureMetni(k.enHizliSaat)}
                <br />
                En yavaş: {sureMetni(k.enYavasSaat)}
              </span>
            }
          >
            <Tag color={tepkiRengi(v)}>{sureMetni(v)}</Tag>
          </Tooltip>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      title: "Son İşlem",
      dataIndex: "sonIslem",
      width: 135,
      render: (v: string) =>
        v ? (
          <Text style={{ fontSize: 12.5 }}>
            {dayjs(v).format("DD.MM.YYYY HH:mm")}
          </Text>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
  ];

  /* ------------------------------------------------ yeni yerleşim hesapları */
  const aralikQ = () =>
    new URLSearchParams({
      bas: aralik[0].format("YYYY-MM-DD"),
      bit: aralik[1].format("YYYY-MM-DD"),
    });

  const farkYaz = (su: number, on: number | undefined, tersi = false) => {
    if (!on || !su) return null;
    const f = Math.round(((su - on) * 100) / on);
    if (!f) return <span>önceki dönemle aynı</span>;
    const iyi = tersi ? f < 0 : f > 0;
    return (
      <span>
        <span className={`ip-fark ${iyi ? "ip-iyi" : "ip-kotu"}`}>
          {f > 0 ? "▲" : "▼"} %{Math.abs(f)}
        </span>{" "}
        önceki döneme göre
      </span>
    );
  };

  const oOzet = onceki?.ozet ?? {};
  const eskiToplam = uzmanlar.reduce((t, u) => t + (u.eskiCalisanAlimi || 0), 0);
  const enNeden = (olumsuzlar?.nedenler ?? [])[0];
  const doldurmaGun = doldurma?.ortalamaDakika ? doldurma.ortalamaDakika / 1440 : 0;
  const oDoldurmaGun = oncekiDoldurma?.ortalamaDakika ? oncekiDoldurma.ortalamaDakika / 1440 : 0;
  const gunYaz = (g: number) => (g ? `${g.toFixed(1).replace(".", ",")} gün` : "—");
  const yuzdeYaz = (a: number, b: number) => (b ? Math.round((a * 100) / b) : 0);

  const doldurmaKayitlari = (doldurma?.pozisyonlar ?? []).flatMap((p: any) =>
    (p.kayitlar ?? []).map((k: any) => ({ ...k, bolum: p.bolum }))
  );

  const AV_RENK = ["#5f8c10", "#1a5fb4", "#722ed1", "#e8481c", "#08979c", "#b7791f", "#c41d7f"];
  const avRengi = (s: string) => {
    let t = 0;
    for (const c of s ?? "") t = (t * 31 + c.charCodeAt(0)) >>> 0;
    return AV_RENK[t % AV_RENK.length];
  };
  const basHarf = (s: string) =>
    (s ?? "").split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("");

  const sonucOrani = (u: Uzman) =>
    u.ilgilenilenBasvuru ? Math.round((Math.min(u.sonuclanan, u.ilgilenilenBasvuru) * 100) / u.ilgilenilenBasvuru) : 0;
  const pazarlikOrani = (u: Uzman) =>
    u.ortalamaTalep > 0 && u.ortalamaAnlasilan > 0
      ? ((u.ortalamaAnlasilan - u.ortalamaTalep) * 100) / u.ortalamaTalep
      : null;

  const siraliUzmanlar = [...uzmanlar].sort((a, b) =>
    uzSira === "ise" ? b.iseAlinan - a.iseAlinan
    : uzSira === "tepki" ? (a.ortalamaTepkiSaat || 1e9) - (b.ortalamaTepkiSaat || 1e9)
    : uzSira === "sonuc" ? sonucOrani(b) - sonucOrani(a)
    : b.ilgilenilenBasvuru - a.ilgilenilenBasvuru
  );

  const hazirSec = (h: "ay" | "3ay" | "yil") => {
    setHazirAralik(h);
    setAralik(
      h === "ay" ? [dayjs().startOf("month"), dayjs()]
      : h === "3ay" ? [dayjs().subtract(2, "month").startOf("month"), dayjs()]
      : [dayjs().startOf("year"), dayjs()]
    );
  };

  const huni = [
    { ad: "Başvuru", asama: "ilgilenilen", deger: toplamIslem, renk: "#1a5fb4", alt: "" },
    { ad: "İncelendi", asama: "inceleme", deger: Number(ozetVerisi?.inceleme ?? 0), renk: "#3a7bd5", alt: "incelendi" },
    { ad: "Görüşme", asama: "gorusme", deger: toplamGorusme, renk: "#722ed1", alt: "görüşmeye" },
    { ad: "Olumlu", asama: "olumlu", deger: Number(ozetVerisi?.olumlu ?? 0), renk: "#7cb518", alt: "olumlu" },
    { ad: "İşe alındı", asama: "iseAlinan", deger: toplamIseAlinan, renk: "#08979c", alt: "işe başladı" },
  ];

  const ucretliUzmanlar = uzmanlar.filter((u) => u.ucretliAlim > 0 && u.ortalamaTalep > 0);
  const ucretMax = Math.max(1, ...ucretliUzmanlar.map((u) => Math.max(u.ortalamaTalep, u.ortalamaAnlasilan))) * 1.05;
  const ucretliToplam = ucretliUzmanlar.reduce((t, u) => t + u.ucretliAlim, 0);
  const agirlikli = (f: (u: Uzman) => number) =>
    ucretliToplam ? ucretliUzmanlar.reduce((t, u) => t + f(u) * u.ucretliAlim, 0) / ucretliToplam : 0;

  const pozisyonlar = [...(doldurma?.pozisyonlar ?? [])].sort(
    (a: any, b: any) => b.ortalamaDakika - a.ortalamaDakika
  );
  const pozMax = Math.max(1, ...pozisyonlar.map((p: any) => p.ortalamaDakika)) * 1.15;

  const olumsuzKayitlar: any[] = olumsuzlar?.kayitlar ?? [];

  /** Uzman özetini Excel olarak indirir */
  const excelIndir = () =>
    tabloIndir({
      baslik: "İK Performans",
      altBaslik: `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format("DD.MM.YYYY")}`,
      sayfaAdi: "Uzmanlar",
      dosyaAdi: `ik-performans-${aralik[0].format("YYYYMMDD")}-${aralik[1].format("YYYYMMDD")}`,
      genelToplam: true,
      sutunlar: [
        { ad: "Uzman", genislik: 24 },
        { ad: "Bölge", genislik: 24 },
        { ad: "Başvuru", tip: "sayi" },
        { ad: "İnceleme", tip: "sayi" },
        { ad: "Görüşme", tip: "sayi" },
        { ad: "Olumlu", tip: "sayi" },
        { ad: "İşe alınan", tip: "sayi", veriCubugu: true },
        { ad: "Eski çalışan", tip: "sayi" },
        { ad: "Olumsuz", tip: "sayi" },
        { ad: "Sonuçlandırma", tip: "yuzde", toplam: false, renkOlcegi: true },
        { ad: "Tepki (saat)", tip: "ondalik", toplam: false },
        { ad: "Doldurma (gün)", tip: "ondalik", toplam: false },
        { ad: "Ort. talep", tip: "para", toplam: false },
        { ad: "Ort. anlaşılan", tip: "para", toplam: false },
      ],
      satirlar: siraliUzmanlar.map((u) => [
        u.adSoyad || u.kullaniciAdi, u.bolge || "", u.ilgilenilenBasvuru, u.inceleme, u.gorusme, u.olumlu,
        u.iseAlinan, u.eskiCalisanAlimi, u.olumsuz, sonucOrani(u) / 100, u.ortalamaTepkiSaat || null,
        u.ortalamaDoldurmaDakika ? u.ortalamaDoldurmaDakika / 1440 : null, u.ortalamaTalep || null, u.ortalamaAnlasilan || null,
      ]),
    });

  return (
    <div className="ip">
      {/* ------------------------------------------------------------ başlık */}
      <div className="ip-baslik">
        <div>
          <h2>
            <i><Gauge size={17} strokeWidth={2.2} /></i>İşe alım
          </h2>
          <p>
            {aralik[0].format("DD.MM.YYYY")} – {aralik[1].format("DD.MM.YYYY")} ·
            İK uzmanlarının başvuru süreçlerindeki hızı ve sonuçları
          </p>
        </div>

        <Space wrap size={8}>
          <div className="ip-cipler">
            {([["ay", "Bu ay"], ["3ay", "Son 3 ay"], ["yil", "Bu yıl"]] as const).map(([k, t]) => (
              <button key={k} className={hazirAralik === k ? "acik" : ""} onClick={() => hazirSec(k)}>
                {t}
              </button>
            ))}
          </div>
          <RangePicker
            value={aralik}
            format="DD.MM.YYYY"
            allowClear={false}
            onChange={(d) => {
              if (!d) return;
              setHazirAralik(null);
              setAralik(d as [Dayjs, Dayjs]);
            }}
          />
          <Button loading={yukleniyor} icon={<RefreshCw size={15} strokeWidth={2} />} onClick={getir}>
            Yenile
          </Button>
          <Button icon={<Download size={15} strokeWidth={2} />} onClick={excelIndir}>
            Excel
          </Button>
        </Space>
      </div>

      {/* -------------------------------------------------------------- kutular */}
      <div className="ip-kpi">
        <button className="ip-k" style={{ ["--c" as any]: "#1a5fb4" }}
          onClick={() => listeAc("İlgilenilen başvurular", "Dönemde işlem yapılan tüm başvurular", { asama: "ilgilenilen" })}>
          <span>İlgilenilen başvuru</span>
          <b>{toplamIslem.toLocaleString("tr-TR")}</b>
          <small>{farkYaz(toplamIslem, Number(oOzet.ilgilenilen)) ?? "dönemde işlem yapılan başvuru"}</small>
        </button>

        <button className="ip-k" style={{ ["--c" as any]: "#722ed1" }}
          onClick={() => listeAc("Görüşmeye alınanlar", "Görüşme talebi yapılan başvurular", { asama: "gorusme" })}>
          <span>Görüşme</span>
          <b>{toplamGorusme.toLocaleString("tr-TR")}</b>
          <small>başvuruların %{yuzdeYaz(toplamGorusme, toplamIslem)}'i · {farkYaz(toplamGorusme, Number(oOzet.gorusme))}</small>
        </button>

        <button className="ip-k" style={{ ["--c" as any]: "#08979c", ["--c2" as any]: "#08979c" }}
          onClick={() => listeAc("İşe alınanlar", "Dönemde işe alınan adaylar", { asama: "iseAlinan" })}>
          <span>İşe alınan</span>
          <b>{toplamIseAlinan.toLocaleString("tr-TR")}</b>
          <small>
            görüşmelerin %{yuzdeYaz(toplamIseAlinan, toplamGorusme)}'i
            {eskiToplam > 0 && (
              <>
                {" · "}
                <span className="ip-etiket ip-e-mor"
                  onClick={(e) => {
                    e.stopPropagation();
                    listeAc("Eski çalışan alımları", "Daha önce şirkette çalışmış, yeniden işe alınanlar", { asama: "eskiCalisan" });
                  }}>
                  {eskiToplam} eski çalışan
                </span>
              </>
            )}
          </small>
        </button>

        <button className="ip-k" style={{ ["--c" as any]: "#e8481c" }}
          onClick={() => listeAc("Olumsuz değerlendirilenler", "Dönemde olumsuz sonuçlanan başvurular", { asama: "olumsuz" })}>
          <span>Olumsuz</span>
          <b>{toplamOlumsuz.toLocaleString("tr-TR")}</b>
          <small>
            %{yuzdeYaz(toplamOlumsuz, toplamIslem)}
            {enNeden && <> · en çok "{String(enNeden.neden).toLocaleLowerCase("tr")}"</>}
          </small>
        </button>

        <button className="ip-k"
          style={{ ["--c" as any]: RENK.yesil, ["--c2" as any]: ortalamaTepki <= 24 ? RENK.yesilKoyu : "#d46b08" }}
          onClick={() => listeAc("Tepki süreleri", "Başvurunun gelişinden ilk işleme kadar · en yavaş en üstte", { asama: "ilgilenilen", sirala: "tepki" })}>
          <span>Ortalama tepki</span>
          <b>{sureMetni(ortalamaTepki)}</b>
          <small>hedef 24 saat · {farkYaz(ortalamaTepki, Number(onceki?.genelTepkiSaat), true)}</small>
        </button>

        <button className="ip-k" style={{ ["--c" as any]: "#b7791f" }}
          onClick={() =>
            setEkListe({
              baslik: "Pozisyon doldurma süreleri",
              alt: "Dönemde işe alınanlar · en uzun süren en üstte",
              tur: "doldurma",
              kayitlar: [...doldurmaKayitlari].sort((a: any, b: any) => b.dakika - a.dakika),
            })
          }>
          <span>Pozisyon doldurma</span>
          <b>{gunYaz(doldurmaGun)}</b>
          <small>eksikten işe girişe · {farkYaz(doldurmaGun, oDoldurmaGun, true)}</small>
        </button>
      </div>

      {bolgesizSubeler.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`${bolgesizSubeler.length} şube hiçbir bölgeye atanmamış`}
          description={
            <div style={{ fontSize: 12.5 }}>
              Bu şubelerin başvuruları "Bölgesiz" altında toplanıyor. Yönetim → Form Ayarları → Bölgeler bölümünden atayabilirsiniz.{" "}
              <Space size={[6, 6]} wrap style={{ marginTop: 6 }}>
                {bolgesizSubeler.map((x: any) => (
                  <Tag key={x.kod} color="orange">
                    {x.ad}
                    <span style={{ opacity: 0.7 }}> · {x.basvuru} başvuru</span>
                  </Tag>
                ))}
              </Space>
            </div>
          }
        />
      )}

      <div className="ip-iki">
        {/* ------------------------------------------------------------ huni */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Başvuru hunisi</b>
              <small>Her başvuru bir kez sayılır · oranlar bir önceki aşamaya göre · aşamaya tıklayın</small>
            </div>
          </div>
          <div className="ip-huni">
            {huni.map((h, i) => (
              <div key={h.ad} className="ip-h"
                onClick={() => listeAc(`Huni: ${h.ad}`, `${h.ad} aşamasına gelen başvurular`, { asama: h.asama })}>
                <span className="ip-h-ad">{h.ad}</span>
                <div className="ip-h-cubuk">
                  <i style={{ width: `${Math.max(4, (h.deger * 100) / (toplamIslem || 1))}%`, background: h.renk }}>
                    {h.deger.toLocaleString("tr-TR")}
                  </i>
                </div>
                <span className="ip-h-oran">
                  <b>{i === 0 ? "—" : `%${yuzdeYaz(h.deger, huni[i - 1].deger)}`}</b>
                  {h.alt}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ----------------------------------------------------------- bölge */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Bölge bazında</b>
              <small>Başvurunun geldiği mağazanın bölgesine göre · satıra tıklayın</small>
            </div>
            <div className="ip-lej">
              <span><i style={{ background: "#08979c" }} />İşe alınan</span>
              <span><i style={{ background: "#7cb518" }} />Olumlu</span>
              <span><i style={{ background: "#b8a3e8" }} />Görüşme</span>
              <span><i style={{ background: "#f4a27f" }} />Olumsuz</span>
            </div>
          </div>

          {bolgeler.length === 0 ? (
            <div className="ip-bos">Seçilen dönemde işlem bulunmuyor.</div>
          ) : (
            bolgeler.map((b) => {
              const n = b.islem || 1;
              const p = (x: number) => `${Math.min(100, (x * 100) / n)}%`;
              return (
                <Tooltip key={b.bolge}
                  title={`${b.iseAlinan} işe alınan · ${b.olumlu} olumlu · ${b.gorusme} görüşme · ${b.olumsuz} olumsuz${b.ortalamaTepkiSaat > 0 ? ` · tepki ${sureMetni(b.ortalamaTepkiSaat)}` : ""}`}>
                  <div className="ip-bolge"
                    onClick={() => listeAc(b.bolge, "Bölgedeki mağazalara gelen başvurular", { bolge: b.bolge }, (b as any).uzmanlar ?? [])}>
                    <div>
                      <b>{b.bolge}</b>
                      <small>
                        {b.bolge === "Bölgesiz" && bolgesizSubeler.length > 0
                          ? `${bolgesizSubeler.length} şube bölgeye atanmamış`
                          : ((b as any).uzmanlar ?? []).join(" · ") || `${b.uzman} uzman`}
                      </small>
                    </div>
                    <div className="ip-yigin">
                      <i style={{ width: p(b.iseAlinan), background: "#08979c" }} />
                      <i style={{ width: p(Math.max(0, b.olumlu - b.iseAlinan)), background: "#7cb518" }} />
                      <i style={{ width: p(Math.max(0, b.gorusme - b.olumlu)), background: "#b8a3e8" }} />
                      <i style={{ width: p(b.olumsuz), background: "#f4a27f" }} />
                    </div>
                    <div className="ip-bolge-sag">
                      {b.islem.toLocaleString("tr-TR")}
                      <small><br />başvuru</small>
                    </div>
                  </div>
                </Tooltip>
              );
            })
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------- uzmanlar */}
      <div className="ip-panel" style={{ marginBottom: 14 }}>
        <div className="ip-pbas">
          <div>
            <b>Uzmanlar</b>
            <small>Karta tıklayınca işlem yaptığı başvurular ve ücret pazarlıkları açılır</small>
          </div>
          <Space wrap size={8}>
            <div className="ip-cipler">
              {([["ise", "İşe alım"], ["tepki", "Tepki hızı"], ["sonuc", "Sonuçlandırma"], ["basvuru", "Başvuru"]] as const).map(([k, t]) => (
                <button key={k} className={uzSira === k ? "acik" : ""} onClick={() => setUzSira(k)}>{t}</button>
              ))}
            </div>
            <Button size="small" onClick={() => setTabloGorunum(!tabloGorunum)}>
              {tabloGorunum ? "▦ Kart görünümü" : "☰ Tablo görünümü"}
            </Button>
          </Space>
        </div>

        {tabloGorunum ? (
          <Tablo<Uzman>
            rowKey="kullaniciAdi"
            size="small"
            loading={yukleniyor}
            columns={uzmanSutunlari}
            dataSource={siraliUzmanlar}
            pagination={false}
            scroll={{ x: 1860 }}
            rowClassName="rp-tiklanabilir"
            onRow={(k) => ({
              onClick: () =>
                listeAc(k.adSoyad || k.kullaniciAdi, "Bu uzmanın işlem yaptığı başvurular", { kullanici: k.kullaniciAdi }),
            })}
          />
        ) : siraliUzmanlar.length === 0 ? (
          <div className="ip-bos">Seçilen dönemde işlem yapan uzman yok.</div>
        ) : (
          <div className="ip-uzmanlar">
            {siraliUzmanlar.map((u, i) => {
              const pz = pazarlikOrani(u);
              const so = sonucOrani(u);
              return (
                <button key={u.kullaniciAdi} className="ip-uz"
                  onClick={() => listeAc(u.adSoyad || u.kullaniciAdi, "Bu uzmanın işlem yaptığı başvurular", { kullanici: u.kullaniciAdi })}>
                  <span className="ip-sira">#{i + 1}</span>
                  <div className="ip-uz-ust">
                    <div className="ip-av" style={{ background: avRengi(u.adSoyad || u.kullaniciAdi) }}>
                      {basHarf(u.adSoyad || u.kullaniciAdi)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <b>{u.adSoyad || u.kullaniciAdi}</b>
                      <small>{[u.unvan, u.bolge].filter(Boolean).join(" · ") || "—"}</small>
                    </div>
                  </div>
                  <div className="ip-sayilar">
                    <div><b>{u.ilgilenilenBasvuru}</b><span>Başvuru</span></div>
                    <div><b>{u.gorusme}</b><span>Görüşme</span></div>
                    <div><b style={{ color: "#08979c" }}>{u.iseAlinan}</b><span>İşe alım</span></div>
                    <div><b style={{ color: RENK.turuncu }}>{u.olumsuz}</b><span>Olumsuz</span></div>
                  </div>
                  <div className="ip-satir">
                    <span>Tepki süresi</span>
                    {u.ortalamaTepkiSaat > 0 ? <Tag color={tepkiRengi(u.ortalamaTepkiSaat)} style={{ marginInlineEnd: 0 }}>{sureMetni(u.ortalamaTepkiSaat)}</Tag> : <span>—</span>}
                  </div>
                  <div className="ip-satir">
                    <span>Ücret pazarlığı</span>
                    {pz === null ? <b>—</b> : (
                      <b className={pz <= 0 ? "ip-iyi" : "ip-kotu"}>
                        {pz > 0 ? "+" : "−"}%{Math.abs(pz).toFixed(1).replace(".", ",")}
                      </b>
                    )}
                  </div>
                  <div className="ip-satir">
                    <span>Doldurma süresi</span>
                    <b>{u.ortalamaDoldurmaDakika > 0 ? gunYaz(u.ortalamaDoldurmaDakika / 1440) : "—"}</b>
                  </div>
                  <div className="ip-satir">
                    <span>Sonuçlandırma{u.eskiCalisanAlimi > 0 && <span className="ip-etiket ip-e-mor" style={{ marginLeft: 6 }}>{u.eskiCalisanAlimi} eski</span>}</span>
                    <div className="ip-hal" data-v={`%${so}`}
                      style={{ background: `conic-gradient(${so >= 70 ? RENK.yesil : "#b7791f"} ${so}%, #edf0ea 0)` }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ip-uc">
        {/* ------------------------------------------------- pozisyon doldurma */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Pozisyon doldurma süresi</b>
              <small>Ortalama gün · çizgi en hızlı alım · pozisyona tıklayın</small>
            </div>
            {doldurma?.gecmiseDonuk > 0 && (
              <Tooltip title={`${doldurma.gecmiseDonuk} kayıt başvurusu açıldıktan bir saat içinde işe alınmış görünüyor (sonradan açılmış kayıt); ortalamaya alınmadı.`}>
                <span className="ip-etiket ip-e-sari">{doldurma.gecmiseDonuk} kayıt ölçüm dışı</span>
              </Tooltip>
            )}
          </div>
          {pozisyonlar.length === 0 ? (
            <div className="ip-bos">Seçilen dönemde işe alım yok.</div>
          ) : (
            pozisyonlar.map((p: any) => {
              const g = p.ortalamaDakika / 1440;
              const renk = g > 13 ? "#e8481c" : g > 10 ? "#f08a4b" : g > 8 ? "#d4a017" : "#7cb518";
              return (
                <Tooltip key={p.bolum}
                  title={`${p.adet} işe alım · en hızlı ${sureMetni(p.enHizli / 60)} · en yavaş ${sureMetni(p.enYavas / 60)}${(p.uzmanlar ?? []).length ? ` · ${p.uzmanlar.map((u: any) => `${u.adSoyad} (${u.adet})`).join(", ")}` : ""}`}>
                  <div className="ip-poz"
                    onClick={() => setEkListe({ baslik: `${p.bolum} · doldurma süreleri`, alt: `${p.adet} işe alım · ortalama ${gunYaz(g)}`, tur: "doldurma", kayitlar: (p.kayitlar ?? []).map((k: any) => ({ ...k, bolum: p.bolum })) })}>
                    <span>{p.bolum}</span>
                    <div className="ip-poz-bar">
                      <i style={{ width: `${(p.ortalamaDakika * 100) / pozMax}%`, background: renk }} />
                      <u style={{ left: `${(p.enHizli * 100) / pozMax}%` }} />
                    </div>
                    <b>{g.toFixed(1).replace(".", ",")} g</b>
                  </div>
                </Tooltip>
              );
            })
          )}
        </div>

        {/* ---------------------------------------------------- ücret pazarlığı */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Ücret pazarlığı</b>
              <small>Aday talebi (gri) ve anlaşılan ücret (yeşil) · uzmana tıklayın</small>
            </div>
          </div>
          {ucretliUzmanlar.length === 0 ? (
            <div className="ip-bos">Ücreti girilmiş işe alım yok.</div>
          ) : (
            <>
              {ucretliUzmanlar.map((u) => {
                const f = pazarlikOrani(u) ?? 0;
                return (
                  <Tooltip key={u.kullaniciAdi}
                    title={`${u.ucretliAlim} alım · talep ${tutar(u.ortalamaTalep)} · anlaşılan ${tutar(u.ortalamaAnlasilan)}`}>
                    <div className="ip-ucret"
                      onClick={() => listeAc(u.adSoyad || u.kullaniciAdi, "Ücret pazarlıkları ve işlem yaptığı başvurular", { kullanici: u.kullaniciAdi })}>
                      <span>{u.adSoyad || u.kullaniciAdi}</span>
                      <div className="ip-ucret-cubuk">
                        <i className="t" style={{ width: `${(u.ortalamaTalep * 100) / ucretMax}%` }} />
                        <i className="a" style={{ width: `${(u.ortalamaAnlasilan * 100) / ucretMax}%` }} />
                      </div>
                      <b className={f <= 0 ? "ip-iyi" : "ip-kotu"} style={{ textAlign: "right" }}>
                        {f > 0 ? "+" : "−"}%{Math.abs(f).toFixed(1).replace(".", ",")}
                      </b>
                    </div>
                  </Tooltip>
                );
              })}
              <div className="ip-alt">
                {toplamIseAlinan} işe alımın {ucretliToplam}'inde talep ve anlaşılan ücret girilmiş. Ortalama talep{" "}
                <b style={{ color: "#1f2933" }}>{tutar(agirlikli((u) => u.ortalamaTalep))}</b>, anlaşılan{" "}
                <b style={{ color: "#1f2933" }}>{tutar(agirlikli((u) => u.ortalamaAnlasilan))}</b>.
              </div>
            </>
          )}
        </div>

        {/* ---------------------------------------------------- olumsuzlar */}
        <div className="ip-panel">
          <div className="ip-pbas">
            <div>
              <b>Olumsuz değerlendirmeler</b>
              <small>Gerekçeler metinden gruplanır · gruba tıklayın</small>
            </div>
            {olumsuzKayitlar.length > 0 && (
              <span className="ip-etiket ip-e-tur" style={{ cursor: "pointer" }}
                onClick={() => setEkListe({ baslik: "Olumsuz değerlendirmeler", alt: "Tüm gerekçeler", tur: "olumsuz", kayitlar: olumsuzKayitlar })}>
                {olumsuzKayitlar.length} aday
              </span>
            )}
          </div>
          {(olumsuzlar?.nedenler ?? []).length === 0 ? (
            <div className="ip-bos">Seçilen dönemde olumsuz sonuçlanan başvuru yok.</div>
          ) : (
            <>
              {(olumsuzlar.nedenler as any[]).map((n, i) => (
                <div key={n.neden} className="ip-neden"
                  onClick={() => setEkListe({ baslik: `Olumsuz: ${n.neden}`, alt: `${n.adet} aday`, tur: "olumsuz", kayitlar: olumsuzKayitlar.filter((k) => k.nedenGrubu === n.neden) })}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ip-etiket ip-e-tur">{i + 1}</span>
                    {n.neden}
                  </span>
                  <span>
                    <span style={{ color: "#9aa3af", fontSize: 11.5, marginRight: 8 }}>
                      %{yuzdeYaz(n.adet, olumsuzlar.toplam || olumsuzKayitlar.length)}
                    </span>
                    <em>{n.adet}</em>
                  </span>
                </div>
              ))}
              <div className="ip-alt">
                En çok olumsuz:{" "}
                {(olumsuzlar.pozisyonlar ?? []).slice(0, 2).map((p: any, i: number) => (
                  <span key={p.bolum}>
                    {i > 0 && " ve "}
                    <span className="ip-bag"
                      onClick={() => setEkListe({ baslik: `Olumsuz: ${p.bolum}`, alt: "Pozisyona göre", tur: "olumsuz", kayitlar: olumsuzKayitlar.filter((k) => (k.bolum || "Belirtilmemiş") === p.bolum) })}>
                      {p.bolum}
                    </span>{" "}
                    ({p.adet})
                  </span>
                ))}
                {" · "}Uzmana göre:{" "}
                {(olumsuzlar.uzmanlar ?? []).slice(0, 3).map((u: any, i: number) => (
                  <span key={u.adSoyad}>
                    {i > 0 && ", "}
                    <span className="ip-bag"
                      onClick={() => setEkListe({ baslik: `Olumsuz · ${u.adSoyad}`, alt: `${u.adet} aday`, tur: "olumsuz", kayitlar: u.kayitlar ?? [] })}>
                      {u.adSoyad}
                    </span>{" "}
                    ({u.adet})
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* --------------------------------------- doldurma / olumsuz listesi */}
      <Drawer
        open={!!ekListe}
        onClose={() => setEkListe(null)}
        width="min(1080px, 96vw)"
        className="rp-cekmece"
        title={
          ekListe && (
            <Space wrap>
              <Text strong>{ekListe.baslik}</Text>
              <Tag color="blue">{ekListe.kayitlar.length} kayıt</Tag>
              <Text type="secondary" style={{ fontSize: 12.5 }}>{ekListe.alt}</Text>
            </Space>
          )
        }
      >
        {ekListe && (
          <Tablo
            rowKey="id"
            size="small"
            dataSource={ekListe.kayitlar}
            pagination={{ pageSize: 25, showSizeChanger: false }}
            rowClassName="rp-tiklanabilir"
            onRow={(k: any) => ({ onClick: () => setAcikBasvuru(k.id) })}
            scroll={{ x: 900 }}
            columns={
              ekListe.tur === "doldurma"
                ? [
                    { title: "Aday", dataIndex: "adSoyad", width: 190, render: (v: string) => <Text strong>{v}</Text> },
                    { title: "Pozisyon", dataIndex: "bolum", width: 150 },
                    { title: "Şube", dataIndex: "subeAdi", width: 170, ellipsis: true },
                    { title: "Bölge", dataIndex: "bolge", width: 130 },
                    {
                      title: "Süre", dataIndex: "dakika", width: 130,
                      sorter: (a: any, b: any) => a.dakika - b.dakika,
                      render: (v: number, k: any) => (
                        <Tooltip title={k.olcum === "kadro" ? "Norm kadroda eksiğin başladığı tarihten" : "Başvuru tarihinden (eksik başlangıcı bilinmiyor)"}>
                          <Tag color={v <= 1440 * 15 ? "green" : v <= 1440 * 30 ? "gold" : "orange"}>{sureMetni(v / 60)}</Tag>
                        </Tooltip>
                      ),
                    },
                    { title: "İşe giriş", dataIndex: "iseGirisTarihi", width: 110, render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—") },
                    { title: "İşe alan", dataIndex: "kullaniciAdSoyad" },
                  ]
                : [
                    { title: "Aday", dataIndex: "adSoyad", width: 180, render: (v: string) => <Text strong>{v}</Text> },
                    { title: "Telefon", dataIndex: "telefon", width: 125 },
                    { title: "Şube", dataIndex: "subeAdi", width: 160, ellipsis: true },
                    { title: "Pozisyon", dataIndex: "bolum", width: 130, ellipsis: true },
                    { title: "Grup", dataIndex: "nedenGrubu", width: 190, render: (v: string) => <Tag color="volcano">{v}</Tag> },
                    { title: "Gerekçe", dataIndex: "gerekce", ellipsis: true, render: (v: string) => <Tooltip title={v}><span>{v || "—"}</span></Tooltip> },
                    { title: "Tarih", dataIndex: "islemTarihi", width: 105, render: (v: string) => dayjs(v).format("DD.MM.YYYY") },
                    { title: "Uzman", dataIndex: "kullaniciAdSoyad", width: 150 },
                  ]
            }
          />
        )}
      </Drawer>

      {/* ------------------------------------------------- başvuru listesi */}
      <Drawer
        open={!!detay}
        onClose={() => {
          setDetay(null);
          setListe([]);
        }}
        width="min(1240px, 96vw)"
        className="rp-cekmece"
        title={
          detay && (
            <div>
              <Space wrap>
                <Text strong>{detay.baslik}</Text>
                <Tag color="blue">{liste.length} başvuru</Tag>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {detay.alt}
                </Text>
              </Space>

              {detay.uzmanlar.length > 0 && (
                <div className="pf-sorumlular">
                  <UserCircle2 size={14} strokeWidth={2} />
                  <span>Sorumlu uzman:</span>
                  {detay.uzmanlar.map((u) => (
                    <Tag key={u} color="green" style={{ marginInlineEnd: 0 }}>
                      {u}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          )
        }
      >
        {pazarliklar.length > 0 && (
          <Card
            size="small"
            style={{ marginBottom: 14 }}
            title={
              <Space size={8}>
                <Text strong style={{ fontSize: 13.5 }}>
                  Ücret Pazarlığı
                </Text>
                <Tag>{pazarliklar.length} anlaşma</Tag>
              </Space>
            }
          >
            <Tablo
              rowKey="basvuruId"
              size="small"
              pagination={false}
              dataSource={pazarliklar}
              scroll={{ y: 260 }}
              columns={[
                { title: "Aday", dataIndex: "adSoyad", width: 170 },
                { title: "Şube", dataIndex: "subeAdi", width: 150, ellipsis: true },
                {
                  title: "Talep",
                  dataIndex: "talep",
                  width: 110,
                  align: "right" as const,
                  render: (v: any) => tutar(v),
                },
                {
                  title: "Anlaşılan",
                  dataIndex: "anlasilan",
                  width: 110,
                  align: "right" as const,
                  render: (v: any) => <b>{tutar(v)}</b>,
                },
                {
                  title: "Fark",
                  key: "fark",
                  width: 110,
                  align: "right" as const,
                  render: (_v: any, k: any) => {
                    /* Her iki değer de bin çarpanı yorumundan geçer;
                       "35" yazan aday ile "35.000" yazan aynı ölçekte
                       karşılaştırılır. */
                    const t = ucret(k.talep);
                    const a = ucret(k.anlasilan);

                    if (t <= 0 || a <= 0) return "—";

                    /* Yorumdan sonra hâlâ on kattan fazla fark varsa
                       veri gerçekten tutarsızdır; oran gösterilmez. */
                    if (t > a * 10 || a > t * 10)
                      return (
                        <Tooltip title="Talep ve anlaşılan tutar birbirine çok uzak; ücret alanı hatalı girilmiş olabilir.">
                          <span style={{ color: "#bbb" }}>?</span>
                        </Tooltip>
                      );

                    const fark = a - t;

                    if (fark === 0) return <Tag>eşit</Tag>;

                    return (
                      <Tag color={fark < 0 ? "green" : "orange"}>
                        {fark > 0 ? "+" : ""}
                        {Math.round((fark / t) * 100)}%
                      </Tag>
                    );
                  },
                },
              ]}
            />
          </Card>
        )}

        <Tablo
          rowKey="id"
          size="small"
          loading={listeYukleniyor}
          columns={listeSutunlari}
          dataSource={liste}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1440 }}
        />
      </Drawer>

      {/* --------------------------------------------------- başvuru detayı */}
      <BasvuruDetayModal
        basvuruId={acikBasvuru}
        kapat={() => setAcikBasvuru(null)}
      />
    </div>
  );
}

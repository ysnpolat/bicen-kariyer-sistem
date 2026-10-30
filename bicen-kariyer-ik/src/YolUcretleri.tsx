/**
 * ---------------------------------------------------------------------------
 * Yol Ücretleri (Yönetim → Yol Ücretleri)
 * ---------------------------------------------------------------------------
 * Personel yol ücretleri Mikro'da tutulmuyor; İK elindeki Excel listesini
 * buradan toplu olarak aktarıyor. Kayıt personel koduna bağlı
 * (KRY_PERSONEL_YOL) ve Personeller → Excel çıktısında maaşın yanında
 * "Yol Ücreti" sütunu olarak görünüyor.
 *
 * Akış Yıllık İzin'deki toplu aktarımla aynı:
 *   1. Şablonu indir (kayıtlı ücretlerle dolu gelir; düzenleyip geri yükle),
 *   2. Excel'i seç — dosya tarayıcıda çözümlenir, sunucuya satırlar gider,
 *   3. Önizlemede her satırın durumu (eşleşti / bulunamadı / tutar hatalı /
 *      tekrar) ve mevcut tutarla farkı görülür,
 *   4. "Aktar" ile eşleşen satırlar yazılır. Dosyada olmayan personelin
 *      kaydına dokunulmaz.
 *
 * Sütun başlıkları esnek okunur: Sicil / Personel Kodu, TC / TC Kimlik No /
 * Kimlik No, Ad Soyad, Yol Ücreti / Tutar / Yol, Açıklama. Eşleştirme önce
 * sicille, yoksa TC ile yapılır; ada bakılmaz. Tutar Türkçe biçimde
 * ("1.250,50") de yazılabilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { Bus, Download, FileSpreadsheet, RefreshCw, Search, Trash2, Upload } from "lucide-react";

import { api, oturumOku, saltOkunur } from "./api";
import { tabloIndir } from "./raporExcel";
import { PersonelAdi } from "./personelKarti";

const { Text, Paragraph } = Typography;

/* -------------------------------------------------------------------------- */
/* Türler                                                                      */
/* -------------------------------------------------------------------------- */

interface Kayit {
  sicil: string;
  adSoyad: string | null;
  tc: string | null;
  sube: string | null;
  pozisyon: string | null;
  bulundu: boolean;
  calisiyor: boolean;
  /** Rol yetkisinde ücret gizliyse boş */
  tutar: number | null;
  aciklama: string | null;
  guncelleyen: string | null;
  guncelleme: string;
}

interface Liste {
  ucretGizli: boolean;
  toplam: number;
  toplamTutar: number | null;
  kayitlar: Kayit[];
}

/** Excel'den okunan satır; sunucuya bu gider */
interface DosyaSatiri {
  sira: number;
  sicil: string | null;
  tc: string | null;
  adSoyad: string | null;
  tutar: number | null;
  aciklama: string | null;
}

type Durum = "eslesti" | "bulunamadi" | "tutarHatali" | "tekrar";

interface OnizlemeSatiri {
  sira: number;
  durum: Durum;
  mesaj: string | null;
  dosyaSicil: string | null;
  dosyaTc: string | null;
  dosyaAdSoyad: string | null;
  sicil: string | null;
  adSoyad: string | null;
  tc: string | null;
  sube: string | null;
  pozisyon: string | null;
  calisiyor: boolean;
  tutar: number | null;
  mevcut: number | null;
  degisim: "yeni" | "degisti" | "ayni" | null;
}

interface Onizleme {
  toplam: number;
  eslesen: number;
  bulunamayan: number;
  tutarHatali: number;
  tekrar: number;
  yeni: number;
  degisen: number;
  ayni: number;
  satirlar: OnizlemeSatiri[];
}

/* -------------------------------------------------------------------------- */
/* Yardımcılar                                                                 */
/* -------------------------------------------------------------------------- */

const tl = (d?: number | null) =>
  d == null
    ? "—"
    : d.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

/** Başlık karşılaştırması: Türkçe harfler sadeleşir, harf ve rakam dışı atılır */
const sade = (m: unknown) =>
  String(m ?? "")
    .toLocaleUpperCase("tr")
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]/g, "");

/* Kabul edilen başlıklar (sadeleşmiş hâlleriyle) */
const BASLIKLAR: Record<keyof Omit<DosyaSatiri, "sira">, string[]> = {
  sicil: ["SICIL", "SICILNO", "PERSONELKODU", "PERKOD", "PERSONELNO", "PERSONELSICIL"],
  tc: ["TC", "TCNO", "TCKN", "TCKIMLIK", "TCKIMLIKNO", "TCKIMLIKNUMARASI", "KIMLIKNO", "KIMLIKNUMARASI"],
  adSoyad: ["ADSOYAD", "ADISOYADI", "ADSOYADI", "ADISOYAD", "PERSONEL", "PERSONELADI"],
  tutar: ["YOLUCRETI", "YOLUCRET", "YOL", "TUTAR", "YOLPARASI", "YOLTUTARI", "YOLUCRETITUTARI"],
  aciklama: ["ACIKLAMA", "NOT", "NOTLAR"],
};

/**
 * Tutar okuma. Excel sayı hücresi doğrudan gelir; metin hücrelerde Türkçe
 * biçim ("1.250,50", "1250,5", "1.250") ve İngilizce biçim ("1,250.50",
 * "1250.50") ayrılır: iki ayraç da varsa sondaki ondalıktır; yalnızca
 * virgül varsa ondalık; yalnızca nokta varsa üçlü gruplar binlik sayılır.
 */
const tutarOku = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  let m = String(v ?? "")
    .replace(/₺|TL|TRY/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!m) return null;

  const nokta = m.lastIndexOf(".");
  const virgul = m.lastIndexOf(",");

  if (nokta >= 0 && virgul >= 0) {
    m = virgul > nokta
      ? m.replace(/\./g, "").replace(",", ".")
      : m.replace(/,/g, "");
  } else if (virgul >= 0) {
    m = m.replace(/\./g, "").replace(",", ".");
  } else if (nokta >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(m)) {
    m = m.replace(/\./g, "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(m)) return null;

  const n = Number(m);
  return Number.isFinite(n) ? n : null;
};

/** Sicil ve TC: sayı hücresi bilimsel gösterime düşmesin */
const kodOku = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(0) : null;
  const m = String(v).trim();
  return m || null;
};

/**
 * Çalışma kitabından satırları çıkarır. Başlık satırı ilk 30 satırda,
 * tutar sütunu ile sicil ya da TC sütunu olan satır olarak aranır; ilk
 * sayfada yoksa diğer sayfalara bakılır.
 */
const kitaptanOku = (kitap: XLSX.WorkBook): { satirlar: DosyaSatiri[]; sayfa: string } => {
  for (const ad of kitap.SheetNames) {
    const hucreler = XLSX.utils.sheet_to_json<any[]>(kitap.Sheets[ad], {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    }) as any[][];

    for (let b = 0; b < Math.min(30, hucreler.length); b++) {
      const basliklar = (hucreler[b] ?? []).map(sade);

      const bul = (k: keyof typeof BASLIKLAR) =>
        basliklar.findIndex((h) => BASLIKLAR[k].includes(h));

      const iTutar = bul("tutar");
      const iSicil = bul("sicil");
      const iTc = bul("tc");

      if (iTutar < 0 || (iSicil < 0 && iTc < 0)) continue;

      const iAd = bul("adSoyad");
      const iAciklama = bul("aciklama");

      const al = (r: any[], i: number) => (i < 0 ? "" : r?.[i]);

      const satirlar = hucreler
        .slice(b + 1)
        .map((r, j): DosyaSatiri => ({
          /* Excel'deki satır numarası: başlık satırı + 1 + sıra + 1 */
          sira: b + j + 2,
          sicil: kodOku(al(r, iSicil)),
          tc: kodOku(al(r, iTc)),
          adSoyad: String(al(r, iAd) ?? "").trim() || null,
          tutar: tutarOku(al(r, iTutar)),
          aciklama: String(al(r, iAciklama) ?? "").trim() || null,
        }))
        /* Tamamen boş satırlar ve toplam satırları atlanır */
        .filter((x) => x.sicil || x.tc);

      return { satirlar, sayfa: ad };
    }
  }

  throw new Error(
    "Başlık satırı bulunamadı. Dosyada Sicil (ya da TC Kimlik No) ve Yol Ücreti (ya da Tutar) sütunları olmalı; şablonu kullanabilirsiniz."
  );
};

const DURUM_ETIKET: Record<Durum, { renk: string; ad: string }> = {
  eslesti: { renk: "green", ad: "Eşleşti" },
  bulunamadi: { renk: "red", ad: "Bulunamadı" },
  tutarHatali: { renk: "orange", ad: "Tutar hatalı" },
  tekrar: { renk: "default", ad: "Tekrar" },
};

/* -------------------------------------------------------------------------- */
/* Bileşen                                                                     */
/* -------------------------------------------------------------------------- */

export default function YolUcretleri() {
  const { message } = AntdApp.useApp();
  const yalnizOku = saltOkunur(oturumOku());

  const [veri, setVeri] = useState<Liste | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ara, setAra] = useState("");

  /* İçe aktarım */
  const [aktarAcik, setAktarAcik] = useState(false);
  const [dosyaSatirlari, setDosyaSatirlari] = useState<DosyaSatiri[]>([]);
  const [kaynak, setKaynak] = useState("");
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [onizSuzgec, setOnizSuzgec] = useState<"hepsi" | "eslesen" | "sorunlu">("hepsi");
  const [okunuyor, setOkunuyor] = useState(false);
  const [aktariliyor, setAktariliyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Liste>("/api/YolUcreti"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kayitlar = veri?.kayitlar ?? [];
  const q = ara.trim().toLocaleLowerCase("tr");

  const gorunen = useMemo(
    () =>
      !q
        ? kayitlar
        : kayitlar.filter((k) =>
            [k.sicil, k.adSoyad, k.tc, k.sube, k.pozisyon, k.aciklama]
              .some((d) => (d ?? "").toLocaleLowerCase("tr").includes(q))
          ),
    [kayitlar, q]
  );

  /* ------------------------------------------------------------ şablon */

  /* Şablon kayıtlı ücretlerle dolu gelir: tutarı değiştirip geri yüklemek
     yeterli. TC metin olarak yazılır ki Excel baştaki sıfırı ve haneleri
     bozmasın. */
  const sablonIndir = () => {
    const satirlar = kayitlar.map((k) => [
      k.sicil,
      k.tc && !k.tc.includes("•") ? k.tc : "",
      k.adSoyad ?? "",
      k.tutar ?? "",
      k.aciklama ?? "",
    ]);

    const sayfa = XLSX.utils.aoa_to_sheet([
      ["Sicil", "TC Kimlik No", "Ad Soyad", "Yol Ücreti", "Açıklama"],
      ...satirlar,
    ]);
    sayfa["!cols"] = [{ wch: 12 }, { wch: 15 }, { wch: 28 }, { wch: 12 }, { wch: 30 }];

    const kitap = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(kitap, sayfa, "Yol Ücretleri");
    XLSX.writeFile(kitap, `yol-ucreti-sablon-${dayjs().format("YYYY-MM-DD")}.xlsx`);
  };

  /* ------------------------------------------------------------ dışa aktar */

  const disaAktar = () => {
    if (gorunen.length === 0) {
      message.info("Dışa aktarılacak kayıt yok.");
      return;
    }

    tabloIndir({
      baslik: "Personel Yol Ücretleri",
      altBaslik: `${gorunen.length} personel · ${dayjs().format("DD.MM.YYYY")}`,
      sayfaAdi: "Yol Ücretleri",
      dosyaAdi: "yol-ucretleri",
      genelToplam: true,
      sutunlar: [
        { ad: "Sicil", genislik: 11 },
        { ad: "TC Kimlik No", genislik: 14 },
        { ad: "Ad Soyad", genislik: 28 },
        { ad: "Şube", genislik: 24 },
        { ad: "Pozisyon", genislik: 22 },
        { ad: "Yol Ücreti", tip: "para", genislik: 14 },
        { ad: "Açıklama", genislik: 28 },
        { ad: "Güncelleyen", genislik: 18 },
        { ad: "Güncelleme", tip: "tarihSaat" },
      ],
      satirlar: gorunen.map((k) => [
        k.sicil,
        k.tc ?? "",
        k.adSoyad ?? "",
        k.sube ?? "",
        k.pozisyon ?? "",
        k.tutar,
        k.aciklama ?? "",
        k.guncelleyen ?? "",
        k.guncelleme ?? null,
      ]),
    }).catch((h) => message.error(h?.message ?? "Excel oluşturulamadı."));
  };

  /* ------------------------------------------------------------ içe aktar */

  const aktarKapat = () => {
    setAktarAcik(false);
    setDosyaSatirlari([]);
    setOnizleme(null);
    setKaynak("");
    setOnizSuzgec("hepsi");
  };

  const dosyaOku = async (dosya: File) => {
    setOkunuyor(true);
    setOnizleme(null);
    setDosyaSatirlari([]);

    try {
      /* CSV'yi Türkçe Windows (1254) kaydeder; Excel biçimlerinde sorun yok */
      const csvMi = /\.(csv|txt)$/i.test(dosya.name);

      const kitap = XLSX.read(await dosya.arrayBuffer(), {
        type: "array",
        raw: true,
        ...(csvMi ? { codepage: 1254 } : {}),
      });

      const { satirlar, sayfa } = kitaptanOku(kitap);

      if (satirlar.length === 0) throw new Error("Dosyada aktarılacak satır yok.");

      setKaynak(`${dosya.name} · ${sayfa}`);
      setDosyaSatirlari(satirlar);
      setOnizleme(await api.gonder<Onizleme>("/api/YolUcreti/Onizleme", satirlar));
    } catch (h: any) {
      message.error(h?.message ?? "Dosya okunamadı.");
    } finally {
      setOkunuyor(false);
    }
  };

  const aktarUygula = async () => {
    if (!onizleme || onizleme.eslesen === 0) {
      message.warning("Aktarılabilecek satır yok.");
      return;
    }

    setAktariliyor(true);

    try {
      /* Sunucu eşleştirmeyi baştan yapar; dosyadaki satırlar aynen gider */
      const d = await api.gonder<any>("/api/YolUcreti/Aktar", dosyaSatirlari);

      message.success(
        `${d.yazilan} personelin yol ücreti kaydedildi` +
          ` (${d.yeni} yeni, ${d.guncellenen} güncellendi` +
          (d.atlanan ? `, ${d.atlanan} satır atlandı` : "") +
          ")."
      );
      aktarKapat();
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setAktariliyor(false);
    }
  };

  const sil = async (k: Kayit) => {
    try {
      await api.sil(`/api/YolUcreti/${encodeURIComponent(k.sicil)}`);
      message.success("Yol ücreti kaydı silindi.");
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  /* ------------------------------------------------------------ tablolar */

  const sutunlar: ColumnsType<Kayit> = [
    {
      title: "Sicil",
      dataIndex: "sicil",
      width: 90,
      sorter: (a, b) => a.sicil.localeCompare(b.sicil, "tr", { numeric: true }),
    },
    {
      title: "Ad Soyad",
      dataIndex: "adSoyad",
      render: (v, k) =>
        !k.bulundu ? (
          <Tooltip title="Bu sicil personel listesinde yok">
            <Text type="danger">Personel bulunamadı</Text>
          </Tooltip>
        ) : (
          <Space size={6}>
            <Text strong><PersonelAdi kod={k.sicil}>{v}</PersonelAdi></Text>
            {!k.calisiyor && <Tag color="default">ayrıldı</Tag>}
          </Space>
        ),
      sorter: (a, b) => (a.adSoyad ?? "").localeCompare(b.adSoyad ?? "", "tr"),
    },
    { title: "TC Kimlik No", dataIndex: "tc", width: 130, render: (v) => v || "—" },
    {
      title: "Şube",
      dataIndex: "sube",
      render: (v) => v || "—",
      sorter: (a, b) => (a.sube ?? "").localeCompare(b.sube ?? "", "tr"),
    },
    { title: "Pozisyon", dataIndex: "pozisyon", render: (v) => v || "—" },
    {
      title: "Yol Ücreti",
      dataIndex: "tutar",
      align: "right",
      width: 120,
      render: (v) => (veri?.ucretGizli ? <Text type="secondary">gizli</Text> : <b>{tl(v)}</b>),
      sorter: (a, b) => (a.tutar ?? 0) - (b.tutar ?? 0),
    },
    {
      title: "Güncelleyen",
      key: "guncelleyen",
      width: 170,
      render: (_v, k) => (
        <span style={{ fontSize: 12 }}>
          {k.guncelleyen || "—"}
          <br />
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            {k.guncelleme ? dayjs(k.guncelleme).format("DD.MM.YYYY HH:mm") : ""}
          </Text>
        </span>
      ),
      sorter: (a, b) => (a.guncelleme ?? "").localeCompare(b.guncelleme ?? ""),
    },
    ...(yalnizOku
      ? []
      : [
          {
            title: "",
            key: "islem",
            width: 50,
            render: (_v: unknown, k: Kayit) => (
              <Popconfirm
                title="Yol ücreti kaydı silinsin mi?"
                okText="Sil"
                cancelText="Vazgeç"
                okButtonProps={{ danger: true }}
                onConfirm={() => sil(k)}
              >
                <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
              </Popconfirm>
            ),
          },
        ]),
  ];

  const onizSatirlari = useMemo(() => {
    const l = onizleme?.satirlar ?? [];
    if (onizSuzgec === "eslesen") return l.filter((x) => x.durum === "eslesti");
    if (onizSuzgec === "sorunlu") return l.filter((x) => x.durum !== "eslesti");
    return l;
  }, [onizleme, onizSuzgec]);

  const onizSutunlari: ColumnsType<OnizlemeSatiri> = [
    { title: "Satır", dataIndex: "sira", width: 60 },
    {
      title: "Dosyada",
      key: "dosya",
      render: (_v, x) => (
        <span style={{ fontSize: 12 }}>
          {x.dosyaAdSoyad || "—"}
          <br />
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            {[x.dosyaSicil && `Sicil ${x.dosyaSicil}`, x.dosyaTc && `TC ${x.dosyaTc}`]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Text>
        </span>
      ),
    },
    {
      title: "Eşleşen personel",
      key: "kisi",
      render: (_v, x) =>
        x.sicil ? (
          <span style={{ fontSize: 12 }}>
            <b><PersonelAdi kod={x.sicil}>{x.adSoyad}</PersonelAdi></b>
            {!x.calisiyor && (
              <Tag color="default" style={{ marginLeft: 6 }}>
                ayrıldı
              </Tag>
            )}
            <br />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {x.sicil} · {x.sube || "—"}
            </Text>
          </span>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Yol Ücreti",
      dataIndex: "tutar",
      align: "right",
      width: 130,
      render: (v, x) => (
        <span>
          <b>{tl(v)}</b>
          {x.degisim === "degisti" && x.mevcut != null && (
            <>
              <br />
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                önceki {tl(x.mevcut)}
              </Text>
            </>
          )}
        </span>
      ),
    },
    {
      title: "Durum",
      key: "durum",
      width: 230,
      render: (_v, x) => (
        <span>
          <Tag color={DURUM_ETIKET[x.durum].renk}>{DURUM_ETIKET[x.durum].ad}</Tag>
          {x.degisim === "yeni" && <Tag color="blue">yeni</Tag>}
          {x.degisim === "degisti" && <Tag color="gold">değişti</Tag>}
          {x.degisim === "ayni" && <Tag>aynı</Tag>}
          {x.mesaj && (
            <div>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                {x.mesaj}
              </Text>
            </div>
          )}
        </span>
      ),
    },
  ];

  /* ------------------------------------------------------------ çizim */

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <Bus size={18} /> Yol Ücretleri
          </h3>
          <Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 13, maxWidth: 720 }}>
            Personel yol ücretleri Excel ile toplu aktarılır. Kayıtlı ücretler
            Personeller → Excel çıktısında maaşın yanında görünür. Dosyada
            olmayan personelin kaydı değişmez.
          </Paragraph>
        </div>

        <Space wrap>
          <Button icon={<RefreshCw size={14} />} onClick={getir} loading={yukleniyor}>
            Yenile
          </Button>
          <Button icon={<Download size={14} />} onClick={sablonIndir}>
            Şablon indir
          </Button>
          {!yalnizOku && (
            <Button type="primary" icon={<Upload size={14} />} onClick={() => setAktarAcik(true)}>
              Excel'den içe aktar
            </Button>
          )}
          <Button icon={<FileSpreadsheet size={14} />} onClick={disaAktar}>
            Excel'e aktar
          </Button>
        </Space>
      </div>

      {veri?.ucretGizli && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Rol yetkinizde ücret bilgisi gizli; tutarlar gösterilmiyor."
        />
      )}

      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<Search size={14} />}
          placeholder="Ad, sicil, TC, şube ya da pozisyon"
          value={ara}
          onChange={(e) => setAra(e.target.value)}
          style={{ width: 320 }}
        />
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {gorunen.length} personel
          {!veri?.ucretGizli && (
            <>
              {" · toplam "}
              <b>{tl(gorunen.reduce((t, k) => t + (k.tutar ?? 0), 0))}</b>
            </>
          )}
        </Text>
      </Space>

      <Table<Kayit>
        rowKey="sicil"
        size="small"
        loading={yukleniyor}
        columns={sutunlar}
        dataSource={gorunen}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500] }}
        scroll={{ x: 900 }}
        locale={{ emptyText: "Kayıtlı yol ücreti yok. Excel'den içe aktarabilirsiniz." }}
      />

      {/* ------------------------------------------------ Excel aktarımı */}
      <Modal
        open={aktarAcik}
        onCancel={aktarKapat}
        onOk={aktarUygula}
        okText={`Aktar (${onizleme?.eslesen ?? 0})`}
        cancelText="Vazgeç"
        confirmLoading={aktariliyor}
        okButtonProps={{ disabled: !onizleme || onizleme.eslesen === 0 }}
        width="min(1100px, 96vw)"
        title="Excel'den yol ücreti aktar"
        destroyOnClose
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 12 }}>
          .xlsx, .xls ya da CSV yükleyin. Okunan sütunlar: <b>Sicil</b> (ya da
          Personel Kodu), <b>TC Kimlik No</b>, Ad Soyad, <b>Yol Ücreti</b> (ya da
          Tutar / Yol) ve isteğe bağlı Açıklama. Eşleştirme önce sicille, sicil
          yoksa TC kimlik numarasıyla yapılır; ada bakılmaz. Tutar "1.250,50"
          gibi Türkçe biçimde de yazılabilir. Aynı personel dosyada iki kez
          geçerse ilk satır alınır.
        </Paragraph>

        <Space wrap style={{ marginBottom: 14 }}>
          <Button icon={<Download size={14} />} onClick={sablonIndir}>
            Şablonu indir
          </Button>

          <Button
            type="primary"
            icon={<Upload size={14} />}
            loading={okunuyor}
            onClick={() => document.getElementById("yol-ucreti-dosya")?.click()}
          >
            Dosya seç
          </Button>

          <input
            id="yol-ucreti-dosya"
            type="file"
            accept=".xlsx,.xlsm,.xls,.xlsb,.csv,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              const d = e.target.files?.[0];
              if (d) dosyaOku(d);
              e.target.value = "";
            }}
          />

          {onizleme && (
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {kaynak && <>{kaynak} · </>}
              {onizleme.toplam} satır okundu ·{" "}
              <b style={{ color: "#5f8c10" }}>{onizleme.eslesen} aktarılacak</b>
              {onizleme.eslesen > 0 && (
                <>
                  {" "}({onizleme.yeni} yeni, {onizleme.degisen} değişen, {onizleme.ayni} aynı)
                </>
              )}
              {onizleme.toplam - onizleme.eslesen > 0 && (
                <>
                  {" · "}
                  <b style={{ color: "#cf1322" }}>
                    {onizleme.toplam - onizleme.eslesen} atlanacak
                  </b>
                </>
              )}
            </Text>
          )}
        </Space>

        {onizleme && (
          <>
            <Space wrap style={{ marginBottom: 10 }}>
              <Segmented
                size="small"
                value={onizSuzgec}
                onChange={(v) => setOnizSuzgec(v as any)}
                options={[
                  { value: "hepsi", label: `Tümü (${onizleme.toplam})` },
                  { value: "eslesen", label: `Eşleşen (${onizleme.eslesen})` },
                  {
                    value: "sorunlu",
                    label: `Sorunlu (${onizleme.toplam - onizleme.eslesen})`,
                  },
                ]}
              />
              {onizleme.bulunamayan > 0 && (
                <Tag color="red">{onizleme.bulunamayan} bulunamadı</Tag>
              )}
              {onizleme.tutarHatali > 0 && (
                <Tag color="orange">{onizleme.tutarHatali} tutar hatalı</Tag>
              )}
              {onizleme.tekrar > 0 && <Tag>{onizleme.tekrar} tekrar</Tag>}
            </Space>

            <Table<OnizlemeSatiri>
              rowKey="sira"
              size="small"
              columns={onizSutunlari}
              dataSource={onizSatirlari}
              pagination={{ pageSize: 100, showSizeChanger: false }}
              scroll={{ x: 800, y: 420 }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

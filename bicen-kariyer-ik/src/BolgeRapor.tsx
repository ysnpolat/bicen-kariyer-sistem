/**
 * ---------------------------------------------------------------------------
 * Bölge Norm Raporu
 * ---------------------------------------------------------------------------
 * Norm kadro durumunu birim türü (Şubeler, Merkez, Depo) ve bölge bazında
 * özetler. Maliyet, norm fazlası ile eksiği arasındaki farkın kişi başı
 * maliyetle çarpımıdır:
 *
 *     maliyet = (fazla personel − eksik personel) × kişi maliyeti
 *
 * Ayrıca her gün paylaşılan bilgilendirme mesajını hazır metin olarak üretir.
 *
 * Raporlu (03.10.2026): bugün sağlık raporlu çalışan sayısı. Mevcuda dahil,
 * yalnızca bilgi; eksik, fazla ve maliyeti değiştirmez.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Row,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import {
  Copy,
  FileDown,
  FileSpreadsheet,
  ImageDown,
  MessageCircle,
  RefreshCw,
} from "lucide-react";

import {
  excelOlarakIndir,
  gorselOlarakIndir,
  pdfOlarakIndir,
  tarihDamgasi,
} from "./disaAktar";

import Tablo from "./Tablo";
import { api } from "./api";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface Satir {
  ad: string;
  tur: string;
  sorumlular: string[];
  norm: number;
  mevcut: number;
  eksik: number;
  fazla: number;
  engelli: number;
  /** Bugün raporlu çalışan (kişi); mevcuda dahil */
  raporlu?: number;
  birimSayisi: number;
}

interface FazlaDetay {
  sube: string;
  pozisyonlar: string;
}

interface Veri {
  turSatirlari: Satir[];
  bolgeSatirlari: Satir[];
  fazlaDetay: FazlaDetay[];
  toplam: {
    norm: number;
    mevcut: number;
    eksik: number;
    fazla: number;
    engelli: number;
    raporlu?: number;
    partTime: number;
    birimSayisi: number;
  };
}

const BOS: Veri = {
  turSatirlari: [],
  bolgeSatirlari: [],
  fazlaDetay: [],
  toplam: {
    norm: 0,
    mevcut: 0,
    eksik: 0,
    fazla: 0,
    engelli: 0,
    raporlu: 0,
    partTime: 0,
    birimSayisi: 0,
  },
};

/** Ondalık sayıyı Türkçe biçimde yazar */
const sayi = (deger: number): string =>
  deger === null || deger === undefined
    ? "—"
    : Number.isInteger(deger)
    ? String(deger)
    : deger.toFixed(1).replace(".", ",");

/** Para birimi biçimi */
const para = (deger: number): string =>
  `${deger < 0 ? "-" : ""}₺${Math.abs(deger).toLocaleString("tr-TR")}`;

const MALIYET_ANAHTARI = "bicen-kisi-maliyeti";

export default function BolgeRapor() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<Veri>(BOS);
  const [maliyet, setMaliyet] = useState<number>(() => {
    const kayitli = window.localStorage.getItem(MALIYET_ANAHTARI);
    return kayitli ? Number(kayitli) || 35000 : 35000;
  });
  const [mesaj, setMesaj] = useState("");
  const [aktariliyor, setAktariliyor] = useState<"" | "pdf" | "gorsel" | "excel">("");

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Veri>("/api/Havuz/BolgeRapor"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    window.localStorage.setItem(MALIYET_ANAHTARI, String(maliyet));
  }, [maliyet]);

  /* -------------------------------------------------------- dışa aktarma */

  /** Aktarım için ekran dışında, tam genişlikte bir kopya hazırlar */
  const alanHazirla = (): HTMLElement | null => {
    const kaynak = document.getElementById("bg-yazdirilacak");
    if (!kaynak) return null;

    const kapsayici = document.createElement("div");
    kapsayici.className = "nr-aktarim-alani";

    const baslik = document.createElement("div");
    baslik.className = "nr-aktarim-baslik";
    baslik.textContent = `Bölge Norm Kadro Raporu · ${dayjs().format("DD.MM.YYYY")}`;
    kapsayici.appendChild(baslik);
    kapsayici.appendChild(kaynak.cloneNode(true));

    kapsayici.style.position = "fixed";
    kapsayici.style.left = "-10000px";
    kapsayici.style.top = "0";
    kapsayici.style.width = `${Math.max(1200, kaynak.scrollWidth)}px`;
    kapsayici.style.background = "#ffffff";
    kapsayici.style.padding = "16px";

    document.body.appendChild(kapsayici);
    return kapsayici;
  };

  const alaniKaldir = (alan: HTMLElement | null) => {
    if (alan?.parentNode) alan.parentNode.removeChild(alan);
  };

  const pdfIndir = async () => {
    setAktariliyor("pdf");
    const alan = alanHazirla();

    try {
      if (alan) await pdfOlarakIndir(alan, `bolge_raporu_${tarihDamgasi()}`);
    } catch (hata: any) {
      message.error("PDF oluşturulamadı: " + hata.message);
    } finally {
      alaniKaldir(alan);
      setAktariliyor("");
    }
  };

  const gorselIndir = async () => {
    setAktariliyor("gorsel");
    const alan = alanHazirla();

    try {
      if (alan) await gorselOlarakIndir(alan, `bolge_raporu_${tarihDamgasi()}`);
    } catch (hata: any) {
      message.error("Görsel oluşturulamadı: " + hata.message);
    } finally {
      alaniKaldir(alan);
      setAktariliyor("");
    }
  };

  const excelIndir = () => {
    const tablo = document
      .getElementById("bg-yazdirilacak")
      ?.querySelector("table");

    if (!tablo) return;

    setAktariliyor("excel");
    try {
      excelOlarakIndir(
        tablo as HTMLElement,
        `bolge_raporu_${tarihDamgasi()}`,
        `Bölge Norm Kadro Raporu · ${dayjs().format("DD.MM.YYYY")}`
      );
    } catch (hata: any) {
      message.error("Excel oluşturulamadı: " + hata.message);
    } finally {
      setAktariliyor("");
    }
  };

  /* ---------------------------------------------------------- hesaplamalar */

  const hesapla = (s: Satir) => ({
    ...s,
    maksEksik: Math.round(s.norm * 0.02 * 10) / 10,
    toplamSorun: s.eksik + s.fazla,
    maliyet: (s.fazla - s.eksik) * maliyet,
  });

  const turler = useMemo(() => veri.turSatirlari.map(hesapla), [veri, maliyet]);
  const bolgeler = useMemo(() => veri.bolgeSatirlari.map(hesapla), [veri, maliyet]);

  const t = veri.toplam;
  const genelSorun = t.eksik + t.fazla;
  const genelMaliyet = (t.fazla - t.eksik) * maliyet;

  /* ------------------------------------------------------------ mesaj metni */

  const mesajUret = useCallback(() => {
    const bugun = dayjs().format("DD.MM.YYYY");

    const turAdet = (ad: string) =>
      veri.turSatirlari.find((x) =>
        x.ad.toLocaleLowerCase("tr").includes(ad.toLocaleLowerCase("tr"))
      )?.mevcut ?? 0;

    const satirlar: string[] = [
      "Merhaba;",
      "",
      `* Genel Müdür onaylı norm kadromuz ${bugun} tarihinden itibaren ${sayi(
        t.norm
      )} kişidir.`,
      `* Toplam aktif mevcut çalışanımız ${sayi(t.mevcut)} kişidir.`,
      `* Bugün ${sayi(t.eksik)} eksik ihtiyacımız bulunmaktadır.`,
      /* "Fazla çalışan" ile "norm dışı fazla" aynı sayıydı ve iki ayrı
         satırda tekrarlanıyordu; tek satırda yazılır. */
      `* Norm kadro dışı ${sayi(t.fazla)} fazla çalışanımız mevcuttur.`,
      `* Engelli kadro ${sayi(t.engelli)} kişi.`,
      /* Raporlu personel mevcuda dahil; bilgi için ayrıca yazılıyor */
      `* Raporlu: ${t.raporlu ?? 0} kişi (mevcuda dahil).`,
      "",
      "FAZLA PERSONEL DETAY",
    ];

    if (veri.fazlaDetay.length === 0) {
      satirlar.push("Fazla personel bulunmamaktadır.");
    } else {
      veri.fazlaDetay.forEach((f) => {
        satirlar.push(`${f.sube.toLocaleUpperCase("tr")}: ${f.pozisyonlar}`);
      });
    }

    satirlar.push("");
    satirlar.push(
      `* Norm kadromuzda ${sayi(
        t.partTime
      )} part time çalışanımız bulunmaktadır. (Engelli dâhil)`
    );

    veri.turSatirlari.forEach((x) => {
      satirlar.push(`. ${x.ad}: ${sayi(x.mevcut)} kişi`);
    });

    satirlar.push(`. Toplam ${sayi(t.mevcut)} çalışanımız bulunmaktadır.`);

    // Kullanılmayan yardımcı uyarısı olmasın diye çağrılır
    void turAdet;

    return satirlar.join("\n");
  }, [veri, t]);

  useEffect(() => {
    setMesaj(mesajUret());
  }, [mesajUret]);

  const kopyala = async () => {
    try {
      await navigator.clipboard.writeText(mesaj);
      message.success("Mesaj panoya kopyalandı.");
    } catch {
      message.warning("Kopyalanamadı, metni elle seçip kopyalayabilirsiniz.");
    }
  };

  const whatsappAc = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(mesaj)}`,
      "_blank",
      "noopener"
    );
  };

  /* ------------------------------------------------------------------ tablo */

  const sutunlar: ColumnsType<any> = [
    {
      title: "Bölge / Birim",
      dataIndex: "ad",
      width: 200,
      fixed: "left",
      render: (v: string, k: any) => (
        <div>
          <Text strong>{v}</Text>
          {k.sorumlular?.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
              {k.sorumlular.join(", ")}
            </div>
          )}
          {k.tur === "tur" && k.birimSayisi > 0 && (
            <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
              {k.birimSayisi} birim
            </div>
          )}
        </div>
      ),
    },
    {
      title: "G.M. Norm",
      dataIndex: "norm",
      width: 110,
      align: "center",
      sorter: (a, b) => a.norm - b.norm,
      render: (v: number) => <div className="bg-hucre bg-norm">{sayi(v)}</div>,
    },
    {
      title: "Mevcut Çalışan",
      dataIndex: "mevcut",
      width: 130,
      align: "center",
      render: (v: number) => <div className="bg-hucre bg-mevcut">{sayi(v)}</div>,
    },
    {
      title: "Maks. Eksik %2",
      dataIndex: "maksEksik",
      width: 130,
      align: "center",
      render: (v: number) => (
        <Tooltip title="Normun %2'si kadar eksik kabul edilebilir sayılır">
          <div className="bg-hucre">{sayi(v)}</div>
        </Tooltip>
      ),
    },
    {
      title: "Eksik Pers.",
      dataIndex: "eksik",
      width: 115,
      align: "center",
      sorter: (a, b) => a.eksik - b.eksik,
      render: (v: number, k: any) => (
        <div className={`bg-hucre ${v > k.maksEksik ? "bg-eksik-asim" : "bg-eksik"}`}>
          {sayi(v)}
        </div>
      ),
    },
    {
      title: "Fazla Pers.",
      dataIndex: "fazla",
      width: 115,
      align: "center",
      sorter: (a, b) => a.fazla - b.fazla,
      render: (v: number) => <div className="bg-hucre bg-fazla">{sayi(v)}</div>,
    },
    {
      title: (
        <Tooltip title="Bugün sağlık raporlu çalışan. Mevcut sayısına dahildir; eksik, fazla ve maliyeti değiştirmez.">
          Raporlu
        </Tooltip>
      ),
      dataIndex: "raporlu",
      width: 75,
      align: "center",
      render: (v: number) => (
        <div className="bg-hucre bg-raporlu">{v ? v : "—"}</div>
      ),
    },
    {
      title: "Toplam Sorun",
      dataIndex: "toplamSorun",
      width: 125,
      align: "center",
      sorter: (a, b) => a.toplamSorun - b.toplamSorun,
      render: (v: number) => <div className="bg-hucre bg-sorun">{sayi(v)}</div>,
    },
    {
      title: "Maliyet",
      dataIndex: "maliyet",
      width: 130,
      align: "center",
      sorter: (a, b) => a.maliyet - b.maliyet,
      render: (v: number) => (
        <div className={`bg-hucre ${v < 0 ? "bg-maliyet-eksi" : "bg-maliyet"}`}>
          {para(v)}
        </div>
      ),
    },
  ];

  return (
    <>
      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : turler.length === 0 && bolgeler.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Gösterilecek veri bulunamadı"
          description="Norm kadro verisi girildikten ve Form Ayarları'ndan bölgeler tanımlandıktan sonra bu rapor dolar."
        />
      ) : (
        <>
          {/* --------------------------------------------------- ayar satırı */}
          <Row gutter={[10, 10]} align="middle" style={{ marginBottom: 12 }}>
            <Col xs={24} md={7}>
              <Space size={8}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  Kişi başı maliyet
                </Text>
                <InputNumber
                  min={0}
                  step={1000}
                  value={maliyet}
                  style={{ width: 130 }}
                  formatter={(v) => `₺ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                  parser={(v) => Number((v ?? "").replace(/[^\d]/g, "")) as 0}
                  onChange={(v) => setMaliyet(Number(v) || 0)}
                />
              </Space>
            </Col>

            <Col xs={24} md={13}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Maliyet = (fazla personel − eksik personel) × kişi başı maliyet
              </Text>
            </Col>

            <Col xs={24} md={4}>
              <Space.Compact block>
                <Button
                  loading={yukleniyor}
                  icon={<RefreshCw size={15} strokeWidth={2} />}
                  onClick={getir}
                  title="Yenile"
                />
                <Button
                  loading={aktariliyor === "excel"}
                  icon={<FileSpreadsheet size={15} strokeWidth={2} />}
                  onClick={excelIndir}
                  title="Renkleriyle Excel indir"
                >
                  Excel
                </Button>
                <Button
                  loading={aktariliyor === "pdf"}
                  icon={<FileDown size={15} strokeWidth={2} />}
                  onClick={pdfIndir}
                  title="PDF indir"
                >
                  PDF
                </Button>
                <Button
                  loading={aktariliyor === "gorsel"}
                  icon={<ImageDown size={15} strokeWidth={2} />}
                  onClick={gorselIndir}
                  title="Görsel indir"
                />
              </Space.Compact>
            </Col>
          </Row>

          {/* ------------------------------------------------ birim türleri */}
          <div id="bg-yazdirilacak">
          <Text strong style={{ fontSize: 13 }}>
            Birim Türleri
          </Text>
          <Tablo
            rowKey="ad"
            size="small"
            style={{ marginTop: 8, marginBottom: 18 }}
            columns={sutunlar}
            dataSource={turler}
            pagination={false}
            scroll={{ x: 1130 }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row className="bg-toplam">
                  <Table.Summary.Cell index={0}>
                    <b>Genel toplam</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="center">
                    <b>{sayi(t.norm)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="center">
                    <b>{sayi(t.mevcut)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="center">
                    <b>{sayi(Math.round(t.norm * 0.02 * 10) / 10)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="center">
                    <b>{sayi(t.eksik)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="center">
                    <b>{sayi(t.fazla)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="center">
                    <b>{t.raporlu ?? 0}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="center">
                    <b>{sayi(genelSorun)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={8} align="center">
                    <b>{para(genelMaliyet)}</b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />

          {/* ------------------------------------------------------ bölgeler */}
          <Text strong style={{ fontSize: 13 }}>
            Bölgeler
          </Text>

          {bolgeler.length === 0 ? (
            <Empty
              style={{ marginTop: 8 }}
              description="Form Ayarları'ndan bölge tanımlayınız."
            />
          ) : (
            <Tablo
              rowKey="ad"
              size="small"
              style={{ marginTop: 8 }}
              columns={sutunlar}
              dataSource={bolgeler}
              pagination={false}
              scroll={{ x: 1130 }}
            />
          )}

          </div>

          {/* -------------------------------------------------- günlük mesaj */}
          <Card
            size="small"
            style={{ marginTop: 18 }}
            title={
              <Space size={8}>
                <MessageCircle size={16} strokeWidth={2} />
                Günlük Bilgilendirme Mesajı
              </Space>
            }
            extra={
              <Space>
                <Button
                  size="small"
                  icon={<RefreshCw size={14} strokeWidth={2} />}
                  onClick={() => setMesaj(mesajUret())}
                >
                  Yeniden üret
                </Button>
                <Button
                  size="small"
                  icon={<Copy size={14} strokeWidth={2} />}
                  onClick={kopyala}
                >
                  Kopyala
                </Button>
                <Button
                  size="small"
                  className="ik-wa-dugme"
                  icon={<MessageCircle size={14} strokeWidth={2} />}
                  onClick={whatsappAc}
                >
                  WhatsApp
                </Button>
              </Space>
            }
          >
            <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
              Metin güncel norm kadro verilerinden üretilir. Göndermeden önce
              üzerinde değişiklik yapabilirsiniz; düzenlemeleriniz kopyalanan
              metne yansır.
            </Paragraph>

            <TextArea
              rows={18}
              value={mesaj}
              onChange={(e) => setMesaj(e.target.value)}
              style={{ fontSize: 13, fontFamily: "inherit" }}
            />
          </Card>
        </>
      )}
    </>
  );
}

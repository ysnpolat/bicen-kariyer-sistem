/**
 * Performans Büyüme
 * ---------------------------------------------------------------------------
 * Şubelerin bir önceki yıla göre büyüme oranları. Her ölçüt için şubenin
 * büyümesi genel ortalamayla karşılaştırılır: üstündeyse yeşil, altındaysa
 * kırmızı.
 *
 * Karşılaştırma burada yapılır; kaynak sistemde renkler HTML olarak SQL'e
 * gömülüydü. Veri ile sunumu ayırmak hem tabloyu sıralanabilir kılıyor hem
 * de renk kuralı değiştiğinde sorguya dokunmayı gerektirmiyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import {
  FileSpreadsheet,
  FileText,
  ImageDown,
  RefreshCw, Search, TrendingUp } from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";
import {
  excelOlarakIndir,
  gorselOlarakIndir,
  pdfOlarakIndir,
  tarihDamgasi,
} from "./disaAktar";

const { Title, Text } = Typography;

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** Ölçüt tanımı: değer alanı ve karşılaştırılacağı genel ortalama alanı */
const OLCUTLER = [
  { baslik: "Müşteri", alan: "musteri", genel: "musteriGenel" },
  { baslik: "Ciro", alan: "ciro", genel: "ciroGenel" },
  { baslik: "Kâr", alan: "kar", genel: "karGenel" },
  { baslik: "Et Ciro", alan: "etCiro", genel: "etCiroGenel" },
  { baslik: "Et Kâr", alan: "etKar", genel: "etKarGenel" },
  { baslik: "Şarküteri Ciro", alan: "sarkuteriCiro", genel: "sarkuteriCiroGenel" },
  { baslik: "Şarküteri Kâr", alan: "sarkuteriKar", genel: "sarkuteriKarGenel" },
  { baslik: "Manav Ciro", alan: "manavCiro", genel: "manavCiroGenel" },
  { baslik: "Manav Kâr", alan: "manavKar", genel: "manavKarGenel" },
  { baslik: "Tadolya Ciro", alan: "tadolyaCiro", genel: "tadolyaCiroGenel" },
  { baslik: "Tadolya Kâr", alan: "tadolyaKar", genel: "tadolyaKarGenel" },
];

/** Oranı yüzde olarak yazar; veri yoksa tire döner */
const oran = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
};

export default function PerformansBuyume() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yil, setYil] = useState<number | undefined>();
  const [ay, setAy] = useState<number | undefined>();
  const [arama, setArama] = useState("");

  /* Dışa aktarma, ekrandaki alanı olduğu gibi alır: renkler ve
     başlıklar korunur, ayrı bir biçimlendirme yazmak gerekmez. */
  const alan = useRef<HTMLDivElement>(null);
  const [aktariliyor, setAktariliyor] = useState<string | null>(null);

  const aktar = async (bicim: "excel" | "pdf" | "gorsel") => {
    if (!alan.current) return;

    setAktariliyor(bicim);

    const ad = `buyume-oranlari-${tarihDamgasi()}`;
    const baslik = `Büyüme Oranları`;

    try {
      if (bicim === "excel") excelOlarakIndir(alan.current, ad, baslik);
      else if (bicim === "pdf") await pdfOlarakIndir(alan.current, ad, baslik);
      else await gorselOlarakIndir(alan.current, ad);
    } catch (hata: any) {
      message.error(hata?.message ?? "Dışa aktarılamadı.");
    } finally {
      setAktariliyor(null);
    }
  };

  const getir = useCallback(
    async (y?: number, a?: number) => {
      setYukleniyor(true);

      try {
        const sorgu = new URLSearchParams();
        if (y) sorgu.set("yil", String(y));
        if (a) sorgu.set("ay", String(a));

        const d = await api.al<any>(`/api/Performans/Buyume?${sorgu}`);
        setVeri(d);

        if (!y && d?.yil) setYil(d.yil);
        if (!a && d?.ay) setAy(d.ay);
      } catch (hata: any) {
        message.error(hata.message);
        setVeri(null);
      } finally {
        setYukleniyor(false);
      }
    },
    [message]
  );

  useEffect(() => {
    getir();
  }, [getir]);

  /* Genel ortalama satırı: her ölçütün genel değeri aynı olduğu için
     ilk satırdan okunur. Tablonun başında sabit durur. */
  const genelSatir = useMemo(() => {
    const ilk = (veri?.satirlar ?? [])[0];

    if (!ilk) return null;

    const satir: any = { subeAdi: "GENEL ORTALAMA", genelMi: true };

    OLCUTLER.forEach((o) => {
      satir[o.alan] = ilk[o.genel];
      satir[o.genel] = ilk[o.genel];
    });

    return satir;
  }, [veri]);

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    const satirlar = veri?.satirlar ?? [];

    const suzulmus = q
      ? satirlar.filter((s: any) =>
          (s.subeAdi ?? "").toLocaleLowerCase("tr").includes(q)
        )
      : satirlar;

    return genelSatir ? [genelSatir, ...suzulmus] : suzulmus;
  }, [veri, arama, genelSatir]);

  /* Kaç ölçütte ortalamanın üstünde: şubeleri hızlı kıyaslamak için */
  const ustundeSayisi = (s: any) =>
    OLCUTLER.filter((o) => Number(s[o.alan]) > Number(s[o.genel])).length;

  return (
    <div>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={10}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
            <Space size={8}>
              <TrendingUp size={18} strokeWidth={2} />
              Performans Büyüme
            </Space>
          </Title>
        </Col>

        <Col xs={24} md={14} style={{ textAlign: "right" }}>
          <Space wrap>
            <Select
              style={{ width: 100 }}
              placeholder="Yıl"
              value={yil}
              onChange={(v) => {
                setYil(v);
                getir(v, ay);
              }}
              options={(veri?.yillar ?? []).map((y: number) => ({
                value: y,
                label: String(y),
              }))}
            />

            <Select
              style={{ width: 140 }}
              placeholder="Ay"
              value={ay}
              onChange={(v) => {
                setAy(v);
                getir(yil, v);
              }}
              options={(veri?.aylar ?? []).map((a: number) => ({
                value: a,
                label: `${a} - ${AYLAR[a - 1] ?? a}`,
              }))}
            />

            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Şube ara"
              style={{ width: 180 }}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />

            <Button
              icon={<RefreshCw size={15} strokeWidth={2} />}
              loading={yukleniyor}
              onClick={() => getir(yil, ay)}
            >
              Yenile
            </Button>

            <Button
              icon={<FileSpreadsheet size={15} strokeWidth={2} />}
              loading={aktariliyor === "excel"}
              onClick={() => aktar("excel")}
            >
              Excel
            </Button>

            <Button
              icon={<FileText size={15} strokeWidth={2} />}
              loading={aktariliyor === "pdf"}
              onClick={() => aktar("pdf")}
            >
              PDF
            </Button>

            <Button
              icon={<ImageDown size={15} strokeWidth={2} />}
              loading={aktariliyor === "gorsel"}
              onClick={() => aktar("gorsel")}
            >
              Görsel
            </Button>

          </Space>
        </Col>
      </Row>

      {veri?.hata ? (
        <Alert
          type="warning"
          showIcon
          message={veri.hata}
          description={
            veri.ayrinti ? (
              <div>
                <div style={{ marginBottom: 6 }}>{veri.ayrinti}</div>
                <span style={{ fontSize: 12 }}>
                  Bağlantı tanımlıysa sorun kolon adı ya da yetki olabilir.
                </span>
              </div>
            ) : (
              "Performans veritabanı bağlantısı tanımlı olmayabilir (appsettings.json → ConnectionStrings → Performans)."
            )
          }
        />
      ) : yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : (
        <div ref={alan}>
        <Card size="small">
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Oranlar bir önceki yılın aynı ayına göredir. Genel ortalamanın
            üstünde kalan değerler yeşil, altında kalanlar kırmızı gösterilir.
          </Text>

          <Tablo
            rowKey="subeAdi"
            size="small"
            style={{ marginTop: 10 }}
            loading={yukleniyor}
            dataSource={liste}
            locale={{ emptyText: "Bu dönem için büyüme verisi bulunmuyor." }}
            pagination={false}
            scroll={{ x: 1500, y: 560 }}
            rowClassName={(k: any) => (k.genelMi ? "pb-genel" : "")}
            columns={[
              {
                title: "Mağaza",
                dataIndex: "subeAdi",
                width: 165,
                fixed: "left" as const,
                render: (v: string, k: any) => (
                  <b style={{ color: k.genelMi ? "#1a4d80" : undefined }}>{v}</b>
                ),
              },
              {
                title: "Üstünde",
                key: "ustunde",
                width: 95,
                align: "center" as const,
                sorter: (a: any, b: any) => ustundeSayisi(a) - ustundeSayisi(b),
                render: (_v: any, k: any) => {
                  if (k.genelMi) return <Text type="secondary">—</Text>;

                  const n = ustundeSayisi(k);

                  return (
                    <Tooltip title="Genel ortalamanın üstünde kalınan ölçüt sayısı">
                      <b
                        style={{
                          color:
                            n >= 7 ? "#5f8c10" : n >= 4 ? "#d46b08" : "#cf1322",
                        }}
                      >
                        {n} / {OLCUTLER.length}
                      </b>
                    </Tooltip>
                  );
                },
              },
              ...OLCUTLER.map((o) => ({
                title: o.baslik,
                dataIndex: o.alan,
                width: 125,
                align: "right" as const,
                sorter: (a: any, b: any) =>
                  (Number(a[o.alan]) || 0) - (Number(b[o.alan]) || 0),
                render: (v: any, k: any) => {
                  if (v === null || v === undefined)
                    return <Text type="secondary">—</Text>;

                  /* Genel ortalama satırı kendiyle kıyaslanmaz */
                  if (k.genelMi)
                    return <b style={{ color: "#1a4d80" }}>{oran(v)}</b>;

                  const ustunde = Number(v) > Number(k[o.genel]);

                  return (
                    <span
                      style={{
                        color: ustunde ? "#5f8c10" : "#cf1322",
                        fontWeight: 600,
                      }}
                    >
                      {oran(v)}
                    </span>
                  );
                },
              })),
            ]}
          />
        </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Prim Hak Edişi
 * ---------------------------------------------------------------------------
 * Mağaza performans puanına göre hesaplanan prim tutarları. Puan aralığı
 * ücretin yüzdesini belirler: 60-70 arası %3, 70-80 %5, 80-90 %7,
 * 90 ve üstü %10. Altmışın altında prim yoktur ve listeye girmez.
 *
 * Puanlar performans veritabanından, ücretler Mikro'dan gelir; ikisi
 * sunucuda birleştirilir.
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
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Coins,
  FileSpreadsheet,
  FileText,
  ImageDown,
  RefreshCw,
  Search,
} from "lucide-react";

import Tablo from "./Tablo";
import { api, oturumOku } from "./api";
import PrimYukleme, { primExceli } from "./PrimYukleme";
import { Drawer } from "antd";
import { CreditCard } from "lucide-react";
import {
  gorselOlarakIndir,
  pdfOlarakIndir,
  tarihDamgasi,
} from "./disaAktar";

const { Title, Text } = Typography;

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const ARALIKLAR = ["60-70", "70-80", "80-90", "90-100"];

const aralikRengi = (a: string) =>
  a === "90-100" ? "#5f8c10" : a === "80-90" ? "#7cb518"
  : a === "70-80" ? "#d46b08" : "#cf1322";

const para = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("tr-TR")} TL` : "—";
};

export default function PrimHakedis() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yil, setYil] = useState<number>(new Date().getFullYear());
  const [ay, setAy] = useState<number | undefined>();
  const [arama, setArama] = useState("");

  /* Dışa aktarma, ekrandaki alanı olduğu gibi alır: renkler ve
     başlıklar korunur, ayrı bir biçimlendirme yazmak gerekmez. */
  const alan = useRef<HTMLDivElement>(null);
  const [aktariliyor, setAktariliyor] = useState<string | null>(null);

  const aktar = async (bicim: "excel" | "pdf" | "gorsel") => {
    if (!alan.current) return;

    setAktariliyor(bicim);

    const ad = `prim-hakedis-${tarihDamgasi()}`;
    const baslik = `Prim Hak Edişi`;

    try {
      /* Excel ekrandan değil veriden (21.10.2026): sayfalama ve dilim
         süzgecinden bağımsız tüm personel, TC ve Biçen Kart no ile */
      if (bicim === "excel") {
        if (!veri?.kayitlar?.length) throw new Error("Aktarılacak kayıt yok.");
        await primExceli(veri.kayitlar, veri.yil ?? yil, veri.ay ?? ay ?? 1);
      } else if (bicim === "pdf") await pdfOlarakIndir(alan.current, ad, baslik);
      else await gorselOlarakIndir(alan.current, ad);
    } catch (hata: any) {
      message.error(hata?.message ?? "Dışa aktarılamadı.");
    } finally {
      setAktariliyor(null);
    }
  };
  const [aralik, setAralik] = useState<string>("hepsi");
  const [yuklemeAcik, setYuklemeAcik] = useState(false);
  const kartYetkisi = ["Admin", "IK", "IKYoneticisi", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");

  const getir = useCallback(
    async (y?: number, a?: number) => {
      setYukleniyor(true);

      try {
        const sorgu = new URLSearchParams();
        if (y) sorgu.set("yil", String(y));
        if (a) sorgu.set("ay", String(a));

        const d = await api.al<any>(`/api/Performans/Hakedis?${sorgu}`);
        setVeri(d);

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
    /* Açılışta içinde bulunulan ay denenir */
    getir(new Date().getFullYear(), new Date().getMonth() + 1);
  }, [getir]);

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return (veri?.kayitlar ?? []).filter((k: any) => {
      if (aralik !== "hepsi" && k.aralik !== aralik) return false;

      if (q) {
        const metin = `${k.adSoyad} ${k.subeAdi ?? ""} ${k.gorevAdi ?? ""}`;
        if (!metin.toLocaleLowerCase("tr").includes(q)) return false;
      }

      return true;
    });
  }, [veri, arama, aralik]);

  /* Aralık başına kişi ve tutar: hangi dilimde ne kadar prim çıktığı */
  const dagilim = useMemo(() => {
    const kayitlar = veri?.kayitlar ?? [];

    return ARALIKLAR.map((a) => {
      const grup = kayitlar.filter((k: any) => k.aralik === a);

      return {
        aralik: a,
        kisi: grup.length,
        tutar: grup.reduce((t: number, k: any) => t + (k.tutar ?? 0), 0),
      };
    });
  }, [veri]);

  const listeToplam = useMemo(
    () => liste.reduce((t: number, k: any) => t + (k.tutar ?? 0), 0),
    [liste]
  );

  return (
    <div>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={9}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
            <Space size={8}>
              <Coins size={18} strokeWidth={2} />
              Prim Hak Edişi
            </Space>
          </Title>
        </Col>

        <Col xs={24} md={15} style={{ textAlign: "right" }}>
          <Space wrap>
            <Select
              style={{ width: 100 }}
              value={yil}
              onChange={(v) => {
                setYil(v);
                getir(v, ay);
              }}
              options={[0, 1, 2].map((i) => {
                const y = new Date().getFullYear() - i;
                return { value: y, label: String(y) };
              })}
            />

            <Select
              style={{ width: 140 }}
              placeholder="Ay"
              value={ay}
              onChange={(v) => {
                setAy(v);
                getir(yil, v);
              }}
              options={AYLAR.map((a, i) => ({
                value: i + 1,
                label: `${i + 1} - ${a}`,
              }))}
            />

            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Ad, şube veya görev"
              style={{ width: 200 }}
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

            {kartYetkisi && (
              <Button
                type="primary"
                icon={<CreditCard size={15} strokeWidth={2} />}
                disabled={!ay}
                onClick={() => setYuklemeAcik(true)}
              >
                Biçen Kart'a yükle
              </Button>
            )}

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
          description={veri.ayrinti}
        />
      ) : yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : (
        <div ref={alan}>
          {/* --------------------------------------------- dilim özetleri */}
          <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={6}>
              <Card size="small" style={{ background: "#f2f9e8" }}>
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  Toplam Hak Ediş
                </Text>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    color: "#5f8c10",
                    lineHeight: 1.3,
                  }}
                >
                  {para(veri?.toplam ?? 0)}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {(veri?.kayitlar ?? []).length} personel
                </Text>
              </Card>
            </Col>

            {dagilim.map((d) => (
              <Col xs={12} md={4} key={d.aralik}>
                <Card
                  size="small"
                  hoverable
                  onClick={() =>
                    setAralik(aralik === d.aralik ? "hepsi" : d.aralik)
                  }
                  style={{
                    borderColor:
                      aralik === d.aralik ? aralikRengi(d.aralik) : undefined,
                    borderWidth: aralik === d.aralik ? 2 : 1,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {d.aralik} puan
                  </Text>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      lineHeight: 1.3,
                      color: aralikRengi(d.aralik),
                    }}
                  >
                    {d.kisi}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {para(d.tutar)}
                  </Text>
                </Card>
              </Col>
            ))}
          </Row>

          <Card size="small">
            <Row align="middle" gutter={[10, 10]} style={{ marginBottom: 10 }}>
              <Col flex="auto">
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {liste.length} personel · seçili listenin toplamı{" "}
                  <b>{para(listeToplam)}</b>
                  {veri?.ucretsiz > 0 && (
                    <>
                      {" · "}
                      <Tooltip title="Mikro'da ücret bilgisi bulunamayan personel; tutarları hesaplanmadı.">
                        <span style={{ color: "#d46b08" }}>
                          {veri.ucretsiz} kişide ücret yok
                        </span>
                      </Tooltip>
                    </>
                  )}
                </Text>
              </Col>

              <Col>
                <Segmented
                  value={aralik}
                  onChange={(v) => setAralik(v as string)}
                  options={[
                    { label: "Hepsi", value: "hepsi" },
                    ...ARALIKLAR.map((a) => ({ label: a, value: a })),
                  ]}
                />
              </Col>
            </Row>

            <Tablo
              rowKey={(k: any) => `${k.adSoyad}-${k.subeAdi}`}
              size="small"
              loading={yukleniyor}
              dataSource={liste}
              locale={{ emptyText: "Bu dönem için hak ediş bulunmuyor." }}
              pagination={{ pageSize: 50, showSizeChanger: false }}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  width: 260,
                  render: (v: string, k: any) => (
                    <Space size={6}>
                      <span>{v}</span>
                      {k.ayrildi && (
                        <Tooltip title="Bu personel işten ayrılmış. Hak edişi hesaplanır; ödeme sürecinde ayrıca değerlendirilmesi gerekebilir.">
                          <Tag color="orange">
                            ayrıldı{k.cikisTarihi ? ` · ${new Date(k.cikisTarihi).toLocaleDateString("tr-TR")}` : ""}
                          </Tag>
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
                {
                  title: "Görev",
                  dataIndex: "gorevAdi",
                  width: 175,
                  ellipsis: true,
                  render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : "—"),
                },
                { title: "Şube", dataIndex: "subeAdi", width: 150, ellipsis: true },
                {
                  title: "Puan",
                  dataIndex: "puan",
                  width: 85,
                  align: "right" as const,
                  sorter: (a: any, b: any) => a.puan - b.puan,
                  render: (v: number, k: any) => (
                    <b style={{ color: aralikRengi(k.aralik) }}>{v}</b>
                  ),
                },
                {
                  title: "Dilim",
                  dataIndex: "aralik",
                  width: 95,
                  align: "center" as const,
                  render: (v: string) => (
                    <Tag color={v === "90-100" || v === "80-90" ? "green" : undefined}>
                      {v}
                    </Tag>
                  ),
                },
                {
                  title: "Oran",
                  dataIndex: "yuzde",
                  width: 80,
                  align: "right" as const,
                  render: (v: number) => `%${Math.round(v * 100)}`,
                },
                {
                  title: "Ücret",
                  dataIndex: "ucret",
                  width: 120,
                  align: "right" as const,
                  render: (v: number) =>
                    v > 0 ? para(v) : <Text type="secondary">—</Text>,
                },
                {
                  title: "Hak Ediş",
                  dataIndex: "tutar",
                  width: 125,
                  align: "right" as const,
                  sorter: (a: any, b: any) => (a.tutar ?? 0) - (b.tutar ?? 0),
                  render: (v: number | null) =>
                    v === null ? (
                      <Tooltip title="Ücret bilgisi bulunamadı.">
                        <Text type="secondary">hesaplanamadı</Text>
                      </Tooltip>
                    ) : (
                      <b style={{ color: "#5f8c10" }}>{para(v)}</b>
                    ),
                },
              ]}
            />
          </Card>
        </div>
      )}

      <Drawer
        open={yuklemeAcik}
        onClose={() => setYuklemeAcik(false)}
        width={Math.min(1150, window.innerWidth - 40)}
        title="Prim hak edişini Biçen Kart'a yükle"
        destroyOnClose
      >
        <PrimYukleme baslangicYil={yil} baslangicAy={ay} />
      </Drawer>
    </div>
  );
}

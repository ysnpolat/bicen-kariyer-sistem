/**
 * Yönetim Raporu
 * ---------------------------------------------------------------------------
 * Seçilen ayda şirkette ne olduğunun tek ekranda özeti: onay hareketleri,
 * işe alımlar, ciro büyümesi, geçiş okutma ve çıkış mülakatları.
 *
 * Veriler dört ayrı veritabanından gelir. Bir bölüm boş kalırsa o kaynağa
 * ulaşılamamış demektir; diğerleri yine görünür.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BrainCircuit,
  ClipboardCheck,
  RefreshCw,
  ScanLine,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import dayjs from "dayjs";

import Tablo from "./Tablo";
import { api } from "./api";

const { Title, Text, Paragraph } = Typography;

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** Büyüme oranını yüzde olarak yazar; artı-eksi işareti korunur */
const oran = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
};

const oranRengi = (v: unknown) => {
  const n = Number(v);
  return !Number.isFinite(n) ? undefined : n >= 0 ? "#5f8c10" : "#cf1322";
};

const sayi = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR") : "—";
};

export default function YonetimRaporu() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yil, setYil] = useState(new Date().getFullYear());
  const [ay, setAy] = useState(new Date().getMonth() + 1);

  const [ozet, setOzet] = useState<any>(null);
  const [ozetAliniyor, setOzetAliniyor] = useState(false);

  const getir = useCallback(
    async (y: number, a: number) => {
      setYukleniyor(true);
      setOzet(null);

      try {
        setVeri(await api.al<any>(`/api/YonetimRaporu?yil=${y}&ay=${a}`));
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
    getir(yil, ay);
  }, [getir, yil, ay]);

  const ozetAl = async () => {
    setOzetAliniyor(true);

    try {
      setOzet(
        await api.al<any>(`/api/YonetimRaporu/MulakatOzeti?yil=${yil}&ay=${ay}`)
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setOzetAliniyor(false);
    }
  };

  const o = veri?.onayOzeti;
  const b = veri?.basvuruOzeti;
  const c = veri?.ciroOzeti;
  const g = veri?.gecisOzeti;

  return (
    <div>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={12}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
            <Space size={8}>
              <ClipboardCheck size={18} strokeWidth={2} />
              Yönetim Raporu
            </Space>
          </Title>
        </Col>

        <Col xs={24} md={12} style={{ textAlign: "right" }}>
          <Space wrap>
            <Select
              style={{ width: 100 }}
              value={yil}
              onChange={setYil}
              options={[0, 1, 2].map((i) => {
                const y = new Date().getFullYear() - i;
                return { value: y, label: String(y) };
              })}
            />

            <Select
              style={{ width: 145 }}
              value={ay}
              onChange={setAy}
              options={AYLAR.map((x, i) => ({
                value: i + 1,
                label: `${i + 1} - ${x}`,
              }))}
            />

            <Button
              icon={<RefreshCw size={15} strokeWidth={2} />}
              loading={yukleniyor}
              onClick={() => getir(yil, ay)}
            >
              Yenile
            </Button>
          </Space>
        </Col>
      </Row>

      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : !veri ? (
        <Empty description="Rapor alınamadı." />
      ) : (
        <>
          {/* ================================================ üst kartlar */}
          <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
            {[
              {
                sinif: "yr-mavi",
                baslik: "Gelen Başvuru",
                deger: sayi(b?.gelenBasvuru),
                ek: `${sayi(b?.iseAlinan)} işe alım`,
              },
              {
                sinif: "yr-mor",
                baslik: "Onay İsteği",
                deger: sayi(o?.toplam),
                ek: `${sayi(o?.onaylanan)} onay · ${sayi(o?.reddedilen)} red`,
              },
              {
                sinif: "",
                baslik: "Ciro Büyümesi",
                deger: oran(c?.ciro),
                ek: `kâr ${oran(c?.kar)}`,
                renk: oranRengi(c?.ciro),
              },
              {
                sinif: "yr-koyu",
                baslik: "Geçiş Hareketi",
                deger: sayi(g?.hareket),
                ek: `${sayi(g?.kisi)} kişi · ${sayi(g?.gun)} gün`,
              },
              {
                sinif: "yr-turuncu",
                baslik: "Çıkış Mülakatı",
                deger: sayi(veri?.cikisOzeti?.adet),
                ek: "görüşme",
              },
            ].map((k) => (
              <Col xs={12} md={4} key={k.baslik}>
                <div className={`yr-kart ${k.sinif ?? ""}`}>
                  <span className="yr-baslik">{k.baslik}</span>
                  <b className="yr-deger" style={k.renk ? { color: k.renk } : undefined}>
                    {k.deger}
                  </b>
                  <span className="yr-ek">{k.ek}</span>
                </div>
              </Col>
            ))}
          </Row>

          {/* ================================================== onaylar */}
          <Card
            size="small"
            className="yr-bolum yr-b-mavi"
            style={{ marginBottom: 12 }}
            title={
              <Space size={8}>
                <ClipboardCheck size={15} strokeWidth={2} />
                <Text strong style={{ fontSize: 13.5 }}>
                  Onay Hareketleri
                </Text>
                {Number(o?.bekleyen) > 0 && (
                  <Tag className="yr-bekleyen">{o.bekleyen} onay bekliyor</Tag>
                )}
              </Space>
            }
          >
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={8}>
                <div className="yr-alt-baslik">Konuya göre</div>
                <Tablo
                  rowKey="tur"
                  size="small"
                  pagination={false}
                  dataSource={veri.onayTurleri}
                  locale={{ emptyText: "Bu ayda onay isteği yok." }}
                  columns={[
                    { title: "Tür", dataIndex: "tur" },
                    { title: "Toplam", dataIndex: "toplam", width: 80, align: "right" as const },
                    {
                      title: "Onay",
                      dataIndex: "onaylanan",
                      width: 70,
                      align: "right" as const,
                      render: (v: number) => (
                        <span style={{ color: "#5f8c10" }}>{v}</span>
                      ),
                    },
                    {
                      title: "Red",
                      dataIndex: "reddedilen",
                      width: 70,
                      align: "right" as const,
                      render: (v: number) =>
                        v > 0 ? <span style={{ color: "#cf1322" }}>{v}</span> : "—",
                    },
                  ]}
                />
              </Col>

              <Col xs={24} lg={8}>
                <div className="yr-alt-baslik">Onaya gönderen</div>
                <Tablo
                  rowKey="kisi"
                  size="small"
                  pagination={false}
                  dataSource={veri.isteyenler}
                  locale={{ emptyText: "—" }}
                  columns={[
                    { title: "Kişi", dataIndex: "kisi", ellipsis: true },
                    { title: "İstek", dataIndex: "istek", width: 70, align: "right" as const },
                    {
                      title: "Red",
                      dataIndex: "reddedilen",
                      width: 70,
                      align: "right" as const,
                      render: (v: number) =>
                        v > 0 ? <span style={{ color: "#cf1322" }}>{v}</span> : "—",
                    },
                  ]}
                />
              </Col>

              <Col xs={24} lg={8}>
                <div className="yr-alt-baslik">Karar veren</div>
                <Tablo
                  rowKey="kisi"
                  size="small"
                  pagination={false}
                  dataSource={veri.karariVerenler}
                  locale={{ emptyText: "—" }}
                  columns={[
                    { title: "Kişi", dataIndex: "kisi", ellipsis: true },
                    {
                      title: "Onay",
                      dataIndex: "onaylanan",
                      width: 70,
                      align: "right" as const,
                      render: (v: number) => (
                        <span style={{ color: "#5f8c10" }}>{v}</span>
                      ),
                    },
                    {
                      title: "Red",
                      dataIndex: "reddedilen",
                      width: 70,
                      align: "right" as const,
                      render: (v: number) =>
                        v > 0 ? <span style={{ color: "#cf1322" }}>{v}</span> : "—",
                    },
                  ]}
                />
              </Col>
            </Row>

            {(veri.redler ?? []).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="yr-alt-baslik">Reddedilenler ve sebepleri</div>
                <Tablo
                  rowKey={(k: any) => `${k.tarih}-${k.baslik}`}
                  size="small"
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  dataSource={veri.redler}
                  scroll={{ x: 950 }}
                  columns={[
                    {
                      title: "Tarih",
                      dataIndex: "tarih",
                      width: 110,
                      render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
                    },
                    { title: "Tür", dataIndex: "tur", width: 110 },
                    { title: "Konu", dataIndex: "baslik", width: 240, ellipsis: true },
                    { title: "İsteyen", dataIndex: "isteyen", width: 140, ellipsis: true },
                    { title: "Reddeden", dataIndex: "onaylayan", width: 140, ellipsis: true },
                    {
                      title: "Sebep",
                      dataIndex: "sebep",
                      ellipsis: true,
                      render: (v: string) => v || <Text type="secondary">—</Text>,
                    },
                  ]}
                />
              </div>
            )}
          </Card>

          {/* ============================================== ciro büyümesi */}
          <Card
            size="small"
            className="yr-bolum"
            style={{ marginBottom: 12 }}
            title={
              <Space size={8}>
                <TrendingUp size={15} strokeWidth={2} />
                <Text strong style={{ fontSize: 13.5 }}>
                  Ciro ve Kişi Başı Ciro
                </Text>
              </Space>
            }
          >
            {(veri.ciroSubeler ?? []).length === 0 ? (
              <Empty description="Bu ay için büyüme verisi bulunmuyor." />
            ) : (
              <>
                <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                  Oranlar bir önceki yılın aynı ayına göredir. Kişi başı ciro,
                  genel ortalamanın üstündeyse yeşil.
                </Paragraph>

                <Tablo
                  rowKey="subeAdi"
                  size="small"
                  pagination={{ pageSize: 12, showSizeChanger: false }}
                  dataSource={veri.ciroSubeler}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: "Şube", dataIndex: "subeAdi", width: 165 },
                    {
                      title: "Çalışan",
                      dataIndex: "calisan",
                      width: 90,
                      align: "right" as const,
                    },
                    {
                      title: "Ciro",
                      dataIndex: "ciro",
                      width: 110,
                      align: "right" as const,
                      sorter: (x: any, y: any) => x.ciro - y.ciro,
                      render: (v: number) => (
                        <b style={{ color: oranRengi(v) }}>{oran(v)}</b>
                      ),
                    },
                    {
                      title: "Kâr",
                      dataIndex: "kar",
                      width: 110,
                      align: "right" as const,
                      render: (v: number) => (
                        <span style={{ color: oranRengi(v) }}>{oran(v)}</span>
                      ),
                    },
                    {
                      title: "Müşteri",
                      dataIndex: "musteri",
                      width: 110,
                      align: "right" as const,
                      render: (v: number) => (
                        <span style={{ color: oranRengi(v) }}>{oran(v)}</span>
                      ),
                    },
                    {
                      title: "Kişi Başı Ciro",
                      dataIndex: "kisiBasiCiro",
                      width: 135,
                      align: "right" as const,
                      sorter: (x: any, y: any) => x.kisiBasiCiro - y.kisiBasiCiro,
                      render: (v: number, k: any) => {
                        const ustunde = Number(v) > Number(k.kisiBasiCiroGenel);

                        return (
                          <Tooltip
                            title={`Genel ortalama: ${sayi(k.kisiBasiCiroGenel)}`}
                          >
                            <b style={{ color: ustunde ? "#5f8c10" : "#cf1322" }}>
                              {sayi(v)}
                            </b>
                          </Tooltip>
                        );
                      },
                    },
                  ]}
                />
              </>
            )}
          </Card>

          {/* =============================================== okutma */}
          <Card
            size="small"
            className="yr-bolum yr-b-koyu"
            style={{ marginBottom: 12 }}
            title={
              <Space size={8}>
                <ScanLine size={15} strokeWidth={2} />
                <Text strong style={{ fontSize: 13.5 }}>
                  Şube Bazlı Okutma
                </Text>
              </Space>
            }
          >
            {veri.gecisHatasi ? (
              <Alert
                type="warning"
                showIcon
                message="Geçiş verisine ulaşılamadı"
                description={veri.gecisHatasi}
              />
            ) : (veri.subeOkutma ?? []).length === 0 ? (
              <Empty description="Okutma verisi bulunmuyor." />
            ) : (
              <Tablo
                rowKey="subeAdi"
                size="small"
                pagination={{ pageSize: 12, showSizeChanger: false }}
                dataSource={veri.subeOkutma}
                columns={[
                  { title: "Şube", dataIndex: "subeAdi", width: 175 },
                  { title: "Personel", dataIndex: "toplam", width: 95, align: "right" as const },
                  {
                    title: "Okutan",
                    dataIndex: "okutan",
                    width: 95,
                    align: "right" as const,
                    render: (v: number) => (
                      <span style={{ color: "#5f8c10" }}>{v}</span>
                    ),
                  },
                  {
                    title: "Okutmayan",
                    dataIndex: "okutmayan",
                    width: 110,
                    align: "right" as const,
                    render: (v: number) =>
                      v > 0 ? <b style={{ color: "#cf1322" }}>{v}</b> : "—",
                  },
                  {
                    title: "Oran",
                    dataIndex: "oran",
                    width: 140,
                    sorter: (x: any, y: any) => x.oran - y.oran,
                    render: (v: number) => (
                      <Space size={8}>
                        <span
                          style={{
                            display: "inline-block",
                            width: 60,
                            height: 7,
                            borderRadius: 4,
                            background: "#eef0ec",
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              display: "block",
                              height: "100%",
                              width: `${Math.min(100, v)}%`,
                              background: v >= 80 ? "#7cb518" : "#e8481c",
                            }}
                          />
                        </span>
                        <b style={{ color: v >= 80 ? "#5f8c10" : "#cf1322" }}>
                          %{v}
                        </b>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </Card>

          {/* ============================================ işe alım */}
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={24} lg={12}>
              <Card
                size="small"
                className="yr-bolum"
                title={
                  <Space size={8}>
                    <UserPlus size={15} strokeWidth={2} />
                    <Text strong style={{ fontSize: 13.5 }}>
                      Pozisyona Göre İşe Alım
                    </Text>
                  </Space>
                }
              >
                <Tablo
                  rowKey="pozisyon"
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  dataSource={veri.pozisyonlar}
                  locale={{ emptyText: "Bu ayda işe alım yok." }}
                  columns={[
                    { title: "Pozisyon", dataIndex: "pozisyon", ellipsis: true },
                    {
                      title: "Kişi",
                      dataIndex: "adet",
                      width: 80,
                      align: "right" as const,
                      render: (v: number) => <b>{v}</b>,
                    },
                  ]}
                />
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card
                size="small"
                className="yr-bolum"
                title={
                  <Text strong style={{ fontSize: 13.5 }}>
                    Şubeye Göre İşe Alım
                  </Text>
                }
              >
                <Tablo
                  rowKey="subeAdi"
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  dataSource={veri.subeAlimlari}
                  locale={{ emptyText: "Bu ayda işe alım yok." }}
                  columns={[
                    { title: "Şube", dataIndex: "subeAdi", ellipsis: true },
                    {
                      title: "Kişi",
                      dataIndex: "adet",
                      width: 80,
                      align: "right" as const,
                      render: (v: number) => <b>{v}</b>,
                    },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          {/* ========================================= çıkış mülakatı */}
          <Card
            size="small"
            className="yr-bolum yr-b-turuncu"
            title={
              <Space size={8}>
                <Text strong style={{ fontSize: 13.5 }}>
                  Çıkış Mülakatları
                </Text>
                <Tag>{veri.cikisOzeti?.adet ?? 0} görüşme</Tag>
              </Space>
            }
            extra={
              <Button
                size="small"
                icon={<BrainCircuit size={14} strokeWidth={2} />}
                loading={ozetAliniyor}
                onClick={ozetAl}
                disabled={!veri.cikisOzeti?.adet}
              >
                Yorumları özetle
              </Button>
            }
          >
            {ozet?.ozet && (
              <div className="yr-ozet">{ozet.ozet}</div>
            )}

            <Row gutter={[12, 12]}>
              <Col xs={24} lg={9}>
                <div className="yr-alt-baslik">Ayrılma sebepleri</div>
                <Tablo
                  rowKey="neden"
                  size="small"
                  pagination={false}
                  dataSource={veri.cikisNedenleri}
                  locale={{ emptyText: "—" }}
                  columns={[
                    { title: "Sebep", dataIndex: "neden", ellipsis: true },
                    {
                      title: "Kişi",
                      dataIndex: "adet",
                      width: 70,
                      align: "right" as const,
                    },
                  ]}
                />
              </Col>

              <Col xs={24} lg={15}>
                <div className="yr-alt-baslik">Görüşme özetleri</div>
                <Tablo
                  rowKey={(k: any) => `${k.adSoyad}-${k.subeAdi}`}
                  size="small"
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  dataSource={veri.cikisYorumlari}
                  locale={{ emptyText: "Bu ayda çıkış mülakatı yok." }}
                  columns={[
                    { title: "Personel", dataIndex: "adSoyad", width: 155 },
                    { title: "Şube", dataIndex: "subeAdi", width: 130, ellipsis: true },
                    {
                      title: "Özet",
                      dataIndex: "ozet",
                      ellipsis: true,
                      render: (v: string, k: any) => (
                        <Tooltip title={v || k.yorum}>
                          <span>{v || k.yorum || "—"}</span>
                        </Tooltip>
                      ),
                    },
                  ]}
                />
              </Col>
            </Row>
          </Card>
        </>
      )}
    </div>
  );
}

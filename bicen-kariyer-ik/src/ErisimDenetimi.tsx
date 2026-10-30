/**
 * Erişim Denetimi
 * ---------------------------------------------------------------------------
 * Veritabanına kimin nereden bağlandığını ve ne yaptığını gösterir. Ayrıca
 * başvuruların panelden mi yoksa doğrudan SQL'den mi girildiğini ayırt eder.
 *
 * Ayırt etme ölçütü: uygulama oluşturma tarihini hiç yazmaz, SYSDATETIME()
 * varsayılanı devreye girer ve daima mikrosaniye üretir. Elle yazılan bir
 * tarihte kesirli saniye sıfır kalır (21:22:14.0000000).
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
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import dayjs from "dayjs";

import Tablo from "./Tablo";
import { api } from "./api";

const { Title, Text, Paragraph } = Typography;

/** Veri değiştiren işlemler kırmızı; okuma sessiz kalır */
const islemRengi = (islem: string) =>
  ["DROP", "TRUNCATE", "ALTER", "DELETE"].includes(islem) ? "red"
  : ["INSERT", "UPDATE"].includes(islem) ? "orange"
  : undefined;

export default function ErisimDenetimi() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(await api.al<any>("/api/Basvuru/ErisimDenetimi"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const ozet = veri?.ozet;
  const elleGirilen = Number(ozet?.elleGirilen ?? 0);

  return (
    <div>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={14}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
            <Space size={8}>
              <ShieldAlert size={18} strokeWidth={2} />
              Erişim Denetimi
            </Space>
          </Title>
          <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Veritabanına kimin nereden bağlandığı ve başvuruların hangi yoldan
            girildiği. Oturum listesi anlıktır; bağlantı kapanınca kaybolur.
          </Paragraph>
        </Col>

        <Col xs={24} md={10} style={{ textAlign: "right" }}>
          <Button
            icon={<RefreshCw size={15} strokeWidth={2} />}
            loading={yukleniyor}
            onClick={getir}
          >
            Yenile
          </Button>
        </Col>
      </Row>

      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : (
        <>
          {/* ------------------------------------------- koruma durumu */}
          {veri?.korumaVar === false && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="Koruma tetikleyicisi devre dışı"
              description="Başvuru tablosuna dışarıdan ekleme engellenmiyor. Uygulamayı yeniden başlatmak tetikleyiciyi kurar."
            />
          )}

          {/* --------------------------------------------- özet kartlar */}
          <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  Toplam başvuru
                </Text>
                <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.3 }}>
                  {ozet?.toplam ?? 0}
                </div>
              </Card>
            </Col>

            <Col xs={12} md={6}>
              <Card size="small" style={{ background: "#f2f9e8" }}>
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  Panelden girilen
                </Text>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    lineHeight: 1.3,
                    color: "#5f8c10",
                  }}
                >
                  {ozet?.panelden ?? 0}
                </div>
              </Card>
            </Col>

            <Col xs={12} md={6}>
              <Card
                size="small"
                style={{ background: elleGirilen > 0 ? "#fff1f0" : undefined }}
              >
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  SQL'den elle girilen
                </Text>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    lineHeight: 1.3,
                    color: elleGirilen > 0 ? "#cf1322" : "#6b7280",
                  }}
                >
                  {elleGirilen}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {elleGirilen > 0 ? "incelemeye taşınacak" : "temiz"}
                </Text>
              </Card>
            </Col>

            <Col xs={12} md={6}>
              <Card size="small">
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  Engellenen deneme
                </Text>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    lineHeight: 1.3,
                    color:
                      (veri?.engellenenler ?? []).length > 0 ? "#d46b08" : "#6b7280",
                  }}
                >
                  {(veri?.engellenenler ?? []).length}
                </div>
              </Card>
            </Col>
          </Row>

          {/* ------------------------------------------ bağlı oturumlar */}
          <Card
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <Space size={8}>
                <Text strong style={{ fontSize: 13.5 }}>
                  Bağlı Oturumlar
                </Text>
                <Tag>{(veri?.oturumlar ?? []).length}</Tag>
              </Space>
            }
          >
            {veri?.oturumHatasi ? (
              <Alert
                type="warning"
                showIcon
                message="Oturum bilgileri okunamadı"
                description={
                  <span style={{ fontSize: 12.5 }}>
                    {veri.oturumHatasi}
                    <br />
                    Bu görünüm SQL kullanıcısında <b>VIEW SERVER STATE</b>{" "}
                    yetkisi ister.
                  </span>
                }
              />
            ) : (
              <Tablo
                rowKey="oturum"
                size="small"
                dataSource={veri?.oturumlar ?? []}
                pagination={false}
                scroll={{ x: 1400 }}
                locale={{ emptyText: "Başka bağlı oturum yok." }}
                rowClassName={(k: any) => (k.panelMi ? "" : "ed-disaridan")}
                columns={[
                  {
                    title: "Kaynak",
                    dataIndex: "panelMi",
                    width: 110,
                    render: (v: number) =>
                      v ? (
                        <Tag color="green">Panel</Tag>
                      ) : (
                        <Tooltip title="Bağlantı Biçen Kariyer uygulaması dışından açılmış.">
                          <Tag color="red">DIŞARIDAN</Tag>
                        </Tooltip>
                      ),
                  },
                  { title: "Kullanıcı", dataIndex: "kullanici", width: 130 },
                  {
                    title: "Windows",
                    dataIndex: "windowsHesabi",
                    width: 150,
                    ellipsis: true,
                    render: (v: string) => v || <Text type="secondary">—</Text>,
                  },
                  { title: "IP", dataIndex: "ip", width: 125 },
                  { title: "Bilgisayar", dataIndex: "bilgisayar", width: 140, ellipsis: true },
                  { title: "Uygulama", dataIndex: "uygulama", width: 165, ellipsis: true },
                  {
                    title: "İşlem",
                    dataIndex: "islem",
                    width: 100,
                    render: (v: string) =>
                      v && v !== "-" ? (
                        <Tag color={islemRengi(v)}>{v}</Tag>
                      ) : (
                        <Text type="secondary">—</Text>
                      ),
                  },
                  {
                    title: "Tablo",
                    dataIndex: "hedefTablo",
                    width: 150,
                    render: (v: string) => v || <Text type="secondary">—</Text>,
                  },
                  {
                    title: "Açık işlem",
                    dataIndex: "acikIslem",
                    width: 100,
                    align: "center" as const,
                    render: (v: number) =>
                      v > 0 ? (
                        <Tooltip title="Kapatılmamış işlem var; tablo kilitli kalmış olabilir.">
                          <Tag color="orange">{v}</Tag>
                        </Tooltip>
                      ) : (
                        <Text type="secondary">—</Text>
                      ),
                  },
                  {
                    title: "Son işlem",
                    dataIndex: "sonIslem",
                    width: 145,
                    render: (v: string) =>
                      v ? dayjs(v).format("DD.MM.YYYY HH:mm:ss") : "—",
                  },
                  {
                    title: "Sorgu",
                    dataIndex: "sorgu",
                    width: 320,
                    render: (v: string) =>
                      v ? (
                        <Tooltip title={v}>
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 11.5,
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 300,
                            }}
                          >
                            {v}
                          </span>
                        </Tooltip>
                      ) : (
                        <Text type="secondary">—</Text>
                      ),
                  },
                ]}
              />
            )}
          </Card>

          {/* ------------------------------------- engellenen denemeler */}
          <Card
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <Space size={8}>
                <ShieldCheck size={15} strokeWidth={2} />
                <Text strong style={{ fontSize: 13.5 }}>
                  Engellenen Ekleme Denemeleri
                </Text>
              </Space>
            }
          >
            <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
              Başvuru tablosuna uygulama dışından ekleme yapılmaya çalışıldığında
              işlem geri alınır ve buraya yazılır. Bu kayıtlar kalıcıdır.
            </Paragraph>

            {(veri?.engellenenler ?? []).length === 0 ? (
              <Empty description="Engellenen deneme yok." />
            ) : (
              <Tablo
                rowKey={(k: any) => `${k.tarih}-${k.kullanici}`}
                size="small"
                dataSource={veri.engellenenler}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                columns={[
                  {
                    title: "Tarih",
                    dataIndex: "tarih",
                    width: 155,
                    render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm:ss"),
                  },
                  { title: "Tablo", dataIndex: "tablo", width: 170 },
                  { title: "SQL kullanıcısı", dataIndex: "kullanici", width: 160 },
                  { title: "Makine", dataIndex: "makine", width: 160 },
                  { title: "Uygulama", dataIndex: "uygulama", ellipsis: true },
                ]}
              />
            )}
          </Card>

          {/* --------------------------------------- şüpheli başvurular */}
          <Card
            size="small"
            title={
              <Space size={8}>
                <Text strong style={{ fontSize: 13.5 }}>
                  Elle Girildiği Anlaşılan Başvurular
                </Text>
                <Tag color={(veri?.supheliler ?? []).length > 0 ? "red" : undefined}>
                  {(veri?.supheliler ?? []).length}
                </Tag>
              </Space>
            }
          >
            <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
              Oluşturma tarihinin kesirli saniyesi sıfır olan kayıtlar. Uygulama
              bu alanı hiç yazmaz, veritabanı varsayılanı devreye girer ve daima
              mikrosaniye üretir; sıfır kesir, tarihin elle yazıldığını gösterir.
              Bu kayıtlar İnceleme ekranına taşınmıştır.
            </Paragraph>

            {(veri?.supheliler ?? []).length === 0 ? (
              <Empty description="Elle girildiği anlaşılan başvuru yok." />
            ) : (
              <Tablo
                rowKey="id"
                size="small"
                dataSource={veri.supheliler}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                columns={[
                  { title: "Başvuru No", dataIndex: "basvuruNo", width: 175 },
                  { title: "Aday", dataIndex: "adSoyad", width: 175 },
                  { title: "Kimlik", dataIndex: "kimlikNo", width: 130 },
                  { title: "Şube", dataIndex: "subeAdi", width: 150, ellipsis: true },
                  {
                    title: "Gönderen IP",
                    dataIndex: "gonderenIp",
                    width: 130,
                    render: (v: string) => v || <Text type="secondary">—</Text>,
                  },
                  {
                    title: "Oluşturma",
                    dataIndex: "olusturma",
                    width: 165,
                    render: (v: string) => (
                      <span style={{ color: "#cf1322", fontFamily: "monospace" }}>
                        {dayjs(v).format("DD.MM.YYYY HH:mm:ss")}.000
                      </span>
                    ),
                  },
                  {
                    title: "Durum",
                    dataIndex: "incelendi",
                    width: 110,
                    render: (v: boolean) =>
                      v ? <Tag color="green">incelendi</Tag> : <Tag>bekliyor</Tag>,
                  },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

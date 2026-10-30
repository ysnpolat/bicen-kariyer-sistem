/**
 * ---------------------------------------------------------------------------
 * İK Referansları
 * ---------------------------------------------------------------------------
 * Görüşme sırasında adaydan alınan referanslar burada tutulur. Adayın formda
 * yazdığı referanslardan ayrıdır; bunlar İK'nın kendi kaydıdır.
 *
 * Her referans için ayrı bir görüşme notu tutulabilir: arandı mı, sonuç ne
 * oldu, neler konuşuldu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  MessageSquarePlus,
  Pencil,
  Phone,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import { api, islemYetkisi, oturumOku } from "./api";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

/** Referans görüşmesinin sonucu */
const SONUCLAR = [
  { value: "Olumlu", label: "Olumlu · tavsiye ediyor" },
  { value: "Çekimser", label: "Çekimser · net konuşmadı" },
  { value: "Olumsuz", label: "Olumsuz · tavsiye etmiyor" },
  { value: "Ulaşılamadı", label: "Ulaşılamadı" },
];

const sonucRengi = (sonuc?: string | null): string => {
  if (sonuc === "Olumlu") return "green";
  if (sonuc === "Çekimser") return "orange";
  if (sonuc === "Olumsuz") return "red";
  return "default";
};

export default function Referanslar({
  basvuruId,
  onListe,
  degisti,
}: {
  basvuruId: number;
  /** İsteğe bağlı: liste her okunduğunda üst bileşene bildirilir (sayaç için) */
  onListe?: (liste: any[]) => void;
  /** İsteğe bağlı: referans eklenince, düzenlenince ya da silinince çağrılır */
  degisti?: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const yetkim = islemYetkisi(oturumOku());

  const [yukleniyor, setYukleniyor] = useState(false);
  const [liste, setListe] = useState<any[]>([]);
  const [acik, setAcik] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<any>(null);

  /* Geri çağırma ref'te tutulur: değişen işlev kimliği okumayı yeniden
     tetiklemesin. */
  const onListeRef = useRef(onListe);
  onListeRef.current = onListe;

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const gelen = await api.al<any[]>(`/api/Basvuru/${basvuruId}/Referanslar`);
      setListe(gelen);
      onListeRef.current?.(gelen ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [basvuruId, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /** Yeni referans ya da düzenleme penceresini açar */
  const pencereAc = (kayit?: any) => {
    setDuzenlenen(kayit ?? null);

    form.setFieldsValue(
      kayit ?? {
        adSoyad: "",
        calistigiYer: "",
        gorev: "",
        telefon: "",
        yakinlik: "",
        gorusulduMu: false,
        gorusmeSonucu: undefined,
        gorusmeNotu: "",
        puan: undefined,
      }
    );

    setAcik(true);
  };

  const kaydet = async () => {
    try {
      const d = await form.validateFields();

      setKaydediliyor(true);

      await api.gonder(`/api/Basvuru/${basvuruId}/Referans`, {
        ...d,
        id: duzenlenen?.id ?? 0,
        /* Sonuç seçildiyse görüşme yapılmış sayılır */
        gorusulduMu: !!d.gorusmeSonucu,
      });

      message.success(
        duzenlenen ? "Referans güncellendi." : "Referans eklendi."
      );

      setAcik(false);
      getir();
      degisti?.();
    } catch (hata: any) {
      if (hata?.errorFields) return;
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = async (kayit: any) => {
    try {
      await api.sil(`/api/Basvuru/${basvuruId}/Referans/${kayit.id}`);
      message.success("Referans silindi.");
      getir();
      degisti?.();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const gorusulen = liste.filter((x) => x.gorusulduMu).length;

  return (
    <>
      <Card
        size="small"
        className="rf-kart"
        title={
          <Space size={8}>
            <Users size={16} strokeWidth={2} />
            İK Referansları
            {liste.length > 0 && (
              <Tag color={gorusulen === liste.length ? "green" : "default"}>
                {gorusulen} / {liste.length} görüşüldü
              </Tag>
            )}
          </Space>
        }
        extra={
          yetkim && (
            <Button
              size="small"
              type="primary"
              icon={<UserPlus size={14} strokeWidth={2} />}
              onClick={() => pencereAc()}
            >
              Referans ekle
            </Button>
          )
        }
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
          Görüşme sırasında aldığınız referanslar. Adayın formda yazdığı
          referanslardan ayrıdır; istediğiniz kadar ekleyebilirsiniz. Puan
          5'in altında girilirse başvuru otomatik olarak olumsuz duruma
          alınır.
        </Paragraph>

        {yukleniyor ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <Spin />
          </div>
        ) : liste.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Henüz referans eklenmemiş."
          />
        ) : (
          <div className="rf-liste">
            {liste.map((r) => (
              <div
                key={r.id}
                className={`rf-satir rf-${sonucRengi(r.gorusmeSonucu)}`}
              >
                <div className="rf-ust">
                  <div className="rf-kimlik">
                    <Text strong style={{ fontSize: 13.5 }}>
                      {r.adSoyad}
                    </Text>

                    {r.yakinlik && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.yakinlik}
                      </Text>
                    )}
                  </div>

                  <Space size={6}>
                    {typeof r.puan === "number" && (
                      <Tag
                        color={r.puan < 5 ? "red" : "green"}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {r.puan}/10
                      </Tag>
                    )}

                    {r.gorusmeSonucu ? (
                      <Tooltip
                        title={
                          r.gorusmeTarihi
                            ? dayjs(r.gorusmeTarihi).format("DD.MM.YYYY HH:mm")
                            : undefined
                        }
                      >
                        <Tag
                          color={sonucRengi(r.gorusmeSonucu)}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {r.gorusmeSonucu}
                        </Tag>
                      </Tooltip>
                    ) : (
                      <Tag style={{ marginInlineEnd: 0 }}>görüşülmedi</Tag>
                    )}

                    {yetkim && (
                      <>
                        <Tooltip title="Düzenle / görüşme notu">
                          <Button
                            size="small"
                            type="text"
                            icon={
                              r.gorusmeSonucu ? (
                                <Pencil size={14} strokeWidth={2} />
                              ) : (
                                <MessageSquarePlus size={14} strokeWidth={2} />
                              )
                            }
                            onClick={() => pencereAc(r)}
                          />
                        </Tooltip>

                        <Popconfirm
                          title="Referans silinsin mi?"
                          okText="Sil"
                          cancelText="Vazgeç"
                          onConfirm={() => sil(r)}
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<Trash2 size={14} strokeWidth={2} />}
                          />
                        </Popconfirm>
                      </>
                    )}
                  </Space>
                </div>

                <div className="rf-alanlar">
                  {r.calistigiYer && (
                    <span>
                      <i>Birlikte çalıştığı yer</i>
                      {r.calistigiYer}
                      {r.gorev ? ` · ${r.gorev}` : ""}
                    </span>
                  )}

                  {r.telefon && (
                    <span>
                      <i>Telefon</i>
                      <Space size={4}>
                        <Phone size={12} strokeWidth={2} color="#8a8f98" />
                        <Text copyable={{ text: r.telefon }}>{r.telefon}</Text>
                      </Space>
                    </span>
                  )}
                </div>

                {r.gorusmeNotu && (
                  <div className="rf-not">
                    <b>Görüşme notu:</b> {r.gorusmeNotu}
                  </div>
                )}

                <div className="rf-alt">
                  {r.kullaniciAdSoyad} ekledi ·{" "}
                  {dayjs(r.olusturma).format("DD.MM.YYYY")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------ pencere */}
      <Modal
        open={acik}
        title={duzenlenen ? "Referansı Düzenle" : "Referans Ekle"}
        okText="Kaydet"
        cancelText="Vazgeç"
        width={560}
        confirmLoading={kaydediliyor}
        onCancel={() => setAcik(false)}
        onOk={kaydet}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 14 }}>
          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Form.Item
                name="adSoyad"
                label="Ad Soyad"
                rules={[{ required: true, message: "Ad soyad zorunludur." }]}
              >
                <Input placeholder="Referansın adı soyadı" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={10}>
              <Form.Item name="telefon" label="Telefon">
                <Input placeholder="05xx xxx xx xx" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Form.Item name="calistigiYer" label="Birlikte Çalıştığı Yer">
                <Input placeholder="Şirket veya mağaza adı" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={10}>
              <Form.Item name="gorev" label="Görevi">
                <Input placeholder="Mağaza müdürü, şef..." />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="yakinlik"
            label="Adayla İlişkisi"
            extra="Eski yöneticisi, mesai arkadaşı gibi."
          >
            <Input placeholder="Eski yöneticisi" />
          </Form.Item>

          <div className="rf-ayrac">Referans Görüşmesi</div>

          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Form.Item
                name="gorusmeSonucu"
                label="Görüşme sonucu"
                extra="Boş bırakırsanız referans henüz görüşülmemiş sayılır."
              >
                <Select allowClear placeholder="Henüz görüşülmedi" options={SONUCLAR} />
              </Form.Item>
            </Col>

            <Col xs={24} sm={10}>
              <Form.Item
                name="puan"
                label="Puan (1-10)"
                extra="5'in altı başvuruyu otomatik olumsuz yapar."
                rules={[
                  {
                    type: "number",
                    min: 1,
                    max: 10,
                    message: "1 ile 10 arasında olmalı.",
                  },
                ]}
              >
                <InputNumber
                  min={1}
                  max={10}
                  style={{ width: "100%" }}
                  placeholder="Puan yok"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="gorusmeNotu" label="Görüşme notu">
            <TextArea
              rows={4}
              placeholder="Referansın aday hakkında söyledikleri, dikkat çeken noktalar"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

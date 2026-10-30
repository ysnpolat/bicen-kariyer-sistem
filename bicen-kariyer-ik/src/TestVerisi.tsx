/**
 * ---------------------------------------------------------------------------
 * Test Verisi
 * ---------------------------------------------------------------------------
 * Panelin akışını denemek için aday formunu doldurmadan başvuru oluşturur.
 * Zorunlu alan yoktur; boş bırakılan bilgiler otomatik tamamlanır.
 *
 * Üretilen kayıtlar "TEST" olarak işaretlenir ve tek tuşla temizlenebilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
} from "antd";
import { FlaskConical, Plus, RefreshCw, Shuffle, Trash2 } from "lucide-react";

import { DURUMLAR, api } from "./api";

const { Title, Text, Paragraph } = Typography;

interface Birim {
  kod: string;
  ad: string;
  tur: string;
}

interface BirimTuru {
  ad: string;
  bolumler: string[];
}

export default function TestVerisi() {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm();

  const [birimler, setBirimler] = useState<Birim[]>([]);
  const [turler, setTurler] = useState<BirimTuru[]>([]);
  const [testSayisi, setTestSayisi] = useState(0);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [adet, setAdet] = useState(10);
  const [gun, setGun] = useState(90);

  const seciliBirim = Form.useWatch("subeKodu", form);

  const bolumSecenekleri = (() => {
    const birim = birimler.find((x) => x.kod === seciliBirim);
    if (!birim) return [];
    return turler.find((t) => t.ad === birim.tur)?.bolumler ?? [];
  })();

  /* -------------------------------------------------------------- yükleme */

  const sayiGetir = useCallback(async () => {
    try {
      const s = await api.al<{ adet: number }>("/api/Test/Sayi");
      setTestSayisi(s.adet);
    } catch {
      /* sessiz geçilir */
    }
  }, []);

  useEffect(() => {
    api
      .al<any>("/api/Ayar/Form")
      .then((a) => {
        setBirimler(a.subeler ?? []);
        setTurler(a.birimTurleri ?? []);
      })
      .catch(() => undefined);

    sayiGetir();
  }, [sayiGetir]);

  /* --------------------------------------------------------------- işlemler */

  const tekOlustur = async () => {
    const d = form.getFieldsValue();
    setYukleniyor(true);
    try {
      await api.gonder("/api/Test/Basvuru", d);
      message.success("Test başvurusu oluşturuldu.");
      form.resetFields();
      sayiGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const topluOlustur = async () => {
    setYukleniyor(true);
    try {
      const sonuc = await api.gonder<{ uretilen: number }>(
        `/api/Test/Rastgele?adet=${adet}&gun=${gun}`
      );
      message.success(`${sonuc.uretilen} test başvurusu oluşturuldu.`);
      sayiGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const temizle = () => {
    modal.confirm({
      title: "Tüm test kayıtları silinsin mi?",
      content:
        "Yalnızca bu ekrandan üretilen kayıtlar silinir. Gerçek başvurular etkilenmez.",
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil("/api/Test/Temizle");
          message.success("Test kayıtları temizlendi.");
          sayiGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* ---------------------------------------------------------------- görünüm */

  return (
    <div className="ik-icerik">
      <Alert
        type="warning"
        showIcon
        icon={<FlaskConical size={16} strokeWidth={2} />}
        className="ts-uyari"
        message="Bu ekran yalnızca test içindir"
        description="Buradan üretilen başvurular listede ve raporlarda TEST etiketiyle görünür. Sisteme gerçek başvurular gelmeye başladığında bu kayıtları temizlemeyi unutmayınız."
      />

      <Row gutter={[14, 14]}>
        {/* --------------------------------------------------- tekil kayıt */}
        <Col xs={24} lg={12}>
          <Card size="small" style={{ height: "100%" }}>
            <Title level={5} style={{ marginTop: 0 }}>
              <Space size={8}>
                <Plus size={17} strokeWidth={2} />
                Tek Başvuru Oluştur
              </Space>
            </Title>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Tüm alanlar isteğe bağlıdır. Boş bıraktıklarınız rastgele
              doldurulur; belirli bir durumu denemek için yalnızca ilgili alanı
              girmeniz yeterlidir.
            </Paragraph>

            <Form form={form} layout="vertical">
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item name="adSoyad" label="Ad Soyad">
                    <Input placeholder="Boş bırakılırsa rastgele" />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item name="telefon" label="Telefon">
                    <Input placeholder="05XX XXX XX XX" maxLength={15} />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item name="kimlikNo" label="Kimlik No">
                    <Input placeholder="Boş bırakılırsa rastgele" maxLength={11} />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item name="eposta" label="E-posta">
                    <Input placeholder="Mail denemesi için doldurunuz" />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item name="subeKodu" label="Birim">
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="Rastgele"
                      options={birimler.map((x) => ({
                        value: x.kod,
                        label: `${x.ad} · ${x.tur}`,
                      }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item name="durum" label="Durum">
                    <Select
                      allowClear
                      placeholder="Yeni"
                      options={DURUMLAR.map((x) => ({ value: x, label: x }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Form.Item
                    name="bolumler"
                    label="Pozisyonlar"
                    extra={
                      seciliBirim
                        ? undefined
                        : "Birim seçilirse o birime ait pozisyonlar listelenir."
                    }
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Rastgele"
                      options={bolumSecenekleri.map((x) => ({ value: x, label: x }))}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Button
                type="primary"
                loading={yukleniyor}
                icon={<Plus size={15} strokeWidth={2} />}
                onClick={tekOlustur}
              >
                Başvuru oluştur
              </Button>
            </Form>
          </Card>
        </Col>

        {/* --------------------------------------------------- toplu üretim */}
        <Col xs={24} lg={12}>
          <Card size="small" style={{ height: "100%" }}>
            <Title level={5} style={{ marginTop: 0 }}>
              <Space size={8}>
                <Shuffle size={17} strokeWidth={2} />
                Toplu Rastgele Üretim
              </Space>
            </Title>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Raporları ve havuzu denemek için toplu kayıt üretir. Başvurular
              birimlere, pozisyonlara ve durumlara rastgele dağıtılır; tarihleri
              geçmişe yayılır, böylece aylık grafik anlamlı görünür.
            </Paragraph>

            <Row gutter={12}>
              <Col xs={12}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  Kayıt sayısı
                </Text>
                <InputNumber
                  min={1}
                  max={200}
                  value={adet}
                  onChange={(v) => setAdet(Number(v) || 10)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </Col>

              <Col xs={12}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  Son kaç güne yayılsın
                </Text>
                <InputNumber
                  min={1}
                  max={730}
                  value={gun}
                  onChange={(v) => setGun(Number(v) || 90)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </Col>
            </Row>

            <Button
              type="primary"
              block
              size="large"
              loading={yukleniyor}
              icon={<Shuffle size={16} strokeWidth={2} />}
              onClick={topluOlustur}
              style={{ marginTop: 16 }}
            >
              {adet} kayıt üret
            </Button>

            <Divider />

            <Row gutter={12} align="middle">
              <Col xs={12}>
                <Statistic title="Mevcut test kaydı" value={testSayisi} />
              </Col>

              <Col xs={12}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Button
                    block
                    icon={<RefreshCw size={15} strokeWidth={2} />}
                    onClick={sayiGetir}
                  >
                    Yenile
                  </Button>
                  <Button
                    block
                    danger
                    disabled={testSayisi === 0}
                    icon={<Trash2 size={15} strokeWidth={2} />}
                    onClick={temizle}
                  >
                    Test kayıtlarını sil
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

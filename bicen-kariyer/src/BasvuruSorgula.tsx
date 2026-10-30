/**
 * ---------------------------------------------------------------------------
 * Başvuru Sorgulama
 * ---------------------------------------------------------------------------
 * Aday, başvuru sırasında girdiği kimlik numarası ve cep telefonu ile
 * başvurularını listeler, formunun doldurulmuş hâlini görüntüler.
 * ---------------------------------------------------------------------------
 */

import { useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Row,
  Tag,
  Typography,
} from "antd";
import { ArrowLeft, FileText, Printer, Search } from "lucide-react";

import FormOnizleme from "./FormOnizleme";
import { basvuruSorgula } from "./depo";
import { AYARLAR } from "./sabitler";
import type { BasvuruDto } from "./tipler";
import { sadeceRakam } from "./yardimcilar";

const { Title, Text } = Typography;

export default function BasvuruSorgula({ geriDon }: { geriDon: () => void }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [arandi, setArandi] = useState(false);
  const [sonuclar, setSonuclar] = useState<BasvuruDto[]>([]);
  const [secili, setSecili] = useState<BasvuruDto | null>(null);

  const sorgula = async () => {
    let d: any;
    try {
      d = await form.validateFields();
    } catch {
      return;
    }

    setYukleniyor(true);
    try {
      const liste = await basvuruSorgula(d.kimlikNo, d.telefon);
      setSonuclar(liste);
      setArandi(true);
      setSecili(null);
    } catch (hata: any) {
      message.error(hata?.message ?? "Sorgulama sırasında bir sorun oluştu.");
    } finally {
      setYukleniyor(false);
    }
  };

  /* ------------------------------------------------------- detay görünümü */
  if (secili) {
    return (
      <div className="bsv-sayfa">
        <div className="bsv-kapsayici">
          <div className="bsv-yazdirilamaz">
            <Row gutter={12} style={{ marginBottom: 14 }}>
              <Col xs={12}>
                <Button
                  block
                  size="large"
                  icon={<ArrowLeft size={17} strokeWidth={2} />}
                  onClick={() => setSecili(null)}
                >
                  Listeye dön
                </Button>
              </Col>
              <Col xs={12}>
                <Button
                  block
                  size="large"
                  className="bsv-ana-btn"
                  icon={<Printer size={17} strokeWidth={2} />}
                  onClick={() => window.print()}
                >
                  Yazdır / PDF
                </Button>
              </Col>
            </Row>
          </div>

          <Card className="bsv-kart bsv-onizleme-kart" variant="borderless">
            <FormOnizleme basvuru={secili} />
          </Card>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------- sorgu ekranı */
  return (
    <div className="bsv-sayfa">
      <div className="bsv-kapsayici">
        <div className="bsv-ust">
          <img
            src={AYARLAR.logoYolu}
            alt="Biçen Market"
            className="bsv-logo"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <Title level={3} className="bsv-ust-baslik">
            BAŞVURULARIM
          </Title>
          <Text className="bsv-dokuman-no">
            Kimlik numaranız ve cep telefonunuz ile başvurularınızı görüntüleyin
          </Text>
        </div>

        <Card className="bsv-kart" variant="borderless">
          <Form form={form} layout="vertical" onFinish={sorgula}>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="kimlikNo"
                  label="T.C. Kimlik / Pasaport No"
                  rules={[{ required: true, message: "Kimlik numaranızı giriniz." }]}
                >
                  <Input
                    placeholder="Başvuruda kullandığınız numara"
                    maxLength={20}
                    autoComplete="off"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="telefon"
                  label="Cep Telefonu"
                  rules={[
                    { required: true, message: "Telefon numaranızı giriniz." },
                    { pattern: /^5[0-9]{9}$/, message: "5XXXXXXXXX biçiminde giriniz." },
                  ]}
                >
                  <Input
                    addonBefore="+90"
                    placeholder="5XXXXXXXXX"
                    maxLength={10}
                    inputMode="numeric"
                    onKeyPress={sadeceRakam}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col xs={10} sm={8}>
                <Button block size="large" onClick={geriDon} disabled={yukleniyor}>
                  Geri
                </Button>
              </Col>
              <Col xs={14} sm={16}>
                <Button
                  block
                  size="large"
                  className="bsv-ana-btn"
                  loading={yukleniyor}
                  onClick={sorgula}
                  icon={!yukleniyor ? <Search size={17} strokeWidth={2} /> : undefined}
                >
                  Başvurularımı getir
                </Button>
              </Col>
            </Row>
          </Form>

          {!AYARLAR.apiAktif && (
            <Alert
              type="info"
              showIcon
              className="bsv-uyari"
              message="Sunucuya ulaşılamadığı için başvurularınız yalnızca bu cihaz üzerinden görüntülenmektedir."
            />
          )}

          {arandi && sonuclar.length === 0 && (
            <Empty
              className="bsv-bos"
              description="Girdiğiniz bilgilere ait başvuru bulunamadı. Kimlik numaranızı ve telefonunuzu kontrol ediniz."
            />
          )}

          {sonuclar.length > 0 && (
            <div className="bsv-sonuc-liste">
              {sonuclar.map((b) => (
                <div key={b.basvuruNo} className="bsv-sonuc-kutu">
                  <div className="bsv-sonuc-ust">
                    <Text strong>{b.basvuruNo}</Text>
                    <Tag color="green">{b.gonderimZamani}</Tag>
                  </div>
                  <div className="bsv-sonuc-bilgi">
                    <span>
                      <b>Aday:</b> {b.adayAdSoyad}
                    </span>
                    <span>
                      <b>Şube:</b> {b.subeAdi}
                    </span>
                    <span>
                      <b>Bölümler:</b>{" "}
                      {b.bolumler?.length ? b.bolumler.join(", ") : "—"}
                    </span>
                  </div>
                  <Button
                    block
                    className="bsv-ekle-btn"
                    icon={<FileText size={16} strokeWidth={2} />}
                    onClick={() => setSecili(b)}
                  >
                    Formu görüntüle
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="bsv-alt">
          <div className="bsv-alt-marka">Biçen Market · İnsan Kaynakları</div>
        </div>
      </div>
    </div>
  );
}

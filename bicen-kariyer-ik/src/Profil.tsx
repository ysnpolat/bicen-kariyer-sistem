/**
 * ---------------------------------------------------------------------------
 * Profilim
 * ---------------------------------------------------------------------------
 * Kullanıcı kendi bilgilerini düzenler. Ünvan ve telefon, oluşturduğu görüşme
 * davetlerinde adaya gönderilen mailde imza olarak görünür.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Typography,
} from "antd";
import { Lock, Phone, User } from "lucide-react";

import { api } from "./api";

const { Text, Paragraph } = Typography;

export default function Profil({
  acik,
  kapat,
  guncellendi,
}: {
  acik: boolean;
  kapat: () => void;
  guncellendi: (adSoyad: string) => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [yukleniyor, setYukleniyor] = useState(false);

  useEffect(() => {
    if (!acik) return;

    api
      .al<any>("/api/Auth/Profil")
      .then((p) => form.setFieldsValue({ ...p, yeniParola: "" }))
      .catch((hata: any) => message.error(hata.message));
  }, [acik, form, message]);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();
      setYukleniyor(true);

      await api.gonder("/api/Auth/Profil", d);

      message.success(
        d.yeniParola
          ? "Profiliniz ve parolanız güncellendi."
          : "Profiliniz güncellendi."
      );

      guncellendi(d.adSoyad);
      form.setFieldValue("yeniParola", "");
      kapat();
    } catch (hata: any) {
      if (!hata?.errorFields) message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <Modal
      open={acik}
      title="Profilim"
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={yukleniyor}
      onOk={kaydet}
      onCancel={kapat}
      width={560}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12, marginBottom: 16 }}
        message="Ünvan ve telefon bilgileriniz, oluşturduğunuz görüşme davetlerinde adaya gönderilen mailde imza olarak görünür."
      />

      <Form form={form} layout="vertical">
        <Form.Item name="kullaniciAdi" label="Kullanıcı Adı">
          <Input disabled prefix={<User size={15} strokeWidth={2} color="#6B7280" />} />
        </Form.Item>

        <Row gutter={14}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="adSoyad"
              label="Ad Soyad"
              rules={[{ required: true, message: "Ad soyad giriniz." }]}
            >
              <Input placeholder="Örn: Caner Alkan" maxLength={100} />
            </Form.Item>
          </Col>

          <Col xs={24} sm={12}>
            <Form.Item
              name="unvan"
              label="Ünvan"
              extra="Mailde adınızın üstünde görünür."
            >
              <Input placeholder="Örn: İnsan Kaynakları Uzmanı" maxLength={100} />
            </Form.Item>
          </Col>

          <Col xs={24} sm={12}>
            <Form.Item
              name="telefon"
              label="Cep Telefonu"
              extra="Adaylar bu numaradan size ulaşabilir."
            >
              <Input
                placeholder="0532 000 00 00"
                maxLength={25}
                prefix={<Phone size={15} strokeWidth={2} color="#6B7280" />}
              />
            </Form.Item>
          </Col>

          <Col xs={24} sm={12}>
            <Form.Item
              name="eposta"
              label="E-posta"
              rules={[{ type: "email", message: "Geçerli bir e-posta giriniz." }]}
            >
              <Input placeholder="ornek@bicen.com.tr" maxLength={150} />
            </Form.Item>
          </Col>
        </Row>

        <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 6 }}>
          Parolanızı değiştirmek istemiyorsanız aşağıdaki alanı boş bırakınız.
        </Paragraph>

        <Form.Item
          name="yeniParola"
          label="Yeni Parola"
          rules={[{ min: 6, message: "Parola en az 6 karakter olmalıdır." }]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder="Değiştirmek istemiyorsanız boş bırakınız"
            prefix={<Lock size={15} strokeWidth={2} color="#6B7280" />}
          />
        </Form.Item>

        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Parolanızı değiştirdikten sonra oturumunuz açık kalır; bir sonraki
          girişte yeni parolanızı kullanınız.
        </Text>
      </Form>
    </Modal>
  );
}

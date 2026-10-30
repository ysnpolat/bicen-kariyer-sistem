/**
 * ---------------------------------------------------------------------------
 * Sertifika ve Belgeleriniz
 * ---------------------------------------------------------------------------
 * Aday her sertifika için ad, kurum ve tarih girer; belgeyi bağlantı olarak
 * ekleyebilir veya fotoğrafını yükleyebilir. Görseller tarayıcı tarafında
 * küçültülüp JPEG olarak sıkıştırılır.
 * ---------------------------------------------------------------------------
 */

import { useRef, useState } from "react";
import { App as AntdApp, Button, Col, Form, Input, Row, Typography } from "antd";
import { Award, Camera, Link2, Plus, Trash2, X } from "lucide-react";

import { SERTIFIKA_AYARLARI } from "./sabitler";
import type { SertifikaGorseli } from "./tipler";
import { gorselAdresi, gorselKucult } from "./yardimcilar";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */
/* Görsel seçici (Form.Item tarafından kontrol edilir)                         */
/* -------------------------------------------------------------------------- */

function GorselSecici({
  value,
  onChange,
}: {
  value?: SertifikaGorseli | null;
  onChange?: (yeni: SertifikaGorseli | null) => void;
}) {
  const { message } = AntdApp.useApp();
  const girdiRef = useRef<HTMLInputElement>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const dosyaSecildi = async (olay: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = olay.target.files?.[0];
    olay.target.value = "";
    if (!dosya) return;

    if (dosya.type && !dosya.type.startsWith("image/")) {
      message.error("Lütfen bir görsel dosyası seçiniz.");
      return;
    }

    if (dosya.size / 1024 / 1024 > SERTIFIKA_AYARLARI.enFazlaMB) {
      message.error(`Görsel en fazla ${SERTIFIKA_AYARLARI.enFazlaMB} MB olabilir.`);
      return;
    }

    setIsleniyor(true);
    try {
      const kucuk = await gorselKucult(dosya);
      onChange?.(kucuk);
    } catch (hata: any) {
      message.error({
        content: hata?.message ?? "Görsel işlenemedi. Farklı bir dosya deneyiniz.",
        duration: 8,
      });
    } finally {
      setIsleniyor(false);
    }
  };

  if (value) {
    return (
      <div className="srt-gorsel-onizleme">
        <img src={gorselAdresi(value)} alt={value.ad} />
        <div className="srt-gorsel-bilgi">
          <Text ellipsis style={{ fontSize: 12.5 }}>
            {value.ad}
          </Text>
          <Button
            type="text"
            danger
            size="small"
            icon={<X size={15} strokeWidth={2} />}
            onClick={() => onChange?.(null)}
          >
            Kaldır
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={girdiRef}
        type="file"
        accept="image/*,.heic,.heif"
        style={{ display: "none" }}
        onChange={dosyaSecildi}
      />
      <Button
        block
        loading={isleniyor}
        className="srt-yukle-btn"
        icon={!isleniyor ? <Camera size={16} strokeWidth={2} /> : undefined}
        onClick={() => girdiRef.current?.click()}
      >
        Sertifika görseli / fotoğrafı ekle
      </Button>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sertifika listesi                                                           */
/* -------------------------------------------------------------------------- */

export default function SertifikaAlani() {
  return (
    <Form.List name="sertifikalar">
      {(satirlar, { add, remove }) => (
        <div className="bsv-liste">
          {satirlar.map((satir, sira) => (
            <div key={satir.key} className="bsv-liste-kutu srt-kutu">
              <div className="bsv-liste-ust">
                <span className="bsv-liste-no">{sira + 1}</span>
                <Text strong>Sertifika</Text>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<Trash2 size={15} strokeWidth={2} />}
                  onClick={() => remove(satir.name)}
                >
                  Kaldır
                </Button>
              </div>

              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name={[satir.name, "ad"]}
                    label="Sertifika Adı"
                    rules={[{ required: true, message: "Sertifika adını giriniz." }]}
                  >
                    <Input placeholder="Örn: Hijyen Eğitimi" maxLength={100} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name={[satir.name, "kurum"]} label="Veren Kurum">
                    <Input placeholder="Örn: Halk Eğitim Merkezi" maxLength={100} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name={[satir.name, "tarih"]} label="Alınma Tarihi">
                    <Input placeholder="Örn: 2024" maxLength={20} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name={[satir.name, "link"]}
                    label="Belge Bağlantısı"
                    rules={[
                      {
                        pattern: /^([a-zA-Z]+:\/\/)?[\w.-]+\.[a-zA-Z]{2,}(\/\S*)?$/,
                        message: "Geçerli bir adres giriniz.",
                      },
                    ]}
                  >
                    <Input
                      placeholder="ornek.com/sertifika"
                      maxLength={300}
                      prefix={<Link2 size={15} strokeWidth={2} color="#6B7280" />}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item name={[satir.name, "gorsel"]} label="Sertifika Görseli">
                    <GorselSecici />
                  </Form.Item>
                </Col>
              </Row>
            </div>
          ))}

          {satirlar.length < SERTIFIKA_AYARLARI.enFazlaAdet && (
            <Button
              block
              onClick={() => add({})}
              icon={
                satirlar.length === 0 ? (
                  <Award size={17} strokeWidth={2} />
                ) : (
                  <Plus size={17} strokeWidth={2} />
                )
              }
              className="bsv-ekle-btn"
            >
              {satirlar.length === 0 ? "Sertifika ekle" : "Yeni sertifika ekle"}
            </Button>
          )}

          <Text type="secondary" className="bsv-ipucu">
            Sertifikanızı bağlantı olarak ekleyebilir veya fotoğrafını
            yükleyebilirsiniz. En fazla {SERTIFIKA_AYARLARI.enFazlaAdet} sertifika
            eklenebilir; sertifikanız yoksa bu bölümü boş bırakabilirsiniz.
          </Text>
        </div>
      )}
    </Form.List>
  );
}

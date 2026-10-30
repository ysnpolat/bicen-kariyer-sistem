/**
 * ---------------------------------------------------------------------------
 * Biçen360 - Giriş
 * ---------------------------------------------------------------------------
 * İki sütunlu düzen: solda marka alanı, sağda giriş formu. Dar ekranlarda
 * marka alanı gizlenir ve yalnızca form gösterilir. Düzen İK paneliyle
 * aynı; iki panel yan yana kullanılacak.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Typography, message } from "antd";
import {
  ArrowLeft,
  Bell,
  LogIn,
  Lock,
  ScanLine,
  ShieldCheck,
  Tag,
  User,
} from "lucide-react";

import { API_TABAN, LOGO_ADRESI, api, oturumYaz, type Oturum } from "./api";

const { Title, Text } = Typography;

export default function Giris({
  girisYapildi,
  karsilamaya,
}: {
  girisYapildi: (o: Oturum) => void;
  karsilamaya?: () => void;
}) {
  /* Logo ve tanıtım metinleri karşılama sayfasıyla aynı kaynaktan:
     iki ekranda ayrı metin tutmak, biri güncellenince diğerinin eski
     kalmasına yol açıyordu. */
  const [icerik, setIcerik] = useState<any>(null);

  useEffect(() => {
    api
      .getir<any>("Portal/Icerik")
      .then(setIcerik)
      /* Alınamazsa gömülü varsayılanlarla devam: giriş formu her
         koşulda açılmalı. */
      .catch(() => setIcerik(null));
  }, []);

  const logoAdresi = icerik?.logo?.adres
    ? `${API_TABAN}${icerik.logo.adres}`
    : LOGO_ADRESI;

  const ozellikler: { baslik: string; metin: string }[] =
    icerik?.ozellikler?.length ? icerik.ozellikler.slice(0, 3) : [];

  const [form] = Form.useForm();
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const giris = async () => {
    setHata(null);

    try {
      const d = await form.validateFields();
      setYukleniyor(true);

      const oturum = await api.gonder<Oturum>("Giris", d);
      oturumYaz(oturum);
      girisYapildi(oturum);
    } catch (h: any) {
      /* Alan doğrulama hataları formda görünür; diğerleri kutuda yazılır */
      if (!h?.errorFields) {
        setHata(h.message || "Giriş yapılamadı.");
        message.error(h.message || "Giriş yapılamadı.");
      }
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <div className="gr-sayfa">
      {/* Arka plandaki yumuşak şekiller */}
      <div className="gr-sekil gr-sekil-1" />
      <div className="gr-sekil gr-sekil-2" />
      <div className="gr-sekil gr-sekil-3" />

      <div className="gr-kart">
        {/* ------------------------------------------------------ marka alanı */}
        <div className="gr-marka">
          <div className="gr-marka-icerik">
            <img
              src={logoAdresi}
              alt="Biçen Market"
              className="gr-marka-logo"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />

            <Title level={3} className="gr-marka-baslik">
              {icerik?.baslik ?? "Biçen360"}
              <br />
              <span style={{ fontWeight: 500, fontSize: "0.72em" }}>
                {icerik?.altBaslik ?? "Yönetim Paneli"}
              </span>
            </Title>

            <div className="gr-marka-cizgi" />

            {/* Özellikler ayarlardan geliyor; tanımlı değilse sistemin
                bilinen yetenekleri gösteriliyor. */}
            <ul className="gr-ozellikler">
              {ozellikler.length > 0 ? (
                ozellikler.map((o, i) => (
                  <li key={i}>
                    {[<ScanLine key="a" size={16} strokeWidth={2} />,
                      <Bell key="b" size={16} strokeWidth={2} />,
                      <Tag key="c" size={16} strokeWidth={2} />][i % 3]}
                    <span>{o.baslik}</span>
                  </li>
                ))
              ) : (
                <>
                  <li>
                    <ScanLine size={16} strokeWidth={2} />
                    <span>Künye okutmalarını ve fiyat farklarını raporlayın</span>
                  </li>
                  <li>
                    <Bell size={16} strokeWidth={2} />
                    <span>Mağazalardan gelen arıza kayıtlarını yönetin</span>
                  </li>
                  <li>
                    <Tag size={16} strokeWidth={2} />
                    <span>Rakip fiyatlarını kendi fiyatlarımızla karşılaştırın</span>
                  </li>
                </>
              )}
            </ul>
          </div>

          <div className="gr-marka-alt">Biçen Market · Biçen360</div>
        </div>

        {/* ------------------------------------------------------ form alanı */}
        <div className="gr-form">
          <div className="gr-form-ust">
            <img
              src={logoAdresi}
              alt="Biçen Market"
              className="gr-form-logo"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <Title level={4} className="gr-form-baslik">
              Hoş geldiniz
            </Title>
            <Text type="secondary" style={{ fontSize: 13.5 }}>
              {icerik?.girisYazisi ||
                "Kariyer panelindeki hesabınızla giriş yapınız"}
            </Text>
          </div>

          {hata && (
            <Alert
              type="error"
              showIcon
              className="gr-hata"
              message={hata}
              closable
              onClose={() => setHata(null)}
            />
          )}

          <Form
            form={form}
            layout="vertical"
            onFinish={giris}
            className="gr-form-alan"
            onValuesChange={() => hata && setHata(null)}
          >
            <Form.Item
              name="kullaniciAdi"
              label="Kullanıcı Adı"
              rules={[{ required: true, message: "Kullanıcı adınızı giriniz." }]}
            >
              <Input
                size="large"
                autoComplete="username"
                placeholder="kullanici.adi"
                prefix={<User size={16} strokeWidth={2} color="#9AA3AF" />}
              />
            </Form.Item>

            <Form.Item
              name="parola"
              label="Parola"
              rules={[{ required: true, message: "Parolanızı giriniz." }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                placeholder="••••••••"
                prefix={<Lock size={16} strokeWidth={2} color="#9AA3AF" />}
              />
            </Form.Item>

            <Button
              block
              size="large"
              type="primary"
              htmlType="submit"
              loading={yukleniyor}
              className="gr-dugme"
              icon={!yukleniyor ? <LogIn size={17} strokeWidth={2} /> : undefined}
            >
              Giriş yap
            </Button>
          </Form>

          {/* Karşılamaya dönüş: adres satırına #giris yazıp gelen ya da
              yanlışlıkla forma düşen kullanıcı geri dönebilmeli. */}
          {karsilamaya && (
            <Button
              type="link"
              className="gr-geri"
              onClick={karsilamaya}
              icon={<ArrowLeft size={14} strokeWidth={2} />}
            >
              Karşılama sayfasına dön
            </Button>
          )}

          <div className="gr-form-alt">
            <ShieldCheck size={13} strokeWidth={2} />
            <span>Bu alan yalnızca yetkili personel içindir.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

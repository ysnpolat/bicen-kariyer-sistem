/**
 * ---------------------------------------------------------------------------
 * İK / Yönetim Paneli - Giriş
 * ---------------------------------------------------------------------------
 * İki sütunlu düzen: solda marka alanı, sağda giriş formu. Dar ekranlarda
 * marka alanı gizlenir ve yalnızca form gösterilir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, Form, Input, Typography } from "antd";
import { ClipboardList, LogIn, Lock, ShieldCheck, User, Users } from "lucide-react";

import GuvenlikDogrulamasi from "./GuvenlikDogrulamasi";
import { LOGO_ADRESI, api, oturumYaz, type Oturum } from "./api";

const { Title, Text } = Typography;

export default function Giris({ girisYapildi }: { girisYapildi: (o: Oturum) => void }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  /* Doğrulama yalnızca hatalı denemeden sonra istenir */
  const [dogrulamaGerekli, setDogrulamaGerekli] = useState(false);
  const [siteAnahtari, setSiteAnahtari] = useState("");
  const [jeton, setJeton] = useState("");

  /* Dış hukuk danışmanı girişi (24.10.2026): ayrı hesap, telefona SMS kodu */
  const [hukuk, setHukuk] = useState(false);
  const [kodAdim, setKodAdim] = useState<{ gecici: string; telefon: string } | null>(null);
  const [kod, setKod] = useState("");
  const [hkKimlik, setHkKimlik] = useState("");
  const [hkTelefon, setHkTelefon] = useState("");

  const hukukGiris = async () => {
    setHata(null);
    try {
      setYukleniyor(true);
      let r: any;
      if (kodAdim) {
        if (!/^\d{6}$/.test(kod.trim())) throw new Error("Telefonunuza gelen 6 haneli kodu giriniz.");
        r = await api.gonder<any>("/api/Hukuk/GirisDogrula", { gecici: kodAdim.gecici, kod: kod.trim() });
      } else {
        const k = hkKimlik.replace(/\D/g, "");
        const t = hkTelefon.replace(/\D/g, "").replace(/^0/, "");
        if (k.length !== 11) throw new Error("Kimlik numarası 11 haneli olmalıdır.");
        if (t.length !== 10) throw new Error("Telefon numarasını başında sıfır olmadan giriniz.");
        r = await api.gonder<any>("/api/Hukuk/Giris", { kimlikNo: k, telefon: t, mobil: false });
        if (r?.ikinciAdim) {
          setKodAdim({ gecici: r.gecici, telefon: r.telefon });
          setKod("");
          return;
        }
      }
      oturumYaz(r as Oturum);
      girisYapildi(r as Oturum);
    } catch (h: any) {
      if (!h?.errorFields) {
        setHata(h.message || "Giriş yapılamadı.");
        if (/yeniden giriş/i.test(h.message ?? "")) setKodAdim(null);
      }
    } finally {
      setYukleniyor(false);
    }
  };

  /* Sayfa açılırken bu adres için doğrulama gerekip gerekmediği sorulur */
  useEffect(() => {
    api
      .al<any>("/api/Auth/GirisDurumu")
      .then((d) => {
        setDogrulamaGerekli(!!d?.dogrulamaGerekli);
        setSiteAnahtari(d?.siteAnahtari ?? "");
      })
      .catch(() => undefined);
  }, []);

  const giris = async () => {
    setHata(null);

    try {
      const d = await form.validateFields();
      setYukleniyor(true);

      const oturum = await api.gonder<Oturum>("/api/Auth/Giris", {
        ...d,
        dogrulamaJetonu: jeton,
      });
      oturumYaz(oturum);
      girisYapildi(oturum);
    } catch (h: any) {
      // Alan doğrulama hataları formda görünür; diğerleri kutuda yazılır
      if (!h?.errorFields) {
        setHata(h.message || "Giriş yapılamadı.");
        message.error(h.message || "Giriş yapılamadı.");

        /* Sunucu doğrulama istiyorsa kutu gösterilir */
        if (h?.ayrinti?.dogrulamaGerekli || h?.dogrulamaGerekli) {
          setDogrulamaGerekli(true);
          if (h.siteAnahtari) setSiteAnahtari(h.siteAnahtari);
        } else {
          /* Durumu sunucudan tazele */
          api
            .al<any>("/api/Auth/GirisDurumu")
            .then((d) => {
              setDogrulamaGerekli(!!d?.dogrulamaGerekli);
              setSiteAnahtari(d?.siteAnahtari ?? "");
            })
            .catch(() => undefined);
        }

        setJeton("");
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
              src={LOGO_ADRESI}
              alt="Biçen Market"
              className="gr-marka-logo"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />

            <Title level={3} className="gr-marka-baslik">
              İnsan Kaynakları
              <br />
              Yönetim Paneli
            </Title>

            <div className="gr-marka-cizgi" />

            <ul className="gr-ozellikler">
              <li>
                <ClipboardList size={16} strokeWidth={2} />
                <span>Başvuruları tek ekrandan değerlendirin</span>
              </li>
              <li>
                <Users size={16} strokeWidth={2} />
                <span>Aday havuzunu ve açık kadroları takip edin</span>
              </li>
              <li>
                <ShieldCheck size={16} strokeWidth={2} />
                <span>Aday verileri KVKK kapsamında korunur</span>
              </li>
            </ul>
          </div>

          <div className="gr-marka-alt">Biçen Market · Kariyer Sistemi</div>
        </div>

        {/* ------------------------------------------------------ form alanı */}
        <div className="gr-form">
          <div className="gr-form-ust">
            <img
              src={LOGO_ADRESI}
              alt="Biçen Market"
              className="gr-form-logo"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <Title level={4} className="gr-form-baslik">
              {hukuk ? "Hukuk masası" : "Hoş geldiniz"}
            </Title>
            <Text type="secondary" style={{ fontSize: 13.5 }}>
              {hukuk
                ? kodAdim
                  ? `${kodAdim.telefon} numaralı telefonunuza gelen kodu giriniz`
                  : "Kimlik numaranız ve kayıtlı telefonunuzla giriş yapınız"
                : "Devam etmek için hesabınıza giriş yapınız"}
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
            onFinish={hukuk ? hukukGiris : giris}
            className="gr-form-alan"
            onValuesChange={() => hata && setHata(null)}
          >
            {kodAdim && hukuk ? (
              <Form.Item label="Doğrulama kodu">
                <Input
                  size="large"
                  value={kod}
                  onChange={(e) => setKod(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="______"
                  autoFocus
                  style={{ letterSpacing: 8, fontSize: 20, textAlign: "center" }}
                />
              </Form.Item>
            ) : null}
            {hukuk && !kodAdim ? (
              <>
                <Form.Item label="T.C. kimlik numarası">
                  <Input size="large" value={hkKimlik} inputMode="numeric" maxLength={11} placeholder="11 haneli"
                    onChange={(e) => setHkKimlik(e.target.value.replace(/\D/g, ""))}
                    prefix={<User size={16} strokeWidth={2} color="#9AA3AF" />} />
                </Form.Item>
                <Form.Item label="Cep telefonu">
                  <Input size="large" value={hkTelefon} inputMode="tel" maxLength={11} placeholder="5xx xxx xx xx"
                    onChange={(e) => setHkTelefon(e.target.value.replace(/\D/g, ""))}
                    prefix={<Lock size={16} strokeWidth={2} color="#9AA3AF" />} />
                </Form.Item>
              </>
            ) : null}
            <div style={{ display: hukuk ? "none" : undefined }}>
            <Form.Item
              name="kullaniciAdi"
              label="Kullanıcı Adı"
              rules={[{ required: !hukuk, message: "Kullanıcı adınızı giriniz." }]}
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
              rules={[{ required: !hukuk, message: "Parolanızı giriniz." }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                placeholder="••••••••"
                prefix={<Lock size={16} strokeWidth={2} color="#9AA3AF" />}
              />
            </Form.Item>
            </div>

            {/* Hatalı denemeden sonra güvenlik doğrulaması istenir */}
            {!hukuk && dogrulamaGerekli && siteAnahtari && (
              <div className="gr-dogrulama">
                <GuvenlikDogrulamasi
                  siteAnahtari={siteAnahtari}
                  jetonAlindi={setJeton}
                />
                <span className="gr-dogrulama-not">
                  Hatalı deneme yapıldığı için güvenlik doğrulaması gerekiyor.
                </span>
              </div>
            )}

            <Button
              block
              size="large"
              type="primary"
              htmlType="submit"
              loading={yukleniyor}
              disabled={!hukuk && dogrulamaGerekli && !!siteAnahtari && !jeton}
              className="gr-dugme"
              icon={!yukleniyor ? <LogIn size={17} strokeWidth={2} /> : undefined}
            >
              {hukuk
                ? kodAdim ? "Kodu doğrula" : "Kod gönder"
                : dogrulamaGerekli && siteAnahtari && !jeton
                  ? "Doğrulama bekleniyor…"
                  : "Giriş yap"}
            </Button>
          </Form>

          <div style={{ textAlign: "center", marginTop: 14 }}>
            <a
              onClick={() => {
                setHukuk(!hukuk);
                setKodAdim(null);
                setHata(null);
              }}
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              {hukuk ? "← Biçen personel girişi" : "Hukuk danışmanı girişi"}
            </a>
          </div>

          <div className="gr-form-alt">
            <ShieldCheck size={13} strokeWidth={2} />
            <span>Bu alan yalnızca yetkili personel içindir.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

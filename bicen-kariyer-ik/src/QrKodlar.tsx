/**
 * ---------------------------------------------------------------------------
 * QR Kod Üretici
 * ---------------------------------------------------------------------------
 * Şubelerdeki adaylara asılacak QR kodları üretir. Her şube için adresin
 * sonuna kendi şube kodu eklenir; aday QR'ı okuttuğunda şube alanı otomatik
 * seçili gelir. Kodun ortasına kurum logosu yerleştirilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
} from "antd";
import QRCode from "qrcode";
import { Download, ImageUp, Printer, QrCode, RefreshCw, X } from "lucide-react";

import { LOGO_ADRESI, api } from "./api";

const { Title, Text, Paragraph } = Typography;

interface Sube {
  kod: string;
  ad: string;
  tur?: string;
}

interface QrKart {
  kod: string;
  ad: string;
  adres: string;
  gorsel: string;
}

const ADRES_ANAHTARI = "bicen_qr_temel_adres";

/* -------------------------------------------------------------------------- */
/* Yardımcılar                                                                 */
/* -------------------------------------------------------------------------- */

/** Logoyu bir kez indirip Image nesnesine çevirir (canvas'ı kirletmemek için) */
const logoyuHazirla = async (): Promise<HTMLImageElement | null> => {
  try {
    const cevap = await fetch(LOGO_ADRESI);
    if (!cevap.ok) return null;

    const veri = await cevap.blob();
    const dataUrl = await new Promise<string>((coz) => {
      const okuyucu = new FileReader();
      okuyucu.onload = () => coz(String(okuyucu.result));
      okuyucu.onerror = () => coz("");
      okuyucu.readAsDataURL(veri);
    });

    if (!dataUrl) return null;

    return await new Promise<HTMLImageElement | null>((coz) => {
      const resim = new Image();
      resim.onload = () => coz(resim);
      resim.onerror = () => coz(null);
      resim.src = dataUrl;
    });
  } catch {
    return null;
  }
};

/** QR kodu üretir, istenirse ortasına logoyu yerleştirir */
const qrUret = async (
  adres: string,
  boyut: number,
  logo: HTMLImageElement | null,
  logoOrani: number
): Promise<string> => {
  const tuval = document.createElement("canvas");

  await QRCode.toCanvas(tuval, adres, {
    width: boyut,
    margin: 2,
    // Logo eklendiğinde okunabilirliğin bozulmaması için en yüksek hata düzeltme
    errorCorrectionLevel: "H",
    color: { dark: "#1D2126", light: "#FFFFFF" },
  });

  if (logo) {
    const ctx = tuval.getContext("2d");
    if (ctx) {
      const alan = Math.round(boyut * (logoOrani / 100));
      const konum = Math.round((boyut - alan) / 2);
      const bosluk = Math.round(alan * 0.12);

      // Logonun arkasına beyaz zemin
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(konum - bosluk, konum - bosluk, alan + bosluk * 2, alan + bosluk * 2);

      // Logoyu oranını bozmadan ortala
      const oran = Math.min(alan / logo.width, alan / logo.height);
      const g = logo.width * oran;
      const y = logo.height * oran;
      ctx.drawImage(logo, (boyut - g) / 2, (boyut - y) / 2, g, y);
    }
  }

  return tuval.toDataURL("image/png");
};

const dosyaIndir = (veriUrl: string, dosyaAdi: string) => {
  const bag = document.createElement("a");
  bag.href = veriUrl;
  bag.download = dosyaAdi;
  document.body.appendChild(bag);
  bag.click();
  document.body.removeChild(bag);
};

const temizAdres = (metin: string) => metin.trim().replace(/\/+$/, "");

/* -------------------------------------------------------------------------- */
/* Bileşen                                                                     */
/* -------------------------------------------------------------------------- */

export default function QrKodlar() {
  const { message } = AntdApp.useApp();

  const [temelAdres, setTemelAdres] = useState(
    () =>
      localStorage.getItem(ADRES_ANAHTARI) ||
      `${window.location.protocol}//${window.location.hostname}:5179`
  );
  const [boyut, setBoyut] = useState(600);
  const [logoEkle, setLogoEkle] = useState(true);
  const [logoOrani, setLogoOrani] = useState(22);

  const [subeler, setSubeler] = useState<Sube[]>([]);
  const [secili, setSecili] = useState<string[]>([]);
  const [kartlar, setKartlar] = useState<QrKart[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [logoVar, setLogoVar] = useState(true);

  const logoRef = useRef<HTMLImageElement | null>(null);          // kurum logosu
  const ozelLogoRef = useRef<HTMLImageElement | null>(null);      // yüklenen logo
  const dosyaRef = useRef<HTMLInputElement>(null);
  const [ozelLogoAdres, setOzelLogoAdres] = useState("");
  const [ozelLogoAd, setOzelLogoAd] = useState("");

  /* --------------------------------------------------------------- şubeler */

  useEffect(() => {
    api
      .al<any>("/api/Ayar/Form")
      .then((a) => {
        const liste: Sube[] = a.subeler ?? [];
        setSubeler(liste);
        setSecili(liste.map((s) => s.kod));
      })
      .catch((hata: any) => message.error(hata.message));
  }, [message]);

  /* ------------------------------------------------------------ özel logo */

  const logoSecildi = async (olay: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = olay.target.files?.[0];
    olay.target.value = "";
    if (!dosya) return;

    if (!dosya.type.startsWith("image/")) {
      message.error("Lütfen bir görsel dosyası seçiniz.");
      return;
    }

    try {
      const dataUrl = await new Promise<string>((coz, reddet) => {
        const okuyucu = new FileReader();
        okuyucu.onload = () => coz(String(okuyucu.result));
        okuyucu.onerror = () => reddet(new Error("Dosya okunamadı."));
        okuyucu.readAsDataURL(dosya);
      });

      const resim = await new Promise<HTMLImageElement | null>((coz) => {
        const r = new Image();
        r.onload = () => coz(r);
        r.onerror = () => coz(null);
        r.src = dataUrl;
      });

      if (!resim) {
        message.error("Görsel açılamadı, farklı bir dosya deneyiniz.");
        return;
      }

      ozelLogoRef.current = resim;
      setOzelLogoAdres(dataUrl);
      setOzelLogoAd(dosya.name);
      message.success("Logo seçildi. Şimdi QR kodları üretebilirsiniz.");
    } catch {
      message.error("Logo yüklenemedi.");
    }
  };

  const ozelLogoyuKaldir = () => {
    ozelLogoRef.current = null;
    setOzelLogoAdres("");
    setOzelLogoAd("");
  };

  /* ------------------------------------------------------------------ üret */

  const uret = useCallback(async () => {
    const taban = temizAdres(temelAdres);
    if (!taban) {
      message.error("Önce adayların gireceği adresi yazınız.");
      return;
    }

    setYukleniyor(true);
    try {
      // Özel logo seçilmediyse kurum logosu kullanılır
      if (logoEkle && !ozelLogoRef.current && !logoRef.current) {
        logoRef.current = await logoyuHazirla();
        setLogoVar(!!logoRef.current);
      }

      const logo = logoEkle
        ? ozelLogoRef.current ?? logoRef.current
        : null;

      const hedefler: Sube[] = [
        { kod: "", ad: "Genel (şube seçimsiz)" },
        ...subeler.filter((s) => secili.includes(s.kod)),
      ];

      const yeni: QrKart[] = [];
      for (const sube of hedefler) {
        const adres = sube.kod ? `${taban}/?sube=${encodeURIComponent(sube.kod)}` : taban;
        const gorsel = await qrUret(adres, boyut, logo, logoOrani);
        yeni.push({ kod: sube.kod, ad: sube.ad, adres, gorsel });
      }

      setKartlar(yeni);
      localStorage.setItem(ADRES_ANAHTARI, taban);
    } catch (hata: any) {
      message.error(hata?.message ?? "QR kod üretilemedi.");
    } finally {
      setYukleniyor(false);
    }
  }, [temelAdres, subeler, secili, boyut, logoEkle, logoOrani, message]);

  /* --------------------------------------------------------------- indirme */

  const tekIndir = (kart: QrKart) => {
    const ad = kart.kod ? `QR_${kart.kod}` : "QR_GENEL";
    dosyaIndir(kart.gorsel, `${ad}.png`);
  };

  const tumunuYazdir = () => {
    if (kartlar.length === 0) return;

    const kutular = kartlar
      .map(
        (k) => `
      <div class="kutu">
        <div class="ad">${k.ad}</div>
        <img src="${k.gorsel}" alt="${k.ad}" />
        <div class="baslik">İŞ BAŞVURUSU İÇİN OKUTUNUZ</div>
        <div class="aciklama">Telefonunuzun kamerasını QR koda tutunuz</div>
        <div class="adres">${k.adres}</div>
      </div>`
      )
      .join("");

    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Biçen Kariyer - QR Kodlar</title>
<style>
  body { margin: 0; padding: 16px; font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }
  .cubuk { text-align: right; max-width: 1000px; margin: 0 auto 14px; }
  .cubuk button {
    border: none; background: #7cb518; color: #fff; font-weight: 600;
    font-size: 13px; padding: 9px 18px; border-radius: 8px; cursor: pointer;
  }
  .izgara {
    max-width: 1000px; margin: 0 auto;
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
  }
  .kutu {
    border: 2px solid #1d2126; border-radius: 14px; padding: 18px;
    text-align: center; page-break-inside: avoid;
  }
  .kutu img { width: 86%; max-width: 320px; height: auto; }
  .ad { font-size: 17px; font-weight: 800; color: #1d2126; margin-bottom: 10px; }
  .baslik { font-size: 15px; font-weight: 800; color: #5f8c10; margin-top: 8px; letter-spacing: .4px; }
  .aciklama { font-size: 12.5px; color: #444; margin-top: 3px; }
  .adres { font-size: 10.5px; color: #777; margin-top: 8px; word-break: break-all; }
  @media print {
    @page { size: A4; margin: 10mm; }
    body { padding: 0; }
    .cubuk { display: none; }
    .izgara { gap: 12px; }
  }
</style>
</head>
<body>
  <div class="cubuk"><button onclick="window.print()">Yazdır / PDF olarak kaydet</button></div>
  <div class="izgara">${kutular}</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const adres = URL.createObjectURL(blob);
    dosyaIndir(adres, "bicen_qr_kodlar.html");
    setTimeout(() => URL.revokeObjectURL(adres), 1500);
  };

  /* ---------------------------------------------------------------- görünüm */

  return (
    <div className="ik-icerik">
      <Card>
        <Title level={5} style={{ marginTop: 0 }}>
          <Space size={8}>
            <QrCode size={18} strokeWidth={2} />
            QR Kod Üretici
          </Space>
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Her şube için ayrı QR kod üretilir. Aday QR'ı okuttuğunda başvuru
          formundaki şube alanı otomatik seçili gelir.
        </Paragraph>

        <Row gutter={[16, 12]}>
          <Col xs={24} md={10}>
            <Text strong>Adayların gireceği adres</Text>
            <Input
              value={temelAdres}
              onChange={(e) => setTemelAdres(e.target.value)}
              placeholder="https://kariyer.bicen.com.tr"
              style={{ marginTop: 6 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Adaylar şirket ağı dışından bağlanacağı için internetten
              erişilebilen adresi yazınız.
            </Text>
          </Col>

          <Col xs={12} md={4}>
            <Text strong>Boyut (piksel)</Text>
            <InputNumber
              min={200}
              max={1200}
              step={100}
              value={boyut}
              onChange={(v) => setBoyut(Number(v) || 600)}
              style={{ width: "100%", marginTop: 6 }}
            />
          </Col>

          <Col xs={12} md={4}>
            <Text strong>Logo</Text>
            <div style={{ marginTop: 10 }}>
              <Checkbox
                checked={logoEkle}
                onChange={(e) => setLogoEkle(e.target.checked)}
              >
                Ortaya ekle
              </Checkbox>
            </div>
          </Col>

          <Col xs={24} md={6}>
            <Text strong>Logo oranı (%)</Text>
            <InputNumber
              min={10}
              max={30}
              value={logoOrani}
              disabled={!logoEkle}
              onChange={(v) => setLogoOrani(Number(v) || 22)}
              style={{ width: "100%", marginTop: 6 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              %25 üzerinde okuma zorlaşabilir.
            </Text>
          </Col>

          <Col xs={24}>
            <Text strong>QR Kod Ortasındaki Logo</Text>
            <div className="qr-logo-secim">
              <input
                ref={dosyaRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={logoSecildi}
              />

              <div className="qr-logo-onizleme">
                <img
                  src={ozelLogoAdres || LOGO_ADRESI}
                  alt="Logo"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
              </div>

              <div className="qr-logo-bilgi">
                <Text style={{ fontSize: 13 }}>
                  {ozelLogoAdres ? (
                    <>
                      Seçilen logo: <strong>{ozelLogoAd}</strong>
                    </>
                  ) : (
                    "Kurum logosu kullanılacak (API üzerinden alınır)."
                  )}
                </Text>
                <Space wrap style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    disabled={!logoEkle}
                    icon={<ImageUp size={14} strokeWidth={2} />}
                    onClick={() => dosyaRef.current?.click()}
                  >
                    Dosyadan logo seç
                  </Button>
                  {ozelLogoAdres && (
                    <Button
                      size="small"
                      danger
                      icon={<X size={14} strokeWidth={2} />}
                      onClick={ozelLogoyuKaldir}
                    >
                      Kurum logosuna dön
                    </Button>
                  )}
                </Space>
              </div>
            </div>
          </Col>

          <Col xs={24}>
            <Text strong>Üretilecek şubeler</Text>
            <Select
              mode="multiple"
              allowClear
              value={secili}
              onChange={setSecili}
              style={{ width: "100%", marginTop: 6 }}
              placeholder="Şube seçiniz"
              options={subeler.map((s) => ({
                value: s.kod,
                label: `${s.ad}${s.tur ? ` · ${s.tur}` : ""} (${s.kod})`,
              }))}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Şube listesi Yönetim → Form Ayarları bölümünden düzenlenir. Listeye
              ek olarak şube seçimsiz genel bir QR kod da üretilir.
            </Text>
          </Col>
        </Row>

        <Space wrap style={{ marginTop: 18 }}>
          <Button
            type="primary"
            loading={yukleniyor}
            icon={<RefreshCw size={15} strokeWidth={2} />}
            onClick={uret}
          >
            QR kodları üret
          </Button>

          {kartlar.length > 0 && (
            <Button
              icon={<Printer size={15} strokeWidth={2} />}
              onClick={tumunuYazdir}
            >
              Tümünü yazdırılabilir dosya olarak indir
            </Button>
          )}
        </Space>

        {logoEkle && !logoVar && !ozelLogoAdres && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="Logo bulunamadı"
            description="QR kodlar logosuz üretildi. Logoyu BicenKariyer.API/wwwroot/logo.png konumuna koyup tekrar deneyiniz."
          />
        )}
      </Card>

      {kartlar.length > 0 && (
        <Row gutter={[14, 14]} style={{ marginTop: 16 }}>
          {kartlar.map((kart) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={kart.kod || "genel"}>
              <Card size="small" className="qr-kart">
                <div className="qr-ad">{kart.ad}</div>
                <img src={kart.gorsel} alt={kart.ad} className="qr-gorsel" />
                <div className="qr-adres">{kart.adres}</div>
                <Button
                  block
                  size="small"
                  icon={<Download size={14} strokeWidth={2} />}
                  onClick={() => tekIndir(kart)}
                >
                  PNG indir
                </Button>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

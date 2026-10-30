/**
 * ---------------------------------------------------------------------------
 * Aday Fotoğrafı
 * ---------------------------------------------------------------------------
 * Aday fotoğrafını o anda çekmek zorundadır; hazır görsel yüklenemez.
 * Bu kısıt hem gerçek bir aday fotoğrafı almak hem otomatik gönderimleri
 * zorlaştırmak içindir.
 *
 * İki yol sunulur:
 *
 *  1. Sayfa içi kamera (getUserMedia) — yalnızca güvenli bağlamda çalışır
 *     (https:// veya localhost). Ön kamera tercih edilir.
 *  2. Telefonun kamera uygulaması (capture="user" olan alan) — http üzerinden de
 *     çalışır, tarayıcı kısıtı yoktur.
 *
 * Tarayıcı sayfa içi kamerayı desteklemiyorsa doğrudan ikinci yol gösterilir.
 * Fotoğraf küçültülüp JPEG olarak sıkıştırılır.
 *
 * NOT: capture ayarı yalnızca mobil tarayıcılarda kamerayı zorlar. Masaüstünde
 * tarayıcı bunu yok sayıp dosya seçiciyi açar; bu yüzden sayfa içi kamera
 * desteklenen ortamlarda o yol tercih edilir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Alert, Button, Modal, Space, Typography } from "antd";
import { Camera, ImagePlus, RefreshCw, X } from "lucide-react";

import { FOTOGRAF_AYARLARI } from "./sabitler";
import type { SertifikaGorseli } from "./tipler";
import { gorselAdresi, gorselKucult } from "./yardimcilar";

const { Text } = Typography;

/** Sayfa içi kamera kullanılabilir mi? */
const kameraDestekli = (): boolean =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  window.isSecureContext;

export default function FotografAlani({
  value,
  onChange,
}: {
  value?: SertifikaGorseli | null;
  onChange?: (yeni: SertifikaGorseli | null) => void;
}) {
  const { message } = AntdApp.useApp();

  const dosyaRef = useRef<HTMLInputElement>(null);

  /* Galeri için ayrı girdi: capture olan alan telefonda hep kamerayı
     açıyor, aynı alanı iki amaçla kullanamıyoruz. */
  const galeriRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const akisRef = useRef<MediaStream | null>(null);

  const [kameraAcik, setKameraAcik] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);
  const [hazir, setHazir] = useState(false);

  const sayfaIciKamera = kameraDestekli();

  /* ------------------------------------------------------------ kamera akışı */

  const akisiKapat = () => {
    akisRef.current?.getTracks().forEach((iz) => iz.stop());
    akisRef.current = null;
    setHazir(false);
  };

  useEffect(() => {
    if (!kameraAcik) {
      akisiKapat();
      return;
    }

    let iptal = false;

    (async () => {
      try {
        const akis = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });

        if (iptal) {
          akis.getTracks().forEach((iz) => iz.stop());
          return;
        }

        akisRef.current = akis;
        if (videoRef.current) {
          videoRef.current.srcObject = akis;
          await videoRef.current.play().catch(() => undefined);
        }
        setHazir(true);
      } catch {
        message.error(
          "Kameraya erişilemedi. Tarayıcı izni verilmemiş olabilir; dosyadan seçmeyi deneyiniz."
        );
        setKameraAcik(false);
      }
    })();

    return () => {
      iptal = true;
      akisiKapat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kameraAcik]);

  /* ---------------------------------------------------------------- çekim */

  const cek = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    setIsleniyor(true);
    try {
      const enBuyuk = FOTOGRAF_AYARLARI.enBuyukKenar;
      let g = video.videoWidth;
      let y = video.videoHeight;

      if (g > enBuyuk || y > enBuyuk) {
        const oran = Math.min(enBuyuk / g, enBuyuk / y);
        g = Math.round(g * oran);
        y = Math.round(y * oran);
      }

      const tuval = document.createElement("canvas");
      tuval.width = g;
      tuval.height = y;

      const ctx = tuval.getContext("2d");
      if (!ctx) throw new Error("Görüntü işlenemedi.");

      ctx.drawImage(video, 0, 0, g, y);

      const dataUrl = tuval.toDataURL("image/jpeg", FOTOGRAF_AYARLARI.kalite);
      onChange?.({
        ad: `fotograf_${Date.now()}.jpg`,
        tur: "image/jpeg",
        base64: dataUrl.split(",")[1] ?? "",
      });

      setKameraAcik(false);
    } catch {
      message.error("Fotoğraf alınamadı, tekrar deneyiniz.");
    } finally {
      setIsleniyor(false);
    }
  };

  /* -------------------------------------------------------------- dosyadan */

  const dosyaSecildi = async (olay: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = olay.target.files?.[0];
    olay.target.value = "";
    if (!dosya) return;

    if (dosya.type && !dosya.type.startsWith("image/")) {
      message.error("Lütfen bir fotoğraf seçiniz.");
      return;
    }

    if (dosya.size > 25 * 1024 * 1024) {
      message.error("Fotoğraf en fazla 25 MB olabilir.");
      return;
    }

    setIsleniyor(true);
    try {
      const kucuk = await gorselKucult(
        dosya,
        FOTOGRAF_AYARLARI.enBuyukKenar,
        FOTOGRAF_AYARLARI.kalite
      );
      onChange?.({ ...kucuk, ad: dosya.name });
    } catch (hata: any) {
      // Gerçek sebep gösterilir; genel bir mesaj aday için yol gösterici değil
      message.error({
        content: hata?.message ?? "Fotoğraf işlenemedi, farklı bir dosya deneyiniz.",
        duration: 8,
      });
    } finally {
      setIsleniyor(false);

      // Aynı dosya art arda seçilebilsin diye alan sıfırlanır
      if (dosyaRef.current) dosyaRef.current.value = "";
    }
  };

  /* ---------------------------------------------------------------- görünüm */

  return (
    <>
      {/* Kamera alanı: capture ayarı telefonda doğrudan kamerayı açar */}
      <input
        ref={dosyaRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="user"
        style={{ display: "none" }}
        onChange={dosyaSecildi}
      />

      {/* Galeri alanı: capture yok, telefon dosya seçiciyi açar */}
      <input
        ref={galeriRef}
        type="file"
        accept="image/*,.heic,.heif"
        style={{ display: "none" }}
        onChange={dosyaSecildi}
      />

      {value ? (
        <div className="ftg-onizleme">
          <img src={gorselAdresi(value)} alt="Aday fotoğrafı" />
          <Space direction="vertical" size={6} className="ftg-islem">
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Yüzünüz net ve aydınlık görünüyorsa devam edebilirsiniz.
            </Text>
            <Space wrap>
              <Button
                size="small"
                icon={<RefreshCw size={14} strokeWidth={2} />}
                loading={isleniyor}
                onClick={() =>
                  sayfaIciKamera ? setKameraAcik(true) : dosyaRef.current?.click()
                }
              >
                Yeniden çek
              </Button>

              <Button
                size="small"
                icon={<ImagePlus size={14} strokeWidth={2} />}
                loading={isleniyor}
                onClick={() => galeriRef.current?.click()}
              >
                Galeriden seç
              </Button>
              <Button
                size="small"
                danger
                icon={<X size={14} strokeWidth={2} />}
                onClick={() => onChange?.(null)}
              >
                Kaldır
              </Button>
            </Space>
          </Space>
        </div>
      ) : (
        <div className="ftg-bos">
          <div className="ftg-cerceve">
            <Camera size={34} strokeWidth={1.6} />
            <Text type="secondary" style={{ fontSize: 12.5, textAlign: "center" }}>
              Yüzünüzün net göründüğü bir vesikalık ya da selfie ekleyiniz.
              Fotoğraf çekebilir ya da telefonunuzdan seçebilirsiniz.
            </Text>
          </div>

          <Space wrap style={{ marginTop: 12 }}>
            <Button
              type="primary"
              loading={isleniyor}
              icon={<Camera size={16} strokeWidth={2} />}
              onClick={() =>
                sayfaIciKamera ? setKameraAcik(true) : dosyaRef.current?.click()
              }
            >
              Fotoğraf çek
            </Button>

            <Button
              loading={isleniyor}
              icon={<ImagePlus size={16} strokeWidth={2} />}
              onClick={() => galeriRef.current?.click()}
            >
              Galeriden seç
            </Button>
          </Space>
        </div>
      )}

      {/* --------------------------------------------------------- kamera penceresi */}
      <Modal
        open={kameraAcik}
        title="Fotoğraf Çek"
        onCancel={() => setKameraAcik(false)}
        footer={
          <Space>
            <Button onClick={() => setKameraAcik(false)}>Vazgeç</Button>
            <Button
              type="primary"
              disabled={!hazir}
              loading={isleniyor}
              icon={<Camera size={16} strokeWidth={2} />}
              onClick={cek}
            >
              Çek
            </Button>
          </Space>
        }
        destroyOnClose
        maskClosable={false}
      >
        <div className="ftg-kamera">
          <video ref={videoRef} playsInline muted autoPlay />
          {!hazir && (
            <div className="ftg-kamera-bekle">
              <Text type="secondary">Kamera açılıyor...</Text>
            </div>
          )}
        </div>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Yüzünüzü çerçevenin ortasına alınız. Fotoğraf yalnızca başvurunuzda
          kullanılır.
        </Text>
      </Modal>

      {!sayfaIciKamera && (
        <Alert
          type="info"
          showIcon
          className="ftg-bilgi"
          message="Fotoğraf çek düğmesi telefonunuzun kamera uygulamasını açar."
        />
      )}
    </>
  );
}

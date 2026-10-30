/**
 * ---------------------------------------------------------------------------
 * E-posta Doğrulama
 * ---------------------------------------------------------------------------
 * Başvuru gönderilmeden önce adayın e-posta adresine altı haneli kod
 * gönderilir. Kod doğrulanmadan form kaydedilemez.
 *
 * Bu adım otomatik gönderimlerin maliyetini artırır: her sahte başvuru için
 * gerçek bir posta kutusuna erişmek gerekir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Space, Typography } from "antd";
import { CheckCircle2, Mail, RotateCcw } from "lucide-react";

import { AYARLAR } from "./sabitler";

const { Text } = Typography;

/** Yeni kod istemek için beklenecek süre */
const BEKLEME = 60;

export default function EpostaDogrulama({
  eposta,
  jetonAlindi,
}: {
  eposta: string;
  /** Doğrulama tamamlandığında jetonu üst bileşene verir */
  jetonAlindi: (jeton: string | null) => void;
}) {
  const { message } = AntdApp.useApp();

  const [gonderildi, setGonderildi] = useState(false);
  const [dogrulandi, setDogrulandi] = useState(false);
  const [kod, setKod] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [sayac, setSayac] = useState(0);

  /* Doğrulanan adres; e-posta değişirse doğrulama sıfırlanır */
  const dogrulananAdres = useRef<string>("");

  useEffect(() => {
    if (dogrulandi && eposta.trim().toLowerCase() !== dogrulananAdres.current) {
      setDogrulandi(false);
      setGonderildi(false);
      setKod("");
      jetonAlindi(null);
    }
  }, [eposta, dogrulandi, jetonAlindi]);

  /* Yeni kod isteme sayacı */
  useEffect(() => {
    if (sayac <= 0) return;

    const zaman = window.setTimeout(() => setSayac((s) => s - 1), 1000);
    return () => window.clearTimeout(zaman);
  }, [sayac]);

  const istek = async (yol: string, govde: object) => {
    const cevap = await fetch(`${AYARLAR.apiTaban}/api/Basvuru/${yol}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(govde),
    });

    const veri = await cevap.json().catch(() => ({}));

    if (!cevap.ok) {
      throw new Error(
        [veri?.hata, veri?.ayrinti].filter(Boolean).join(" ") ||
          "İşlem tamamlanamadı."
      );
    }

    return veri;
  };

  const kodGonder = async () => {
    const adres = eposta.trim();

    if (!adres || !adres.includes("@")) {
      message.error("Lütfen geçerli bir e-posta adresi giriniz.");
      return;
    }

    setIsleniyor(true);

    try {
      const sonuc = await istek("KodGonder", { eposta: adres });

      message.success(sonuc.mesaj ?? "Kod gönderildi.");
      setGonderildi(true);
      setSayac(BEKLEME);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const kodDogrula = async () => {
    if (kod.trim().length < 6) {
      message.error("Altı karakterli kodu giriniz (dört rakam, iki harf).");
      return;
    }

    setIsleniyor(true);

    try {
      const sonuc = await istek("KodDogrula", {
        eposta: eposta.trim(),
        kod: kod.trim(),
      });

      dogrulananAdres.current = eposta.trim().toLowerCase();

      setDogrulandi(true);
      jetonAlindi(sonuc.jeton);

      message.success("E-posta adresiniz doğrulandı.");
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIsleniyor(false);
    }
  };

  if (dogrulandi) {
    return (
      <div className="bsv-eposta bsv-eposta-tamam">
        <CheckCircle2 size={19} strokeWidth={2} />
        <div>
          <b>E-posta adresiniz doğrulandı</b>
          <span>{eposta}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bsv-eposta">
      <div className="bsv-eposta-baslik">
        <Mail size={17} strokeWidth={2} />
        <b>E-posta Doğrulama</b>
      </div>

      <Text className="bsv-eposta-not">
        Başvurunuzu göndermek için e-posta adresinizi doğrulamanız gerekiyor.
        {eposta ? (
          <>
            {" "}
            Kod <b>{eposta}</b> adresine gönderilecek.
          </>
        ) : (
          " Önce e-posta adresinizi giriniz."
        )}
      </Text>

      {!gonderildi ? (
        <Button
          block
          size="large"
          className="bsv-ana-btn"
          loading={isleniyor}
          disabled={!eposta.includes("@")}
          icon={<Mail size={16} strokeWidth={2} />}
          onClick={kodGonder}
        >
          Doğrulama kodu gönder
        </Button>
      ) : (
        <>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              size="large"
              maxLength={6}
              placeholder="Örn. 3721KM"
              className="bsv-kod-giris"
              value={kod}
              onChange={(e) =>
                /* Kod dört rakam iki harf; harf ve rakam dışı temizlenir,
                   harfler büyütülür. */
                setKod(
                  e.target.value
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toUpperCase()
                    .slice(0, 6)
                )
              }
              onPressEnter={kodDogrula}
            />

            <Button
              size="large"
              type="primary"
              className="bsv-ana-btn"
              loading={isleniyor}
              disabled={kod.length < 6}
              onClick={kodDogrula}
            >
              Doğrula
            </Button>
          </Space.Compact>

          <div className="bsv-eposta-alt">
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Kod 15 dakika geçerlidir. Gelmediyse istenmeyen klasörünü
              kontrol ediniz.
            </Text>

            <Button
              type="link"
              size="small"
              disabled={sayac > 0 || isleniyor}
              icon={<RotateCcw size={13} strokeWidth={2} />}
              onClick={kodGonder}
            >
              {sayac > 0 ? `Yeniden gönder (${sayac})` : "Yeniden gönder"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

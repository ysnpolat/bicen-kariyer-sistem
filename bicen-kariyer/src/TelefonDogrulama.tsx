/**
 * ---------------------------------------------------------------------------
 * SMS Doğrulama
 * ---------------------------------------------------------------------------
 * Başvuru gönderilmeden önce adayın telefon numarasına altı haneli kod
 * gönderilir. Kod doğrulanmadan form kaydedilemez.
 *
 * E-posta doğrulamasından daha güçlü bir engeldir: geçici telefon hattı
 * edinmek geçici posta adresinden daha zor ve maliyetlidir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Space, Typography } from "antd";
import { CheckCircle2, Phone, RotateCcw } from "lucide-react";

import { AYARLAR } from "./sabitler";

const { Text } = Typography;

/** Yeni kod istemek için beklenecek süre */
const BEKLEME = 60;

/** Numarayı yalnızca rakamlara indirger */
const sadeNumara = (t: string) => t.replace(/\D/g, "");

export default function TelefonDogrulama({
  telefon,
  jetonAlindi,
}: {
  telefon: string;
  /** Doğrulama tamamlandığında jetonu üst bileşene verir */
  jetonAlindi: (jeton: string | null) => void;
}) {
  const { message } = AntdApp.useApp();

  const [gonderildi, setGonderildi] = useState(false);
  const [dogrulandi, setDogrulandi] = useState(false);
  const [kod, setKod] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [sayac, setSayac] = useState(0);

  /* Doğrulanan numara; telefon değişirse doğrulama sıfırlanır */
  const dogrulananNumara = useRef<string>("");

  useEffect(() => {
    if (dogrulandi && sadeNumara(telefon) !== dogrulananNumara.current) {
      setDogrulandi(false);
      setGonderildi(false);
      setKod("");
      jetonAlindi(null);
    }
  }, [telefon, dogrulandi, jetonAlindi]);

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
    const numara = sadeNumara(telefon);

    if (numara.length < 10) {
      message.error("Lütfen geçerli bir telefon numarası giriniz.");
      return;
    }

    setIsleniyor(true);

    try {
      const sonuc = await istek("KodGonder", { telefon: numara });

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
      const numara = sadeNumara(telefon);

      const sonuc = await istek("KodDogrula", {
        telefon: numara,
        kod: kod.trim(),
      });

      dogrulananNumara.current = numara;

      setDogrulandi(true);
      jetonAlindi(sonuc.jeton);

      message.success("Telefon numaranız doğrulandı.");
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
          <b>Telefon numaranız doğrulandı</b>
          <span>{telefon}</span>
        </div>
      </div>
    );
  }

  const numaraGecerli = sadeNumara(telefon).length >= 10;

  return (
    <div className="bsv-eposta">
      <div className="bsv-eposta-baslik">
        <Phone size={17} strokeWidth={2} />
        <b>SMS Doğrulama</b>
      </div>

      <Text className="bsv-eposta-not">
        Başvurunuzu göndermek için telefon numaranızı doğrulamanız gerekiyor.
        {numaraGecerli ? (
          <>
            {" "}
            Kod <b>{telefon}</b> numarasına gönderilecek.
          </>
        ) : (
          " Önce telefon numaranızı giriniz."
        )}
      </Text>

      {!gonderildi ? (
        <Button
          block
          size="large"
          className="bsv-ana-btn"
          loading={isleniyor}
          disabled={!numaraGecerli}
          icon={<Phone size={16} strokeWidth={2} />}
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
              Kod 15 dakika geçerlidir.
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

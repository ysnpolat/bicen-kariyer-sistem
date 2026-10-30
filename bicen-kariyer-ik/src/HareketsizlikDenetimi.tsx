/**
 * ---------------------------------------------------------------------------
 * Hareketsizlik Denetimi
 * ---------------------------------------------------------------------------
 * Kullanıcı bir süre işlem yapmazsa oturum kapatılır. Açık unutulan panelin
 * başkası tarafından kullanılmasını önler.
 *
 * Son iki dakikada geri sayım gösterilir; kullanıcı devam etmek isterse
 * süre yeniden başlar.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal, Progress, Typography } from "antd";
import { Clock } from "lucide-react";

const { Text, Paragraph } = Typography;

/** Hareketsizlik süresi (dakika) */
const SURE_DAKIKA = 60;

/** Süre dolmadan kaç dakika önce uyarılsın */
const UYARI_DAKIKA = 2;

/** Hareket sayılan olaylar */
const OLAYLAR = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

export default function HareketsizlikDenetimi({
  cikis,
}: {
  cikis: () => void;
}) {
  const sonHareket = useRef<number>(Date.now());
  const [kalanSaniye, setKalanSaniye] = useState<number | null>(null);

  /** Kullanıcı bir şey yaptığında sayaç sıfırlanır */
  const sifirla = useCallback(() => {
    sonHareket.current = Date.now();
    setKalanSaniye(null);
  }, []);

  useEffect(() => {
    OLAYLAR.forEach((olay) =>
      window.addEventListener(olay, sifirla, { passive: true })
    );

    return () =>
      OLAYLAR.forEach((olay) => window.removeEventListener(olay, sifirla));
  }, [sifirla]);

  useEffect(() => {
    const denetle = window.setInterval(() => {
      const gecen = (Date.now() - sonHareket.current) / 1000;
      const sinir = SURE_DAKIKA * 60;
      const uyariSiniri = sinir - UYARI_DAKIKA * 60;

      if (gecen >= sinir) {
        cikis();
        return;
      }

      /* Son dakikalarda geri sayım gösterilir */
      setKalanSaniye(gecen >= uyariSiniri ? Math.ceil(sinir - gecen) : null);
    }, 1000);

    return () => window.clearInterval(denetle);
  }, [cikis]);

  if (kalanSaniye === null) return null;

  const dakika = Math.floor(kalanSaniye / 60);
  const saniye = kalanSaniye % 60;

  return (
    <Modal
      open
      closable={false}
      maskClosable={false}
      keyboard={false}
      width={420}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Clock size={18} strokeWidth={2} color="#E8481C" />
          Oturumunuz kapanmak üzere
        </span>
      }
      footer={[
        <Button key="cikis" onClick={cikis}>
          Çıkış yap
        </Button>,
        <Button key="devam" type="primary" onClick={sifirla}>
          Devam et
        </Button>,
      ]}
    >
      <Paragraph style={{ marginTop: 8 }}>
        Bir süredir işlem yapılmadığı için oturumunuz güvenlik gereği
        kapatılacak.
      </Paragraph>

      <Progress
        percent={Math.round((kalanSaniye / (UYARI_DAKIKA * 60)) * 100)}
        status={kalanSaniye < 30 ? "exception" : "active"}
        format={() => (
          <Text strong>
            {dakika}:{String(saniye).padStart(2, "0")}
          </Text>
        )}
      />

      <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
        Ekrana dokunmanız ya da "Devam et" demeniz yeterlidir.
      </Paragraph>
    </Modal>
  );
}

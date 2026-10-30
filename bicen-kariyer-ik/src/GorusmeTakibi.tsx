/**
 * ---------------------------------------------------------------------------
 * Görüşme Takibi
 * ---------------------------------------------------------------------------
 * İki iş yapar:
 *
 *   1. Görüşme saati geçtiği hâlde sonuçlandırılmamış adaylar için uyarı
 *      penceresi açar. Pencere yalnızca görüşmeyi planlayan kişiye gösterilir;
 *      kapatılabilir ve kapatıldığında kayıtlar bildirim alanına düşer.
 *
 *   2. Yaklaşan görüşmeleri hatırlatır. Bu yalnızca bilgilendirmedir,
 *      işlem gerektirmez.
 *
 * Kontrol beş dakikada bir tekrarlanır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Input,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
  notification,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { CalendarClock, Clock } from "lucide-react";

import { api, islemYetkisi, oturumOku,
  yerelZaman,
} from "./api";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

/** Pencere bugün için kapatıldıysa bu anahtar altında saklanır */
const SUSTURMA_ANAHTARI = "bicen-gorusme-uyari-kapatildi";

/** Gecikme süresini okunur yazar */
const gecikmeMetni = (dakika: number): string => {
  if (dakika < 60) return `${dakika} dakika`;
  if (dakika < 1440) return `${Math.floor(dakika / 60)} saat`;

  const gun = Math.floor(dakika / 1440);
  return `${gun} gün`;
};

export default function GorusmeTakibi() {
  const { message } = AntdApp.useApp();

  const oturum = oturumOku();
  const yetkim = islemYetkisi(oturum);

  const [gecenler, setGecenler] = useState<any[]>([]);
  const [sira, setSira] = useState(0);
  const [acik, setAcik] = useState(false);

  /* Seçim ve açıklama */
  const [secim, setSecim] = useState("olumlu");
  const [aciklama, setAciklama] = useState("");
  const [yeniTarih, setYeniTarih] = useState<Dayjs | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Aynı hatırlatma tekrar tekrar gösterilmesin */
  const hatirlatilan = useRef<Set<number>>(new Set());

  /** Bugün için pencere susturuldu mu? */
  const susturulduMu = () => {
    try {
      return (
        window.localStorage.getItem(SUSTURMA_ANAHTARI) ===
        dayjs().format("YYYY-MM-DD")
      );
    } catch {
      return false;
    }
  };

  const getir = useCallback(async () => {
    /* Oturum yoksa istek atılmaz; çıkış anındaki gereksiz 401'leri önler */
    if (!yetkim || !oturumOku()) return;

    try {
      const d = await api.al<any>("/api/Basvuru/GorusmeTakibi");

      /* Pencere yalnızca görüşmeyi planlayan kişiye açılır; diğerleri
         kayıtları bildirim alanından görür. */
      const benim = (d?.gecenler ?? []).filter(
        (x: any) => x.sorumlu === oturum?.kullaniciAdi
      );

      setGecenler(benim);

      if (benim.length > 0 && !susturulduMu()) {
        setSira(0);
        setAcik(true);
      }

      /* Yaklaşan görüşmeler için köşede hatırlatma */
      (d?.yaklasanlar ?? []).forEach((y: any) => {
        if (hatirlatilan.current.has(y.id)) return;
        hatirlatilan.current.add(y.id);

        const kalan = Math.abs(y.gecenDakika);

        notification.info({
          message: "Yaklaşan görüşme",
          description: (
            <span>
              <b>{y.adSoyad}</b> ile görüşme{" "}
              <b>{dayjs(y.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}</b>{" "}
              ({gecikmeMetni(kalan)} sonra)
              {y.gorusmeYeri ? ` · ${y.gorusmeYeri}` : ""}
            </span>
          ),
          icon: <CalendarClock size={20} strokeWidth={2} color="#7CB518" />,
          duration: 12,
          placement: "bottomRight",
        });
      });
    } catch {
      // Sessizce geçilir; uyarı sistemi paneli engellememeli
    }
  }, [yetkim]);

  useEffect(() => {
    getir();

    const zaman = window.setInterval(getir, 5 * 60_000);
    return () => window.clearInterval(zaman);
  }, [getir]);

  const kayit = gecenler[sira];

  /**
   * Pencereyi kapatır ve bugün için tekrar açılmamasını sağlar.
   * Kayıtlar bildirim alanında (zil) görünmeye devam eder.
   */
  const ertele = () => {
    setAcik(false);

    try {
      window.localStorage.setItem(
        SUSTURMA_ANAHTARI,
        dayjs().format("YYYY-MM-DD")
      );
    } catch {
      // Depolama kapalıysa yalnızca bu oturumda susturulur
    }
  };

  /** Seçime göre açıklama ipucu */
  const ipucu = () => {
    if (secim === "ertele") return "Adayın neden gelmediğini ve yeni planı yazınız.";
    if (secim === "olumsuz") return "Olumsuz sonuçlandırma sebebini yazınız.";
    if (secim === "degerlendirmede")
      return "Adaya ulaşılamadıysa veya karar ertelendiyse durumu yazınız.";
    return "Görüşmede konuşulanları kısaca yazınız.";
  };

  const kaydet = async () => {
    if (!kayit) return;

    if (!aciklama.trim()) {
      message.error("Açıklama yazmanız gerekiyor.");
      return;
    }

    if (secim === "ertele" && !yeniTarih) {
      message.error("Yeni görüşme tarihini seçiniz.");
      return;
    }

    setKaydediliyor(true);

    try {
      await api.gonder(`/api/Basvuru/${kayit.id}/GorusmeSonuc`, {
        secim,
        yeniTarih: yerelZaman(yeniTarih),
        aciklama: aciklama.trim(),
      });

      message.success(`${kayit.adSoyad} için kayıt güncellendi.`);

      /* Alanları temizleyip sıradaki adaya geç */
      setAciklama("");
      setYeniTarih(null);
      setSecim("olumlu");

      if (sira + 1 < gecenler.length) {
        setSira(sira + 1);
      } else {
        setAcik(false);
        getir();
      }
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  if (!yetkim || !kayit) return null;

  return (
    <Modal
      open={acik}
      onCancel={ertele}
      /* Kapatılabilir: kapatılan kayıtlar bildirim alanında görünmeye
         devam eder, kimse ekranda kilitli kalmaz. */
      width={560}
      title={
        <Space size={8}>
          <Clock size={18} strokeWidth={2} color="#E8481C" />
          <span>Görüşme zamanı geçti</span>
          {gecenler.length > 1 && (
            <Tag color="orange">
              {sira + 1} / {gecenler.length}
            </Tag>
          )}
        </Space>
      }
      footer={[
        <Button key="sonra" onClick={ertele}>
          Sonra bakarım
        </Button>,
        <Button
          key="kaydet"
          type="primary"
          loading={kaydediliyor}
          onClick={kaydet}
        >
          Kaydet ve devam et
        </Button>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 14 }}
        message={
          <span>
            <b>{kayit.adSoyad}</b> ile görüşme{" "}
            <b>{dayjs(kayit.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}</b>{" "}
            tarihinde planlanmıştı.
          </span>
        }
        description={
          <span>
            Üzerinden <b>{gecikmeMetni(kayit.gecenDakika)}</b> geçti ve başvuru
            hâlâ görüşme talebi durumunda. Lütfen ne olduğunu belirtiniz.
          </span>
        }
      />

      <div className="gt-bilgi">
        <div>
          <span>Telefon</span>
          <b>{kayit.telefon || "—"}</b>
        </div>
        <div>
          <span>Birim</span>
          <b>{kayit.subeAdi || "—"}</b>
        </div>
        <div>
          <span>Pozisyon</span>
          <b>{kayit.bolumler || "—"}</b>
        </div>
        <div>
          <span>Görüşme yeri</span>
          <b>{kayit.gorusmeYeri || "—"}</b>
        </div>
      </div>

      <Text strong style={{ fontSize: 13 }}>
        Ne oldu?
      </Text>

      <Segmented
        block
        style={{ margin: "8px 0 14px" }}
        value={secim}
        onChange={(v) => setSecim(v as string)}
        options={[
          { label: "Görüşme yapıldı", value: "olumlu" },
          { label: "Gelmedi · ertele", value: "ertele" },
          { label: "Değerlendirmede", value: "degerlendirmede" },
          { label: "Olumsuz", value: "olumsuz" },
        ]}
      />

      {secim === "ertele" && (
        <div style={{ marginBottom: 14 }}>
          <Text strong style={{ fontSize: 13 }}>
            Yeni görüşme tarihi
          </Text>
          <DatePicker
            showTime={{ format: "HH:mm" }}
            format="DD.MM.YYYY HH:mm"
            style={{ width: "100%", marginTop: 6 }}
            placeholder="Tarih ve saat seçiniz"
            value={yeniTarih}
            onChange={setYeniTarih}
            disabledDate={(g) => !!g && g < dayjs().startOf("day")}
          />
        </div>
      )}

      <Text strong style={{ fontSize: 13 }}>
        Açıklama <Text type="danger">*</Text>
      </Text>

      <Paragraph type="secondary" style={{ fontSize: 12, margin: "2px 0 6px" }}>
        {ipucu()}
      </Paragraph>

      <TextArea
        rows={3}
        value={aciklama}
        onChange={(e) => setAciklama(e.target.value)}
        placeholder="Zorunlu alan"
      />
    </Modal>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Arıza Kaydı Aç (panel)
 * ---------------------------------------------------------------------------
 * Mobilde kayıt açan mağaza personeli; panelden açan ise merkezdeki ekip.
 * Telefonla bildirilen bir arızayı sisteme girmek ya da bir cihaz için
 * planlı iş açmak için panelde de form gerekiyor.
 *
 * Mobil formdan farkı: şube seçiliyor (mobilde kişinin kendi şubesi) ve
 * soru akışı yok — merkez ekibi sorunu zaten biliyor, doğrudan yazıyor.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { Input, Modal, Segmented, Select, Space, Typography, message } from "antd";

import { api } from "../api";

const { Text } = Typography;

/* ========================================================================== */

export default function ArizaAc({
  departmanlar,
  turler,
  kapat,
  acildi,
  baslangic,
}: {
  departmanlar: { id: number; ad: string }[];
  turler: { id: number; ad: string; departmanId?: number | null }[];
  kapat: () => void;
  acildi: () => void;
  /** Envanterden açılınca cihaz, şube ve departman dolu gelir */
  baslangic?: { subeKodu?: string; envanterId?: number; departmanId?: number | null };
}) {
  const [departmanId, setDepartmanId] = useState<number | undefined>(baslangic?.departmanId ?? undefined);
  const [turId, setTurId] = useState<number | undefined>();
  const [subeKodu, setSubeKodu] = useState<string | undefined>(baslangic?.subeKodu);
  const [envanterId, setEnvanterId] = useState<number | undefined>(baslangic?.envanterId);
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [oncelik, setOncelik] = useState("orta");

  const [subeler, setSubeler] = useState<string[]>([]);
  const [cihazlar, setCihazlar] = useState<any[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    api
      .getir<any>("Envanter/Subeler")
      .then((c) => setSubeler(Array.isArray(c) ? c : c?.subeler ?? []))
      .catch(() => setSubeler([]));
  }, []);

  /* Cihaz listesi şubeye göre: bütün envanteri tek listede sunmak,
     doğru cihazı otuz dört şubenin kasaları arasında aramak demekti. */
  useEffect(() => {
    if (!subeKodu) {
      setCihazlar([]);
      setEnvanterId(undefined);
      return;
    }

    api
      .getir<any>(`Envanter?sube=${encodeURIComponent(subeKodu)}&durum=aktif`)
      .then((c) => setCihazlar(Array.isArray(c) ? c : c?.cihazlar ?? c?.kayitlar ?? []))
      .catch(() => setCihazlar([]));
  }, [subeKodu]);

  const uygunTurler = turler.filter(
    (t) => !t.departmanId || !departmanId || t.departmanId === departmanId
  );

  const kaydet = async () => {
    if (!departmanId) return message.warning("Departman seçiniz.");
    if (!subeKodu) return message.warning("Şube seçiniz.");
    if (!baslik.trim()) return message.warning("Başlık yazınız.");

    setKaydediliyor(true);

    try {
      await api.gonder("Ariza", {
        departmanId,
        turId: turId ?? 0,
        envanterId: envanterId ?? 0,
        subeKodu,
        baslik: baslik.trim(),
        aciklama: aciklama.trim() || null,
        oncelik,
      });

      message.success("Arıza kaydı açıldı.");
      acildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kayıt açılamadı.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      title="Arıza kaydı aç"
      onCancel={kapat}
      onOk={kaydet}
      okText="Kaydı aç"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      width={620}
      destroyOnClose
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Departman
          </Text>
          <Select
            style={{ width: "100%" }}
            placeholder="Kaydın gideceği departman"
            value={departmanId}
            onChange={(d) => {
              setDepartmanId(d);
              setTurId(undefined);
            }}
            options={departmanlar.map((d) => ({ value: d.id, label: d.ad }))}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Arıza türü
          </Text>
          <Select
            allowClear
            style={{ width: "100%" }}
            placeholder="İsteğe bağlı"
            value={turId}
            onChange={setTurId}
            options={uygunTurler.map((t) => ({ value: t.id, label: t.ad }))}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Şube
          </Text>
          <Select
            showSearch
            style={{ width: "100%" }}
            placeholder="Arızanın bulunduğu şube"
            value={subeKodu}
            onChange={(s) => { setSubeKodu(s); setEnvanterId(undefined); }}
            options={subeler.map((x: any) => {
              const kod = typeof x === "string" ? x : x.subeKodu ?? x.kod;
              return { value: kod, label: kod };
            })}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Cihaz
          </Text>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            placeholder={subeKodu ? "İsteğe bağlı" : "Önce şube seçiniz"}
            disabled={!subeKodu}
            value={envanterId}
            onChange={setEnvanterId}
            options={cihazlar.map((c) => ({
              value: c.id,
              label: `${[c.tur, c.marka, c.model].filter(Boolean).join(" ")}${
                c.seriNo ? ` · ${c.seriNo}` : ""
              }`,
            }))}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Başlık
          </Text>
          <Input
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
            placeholder="Kısa ve açık: Kasa 2 fiş yazmıyor"
            maxLength={150}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Açıklama
          </Text>
          <Input.TextArea
            rows={3}
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            placeholder="Ne zaman başladı, ne deneniyor, kim bildirdi"
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Öncelik
          </Text>
          <div>
            <Segmented
              value={oncelik}
              onChange={(d) => setOncelik(String(d))}
              options={[
                { value: "dusuk", label: "Düşük" },
                { value: "orta", label: "Orta" },
                { value: "yuksek", label: "Yüksek" },
              ]}
            />
          </div>
        </div>
      </Space>
    </Modal>
  );
}

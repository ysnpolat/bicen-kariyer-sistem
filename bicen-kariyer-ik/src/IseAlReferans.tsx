/**
 * İşe al penceresinde zorunlu referans (21.10.2026).
 *
 * Şubede kasiyer, reyoner, tandolya ve temizlik dışındaki tüm pozisyonlarda,
 * depo ve genel merkezde her pozisyonda referans zorunlu; şef ve üstünde en
 * az 2. Eksikse İK burada referansı yazar, "Kaydet ve onaya gönder"de önce
 * referanslar kaydedilir, sonra işe alım gönderilir. Kural Yönetim ›
 * Başvuru formu › Zorunlu referans bölümünden değişir.
 */
import { useEffect, useState } from "react";
import { Alert, Col, Form, Input, Row, type FormInstance } from "antd";
import { api } from "./api";

export interface ReferansDurumu {
  gereken: number;
  mevcut: number;
  eksik: number;
}

export const referansDurumuAl = (id: number, bolum?: string, subeKodu?: string) =>
  api.al<ReferansDurumu>(
    `/api/Basvuru/${id}/ReferansDurumu?bolum=${encodeURIComponent(bolum ?? "")}&subeKodu=${encodeURIComponent(subeKodu ?? "")}`
  );

const gecerli = (r: any) =>
  (r?.adSoyad ?? "").trim().length >= 3 && ((r?.telefon ?? "").match(/\d/g) ?? []).length >= 10;

/**
 * Formdaki dolu satırları kaydeder ve güncel durumu döndürür. Yeterli
 * referans yoksa satırlar doğrulanır (hata gösterilir) ve null döner.
 */
export const eksikReferanslariKaydet = async (
  id: number,
  form: FormInstance,
  durum: ReferansDurumu | null,
  bolum?: string,
  subeKodu?: string
): Promise<ReferansDurumu | null> => {
  if (!durum || durum.eksik <= 0) return durum;

  const satirlar: any[] = form.getFieldValue("referanslar") ?? [];
  const dolu = satirlar.filter(gecerli);

  if (dolu.length < durum.eksik) {
    await form.validateFields().catch(() => undefined);
    return null;
  }

  for (const r of dolu)
    await api.gonder(`/api/Basvuru/${id}/Referans`, {
      adSoyad: r.adSoyad.trim(),
      telefon: String(r.telefon).trim(),
      calistigiYer: r.calistigiYer?.trim() || null,
      gorev: r.gorev?.trim() || null,
      yakinlik: r.yakinlik?.trim() || null,
      gorusulduMu: false,
    });

  form.resetFields();
  const yeni = await referansDurumuAl(id, bolum, subeKodu);
  return yeni.eksik > 0 ? null : yeni;
};

export default function IseAlReferans({
  basvuruId,
  bolum,
  subeKodu,
  form,
  surum,
  onDurum,
}: {
  basvuruId?: number;
  bolum?: string;
  subeKodu?: string;
  form: FormInstance;
  /** Değişince durum yeniden okunur */
  surum?: number;
  onDurum: (d: ReferansDurumu | null) => void;
}) {
  const [durum, setDurum] = useState<ReferansDurumu | null>(null);

  useEffect(() => {
    if (!basvuruId) return;
    let iptal = false;
    referansDurumuAl(basvuruId, bolum, subeKodu)
      .then((d) => {
        if (iptal) return;
        setDurum(d);
        onDurum(d);
        const satir = form.getFieldValue("referanslar") ?? [];
        if (d.eksik > satir.length)
          form.setFieldValue("referanslar", [
            ...satir,
            ...Array.from({ length: d.eksik - satir.length }, () => ({})),
          ]);
      })
      .catch(() => {
        if (!iptal) {
          setDurum(null);
          onDurum(null);
        }
      });
    return () => {
      iptal = true;
    };
  }, [basvuruId, bolum, subeKodu, surum]);

  if (!durum || durum.gereken <= 0) return null;

  if (durum.eksik <= 0)
    return (
      <Alert
        type="success"
        showIcon
        style={{ marginTop: 12 }}
        message={`Referans tamam: ${durum.mevcut} / en az ${durum.gereken}`}
      />
    );

  return (
    <div style={{ marginTop: 12 }}>
      <Alert
        type="warning"
        showIcon
        message={`Bu pozisyon için en az ${durum.gereken} referans zorunlu · kayıtlı ${durum.mevcut}`}
        description={`${durum.eksik} referans daha ekleyin. Ad soyad ve telefon zorunlu; kaydettiğinizde önce referanslar kaydedilir, sonra işe alım onaya gider.`}
      />
      <Form form={form} layout="vertical" style={{ marginTop: 10 }}>
        <Form.List name="referanslar">
          {(satirlar) =>
            satirlar.map((s, i) => (
              <div
                key={s.key}
                style={{
                  border: "1px solid #f0d9a8",
                  borderRadius: 8,
                  padding: "10px 12px 0",
                  marginBottom: 8,
                  background: "#fffbf2",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Referans {durum.mevcut + i + 1}</div>
                <Row gutter={10}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name={[s.name, "adSoyad"]}
                      label="Ad soyad"
                      rules={[{ required: true, min: 3, message: "Ad soyad yazınız." }]}
                    >
                      <Input maxLength={80} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name={[s.name, "telefon"]}
                      label="Telefon"
                      rules={[
                        { required: true, message: "Telefon yazınız." },
                        { pattern: /^[0-9\s()+-]{10,18}$/, message: "Geçerli bir numara giriniz." },
                      ]}
                    >
                      <Input inputMode="numeric" maxLength={18} placeholder="05XX XXX XX XX" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item name={[s.name, "calistigiYer"]} label="Çalıştığı yer">
                      <Input maxLength={100} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item name={[s.name, "gorev"]} label="Görevi">
                      <Input maxLength={80} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item name={[s.name, "yakinlik"]} label="Yakınlık">
                      <Input maxLength={60} placeholder="Eski müdürü, iş arkadaşı…" />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            ))
          }
        </Form.List>
      </Form>
    </div>
  );
}

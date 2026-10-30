/**
 * Envanter kategorileri (13.10.2026)
 * ---------------------------------------------------------------------------
 * Departman kendi cihaz kategorilerini açar, düzenler, siler. Cihazın türü
 * serbest metin olarak kalıyor; tanımlı kategoriler cihaz formunda öneri
 * olarak çıkıyor. Ad değişince o departmanın cihazlarının türü de değişir.
 * Cihazı olan kategori silinmez, pasife alınır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { api } from "../../api";

interface Kategori {
  id: number;
  ad: string;
  departmanId: number | null;
  departman: string | null;
  aciklama: string | null;
  bakimAraligi: number | null;
  aktif: boolean;
  sira: number;
  cihazSayisi: number;
  duzenler: boolean;
}

interface Veri {
  kategoriler: Kategori[];
  tanimsiz: { ad: string; cihazSayisi: number }[];
  departmanlar: { id: number; ad: string }[];
  hepsi: boolean;
  yonetir: boolean;
}

export default function EnvanterKategorileri({ degisti }: { degisti?: () => void }) {
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<Partial<Kategori> | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      setVeri(await api.getir<Veri>("Envanter/Kategoriler"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kategoriler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const sil = async (k: Kategori) => {
    try {
      const c = await api.sil<{ bilgi?: string }>(`Envanter/Kategori/${k.id}`);
      message.success(c?.bilgi ?? "Kategori silindi.");
      getir();
      degisti?.();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  const yeni = (ad = "") =>
    setDuzenlenen({
      ad,
      aktif: true,
      sira: 0,
      departmanId: veri?.hepsi ? null : veri?.departmanlar[0]?.id ?? null,
    });

  const liste = veri?.kategoriler ?? [];

  return (
    <>
      {hata && <Alert type="error" showIcon message={hata} style={{ marginBottom: 12 }} />}

      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<Plus size={15} />} onClick={() => yeni()} disabled={!veri?.yonetir}>
          Yeni kategori
        </Button>
        <Typography.Text type="secondary">
          {veri?.hepsi
            ? "Departmanı boş kategori bütün departmanlarda görünür."
            : "Yalnızca kendi departmanlarınızın kategorilerini düzenleyebilirsiniz."}
        </Typography.Text>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={liste}
        pagination={false}
        locale={{ emptyText: <Empty description="Henüz kategori tanımlanmamış." /> }}
        columns={[
          {
            title: "Kategori",
            dataIndex: "ad",
            render: (ad: string, k: Kategori) => (
              <div>
                <b style={{ fontWeight: 600 }}>{ad}</b> {!k.aktif && <Tag>Pasif</Tag>}
                {k.aciklama && <div style={{ fontSize: 12, color: "#6b7280" }}>{k.aciklama}</div>}
              </div>
            ),
          },
          {
            title: "Departman",
            dataIndex: "departman",
            width: 180,
            render: (d: string | null) => (d ? <Tag color="blue">{d}</Tag> : <Tag color="green">Genel</Tag>),
          },
          {
            title: "Bakım aralığı",
            dataIndex: "bakimAraligi",
            width: 120,
            render: (b: number | null) => (b ? `${b} ay` : <Typography.Text type="secondary">—</Typography.Text>),
          },
          { title: "Cihaz", dataIndex: "cihazSayisi", width: 80 },
          {
            title: "",
            width: 90,
            render: (_: unknown, k: Kategori) =>
              k.duzenler ? (
                <Space size={4}>
                  <Button type="text" size="small" icon={<Pencil size={15} />} onClick={() => setDuzenlenen(k)} />
                  <Popconfirm
                    title="Kategori kaldırılsın mı?"
                    description={k.cihazSayisi ? "Cihazı olduğu için silinmez, pasife alınır." : "Kategori silinecek."}
                    okText="Kaldır"
                    cancelText="Vazgeç"
                    onConfirm={() => sil(k)}
                  >
                    <Button type="text" size="small" danger icon={<Trash2 size={15} />} />
                  </Popconfirm>
                </Space>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>salt okunur</Typography.Text>
              ),
          },
        ]}
      />

      {(veri?.tanimsiz?.length ?? 0) > 0 && veri?.yonetir && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>Cihazlarda kullanılıp kategori olarak tanımlanmamış türler</Typography.Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {veri!.tanimsiz.map((t) => (
              <Tag key={t.ad} style={{ cursor: "pointer", padding: "2px 8px" }} onClick={() => yeni(t.ad)}>
                + {t.ad} <span style={{ color: "#9aa1a9" }}>· {t.cihazSayisi}</span>
              </Tag>
            ))}
          </div>
        </div>
      )}

      {duzenlenen && veri && (
        <KategoriFormu
          kategori={duzenlenen}
          veri={veri}
          kapat={() => setDuzenlenen(null)}
          kaydedildi={() => {
            setDuzenlenen(null);
            getir();
            degisti?.();
          }}
        />
      )}
    </>
  );
}

function KategoriFormu({
  kategori,
  veri,
  kapat,
  kaydedildi,
}: {
  kategori: Partial<Kategori>;
  veri: Veri;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();
      setKaydediliyor(true);
      await api.gonder("Envanter/Kategori", {
        id: kategori.id ?? 0,
        ad: d.ad,
        departmanId: d.departmanId ?? null,
        aciklama: d.aciklama ?? null,
        bakimAraligi: d.bakimAraligi ?? null,
        aktif: d.aktif,
        sira: d.sira ?? 0,
      });
      message.success("Kategori kaydedildi.");
      kaydedildi();
    } catch (h: any) {
      if (!h?.errorFields) message.error(h?.message ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      title={kategori.id ? `Kategori düzenle: ${kategori.ad}` : "Yeni kategori"}
      onCancel={kapat}
      onOk={kaydet}
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ad: kategori.ad,
          departmanId: kategori.departmanId ?? undefined,
          aciklama: kategori.aciklama,
          bakimAraligi: kategori.bakimAraligi ?? undefined,
          aktif: kategori.aktif ?? true,
          sira: kategori.sira ?? 0,
        }}
      >
        <Form.Item
          name="ad"
          label="Kategori adı"
          rules={[{ required: true, message: "Kategori adını giriniz." }]}
          extra={kategori.id && kategori.cihazSayisi ? `Ad değişirse bu kategorideki ${kategori.cihazSayisi} cihazın türü de değişir.` : undefined}
        >
          <Input placeholder="Örn. Yazarkasa, Reyon dolabı" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="departmanId"
          label="Departman"
          rules={veri.hepsi ? [] : [{ required: true, message: "Departman seçiniz." }]}
          extra={veri.hepsi ? "Boş bırakılırsa bütün departmanlarda görünür." : undefined}
        >
          <Select
            allowClear={veri.hepsi}
            placeholder={veri.hepsi ? "Genel (tüm departmanlar)" : "Departman seçiniz"}
            options={veri.departmanlar.map((d) => ({ value: d.id, label: d.ad }))}
          />
        </Form.Item>

        <Form.Item name="aciklama" label="Açıklama">
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>

        <Space size={16} wrap>
          <Form.Item name="bakimAraligi" label="Önerilen bakım aralığı (ay)">
            <InputNumber min={0} max={120} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="sira" label="Sıra">
            <InputNumber style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="aktif" label="Durum" valuePropName="checked">
            <Switch checkedChildren="Aktif" unCheckedChildren="Pasif" />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

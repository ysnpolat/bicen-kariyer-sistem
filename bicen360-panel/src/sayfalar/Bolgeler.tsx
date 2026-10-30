/**
 * Bölgeler
 * ---------------------------------------------------------------------------
 * Bölge = şubeler + bölge müdürü. Grup gibi açılıyor: ad, şubeler, müdür.
 *
 * Şubeler personel kartlarındaki şube adlarından seçiliyor; elle yazılmadığı
 * için eşleşme sorunu olmuyor (İK panelindeki şube adıyla Mikro'daki iş grubu
 * adı farklı yazılınca bölge müdürü bazı şubelerini göremiyordu). Bölge
 * müdürü değişince yalnızca kişi değiştiriliyor.
 *
 * Kullanıldığı yerler: mobilde Puantaj Çizelgesi (bölge müdürü şube
 * kartları), mağaza müdürlerinin yıllık izin onayı (şubeyi kapsayan bölge
 * müdürüne gider) ve portalda "bölge" kapsamlı arıza/envanter ekranları.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Modal, Select, Space, Spin, Tag, Typography, message } from "antd";
import { api } from "../api";

type Mudur = { sicil: string; adSoyad: string; pozisyon?: string; aktif: boolean };
type Bolge = { id: number; ad: string; subeler: string[]; mudurler: Mudur[] };

export default function Bolgeler() {
  const [veri, setVeri] = useState<{ bolgeler: Bolge[]; subeSecenekleri: { sube: string; kisi: number }[] } | null>(
    null
  );
  const [duzenlenen, setDuzenlenen] = useState<Partial<Bolge> | null>(null);

  const getir = useCallback(async () => {
    try {
      setVeri(await api.getir<any>("Yetki/Bolgeler"));
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Bölgeler alınamadı.");
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  if (!veri) return <Spin />;

  const atanmis = new Set(veri.bolgeler.flatMap((b) => b.subeler));
  const bosta = veri.subeSecenekleri.filter((x) => !atanmis.has(x.sube));

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small">
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap align="start">
          <Typography.Text type="secondary" style={{ maxWidth: 760, display: "block" }}>
            Her bölgeye şubelerini ve bölge müdürünü bağlayın. Bölge müdürü mobilde{" "}
            <b>Puantaj Çizelgesi</b>'nde bu şubeleri görür; mağaza müdürlerinin yıllık izin talebi
            şubeyi kapsayan bölge müdürüne gider. Bölge müdürü değişirse yalnızca kişiyi
            değiştirmeniz yeter.
          </Typography.Text>
          <Button type="primary" onClick={() => setDuzenlenen({ ad: "", subeler: [], mudurler: [] })}>
            Bölge ekle
          </Button>
        </Space>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {veri.bolgeler.map((b) => (
          <Card
            key={b.id}
            size="small"
            hoverable
            onClick={() => setDuzenlenen(b)}
            style={{ borderColor: b.mudurler.length === 0 ? "#f5bda8" : undefined }}
          >
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {b.ad}
                </Typography.Text>
                <Tag>{b.subeler.length} şube</Tag>
              </Space>

              <div>
                {b.mudurler.length ? (
                  b.mudurler.map((m) => (
                    <Tag key={m.sicil} color={m.aktif ? "green" : "red"}>
                      {m.adSoyad}
                      {!m.aktif ? " · ayrılmış" : ""}
                    </Tag>
                  ))
                ) : (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    Bölge müdürü atanmamış
                  </Typography.Text>
                )}
              </div>

              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: b.subeler.join(", ") }}>
                {b.subeler.join(", ") || "Şube yok"}
              </Typography.Text>
            </Space>
          </Card>
        ))}
      </div>

      {bosta.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`Hiçbir bölgeye bağlı olmayan ${bosta.length} şube`}
          description={bosta.map((x) => `${x.sube} (${x.kisi})`).join(", ")}
        />
      )}

      {duzenlenen && (
        <BolgeFormu
          bolge={duzenlenen}
          bolgeler={veri.bolgeler}
          secenekler={veri.subeSecenekleri}
          kapat={() => setDuzenlenen(null)}
          kaydedildi={() => {
            setDuzenlenen(null);
            getir();
          }}
        />
      )}
    </Space>
  );
}

/* ========================================================================== */

function BolgeFormu({
  bolge,
  bolgeler,
  secenekler,
  kapat,
  kaydedildi,
}: {
  bolge: Partial<Bolge>;
  bolgeler: Bolge[];
  secenekler: { sube: string; kisi: number }[];
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [ad, setAd] = useState(bolge.ad ?? "");
  const [subeler, setSubeler] = useState<string[]>(bolge.subeler ?? []);
  const [mudurler, setMudurler] = useState<Mudur[]>(bolge.mudurler ?? []);
  const [ara, setAra] = useState("");
  const [bulunan, setBulunan] = useState<any[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Başka bölgedeki şube: listede yanında hangi bölgede olduğu */
  const baskaBolgede = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bolgeler) if (b.id !== bolge.id) for (const s of b.subeler) m.set(s, b.ad);
    return m;
  }, [bolgeler, bolge.id]);

  /* Müdür araması: sicil ya da ad, en az 2 harf */
  useEffect(() => {
    if (ara.trim().length < 2) {
      setBulunan([]);
      return;
    }

    const z = setTimeout(async () => {
      try {
        const c = await api.getir<any>(`Yetki/PersonelAra?q=${encodeURIComponent(ara.trim())}`);
        setBulunan(c?.kayitlar ?? []);
      } catch {
        setBulunan([]);
      }
    }, 300);

    return () => clearTimeout(z);
  }, [ara]);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/Bolge", {
        id: bolge.id ?? 0,
        ad: ad.trim(),
        subeler,
        mudurler: mudurler.map((m) => m.sicil),
      });
      message.success("Bölge kaydedildi.");
      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = () =>
    Modal.confirm({
      title: `"${bolge.ad}" bölgesi silinsin mi?`,
      content: "Şubeler ve bölge müdürü bağlantısı kaldırılır; bölge müdürü puantajda bu şubeleri görmez.",
      okText: "Sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        await api.sil(`Yetki/Bolge/${bolge.id}`);
        kaydedildi();
      },
    });

  return (
    <Modal
      open
      width={640}
      title={bolge.id ? `Bölgeyi düzenle — ${bolge.ad}` : "Yeni bölge"}
      onCancel={kapat}
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          {bolge.id ? (
            <Button danger onClick={sil}>
              Bölgeyi sil
            </Button>
          ) : (
            <span />
          )}
          <Space>
            <Button onClick={kapat}>Vazgeç</Button>
            <Button type="primary" loading={kaydediliyor} disabled={!ad.trim()} onClick={kaydet}>
              Kaydet
            </Button>
          </Space>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Typography.Text strong>Bölge adı</Typography.Text>
          <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn. İstanbul Avrupa 1" />
        </div>

        <div>
          <Typography.Text strong>Bölge müdürü</Typography.Text>
          <div style={{ margin: "6px 0" }}>
            {mudurler.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                Henüz atanmadı.
              </Typography.Text>
            ) : (
              mudurler.map((m) => (
                <Tag
                  key={m.sicil}
                  closable
                  color={m.aktif ? "green" : "red"}
                  onClose={(e) => {
                    e.preventDefault();
                    setMudurler(mudurler.filter((x) => x.sicil !== m.sicil));
                  }}
                  style={{ padding: "3px 8px", fontSize: 13 }}
                >
                  {m.adSoyad}
                  {m.pozisyon ? ` · ${m.pozisyon}` : ""}
                </Tag>
              ))
            )}
          </div>
          <Select
            showSearch
            style={{ width: "100%" }}
            placeholder="Sicil ya da ad yazarak personel arayın"
            filterOption={false}
            searchValue={ara}
            onSearch={setAra}
            value={null as any}
            notFoundContent={ara.trim().length < 2 ? "En az 2 harf yazın" : "Bulunamadı"}
            onChange={(sicil: string) => {
              const k = bulunan.find((x) => x.sicil === sicil);
              if (k && !mudurler.some((m) => m.sicil === sicil))
                setMudurler([...mudurler, { sicil: k.sicil, adSoyad: k.adSoyad, pozisyon: k.pozisyon, aktif: true }]);
              setAra("");
            }}
            options={bulunan.map((k) => ({
              value: k.sicil,
              label: `${k.adSoyad} · ${k.pozisyon ?? ""} · ${k.sube ?? ""} · ${k.sicil}`,
            }))}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
            Bir bölgenin birden çok müdürü olabilir (vekâlet gibi). Müdür değişince eskiyi × ile
            çıkarıp yenisini ekleyin.
          </Typography.Text>
        </div>

        <div>
          <Typography.Text strong>Şubeler ({subeler.length})</Typography.Text>
          <Select
            mode="multiple"
            style={{ width: "100%", marginTop: 6 }}
            placeholder="Şube seçin — personel kartlarındaki şube adları"
            value={subeler}
            onChange={setSubeler}
            optionFilterProp="label"
            maxTagCount="responsive"
            options={secenekler.map((x) => {
              const baska = baskaBolgede.get(x.sube);
              return {
                value: x.sube,
                label: baska ? `${x.sube} · ${baska} bölgesinde` : `${x.sube} · ${x.kisi} kişi`,
                disabled: !!baska,
              };
            })}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
            Bir şube yalnızca bir bölgede olabilir; başka bölgedeki şube listede soluk görünür.
          </Typography.Text>
        </div>
      </Space>
    </Modal>
  );
}

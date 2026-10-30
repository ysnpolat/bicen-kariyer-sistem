/**
 * ---------------------------------------------------------------------------
 * İzin Onay Tablosu
 * ---------------------------------------------------------------------------
 * Yıllık izin talebinin 1. onaylayanı: iş yeri + pozisyon → onaylayan
 * pozisyon (ya da belirli bir kişi). 2. onay her zaman İnsan Kaynakları.
 *
 * İK'nın Excel'de tuttuğu "POZİSYON YETKİ" tablosu buraya taşındı ve ilk
 * açılışta ondan dolduruldu. Organizasyon şeması izin onayında artık
 * kullanılmıyor.
 *
 * "Kuralı olmayan pozisyonlar" ayrıca gösteriliyor: kuralı olmayan
 * pozisyonun talebi 1. onayı atlayıp doğrudan İK'ya düşüyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { api } from "./api";

type Kural = { id: number; isYeri: string; pozisyon: string; onay1: string; onay1Sicil?: string | null };

export default function IzinOnayTablosu() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ara, setAra] = useState("");
  const [yer, setYer] = useState<string>("hepsi");
  const [duzenlenen, setDuzenlenen] = useState<Partial<Kural> | null>(null);

  const [deneSicil, setDeneSicil] = useState("");
  const [deneSonuc, setDeneSonuc] = useState<any>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<any>("/api/IzinOnayKural"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kurallar: Kural[] = veri?.kurallar ?? [];
  const pozisyonlar: { pozisyon: string; kisi: number }[] = veri?.pozisyonlar ?? [];
  const isYerleri: string[] = veri?.isYerleri ?? ["ŞUBE"];
  const eksikler: any[] = veri?.eksikler ?? [];

  const q = ara.trim().toLocaleLowerCase("tr");

  const gorunen = useMemo(
    () =>
      kurallar.filter(
        (k) =>
          (yer === "hepsi" || k.isYeri === yer) &&
          (!q || `${k.pozisyon} ${k.onay1}`.toLocaleLowerCase("tr").includes(q))
      ),
    [kurallar, yer, q]
  );

  const pozSecenek = pozisyonlar.map((p) => ({ value: p.pozisyon, label: `${p.pozisyon} · ${p.kisi} kişi` }));
  const aramaFiltre = (g: string, o: any) =>
    String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"));

  const kaydet = async () => {
    try {
      await api.gonder("/api/IzinOnayKural", { id: 0, ...duzenlenen });
      message.success("Kural kaydedildi.");
      setDuzenlenen(null);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const dene = async () => {
    if (!deneSicil.trim()) return;
    try {
      setDeneSonuc(await api.al<any>(`/api/IzinOnayKural/Dene?sicil=${encodeURIComponent(deneSicil.trim())}`));
    } catch (h: any) {
      setDeneSonuc(null);
      message.error(h.message);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Yıllık izin talebi bu tabloya göre onaya gider"
        description="Talep edenin iş yeri ve pozisyonuna göre 1. onaylayan bulunur; 2. onay her zaman İnsan Kaynakları'dır. Mağaza müdürü kendi mağazasının, depo müdürü deponun personelini onaylar; bölge müdürü sorumlu olduğu şubelerin mağaza müdürlerini (bölgeler portalda Yetkiler → Kişiye özel'den). Onaylayan belirli bir kişiyse sicili yazılır."
      />

      {eksikler.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${eksikler.length} pozisyonun kuralı yok — bu personelin talebi doğrudan İK'ya düşer`}
          description={
            <Space size={[6, 6]} wrap style={{ marginTop: 6 }}>
              {eksikler.slice(0, 30).map((e) => (
                <Tag
                  key={e.pozisyon}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setDuzenlenen({
                      isYeri: e.isYerleri?.length === 1 && isYerleri.includes(e.isYerleri[0]) ? e.isYerleri[0] : "ŞUBE",
                      pozisyon: e.pozisyon,
                      onay1: "",
                    })
                  }
                >
                  ＋ {e.pozisyon} · {e.kisi}
                </Tag>
              ))}
            </Space>
          }
        />
      )}

      <Card size="small">
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="Pozisyon ya da onaylayan ara"
              style={{ width: 260 }}
              value={ara}
              onChange={(e) => setAra(e.target.value)}
            />
            <Segmented
              value={yer}
              onChange={(v) => setYer(String(v))}
              options={[{ value: "hepsi", label: `Tümü (${kurallar.length})` }].concat(
                isYerleri.map((y) => ({ value: y, label: `${y} (${kurallar.filter((k) => k.isYeri === y).length})` }))
              )}
            />
          </Space>

          <Space>
            <Input
              placeholder="Sicil ile dene"
              style={{ width: 150 }}
              value={deneSicil}
              onChange={(e) => setDeneSicil(e.target.value)}
              onPressEnter={dene}
            />
            <Button onClick={dene}>Kime gider?</Button>
            <Button type="primary" onClick={() => setDuzenlenen({ isYeri: "ŞUBE", pozisyon: "", onay1: "" })}>
              ＋ Kural ekle
            </Button>
          </Space>
        </Space>

        {deneSonuc && (
          <Alert
            style={{ marginTop: 12 }}
            type={deneSonuc.onaylayanlar?.length ? "success" : "warning"}
            showIcon
            closable
            onClose={() => setDeneSonuc(null)}
            message={
              <>
                <b>{deneSonuc.personel.adSoyad}</b> · {deneSonuc.personel.pozisyon} · {deneSonuc.personel.isYeri}
              </>
            }
            description={
              deneSonuc.kural ? (
                <>
                  1. onay: <b>{deneSonuc.onay1}</b> →{" "}
                  {deneSonuc.onaylayanlar.length
                    ? deneSonuc.onaylayanlar.map((o: any) => `${o.adSoyad} (${o.isYeri})`).join(", ")
                    : "bu pozisyonda kimse bulunamadı — talep İK'ya geçer"}
                  <br />
                  2. onay: <b>İnsan Kaynakları</b>
                </>
              ) : (
                "Bu pozisyonun kuralı yok; talep doğrudan İnsan Kaynakları'na düşer."
              )
            }
          />
        )}
      </Card>

      <Table
        rowKey="id"
        size="middle"
        loading={yukleniyor}
        dataSource={gorunen}
        pagination={{ pageSize: 30, showSizeChanger: false }}
        columns={[
          { title: "İş yeri", dataIndex: "isYeri", width: 170, render: (d: string) => <Tag>{d}</Tag> },
          { title: "Pozisyon (talep eden)", dataIndex: "pozisyon", render: (d: string) => <b>{d}</b> },
          {
            title: "1. onay",
            render: (_: unknown, k: Kural) => (
              <Space size={4}>
                <Tag color="green">{k.onay1}</Tag>
                {k.onay1Sicil && <Tag color="purple">sicil {k.onay1Sicil}</Tag>}
              </Space>
            ),
          },
          { title: "2. onay", width: 150, render: () => <Tag color="blue">İnsan Kaynakları</Tag> },
          {
            title: "",
            width: 130,
            render: (_: unknown, k: Kural) => (
              <Space>
                <Button size="small" onClick={() => setDuzenlenen(k)}>
                  Düzenle
                </Button>
                <Popconfirm
                  title="Kural silinsin mi?"
                  description="Bu pozisyonun talebi doğrudan İK'ya düşer."
                  okText="Sil"
                  cancelText="Vazgeç"
                  onConfirm={async () => {
                    await api.sil(`/api/IzinOnayKural/${k.id}`);
                    getir();
                  }}
                >
                  <Button size="small" danger>
                    Sil
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={!!duzenlenen}
        title={duzenlenen?.id ? "Kuralı düzenle" : "Yeni kural"}
        okText="Kaydet"
        cancelText="Vazgeç"
        onCancel={() => setDuzenlenen(null)}
        onOk={kaydet}
        okButtonProps={{ disabled: !duzenlenen?.isYeri || !duzenlenen?.pozisyon?.trim() || !duzenlenen?.onay1?.trim() }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>İş yeri</Typography.Text>
            <AutoComplete
              style={{ width: "100%" }}
              value={duzenlenen?.isYeri}
              onChange={(v) => setDuzenlenen({ ...duzenlenen, isYeri: v })}
              options={isYerleri.map((y) => ({ value: y }))}
              placeholder="ŞUBE, Z.MERKEZ BURO, AKÇABURGAZ DEPO…"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ŞUBE bütün mağazalar için geçerli; diğerleri personel kartındaki iş yeri adıyla birebir.
            </Typography.Text>
          </div>
          <div>
            <Typography.Text strong>Pozisyon (talep eden)</Typography.Text>
            <AutoComplete
              style={{ width: "100%" }}
              value={duzenlenen?.pozisyon}
              onChange={(v) => setDuzenlenen({ ...duzenlenen, pozisyon: v })}
              options={pozSecenek}
              filterOption={aramaFiltre}
            />
          </div>
          <div>
            <Typography.Text strong>1. onaylayan pozisyon</Typography.Text>
            <AutoComplete
              style={{ width: "100%" }}
              value={duzenlenen?.onay1}
              onChange={(v) => setDuzenlenen({ ...duzenlenen, onay1: v })}
              options={[{ value: "BÖLGE MÜDÜRÜ", label: "BÖLGE MÜDÜRÜ · şubeyi kapsayan" }, ...pozSecenek]}
              filterOption={aramaFiltre}
            />
          </div>
          <div>
            <Typography.Text strong>Belirli bir kişi (isteğe bağlı)</Typography.Text>
            <Input
              placeholder="Sicil — aynı ünvanda birden çok kişi varsa"
              value={duzenlenen?.onay1Sicil ?? ""}
              onChange={(e) => setDuzenlenen({ ...duzenlenen, onay1Sicil: e.target.value })}
            />
          </div>
        </Space>
      </Modal>

    </Space>
  );
}

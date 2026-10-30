/**
 * ---------------------------------------------------------------------------
 * Künye Analizi Raporu
 * ---------------------------------------------------------------------------
 * Mobilden kaydedilen rakip künye okutmaları. Hangi üründe hangi rakipten
 * pahalı aldığımız burada birikir; satın alma bunu tedarikçiyle konuşurken
 * kullanır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";

import { api } from "./api";

const { Text } = Typography;

const para = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺`;

export default function KunyeAnalizi() {
  const { message } = AntdApp.useApp();

  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, "day"),
    dayjs(),
  ]);
  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const bas = aralik[0].format("YYYY-MM-DD");
      const bit = aralik[1].format("YYYY-MM-DD");

      setVeri(await api.al<any>(`/api/Kunye/Rapor?bas=${bas}&bit=${bit}`));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap align="center">
          <DatePicker.RangePicker
            value={aralik}
            format="DD.MM.YYYY"
            onChange={(v) => v && v[0] && v[1] && setAralik([v[0], v[1]])}
          />

          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Mobil uygulamadan okutulan rakip künyeleri. Pozitif fark biz daha
            pahalı alıyoruz demektir.
          </Text>
        </Space>
      </Card>

      {veri && (
        <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
          <Col flex="1 1 150px">
            <div className="pt-kutu pt-mavi">
              <div className="pt-et">Okutma</div>
              <div className="pt-dg">{veri.toplam}</div>
            </div>
          </Col>
          <Col flex="1 1 150px">
            <div className="pt-kutu pt-yesil">
              <div className="pt-et">Karşılaştırılan</div>
              <div className="pt-dg">{veri.karsilastirilan}</div>
            </div>
          </Col>
          <Col flex="1 1 150px">
            <div className="pt-kutu pt-kirmizi">
              <div className="pt-et">Pahalı aldığımız</div>
              <div
                className="pt-dg"
                style={{ color: veri.pahaliAldigimiz > 0 ? "#E8481C" : undefined }}
              >
                {veri.pahaliAldigimiz}
              </div>
            </div>
          </Col>
        </Row>
      )}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="Ürün bazında ortalama fark">
            <Table
              size="small"
              rowKey="urun"
              loading={yukleniyor}
              dataSource={veri?.urunler ?? []}
              pagination={false}
              locale={{ emptyText: <Empty description="Henüz karşılaştırma yok." /> }}
              columns={[
                { title: "Ürün", dataIndex: "urun" },
                { title: "Okutma", dataIndex: "adet", align: "center", width: 80 },
                {
                  title: "Ort. fark",
                  dataIndex: "ortalamaFark",
                  align: "right",
                  width: 110,
                  render: (v: number) => (
                    <Tag color={v > 0 ? "red" : v < 0 ? "green" : "default"}>
                      {v > 0 ? "+" : ""}
                      {para(v)}
                    </Tag>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card size="small" title="Okutmalar">
            <Table
              size="small"
              rowKey="id"
              loading={yukleniyor}
              dataSource={veri?.kayitlar ?? []}
              pagination={{ pageSize: 20, hideOnSinglePage: true }}
              locale={{ emptyText: <Empty description="Bu aralıkta okutma yok." /> }}
              columns={[
                {
                  title: "Tarih",
                  dataIndex: "olusturma",
                  width: 120,
                  render: (v: string) => dayjs(v).format("DD.MM HH:mm"),
                },
                {
                  title: "Ürün / Künye",
                  render: (_: any, k: any) => (
                    <div>
                      <Text strong>{k.urunAdi || `Cins ${k.cinsKod ?? "?"}`}</Text>
                      <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                        {k.kunyeNo}
                        {k.uretici ? ` · ${k.uretici}` : ""}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Rakip",
                  dataIndex: "rakipIsletme",
                  ellipsis: true,
                  render: (v: string, k: any) => (
                    <div>
                      <div style={{ fontSize: 12.5 }}>{v || "—"}</div>
                      <Text strong>{para(k.rakipFiyat)}</Text>
                    </div>
                  ),
                },
                {
                  title: "Biz",
                  width: 130,
                  render: (_: any, k: any) => (
                    <div>
                      <div style={{ fontSize: 12.5, color: "#8a8f98" }}>
                        {k.subeAdi || "—"}
                      </div>
                      <Text strong>{para(k.bizimFiyat)}</Text>
                    </div>
                  ),
                },
                {
                  title: "Fark",
                  dataIndex: "fark",
                  align: "right",
                  width: 130,
                  render: (v: number | null, k: any) =>
                    v === null || v === undefined ? (
                      <Text type="secondary">—</Text>
                    ) : (
                      <Tag color={v > 0 ? "red" : v < 0 ? "green" : "default"}>
                        {v > 0 ? "+" : ""}
                        {para(v)}
                        {k.farkYuzde != null ? ` (%${k.farkYuzde})` : ""}
                      </Tag>
                    ),
                },
                { title: "Okutan", dataIndex: "personelAdi", width: 130, ellipsis: true },
              ]}
              expandable={{
                rowExpandable: (k: any) => !!k.notMetni,
                expandedRowRender: (k: any) => (
                  <Text style={{ fontSize: 13 }}>{k.notMetni}</Text>
                ),
              }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

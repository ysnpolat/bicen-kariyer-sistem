/**
 * ---------------------------------------------------------------------------
 * Bölge Özeti
 * ---------------------------------------------------------------------------
 * Bölge müdürünün gördüğü ekran. Başvuru listesi yerine kendi bölgesindeki
 * hareketi özetler: görüşme talepleri, evrak aşamasındakiler ve işe alınanlar.
 *
 * Adayların kimlik bilgileri bu ekranda gösterilmez; sunucu zaten bu verileri
 * göndermez.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  CalendarClock,
  FileCheck2,
  DoorOpen,
  RefreshCw,
  UserCheck,
  Users,
} from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";
import { RENK } from "./sabitler";

const { Title, Text, Paragraph } = Typography;

/** Para biçimi */
const para = (deger?: number | null): string =>
  deger ? `${Number(deger).toLocaleString("tr-TR")} TL` : "—";

export default function BolgeOzeti() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);

  /* QR okutma ve kadro durumu; bölge müdürünün kendi mağazaları */
  const [durum, setDurum] = useState<any>(null);
  const [gorunum, setGorunum] = useState<"gorusme" | "evrak" | "alinan">(
    "gorusme"
  );
  const [veri, setVeri] = useState<Record<string, any[]>>({
    gorusme: [],
    evrak: [],
    alinan: [],
  });

  const getir = useCallback(async () => {
    /* Kadro ve okutma durumu ayrı uçtan gelir; biri hata verirse
       diğeri yine gösterilir. */
    api
      .al<any>("/api/Personel/BolgeDurum")
      .then(setDurum)
      .catch(() => setDurum(null));

    setYukleniyor(true);

    try {
      /* Üç durum ayrı ayrı çekilir; sunucu bölge sınırını kendisi uygular */
      const [gorusme, evrak, alinan] = await Promise.all([
        api.al<any>(
          `/api/Basvuru/Liste?durum=${encodeURIComponent("Görüşme Talebi")}&adet=200`
        ),
        api.al<any>(
          `/api/Basvuru/Liste?durum=${encodeURIComponent("Evrak Hazırlanıyor")}&adet=200`
        ),
        api.al<any>(
          `/api/Basvuru/Liste?durum=${encodeURIComponent("İşe Alındı")}&adet=200`
        ),
      ]);

      setVeri({
        gorusme: gorusme?.kayitlar ?? [],
        evrak: evrak?.kayitlar ?? [],
        alinan: alinan?.kayitlar ?? [],
      });
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Yaklaşan görüşmeler önce gelsin */
  const gorusmeler = [...veri.gorusme].sort((a, b) =>
    (a.gorusmeTarihi ?? "").localeCompare(b.gorusmeTarihi ?? "")
  );

  const listeler: Record<string, any[]> = {
    gorusme: gorusmeler,
    evrak: veri.evrak,
    alinan: veri.alinan,
  };

  const liste = listeler[gorunum] ?? [];

  /* Ortak sütunlar; kimlik bilgisi gösterilmez */
  const sutunlar = [
    {
      title: "Aday",
      dataIndex: "adSoyad",
      width: 180,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    { title: "Telefon", dataIndex: "telefon", width: 130 },
    { title: "Birim", dataIndex: "subeAdi", width: 170, ellipsis: true },
    {
      title: "Pozisyon",
      key: "pozisyon",
      width: 170,
      ellipsis: true,
      render: (_v: unknown, k: any) => k.iseGirisBolum || k.bolumler || "—",
    },
  ];

  const gorusmeSutunlari = [
    ...sutunlar,
    {
      title: "Görüşme",
      dataIndex: "gorusmeTarihi",
      width: 155,
      sorter: (a: any, b: any) =>
        (a.gorusmeTarihi ?? "").localeCompare(b.gorusmeTarihi ?? ""),
      render: (v: string) => {
        if (!v) return <span style={{ color: "#bbb" }}>—</span>;

        const tarih = dayjs(v);
        const gecti = tarih.isBefore(dayjs());

        return (
          <Space direction="vertical" size={0}>
            <Text>{tarih.format("DD.MM.YYYY HH:mm")}</Text>
            <Tag color={gecti ? "orange" : "blue"} style={{ marginInlineEnd: 0 }}>
              {gecti
                ? "zamanı geçti"
                : `${tarih.diff(dayjs(), "day")} gün sonra`}
            </Tag>
          </Space>
        );
      },
    },
    { title: "Yer", dataIndex: "gorusmeYeri", ellipsis: true },
  ];

  const alinanSutunlari = [
    ...sutunlar,
    {
      title: "İşe Giriş",
      dataIndex: "iseGirisTarihi",
      width: 120,
      render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—"),
    },
    {
      title: "Anlaşılan Ücret",
      dataIndex: "anlasilanUcret",
      width: 140,
      align: "right" as const,
      render: (v: number) => para(v),
    },
  ];

  const evrakSutunlari = [
    ...sutunlar,
    {
      title: "Talep Ettiği Ücret",
      dataIndex: "talepUcret",
      width: 150,
      align: "right" as const,
      render: (v: string) => para(Number(v)),
    },
    {
      title: "Bekleme",
      dataIndex: "durumGun",
      width: 120,
      align: "center" as const,
      render: (v: number) =>
        v > 0 ? (
          <Tag color={v > 7 ? "orange" : "default"}>{v} gündür</Tag>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
  ];

  const sutunSecimi: Record<string, any[]> = {
    gorusme: gorusmeSutunlari,
    evrak: evrakSutunlari,
    alinan: alinanSutunlari,
  };

  return (
    <div className="ik-icerik">
      <Title level={4} style={{ marginTop: 0 }}>
        Bölgenizdeki Hareket
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 13 }}>
        Sorumlu olduğunuz mağazalara gelen başvuruların güncel durumu.
      </Paragraph>

      {/* ------------------------------------------------------- özet kartları */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={24} md={8}>
          <Card
            size="small"
            className={`bs-kart${gorunum === "gorusme" ? " bs-kart-secili" : ""}`}
            onClick={() => setGorunum("gorusme")}
          >
            <div className="bs-kart-baslik">
              <Space size={6}>
                <CalendarClock size={14} strokeWidth={2} />
                Görüşme Talebi
              </Space>
            </div>
            <div className="bs-kart-deger" style={{ color: "#722ed1" }}>
              {veri.gorusme.length}
            </div>
            <div className="bs-kart-alt">planlanan görüşmeler</div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card
            size="small"
            className={`bs-kart${gorunum === "evrak" ? " bs-kart-secili" : ""}`}
            onClick={() => setGorunum("evrak")}
          >
            <div className="bs-kart-baslik">
              <Space size={6}>
                <FileCheck2 size={14} strokeWidth={2} />
                Evrak Hazırlanıyor
              </Space>
            </div>
            <div className="bs-kart-deger" style={{ color: "#2f54eb" }}>
              {veri.evrak.length}
            </div>
            <div className="bs-kart-alt">işe alım süreci sürüyor</div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card
            size="small"
            className={`bs-kart${gorunum === "alinan" ? " bs-kart-secili" : ""}`}
            onClick={() => setGorunum("alinan")}
          >
            <div className="bs-kart-baslik">
              <Space size={6}>
                <UserCheck size={14} strokeWidth={2} />
                İşe Alınan
              </Space>
            </div>
            <div className="bs-kart-deger" style={{ color: RENK.yesilKoyu }}>
              {veri.alinan.length}
            </div>
            <div className="bs-kart-alt">tamamlanan işe alımlar</div>
          </Card>
        </Col>
      </Row>

      {/* -------------------------------------------------------------- liste */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <Users size={16} strokeWidth={2} />
            {gorunum === "gorusme"
              ? "Görüşme Talepleri"
              : gorunum === "evrak"
              ? "Evrak Hazırlananlar"
              : "İşe Alınanlar"}
          </Space>
        }
        extra={
          <Segmented
            size="small"
            value={gorunum}
            onChange={(v) => setGorunum(v as any)}
            options={[
              { label: "Görüşme", value: "gorusme" },
              { label: "Evrak", value: "evrak" },
              { label: "İşe alınan", value: "alinan" },
            ]}
          />
        }
      >
        {yukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : liste.length === 0 ? (
          <Empty description="Bu durumda başvuru bulunmuyor." />
        ) : (
          <Tablo
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: false }}
            dataSource={liste}
            scroll={{ x: 860 }}
            columns={sutunSecimi[gorunum]}
          />
        )}
      </Card>

      {/* -------------------------------------- QR okutma ve kadro durumu */}
      {durum && (
        <Row gutter={[12, 12]} style={{ marginTop: 14 }}>
          <Col xs={24} lg={12}>
            <Card
              size="small"
              title={
                <Space size={8}>
                  <DoorOpen size={16} strokeWidth={2} />
                  Dün QR Okutmayanlar
                  <Tag color={durum.okutmayanSayisi > 0 ? "red" : "green"}>
                    {durum.okutmayanSayisi} / {durum.toplamPersonel}
                  </Tag>
                </Space>
              }
            >
              {durum.okutmayanlar?.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Tüm personel okutmuş."
                />
              ) : (
                <div className="bo-liste">
                  {durum.okutmayanlar.map((m: any) => (
                    <details className="bo-magaza" key={m.magaza}>
                      <summary>
                        <span>{m.magaza}</span>
                        <b>{m.okutmayan}</b>
                      </summary>

                      <div className="bo-kisiler">
                        {m.kisiler.map((k: any, i: number) => (
                          <span key={i}>
                            {k.adSoyad}
                            {k.pozisyon && <i>{k.pozisyon}</i>}
                          </span>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              <Text type="secondary" style={{ fontSize: 11.5 }}>
                Okutmayan personel devamsız değildir; izinli olabilir ya da
                okutmayı atlamış olabilir.
              </Text>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card
              size="small"
              title={
                <Space size={8}>
                  <Users size={16} strokeWidth={2} />
                  Kadro Durumu
                </Space>
              }
            >
              {durum.kadroDurumu?.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Kadro tanımı bulunamadı."
                />
              ) : (
                <div className="bo-liste">
                  {durum.kadroDurumu.map((k: any) => (
                    <div className="bo-kadro" key={k.magaza}>
                      <div className="bo-kadro-ust">
                        <b>{k.magaza}</b>

                        <Space size={5}>
                          <Tag bordered={false}>
                            norm {k.norm} · mevcut {k.mevcut}
                          </Tag>

                          {k.fark !== 0 && (
                            <Tag color={k.fark < 0 ? "red" : "orange"}>
                              {k.fark > 0 ? `+${k.fark}` : k.fark}
                            </Tag>
                          )}
                        </Space>
                      </div>

                      {(k.eksikler.length > 0 || k.fazlalar.length > 0) && (
                        <div className="bo-kadro-alt">
                          {k.eksikler.map((e: any) => (
                            <span className="bo-eksik" key={`e${e.bolum}`}>
                              {e.bolum} <b>−{e.adet}</b>
                            </span>
                          ))}

                          {k.fazlalar.map((f: any) => (
                            <span className="bo-fazla" key={`f${f.bolum}`}>
                              {f.bolum} <b>+{f.adet}</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Space style={{ marginTop: 12 }}>
        <Tag
          icon={<RefreshCw size={12} strokeWidth={2} />}
          style={{ cursor: "pointer" }}
          onClick={getir}
        >
          Yenile
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Aday kimlik bilgileri bu ekranda gösterilmez.
        </Text>
      </Space>
    </div>
  );
}

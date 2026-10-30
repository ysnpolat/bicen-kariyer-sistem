/**
 * ---------------------------------------------------------------------------
 * Personel Sirkülasyonu
 * ---------------------------------------------------------------------------
 * Seçilen dönemde hangi birimden kaç kişi işe girmiş, kaç kişi ayrılmış,
 * ortalama ne kadar çalışmışlar ve o birime personel bulmak ne kadar sürüyor.
 *
 * Giriş ve çıkış bilgisi Mikro'dan, işe alım süresi başvuru sisteminden gelir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Drawer,
  Segmented,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  ArrowDownRight,
  BarChart3,
  ArrowUpRight,
  Clock,
  RefreshCw,
  TrendingDown,
  Undo2,
  UserCircle2,
  Users,
} from "lucide-react";

import Tablo from "./Tablo";
import GeriDonenler from "./GeriDonenler";
import Turnover from "./Turnover";
import PersonelResmi from "./PersonelResmi";
import { api } from "./api";
import { RENK } from "./sabitler";
import { PersonelAdi, personelKartiAc, personelKartiAcilabilir } from "./personelKarti";

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

type Donem = "3ay" | "6ay" | "12ay" | "ozel";

interface Veri {
  toplamMevcut: number;
  yillikDevir: number;
  donemBasiCalisan: number;
  donemSonuCalisan: number;
  ortalamaCalisan: number;
  donemAy: number;
  giren: number;
  cikan: number;
  net: number;
  devirOrani: number;
  ortalamaCalismaGun: number;
  birimler: any[];
  pozisyonlar: any[];
  sebepler: any[];
}

const BOS: Veri = {
  toplamMevcut: 0,
  yillikDevir: 0,
  donemBasiCalisan: 0,
  donemSonuCalisan: 0,
  ortalamaCalisan: 0,
  donemAy: 12,
  giren: 0,
  cikan: 0,
  net: 0,
  devirOrani: 0,
  ortalamaCalismaGun: 0,
  birimler: [],
  pozisyonlar: [],
  sebepler: [],
};

/** Gün sayısını okunur süreye çevirir */
const sureMetni = (gun: number): string => {
  if (!gun || gun <= 0) return "—";
  if (gun < 30) return `${gun} gün`;

  const yil = Math.floor(gun / 365);
  const ay = Math.floor((gun % 365) / 30);

  if (yil === 0) return `${ay} ay`;
  return ay > 0 ? `${yil} yıl ${ay} ay` : `${yil} yıl`;
};

/** Dakikayı okunur süreye çevirir (işe alım süresi için) */
const alimSuresi = (dakika: number): string => {
  if (!dakika || dakika <= 0) return "—";
  if (dakika < 60) return `${dakika} dakika`;
  if (dakika < 1440) return `${Math.round(dakika / 60)} saat`;
  return `${Math.round(dakika / 1440)} gün`;
};

/** Devir oranına göre renk: yüksek devir dikkat gerektirir */
const devirRengi = (oran: number) =>
  oran >= 50 ? "red" : oran >= 25 ? "orange" : oran >= 10 ? "gold" : "green";

export default function Sirkulasyon() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<Veri>(BOS);
  const [donem, setDonem] = useState<Donem>("12ay");
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(12, "month"),
    dayjs(),
  ]);

  /* Birim satırında hangi liste gösteriliyor: ayrılanlar mı, girenler mi */
  const [liste, setListe] = useState<Record<string, "cikan" | "giren">>({});

  /* Kişiye tıklanınca açılan personel detayı */
  const [detay, setDetay] = useState<any>(null);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);

  /* Pozisyon veya çıkış sebebine tıklanınca açılan kişi listesi */
  const [kirilim, setKirilim] = useState<{ baslik: string; kayitlar: any[] } | null>(
    null
  );

  /* Dönem düğmesi aralığı belirler; "özel" seçilirse takvimden alınır */
  useEffect(() => {
    if (donem === "ozel") return;

    const ay = donem === "3ay" ? 3 : donem === "6ay" ? 6 : 12;
    setAralik([dayjs().subtract(ay, "month"), dayjs()]);
  }, [donem]);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const sorgu = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
      });

      setVeri(await api.al<Veri>(`/api/Personel/Sirkulasyon?${sorgu.toString()}`));
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(BOS);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /** Kişiye tıklanınca ayrıntılarını getirir */
  const detayAc = async (kod: string) => {
    if (!kod) return;

    /* 09.10.2026: Personeller sayfasındaki personel kartı (her sayfada aynı
       kart). Rol o sayfayı görmüyorsa eski ayrıntı penceresi açılır. */
    if (personelKartiAcilabilir()) {
      personelKartiAc(kod);
      return;
    }

    setDetay({ kisi: null });
    setDetayYukleniyor(true);

    try {
      setDetay(await api.al<any>(`/api/Personel/Detay?kod=${encodeURIComponent(kod)}`));
    } catch (hata: any) {
      message.error(hata.message);
      setDetay(null);
    } finally {
      setDetayYukleniyor(false);
    }
  };

  /** Kişi listesi tablosunun ortak sütunları */
  const kisiSutunlari = (cikisGoster: boolean) => [
    {
      title: "Personel",
      key: "ad",
      width: 168,
      render: (_v: unknown, k: any) => (
        <div className="pr-kisi">
          <PersonelResmi kod={k.personelKodu} ad={k.ad} boyut={28} />
          <div className="pr-kisi-metin">
            <Text strong style={{ fontSize: 12.5 }}>
              <PersonelAdi kod={k.personelKodu}>{k.ad} {k.soyad}</PersonelAdi>
            </Text>
            <div style={{ fontSize: 11, color: "#8a8f98" }}>{k.personelKodu}</div>
          </div>
        </div>
      ),
    },
    { title: "Ünvan", dataIndex: "pozisyon", width: 128, ellipsis: true },
    {
      title: "Giriş",
      dataIndex: "girisTarihi",
      width: 92,
      render: (v: string) => (v ? dayjs(v).format("DD.MM.YY") : "—"),
    },
    ...(cikisGoster
      ? [
          {
            title: "Çıkış",
            dataIndex: "cikisTarihi",
            width: 92,
            render: (v: string) => (v ? dayjs(v).format("DD.MM.YY") : "—"),
          },
        ]
      : []),
    {
      title: "Çalışma",
      dataIndex: "calismaGunu",
      width: 92,
      render: (v: number) => (
        <Tag color={v < 365 ? "orange" : "default"} style={{ marginInlineEnd: 0 }}>
          {sureMetni(v)}
        </Tag>
      ),
    },
    ...(cikisGoster
      ? [
          {
            title: "Çıkış Sebebi",
            dataIndex: "cikisSebebi",
            width: 180,
            ellipsis: true,
            render: (v: string) =>
              v ? (
                <Tooltip title={v}>
                  <Tag color="red" style={{ marginInlineEnd: 0 }}>
                    {v}
                  </Tag>
                </Tooltip>
              ) : (
                <span style={{ color: "#bbb" }}>—</span>
              ),
          },
        ]
      : [
          {
            title: "Durum",
            dataIndex: "durum",
            width: 110,
            render: (v: number) =>
              v === 1 ? (
                <Tag color="green">Çalışıyor</Tag>
              ) : (
                <Tag color="red">Ayrıldı</Tag>
              ),
          },
        ]),
  ];

  return (
    <div className="ik-icerik">
      <Tabs
        defaultActiveKey="sirkulasyon"
        destroyInactiveTabPane
        items={[
          {
            key: "sirkulasyon",
            label: (
              <Space size={6}>
                <TrendingDown size={15} strokeWidth={2} />
                Sirkülasyon
              </Space>
            ),
            children: (
              <>
      {/* ------------------------------------------------------ dönem seçimi */}
      <Card size="small" className="rp-filtre">
        <Row gutter={[10, 10]} align="middle">
          <Col xs={24} md={9}>
            <Segmented
              block
              value={donem}
              onChange={(v) => setDonem(v as Donem)}
              options={[
                { label: "Son 3 ay", value: "3ay" },
                { label: "Son 6 ay", value: "6ay" },
                { label: "Son 12 ay", value: "12ay" },
                { label: "Özel", value: "ozel" },
              ]}
            />
          </Col>

          <Col xs={24} md={9}>
            <RangePicker
              value={aralik}
              format="DD.MM.YYYY"
              allowClear={false}
              style={{ width: "100%" }}
              onChange={(d) => {
                if (!d) return;
                setDonem("ozel");
                setAralik(d as [Dayjs, Dayjs]);
              }}
            />
          </Col>

          <Col xs={24} md={6}>
            <Space>
              <Tag
                icon={<RefreshCw size={12} strokeWidth={2} />}
                onClick={getir}
                style={{ cursor: "pointer" }}
              >
                Yenile
              </Tag>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {veri.birimler.length} birim
              </Text>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ---------------------------------------------------------- özetler */}
      <Row gutter={[12, 12]} className="rp-satir">
        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">
              <Space size={6}>
                <ArrowUpRight size={14} strokeWidth={2} />
                İşe Giren
              </Space>
            </div>
            <div className="rp-ozet-deger" style={{ color: RENK.yesilKoyu }}>
              {veri.giren}
            </div>
          </Card>
        </Col>

        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">
              <Space size={6}>
                <ArrowDownRight size={14} strokeWidth={2} />
                İşten Ayrılan
              </Space>
            </div>
            <div className="rp-ozet-deger" style={{ color: RENK.turuncu }}>
              {veri.cikan}
            </div>
          </Card>
        </Col>

        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">
              <Space size={6}>
                <TrendingDown size={14} strokeWidth={2} />
                Devir Oranı
              </Space>
            </div>
            <div
              className="rp-ozet-deger"
              style={{ color: veri.devirOrani >= 25 ? "#cf1322" : RENK.yesilKoyu }}
            >
              %{veri.devirOrani}
            </div>
            <div className="rp-ozet-alt">
              yıllık karşılığı %{veri.yillikDevir} · ortalama{" "}
              {veri.ortalamaCalisan} çalışan
            </div>
          </Card>
        </Col>

        <Col xs={12} md={6}>
          <Card size="small" className="rp-ozet">
            <div className="rp-ozet-baslik">
              <Space size={6}>
                <Clock size={14} strokeWidth={2} />
                Ortalama Çalışma
              </Space>
            </div>
            <div className="rp-ozet-deger" style={{ fontSize: 20 }}>
              {sureMetni(veri.ortalamaCalismaGun)}
            </div>
            <div className="rp-ozet-alt">ayrılanların kıdemi</div>
          </Card>
        </Col>
      </Row>

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : veri.birimler.length === 0 ? (
        <Card>
          <Empty description="Seçilen dönemde personel hareketi bulunmuyor." />
        </Card>
      ) : (
        <>
          {/* ----------------------------------------------- birim tablosu */}
          <Card
            size="small"
            className="rp-satir"
            title={
              <Space size={8}>
                <Users size={16} strokeWidth={2} />
                Birim Bazında Sirkülasyon
              </Space>
            }
          >
            <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
              Devir oranı, dönemde ayrılan personelin <b>ortalama çalışan
              sayısına</b> bölünmesiyle bulunur: (dönem başı + dönem sonu) ÷ 2.
              %100'ün üzerindeki değerler, kadronun tamamından fazla kişinin
              ayrıldığını gösterir. Satıra tıklayarak o birimden ayrılanları ve
              işe başlayanları görebilirsiniz.
            </Paragraph>

            <Tablo
              rowKey="birim"
              size="small"
              pagination={false}
              dataSource={veri.birimler}
              scroll={{ x: 1180 }}
              expandable={{
                rowExpandable: (b: any) => b.cikanlar?.length > 0,
                expandedRowRender: (b: any) => {
                  const tur = liste[b.birim] ?? "cikan";
                  const kayitlar = tur === "cikan" ? b.cikanlar : b.girenler;

                  return (
                    <div>
                      <Segmented
                        size="small"
                        style={{ marginBottom: 8 }}
                        value={tur}
                        onChange={(v) =>
                          setListe({ ...liste, [b.birim]: v as "cikan" | "giren" })
                        }
                        options={[
                          { label: `Ayrılanlar (${b.cikanlar?.length ?? 0})`, value: "cikan" },
                          { label: `İşe başlayanlar (${b.girenler?.length ?? 0})`, value: "giren" },
                        ]}
                      />

                      <Tablo
                        rowKey="personelKodu"
                        size="small"
                        className="kp-ic-tablo"
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                        dataSource={kayitlar ?? []}
                        rowClassName="pr-tiklanabilir"
                        onRow={(k: any) => ({
                          onClick: () => detayAc(k.personelKodu),
                        })}
                        columns={kisiSutunlari(tur === "cikan")}
                      />
                    </div>
                  );
                },
              }}
              columns={[
                {
                  title: "Birim",
                  dataIndex: "birim",
                  width: 190,
                  fixed: "left",
                  render: (v: string) => <Text strong>{v}</Text>,
                },
                {
                  title: "Mevcut",
                  dataIndex: "mevcut",
                  width: 90,
                  align: "center",
                  sorter: (a: any, b: any) => a.mevcut - b.mevcut,
                },
                {
                  title: "Giren",
                  dataIndex: "giren",
                  width: 90,
                  align: "center",
                  sorter: (a: any, b: any) => a.giren - b.giren,
                  render: (v: number) =>
                    v > 0 ? <Tag color="green">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
                },
                {
                  title: "Ayrılan",
                  dataIndex: "cikan",
                  width: 95,
                  align: "center",
                  defaultSortOrder: "descend",
                  sorter: (a: any, b: any) => a.cikan - b.cikan,
                  render: (v: number) =>
                    v > 0 ? <Tag color="red">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
                },
                {
                  title: "Devir",
                  dataIndex: "devirOrani",
                  width: 118,
                  align: "center",
                  sorter: (a: any, b: any) => a.devirOrani - b.devirOrani,
                  render: (v: number, k: any) =>
                    v > 0 ? (
                      <Tooltip
                        title={
                          <span>
                            Ayrılan ÷ ortalama çalışan × 100
                            <br />
                            {k.cikan} ÷ {k.ortalamaCalisan} × 100 = %{v}
                            <br />
                            Dönem başı {k.donemBasi} · dönem sonu {k.donemSonu} kişi
                            <br />
                            Yıllık karşılığı: %{k.yillikDevir}
                          </span>
                        }
                      >
                        <div>
                          <Tag color={devirRengi(v)} style={{ marginInlineEnd: 0 }}>
                            %{v}
                          </Tag>
                          {k.yillikDevir !== v && (
                            <div style={{ fontSize: 11, color: "#8a8f98" }}>
                              yıllık %{k.yillikDevir}
                            </div>
                          )}
                        </div>
                      </Tooltip>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    ),
                },
                {
                  title: "Ortalama Çalışma",
                  dataIndex: "ortalamaCalismaGun",
                  width: 150,
                  align: "center",
                  sorter: (a: any, b: any) => a.ortalamaCalismaGun - b.ortalamaCalismaGun,
                  render: (v: number, k: any) => (
                    <div>
                      <div>{sureMetni(v)}</div>
                      {k.erkenAyrilan > 0 && (
                        <Tooltip title="İlk yılını doldurmadan ayrılan sayısı">
                          <Text type="secondary" style={{ fontSize: 11.5 }}>
                            {k.erkenAyrilan} kişi 1 yıldan az
                          </Text>
                        </Tooltip>
                      )}
                    </div>
                  ),
                },
                {
                  title: "İşe Alım Süresi",
                  dataIndex: "alimDakika",
                  width: 145,
                  align: "center",
                  sorter: (a: any, b: any) => a.alimDakika - b.alimDakika,
                  render: (v: number, k: any) =>
                    v > 0 ? (
                      <Tooltip
                        title={`${k.alimAdet} işe alımın ortalaması. Uzun süre, o birime personel bulmanın zor olduğunu gösterir.`}
                      >
                        <Tag color={v > 1440 * 15 ? "orange" : "blue"}>
                          {alimSuresi(v)}
                        </Tag>
                      </Tooltip>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    ),
                },
                {
                  title: "En Çok Ayrılan Pozisyonlar",
                  key: "pozisyonlar",
                  render: (_v, k: any) =>
                    k.pozisyonlar?.length > 0 ? (
                      <Space size={4} wrap>
                        {k.pozisyonlar.map((p: any) => (
                          <Tag key={p.pozisyon} style={{ marginInlineEnd: 0 }}>
                            {p.pozisyon} · {p.adet}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    ),
                },
              ]}
            />
          </Card>

          {/* -------------------------------------------- pozisyon tablosu */}
          <Card size="small" className="rp-satir" title="Pozisyon Bazında Hareket">
            <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
              Satıra tıklayarak o pozisyondan ayrılanları görebilirsiniz.
            </Paragraph>

            <Tablo
              rowKey="pozisyon"
              size="small"
              pagination={false}
              dataSource={veri.pozisyonlar}
              scroll={{ x: 720 }}
              rowClassName="rp-tiklanabilir"
              onRow={(p: any) => ({
                onClick: () =>
                  setKirilim({
                    baslik: `${p.pozisyon} · ayrılanlar`,
                    kayitlar: p.cikanlar ?? [],
                  }),
              })}
              columns={[
                {
                  title: "Pozisyon",
                  dataIndex: "pozisyon",
                  width: 200,
                  render: (v: string) => <Text strong>{v}</Text>,
                },
                { title: "Mevcut", dataIndex: "mevcut", width: 95, align: "center" },
                {
                  title: "Başlayan",
                  dataIndex: "giren",
                  width: 110,
                  align: "center",
                  sorter: (a: any, b: any) => a.giren - b.giren,
                  render: (v: number) =>
                    v > 0 ? <Tag color="green">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
                },
                {
                  title: "Ayrılan",
                  dataIndex: "cikan",
                  width: 110,
                  align: "center",
                  defaultSortOrder: "descend",
                  sorter: (a: any, b: any) => a.cikan - b.cikan,
                  render: (v: number) =>
                    v > 0 ? <Tag color="red">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
                },
                {
                  title: "Ortalama Çalışma",
                  dataIndex: "ortalamaCalismaGun",
                  width: 160,
                  align: "center",
                  sorter: (a: any, b: any) => a.ortalamaCalismaGun - b.ortalamaCalismaGun,
                  render: (v: number) => sureMetni(v),
                },
                {
                  title: "İlk Yılında Ayrılan",
                  dataIndex: "erkenAyrilan",
                  align: "center",
                  render: (v: number) =>
                    v > 0 ? <Tag color="orange">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
                },
              ]}
            />
          </Card>

          {/* ------------------------------------------------ çıkış sebepleri */}
          {veri.sebepler.length > 0 && (
            <Card size="small" className="rp-satir" title="Çıkış Sebepleri">
              <div className="pf-doldurma-bolge" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
                {veri.sebepler.map((x: any) => (
                  <button
                    className="pf-doldurma-kutu sr-tiklanabilir"
                    key={x.sebep}
                    onClick={() =>
                      setKirilim({
                        baslik: `Çıkış sebebi: ${x.sebep}`,
                        kayitlar: x.kayitlar ?? [],
                      })
                    }
                  >
                    <span>{x.sebep}</span>
                    <b style={{ color: RENK.turuncu }}>{x.adet}</b>
                    <i>kişi</i>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* --------------------------------------------- kırılım çekmecesi */}
          <Drawer
            open={!!kirilim}
            onClose={() => setKirilim(null)}
            width="min(1000px, 96vw)"
            className="rp-cekmece"
            title={
              kirilim && (
                <Space wrap size={8}>
                  <Text strong>{kirilim.baslik}</Text>
                  <Tag color="blue">{kirilim.kayitlar.length} kişi</Tag>
                </Space>
              )
            }
          >
            {kirilim && (
              <Tablo
                rowKey="personelKodu"
                size="small"
                pagination={{ pageSize: 20, showSizeChanger: false }}
                dataSource={kirilim.kayitlar}
                rowClassName="pr-tiklanabilir"
                onRow={(k: any) => ({ onClick: () => detayAc(k.personelKodu) })}
                columns={[
                  {
                    title: "Personel",
                    key: "ad",
                    width: 172,
                    render: (_v: unknown, k: any) => (
                      <div className="pr-kisi">
                        <PersonelResmi kod={k.personelKodu} ad={k.ad} boyut={28} />
                        <div className="pr-kisi-metin">
                          <Text strong style={{ fontSize: 12.5 }}>
                            <PersonelAdi kod={k.personelKodu}>{k.ad} {k.soyad}</PersonelAdi>
                          </Text>
                          <div style={{ fontSize: 11, color: "#8a8f98" }}>
                            {k.isGrubu}
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "Ünvan",
                    dataIndex: "pozisyon",
                    width: 120,
                    ellipsis: true,
                  },
                  {
                    title: "Giriş",
                    dataIndex: "girisTarihi",
                    width: 92,
                    render: (v: string) => (v ? dayjs(v).format("DD.MM.YY") : "—"),
                  },
                  {
                    title: "Çıkış",
                    dataIndex: "cikisTarihi",
                    width: 92,
                    render: (v: string) => (v ? dayjs(v).format("DD.MM.YY") : "—"),
                  },
                  {
                    title: "Çalışma",
                    dataIndex: "calismaGunu",
                    width: 92,
                    render: (v: number) => (
                      <Tag
                        color={v < 365 ? "orange" : "default"}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {sureMetni(v)}
                      </Tag>
                    ),
                  },
                  {
                    title: "Çıkış Sebebi",
                    dataIndex: "cikisSebebi",
                    width: 190,
                    ellipsis: true,
                    render: (v: string) =>
                      v ? (
                        <Tooltip title={v}>
                          <Tag color="red" style={{ marginInlineEnd: 0 }}>
                            {v}
                          </Tag>
                        </Tooltip>
                      ) : (
                        <span style={{ color: "#bbb" }}>—</span>
                      ),
                  },
                ]}
              />
            )}
          </Drawer>

          {/* ------------------------------------------------ personel detayı */}
          <Drawer
            open={!!detay}
            onClose={() => setDetay(null)}
            width="min(1020px, 96vw)"
            className="rp-cekmece"
            title={
              detay?.kisi ? (
                <Space wrap size={8}>
                  <Text strong>
                    <PersonelAdi kod={detay.kisi.personelKodu}>{detay.kisi.ad} {detay.kisi.soyad}</PersonelAdi>
                  </Text>
                  {detay.kisi.durum === 1 ? (
                    <Tag color="green">Çalışıyor</Tag>
                  ) : (
                    <Tag color="red">Ayrıldı</Tag>
                  )}
                  {detay.calismaSayisi > 1 && (
                    <Tag color="purple">{detay.calismaSayisi}. kez çalışıyor</Tag>
                  )}
                </Space>
              ) : (
                "Personel"
              )
            }
          >
            {detayYukleniyor ? (
              <div style={{ textAlign: "center", padding: "50px 0" }}>
                <Spin />
              </div>
            ) : (
              detay?.kisi && (
                <>
                  <div className="pd-ust">
                    <div className="pd-resim">
                      {detay.resim ? (
                        <img src={detay.resim} alt={detay.kisi.ad} />
                      ) : (
                        <div className="pd-resim-yok">
                          <UserCircle2 size={44} strokeWidth={1.4} />
                          <span>Fotoğraf yok</span>
                        </div>
                      )}
                    </div>

                    <div className="pd-bilgi">
                      <div>
                        <span>Personel Kodu</span>
                        <b>{detay.kisi.personelKodu || "—"}</b>
                      </div>
                      <div>
                        <span>Kimlik No</span>
                        <b>{detay.kisi.kimlikNo || "—"}</b>
                      </div>
                      <div>
                        <span>Telefon</span>
                        <b>{detay.kisi.telefon || "—"}</b>
                      </div>
                      <div>
                        <span>İş Grubu</span>
                        <b>{detay.kisi.isGrubu || "—"}</b>
                      </div>
                      <div>
                        <span>Ünvan</span>
                        <b>{detay.kisi.pozisyon || "—"}</b>
                      </div>
                      <div>
                        <span>Toplam Çalışma</span>
                        <b>{sureMetni(detay.toplamGun)}</b>
                      </div>
                    </div>
                  </div>

                  <Title level={5} style={{ marginTop: 18 }}>
                    Çalışma Dönemleri ({detay.gecmis?.length ?? 0})
                  </Title>

                  <Tablo
                    rowKey="personelKodu"
                    size="small"
                    pagination={false}
                    dataSource={detay.gecmis ?? []}
                    scroll={{ x: 800 }}
                    columns={[
                      { title: "İş Grubu", dataIndex: "isGrubu", width: 165, ellipsis: true },
                      { title: "Ünvan", dataIndex: "pozisyon", width: 150, ellipsis: true },
                      {
                        title: "Giriş",
                        dataIndex: "girisTarihi",
                        width: 110,
                        render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—"),
                      },
                      {
                        title: "Çıkış",
                        dataIndex: "cikisTarihi",
                        width: 110,
                        render: (v: string) =>
                          v ? dayjs(v).format("DD.MM.YYYY") : <Tag color="green">Devam</Tag>,
                      },
                      {
                        title: "Süre",
                        dataIndex: "calismaGunu",
                        width: 110,
                        render: (v: number) => sureMetni(v),
                      },
                      {
                        title: "Çıkış Sebebi",
                        dataIndex: "cikisSebebi",
                        width: 190,
                        render: (v: string) =>
                          v ? <Tag color="red">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
                      },
                    ]}
                  />
                </>
              )
            )}
          </Drawer>

          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="Sayılar nasıl okunmalı?"
            description={
              <span>
                Yüksek devir oranı ve kısa ortalama çalışma süresi birlikte
                görülüyorsa o birimde kalıcılık sorunu var demektir. Uzun işe
                alım süresi ise o birime personel bulmanın zor olduğunu gösterir;
                ikisi bir aradaysa öncelik verilmesi gereken birim odur.
              </span>
            }
          />
        </>
      )}
              </>
            ),
          },
          {
            key: "turnover",
            label: (
              <Space size={6}>
                <BarChart3 size={15} strokeWidth={2} />
                Turnover
              </Space>
            ),
            children: <Turnover />,
          },
          {
            key: "geridonen",
            label: (
              <Space size={6}>
                <Undo2 size={15} strokeWidth={2} />
                Geri Dönenler
              </Space>
            ),
            children: <GeriDonenler />,
          },
        ]}
      />
    </div>
  );
}

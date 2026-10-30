/**
 * ---------------------------------------------------------------------------
 * Geri Dönen Personel
 * ---------------------------------------------------------------------------
 * Daha önce çalışıp ayrılmış ve tekrar işe alınmış personelin analizi.
 *
 * Aynı kişinin farklı personel kodlarıyla açılmış kayıtları kimlik numarası
 * üzerinden eşleştirilir. Çok kısa aralar (varsayılan 7 günden az) kayıt
 * düzeltmesi sayılır ve geri dönüş kabul edilmez.
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
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { RefreshCw, Undo2 } from "lucide-react";

import PersonelResmi from "./PersonelResmi";
import Tablo from "./Tablo";
import { api } from "./api";
import { RENK } from "./sabitler";

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

type Donem = "6ay" | "12ay" | "24ay" | "ozel";
type Suzgec = "calisan" | "hepsi" | "ayni" | "farkli" | "tekrar";

/** Gün sayısını okunur süreye çevirir */
const sureMetni = (gun: number): string => {
  if (!gun || gun <= 0) return "—";
  if (gun < 30) return `${gun} gün`;

  const yil = Math.floor(gun / 365);
  const ay = Math.floor((gun % 365) / 30);

  if (yil === 0) return `${ay} ay`;
  return ay > 0 ? `${yil} yıl ${ay} ay` : `${yil} yıl`;
};

export default function GeriDonenler() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<any>(null);
  const [donem, setDonem] = useState<Donem>("12ay");
  /* Varsayılan olarak yalnızca hâlâ çalışanlar listelenir */
  const [suzgec, setSuzgec] = useState<Suzgec>("calisan");
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(12, "month"),
    dayjs(),
  ]);

  useEffect(() => {
    if (donem === "ozel") return;

    const ay = donem === "6ay" ? 6 : donem === "12ay" ? 12 : 24;
    setAralik([dayjs().subtract(ay, "month"), dayjs()]);
  }, [donem]);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const sorgu = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
      });

      setVeri(await api.al<any>(`/api/Personel/GeriDonenler?${sorgu.toString()}`));
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Süzgeç uygulanmış kayıtlar */
  const kayitlar = (veri?.kayitlar ?? []).filter((k: any) => {
    if (suzgec === "calisan") return k.halenCalisiyor;
    if (suzgec === "ayni") return k.ayniBirim && k.halenCalisiyor;
    if (suzgec === "farkli") return !k.ayniBirim && k.halenCalisiyor;
    if (suzgec === "tekrar") return !k.halenCalisiyor;
    return true;
  });

  const kidemFarki =
    (veri?.ikinciDonemOrtGun ?? 0) - (veri?.birinciDonemOrtGun ?? 0);

  return (
    <>
      {/* ------------------------------------------------------ dönem seçimi */}
      <Row gutter={[10, 10]} align="middle" style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Segmented
            block
            value={donem}
            onChange={(v) => setDonem(v as Donem)}
            options={[
              { label: "Son 6 ay", value: "6ay" },
              { label: "Son 12 ay", value: "12ay" },
              { label: "Son 24 ay", value: "24ay" },
              { label: "Özel", value: "ozel" },
            ]}
          />
        </Col>

        <Col xs={24} md={8}>
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

        <Col xs={24} md={8}>
          <Space style={{ float: "right" }}>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Eşleştirme kimlik numarasına göre yapılır
            </Text>
            <Tag
              icon={<RefreshCw size={12} strokeWidth={2} />}
              style={{ cursor: "pointer" }}
              onClick={getir}
            >
              Yenile
            </Tag>
          </Space>
        </Col>
      </Row>

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : !veri || veri.geriDonen === 0 ? (
        <Empty description="Seçilen dönemde geri dönen personel bulunmuyor." />
      ) : (
        <>
          {/* ------------------------------------------------------ özetler */}
          <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
            <Col xs={12} md={4}>
              <div className="rp-norm-kutu">
                <span>Geri dönen</span>
                <b>{veri.geriDonen}</b>
                <i className="gd-alt">farklı kişi</i>
              </div>
            </Col>

            <Col xs={12} md={4}>
              <div className="rp-norm-kutu nr-alinan-kutu">
                <span>Geri dönüş oranı</span>
                <b>%{veri.geriDonusOrani}</b>
                <i className="gd-alt">
                  {veri.ayrilanKisi} ayrılandan {veri.geriDonen}'i
                </i>
              </div>
            </Col>

            <Col xs={12} md={4}>
              <div className="rp-norm-kutu">
                <span>Ortalama ara</span>
                <b style={{ fontSize: 20 }}>{sureMetni(veri.ortalamaAraGun)}</b>
                <i className="gd-alt">çıkıştan yeniden girişe</i>
              </div>
            </Col>

            <Col xs={12} md={4}>
              <div className="rp-norm-kutu nr-alinan-kutu">
                <span>İkinci dönem kalıcılık</span>
                <b>%{veri.kalicilikOrani}</b>
                <i className="gd-alt">{veri.halenCalisan} kişi çalışıyor</i>
              </div>
            </Col>

            <Col xs={12} md={4}>
              <div className="rp-norm-kutu rp-norm-ihtiyac">
                <span>Tekrar ayrılan</span>
                <b>{veri.tekrarAyrilan}</b>
                <i className="gd-alt">ikinci dönemi de bitti</i>
              </div>
            </Col>

            <Col xs={12} md={4}>
              <div className="rp-norm-kutu">
                <span>Kıdem değişimi</span>
                <b
                  style={{
                    fontSize: 20,
                    color: kidemFarki >= 0 ? RENK.yesilKoyu : "#cf1322",
                  }}
                >
                  {kidemFarki >= 0 ? "+" : "−"}
                  {sureMetni(Math.abs(kidemFarki))}
                </b>
                <i className="gd-alt">2. dönem − 1. dönem</i>
              </div>
            </Col>
          </Row>

          {/* -------------------------------------------------- kişi listesi */}
          <Card
            size="small"
            className="rp-satir"
            title={
              <Space size={8}>
                <Undo2 size={16} strokeWidth={2} />
                Geri Dönenler
              </Space>
            }
            extra={
              <Segmented
                size="small"
                value={suzgec}
                onChange={(v) => setSuzgec(v as Suzgec)}
                options={[
                  { label: `Çalışanlar (${veri.halenCalisan})`, value: "calisan" },
                  { label: "Aynı birim", value: "ayni" },
                  { label: "Farklı birim", value: "farkli" },
                  { label: `Tekrar ayrılan (${veri.tekrarAyrilan})`, value: "tekrar" },
                  { label: `Tümü (${veri.kayitlar?.length ?? 0})`, value: "hepsi" },
                ]}
              />
            }
          >
            <Tablo
              rowKey={(k: any) => `${k.kimlikNo}-${k.personelKodu}`}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: false }}
              dataSource={kayitlar}
              scroll={{ x: 1080 }}
              columns={[
                {
                  title: "Personel",
                  key: "ad",
                  width: 175,
                  render: (_v: unknown, k: any) => (
                    <div className="pr-kisi">
                      <PersonelResmi kod={k.personelKodu} ad={k.ad} boyut={28} />
                      <div className="pr-kisi-metin">
                        <Text strong style={{ fontSize: 12.5 }}>
                          {k.ad} {k.soyad}
                        </Text>
                        <div style={{ fontSize: 11, color: "#8a8f98" }}>
                          {k.yeniUnvan}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Önceki dönem",
                  key: "onceki",
                  width: 190,
                  render: (_v: unknown, k: any) => (
                    <div>
                      <Text strong style={{ fontSize: 12.5 }}>
                        {k.oncekiBirim}
                      </Text>
                      <div style={{ fontSize: 11, color: "#8a8f98" }}>
                        {dayjs(k.oncekiGiris).format("DD.MM.YY")} –{" "}
                        {dayjs(k.oncekiCikis).format("DD.MM.YY")} ·{" "}
                        {sureMetni(k.oncekiGun)}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Çıkış sebebi",
                  dataIndex: "cikisSebebi",
                  width: 160,
                  ellipsis: true,
                  render: (v: string) => (
                    <Tooltip title={v}>
                      <Tag color="red" style={{ marginInlineEnd: 0 }}>
                        {v}
                      </Tag>
                    </Tooltip>
                  ),
                },
                {
                  title: "Ara",
                  dataIndex: "araGun",
                  width: 100,
                  align: "center",
                  sorter: (a: any, b: any) => a.araGun - b.araGun,
                  render: (v: number) => (
                    <Tag style={{ marginInlineEnd: 0 }}>{sureMetni(v)}</Tag>
                  ),
                },
                {
                  title: "Döndüğü yer",
                  key: "yeni",
                  width: 200,
                  render: (_v: unknown, k: any) => (
                    <div>
                      <Space size={5}>
                        <Text strong style={{ fontSize: 12.5 }}>
                          {k.yeniBirim}
                        </Text>
                        <Tag
                          color={k.ayniBirim ? "default" : "purple"}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {k.ayniBirim ? "aynı" : "farklı"}
                        </Tag>
                      </Space>
                      <div style={{ fontSize: 11, color: "#8a8f98" }}>
                        {dayjs(k.yeniGiris).format("DD.MM.YYYY")} · {k.yeniUnvan}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "2. dönem",
                  dataIndex: "yeniGun",
                  width: 110,
                  align: "center",
                  sorter: (a: any, b: any) => a.yeniGun - b.yeniGun,
                  render: (v: number) => sureMetni(v),
                },
                {
                  title: "Durum",
                  dataIndex: "halenCalisiyor",
                  width: 130,
                  render: (v: boolean, k: any) =>
                    v ? (
                      <Tag color="green">Çalışıyor</Tag>
                    ) : (
                      <Space size={4} wrap>
                        <Tag color="red">Tekrar ayrıldı</Tag>
                        {k.yeniCikis && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {dayjs(k.yeniCikis).format("DD.MM.YY")}
                          </Text>
                        )}
                      </Space>
                    ),
                },
              ]}
            />
          </Card>

          {/* --------------------------------------------------- kırılımlar */}
          <Row gutter={[14, 14]}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Çıkış Sebebine Göre Geri Dönüş">
                <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                  Hangi sebeple ayrılanlar geri dönüyor? Hiç geri dönüşü olmayan
                  sebepler listelenmez.
                </Paragraph>

                {veri.sebepler?.filter((x: any) => x.donen > 0).length === 0 && (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Geri dönüşü olan çıkış sebebi bulunmuyor."
                  />
                )}

                {veri.sebepler
                  ?.filter((x: any) => x.donen > 0)
                  .map((s: any) => (
                  <div className="gd-cubuk" key={s.sebep}>
                    <span className="gd-cubuk-ad">
                      {s.sebep}
                      <i>{s.ayrilan} kişi ayrıldı</i>
                    </span>
                    <span className="gd-cubuk-alan">
                      <span
                        className="gd-cubuk-dolu"
                        style={{
                          width: `${Math.min(100, s.oran)}%`,
                          background: s.oran >= 20 ? RENK.yesil : "#faad14",
                        }}
                      />
                    </span>
                    <span className="gd-cubuk-sag">
                      {s.donen} · %{s.oran}
                    </span>
                  </div>
                ))}
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card size="small" title="Ara Süreye Göre Kalıcılık">
                <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                  Ne kadar süre sonra dönenler ikinci dönemde kalıcı oluyor?
                </Paragraph>

                {veri.bantlar?.map((b: any) => (
                  <div className="gd-cubuk" key={b.bant}>
                    <span className="gd-cubuk-ad">
                      {b.bant}
                      <i>{b.kisi} kişi</i>
                    </span>
                    <span className="gd-cubuk-alan">
                      <span
                        className="gd-cubuk-dolu"
                        style={{
                          width: `${Math.min(100, b.oran)}%`,
                          background: b.oran >= 60 ? RENK.yesil : "#faad14",
                        }}
                      />
                    </span>
                    <span className="gd-cubuk-sag">
                      {b.kalici} · %{b.oran}
                    </span>
                  </div>
                ))}

                <Title level={5} style={{ fontSize: 13, marginTop: 16 }}>
                  Döndüğü Birime Göre
                </Title>

                <div className="gd-cubuk">
                  <span className="gd-cubuk-ad">
                    Aynı birime dönen
                    <i>{veri.ayniBirimeDonen} kişi</i>
                  </span>
                  <span className="gd-cubuk-alan">
                    <span
                      className="gd-cubuk-dolu"
                      style={{
                        width: `${
                          veri.ayniBirimeDonen > 0
                            ? Math.min(
                                100,
                                (kayitlarKalici(veri, true) / veri.ayniBirimeDonen) * 100
                              )
                            : 0
                        }%`,
                        background: RENK.yesil,
                      }}
                    />
                  </span>
                  <span className="gd-cubuk-sag">
                    {kayitlarKalici(veri, true)} kalıcı
                  </span>
                </div>

                <div className="gd-cubuk">
                  <span className="gd-cubuk-ad">
                    Farklı birime dönen
                    <i>{veri.farkliBirimeDonen} kişi</i>
                  </span>
                  <span className="gd-cubuk-alan">
                    <span
                      className="gd-cubuk-dolu"
                      style={{
                        width: `${
                          veri.farkliBirimeDonen > 0
                            ? Math.min(
                                100,
                                (kayitlarKalici(veri, false) / veri.farkliBirimeDonen) *
                                  100
                              )
                            : 0
                        }%`,
                        background: "#1677ff",
                      }}
                    />
                  </span>
                  <span className="gd-cubuk-sag">
                    {kayitlarKalici(veri, false)} kalıcı
                  </span>
                </div>
              </Card>
            </Col>
          </Row>

          {/* ------------------------------------------------- birim tablosu */}
          <Card size="small" className="rp-satir" title="Birim Bazında Geri Dönüş">
            <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
              Hangi birim ayrılan personelini geri kazanıyor?
            </Paragraph>

            <Tablo
              rowKey="birim"
              size="small"
              pagination={false}
              dataSource={veri.birimler}
              scroll={{ x: 640 }}
              columns={[
                {
                  title: "Birim",
                  dataIndex: "birim",
                  width: 190,
                  render: (v: string) => <Text strong>{v}</Text>,
                },
                { title: "Ayrılan", dataIndex: "ayrilan", width: 100, align: "center" },
                {
                  title: "Geri dönen",
                  dataIndex: "donen",
                  width: 115,
                  align: "center",
                  defaultSortOrder: "descend",
                  sorter: (a: any, b: any) => a.donen - b.donen,
                  render: (v: number) =>
                    v > 0 ? (
                      <Tag color="blue">{v}</Tag>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    ),
                },
                {
                  title: "Geri dönüş oranı",
                  dataIndex: "oran",
                  width: 145,
                  align: "center",
                  sorter: (a: any, b: any) => a.oran - b.oran,
                  render: (v: number) =>
                    v > 0 ? (
                      <Tag color={v >= 15 ? "green" : "gold"}>%{v}</Tag>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    ),
                },
                {
                  title: "Aynı birime",
                  dataIndex: "ayniyaDonen",
                  width: 120,
                  align: "center",
                },
                {
                  title: "2. dönem kalıcılık",
                  dataIndex: "kalicilik",
                  align: "center",
                  render: (v: number) => (v > 0 ? `%${v}` : "—"),
                },
              ]}
            />
          </Card>
        </>
      )}
    </>
  );
}

/** Aynı veya farklı birime dönenlerden kaçı hâlâ çalışıyor */
function kayitlarKalici(veri: any, ayni: boolean): number {
  return (veri?.kayitlar ?? []).filter(
    (k: any) => k.ayniBirim === ayni && k.halenCalisiyor
  ).length;
}

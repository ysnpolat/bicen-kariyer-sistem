/**
 * ---------------------------------------------------------------------------
 * Maaş Skalası
 * ---------------------------------------------------------------------------
 * Her pozisyon için alt ve üst ücret sınırı tanımlanır. Bu sınırlar iki yerde
 * kullanılır:
 *
 *   1. İşe alım sırasında girilen ücret aralık dışındaysa uyarı verilir.
 *   2. Bu ekranda, mevcut personelden aralık dışında kalanlar listelenir.
 *
 * Skala tanımını yalnızca yöneticiler değiştirebilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { RefreshCw, Save, Wallet } from "lucide-react";

import PersonelResmi from "./PersonelResmi";
import Tablo from "./Tablo";
import { adminMi, api, oturumOku } from "./api";
import { RENK } from "./sabitler";

const { Title, Text, Paragraph } = Typography;

interface Skala {
  bolum: string;
  altSinir: number;
  ustSinir: number;
  aciklama?: string;
}

/** Para biçimi */
const para = (deger?: number | null): string =>
  deger ? `${Number(deger).toLocaleString("tr-TR")} TL` : "—";

export default function MaasSkala() {
  const { message } = AntdApp.useApp();

  const yonetici = adminMi(oturumOku());

  const [gorunum, setGorunum] = useState<"asim" | "tanim">("asim");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [skalalar, setSkalalar] = useState<Skala[]>([]);
  const [pozisyonlar, setPozisyonlar] = useState<string[]>([]);
  const [guncelleme, setGuncelleme] = useState<string | null>(null);
  const [asim, setAsim] = useState<any>(null);

  /* ------------------------------------------------------------- veriler */

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const [tanim, rapor] = await Promise.all([
        api.al<any>("/api/Personel/MaasSkala"),
        api.al<any>("/api/Personel/SkalaAsimi"),
      ]);

      setPozisyonlar(tanim?.pozisyonlar ?? []);
      setGuncelleme(tanim?.guncelleme ?? null);
      setAsim(rapor);

      /* Tanımlı tüm pozisyonlar listelenir; skalası olmayanlar sıfır gelir */
      const kayitli: Skala[] = tanim?.skalalar ?? [];

      const tumu: Skala[] = (tanim?.pozisyonlar ?? []).map((b: string) => {
        const eski = kayitli.find(
          (x) => x.bolum.toLocaleUpperCase("tr") === b.toLocaleUpperCase("tr")
        );

        return {
          bolum: b,
          altSinir: eski?.altSinir ?? 0,
          ustSinir: eski?.ustSinir ?? 0,
          aciklama: eski?.aciklama ?? "",
        };
      });

      /* Ayarlarda olup pozisyon listesinde bulunmayanlar da korunur */
      kayitli.forEach((k) => {
        if (!tumu.some((x) => x.bolum.toLocaleUpperCase("tr") === k.bolum.toLocaleUpperCase("tr"))) {
          tumu.push(k);
        }
      });

      setSkalalar(tumu);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* ------------------------------------------------------------- kaydet */

  const kaydet = async () => {
    const gecersiz = skalalar.find(
      (x) => x.altSinir > 0 && x.ustSinir > 0 && x.altSinir > x.ustSinir
    );

    if (gecersiz) {
      message.error(
        `${gecersiz.bolum}: alt sınır üst sınırdan büyük olamaz.`
      );
      return;
    }

    setKaydediliyor(true);

    try {
      await api.gonder(
        "/api/Personel/MaasSkala",
        skalalar.filter((x) => x.altSinir > 0 || x.ustSinir > 0)
      );

      message.success("Maaş skalaları kaydedildi.");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const degistir = (bolum: string, alan: "altSinir" | "ustSinir", deger: number) => {
    setSkalalar((eski) =>
      eski.map((x) => (x.bolum === bolum ? { ...x, [alan]: deger } : x))
    );
  };

  /* ------------------------------------------------------ kişi listesi */

  const kisiSutunlari = (tur: "ust" | "alt", skala: any) => [
    {
      title: "Personel",
      key: "ad",
      width: 190,
      render: (_v: unknown, k: any) => (
        <div className="pr-kisi">
          <PersonelResmi kod={k.personelKodu} ad={k.ad} boyut={28} />
          <div className="pr-kisi-metin">
            <Text strong style={{ fontSize: 12.5 }}>
              {k.ad} {k.soyad}
            </Text>
            <div style={{ fontSize: 11, color: "#8a8f98" }}>{k.isGrubu}</div>
          </div>
        </div>
      ),
    },
    { title: "Ünvan", dataIndex: "pozisyon", width: 150, ellipsis: true },
    {
      title: "Ücret",
      dataIndex: "ucret",
      width: 120,
      align: "right" as const,
      sorter: (a: any, b: any) => a.ucret - b.ucret,
      render: (v: number) => <Text strong>{para(v)}</Text>,
    },
    {
      title: tur === "ust" ? "Aşım" : "Eksik",
      dataIndex: "fark",
      width: 120,
      align: "right" as const,
      render: (v: number) => (
        <Tag color={tur === "ust" ? "red" : "gold"} style={{ marginInlineEnd: 0 }}>
          {tur === "ust" ? "+" : "−"}
          {Number(v).toLocaleString("tr-TR")} TL
        </Tag>
      ),
    },
    {
      title: "Sınır",
      key: "sinir",
      width: 130,
      align: "right" as const,
      render: () => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {para(tur === "ust" ? skala.ustSinir : skala.altSinir)}
        </Text>
      ),
    },
    {
      title: "İşe Giriş",
      dataIndex: "girisTarihi",
      width: 110,
      render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—"),
    },
  ];

  /* ------------------------------------------------------------- ekran */

  return (
    <>
      <Row gutter={[10, 10]} align="middle" style={{ marginBottom: 12 }}>
        <Col xs={24} md={7}>
          <Segmented
            block
            value={gorunum}
            onChange={(v) => setGorunum(v as "asim" | "tanim")}
            options={[
              { label: "Skala Dışı Personel", value: "asim" },
              { label: "Skala Tanımları", value: "tanim" },
            ]}
          />
        </Col>

        <Col xs={24} md={11}>
          {guncelleme && (
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Skalalar son olarak {dayjs(guncelleme).format("DD.MM.YYYY HH:mm")}{" "}
              tarihinde güncellendi.
            </Text>
          )}
        </Col>

        <Col xs={24} md={6}>
          <Space style={{ float: "right" }}>
            <Button
              loading={yukleniyor}
              icon={<RefreshCw size={15} strokeWidth={2} />}
              onClick={getir}
            />
            {gorunum === "tanim" && yonetici && (
              <Button
                type="primary"
                loading={kaydediliyor}
                icon={<Save size={15} strokeWidth={2} />}
                onClick={kaydet}
              >
                Kaydet
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : gorunum === "tanim" ? (
        /* ------------------------------------------------ skala tanımları */
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Pozisyon bazında ücret aralıkları"
            description="Boş bırakılan pozisyonlarda kontrol yapılmaz. İşe alım sırasında bu aralığın dışında bir ücret girilirse uyarı verilir; işlem yine de sürdürülebilir."
          />

          {!yonetici && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Skala tanımlarını yalnızca yöneticiler değiştirebilir."
            />
          )}

          <Tablo
            rowKey="bolum"
            size="small"
            pagination={false}
            dataSource={skalalar}
            columns={[
              {
                title: "Pozisyon",
                dataIndex: "bolum",
                width: 230,
                render: (v: string) => <Text strong>{v}</Text>,
              },
              {
                title: "Alt Sınır",
                dataIndex: "altSinir",
                width: 160,
                render: (v: number, k: Skala) => (
                  <InputNumber
                    min={0}
                    max={9999999}
                    step={1000}
                    value={v || null}
                    placeholder="—"
                    disabled={!yonetici}
                    style={{ width: "100%" }}
                    addonAfter="TL"
                    formatter={(x?: number | string) =>
                      `${x ?? ""}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
                    }
                    parser={(x?: string) =>
                      Number((x ?? "").replace(/[^\d]/g, "")) as 0
                    }
                    onChange={(deger) =>
                      degistir(k.bolum, "altSinir", Number(deger) || 0)
                    }
                  />
                ),
              },
              {
                title: "Üst Sınır",
                dataIndex: "ustSinir",
                width: 160,
                render: (v: number, k: Skala) => (
                  <InputNumber
                    min={0}
                    max={9999999}
                    step={1000}
                    value={v || null}
                    placeholder="—"
                    disabled={!yonetici}
                    style={{ width: "100%" }}
                    addonAfter="TL"
                    formatter={(x?: number | string) =>
                      `${x ?? ""}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
                    }
                    parser={(x?: string) =>
                      Number((x ?? "").replace(/[^\d]/g, "")) as 0
                    }
                    onChange={(deger) =>
                      degistir(k.bolum, "ustSinir", Number(deger) || 0)
                    }
                  />
                ),
              },
              {
                title: "Aralık",
                key: "aralik",
                render: (_v, k: Skala) =>
                  k.altSinir > 0 || k.ustSinir > 0 ? (
                    <Tag color="blue">
                      {para(k.altSinir)} – {para(k.ustSinir)}
                    </Tag>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12.5 }}>
                      tanımlı değil
                    </Text>
                  ),
              },
            ]}
          />

          {pozisyonlar.length === 0 && (
            <Empty
              style={{ marginTop: 16 }}
              description="Form Ayarları'ndan pozisyon tanımlandıktan sonra burada listelenir."
            />
          )}
        </>
      ) : !asim?.skalaTanimiVar ? (
        /* --------------------------------------------------- tanım yoksa */
        <Alert
          type="warning"
          showIcon
          message="Henüz maaş skalası tanımlanmamış"
          description="Skala Tanımları sekmesinden pozisyonlara alt ve üst ücret sınırı girdiğinizde, aralık dışında kalan personel burada listelenir."
        />
      ) : asim.pozisyonlar?.length === 0 ? (
        <Empty description="Skala dışında ücret alan personel bulunmuyor." />
      ) : (
        /* ------------------------------------------------ aşım listesi */
        <>
          <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
            <Col xs={12} md={6}>
              <div className="rp-norm-kutu rp-norm-ihtiyac">
                <span>Skalanın üzerinde</span>
                <b>{asim.toplamUstunde}</b>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="rp-norm-kutu nr-engelli-kutu">
                <span>Skalanın altında</span>
                <b>{asim.toplamAltinda}</b>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="rp-norm-kutu">
                <span>Aylık aşım tutarı</span>
                <b style={{ fontSize: 19 }}>{para(asim.toplamAsim)}</b>
              </div>
            </Col>
            <Col xs={12} md={6}>
              <div className="rp-norm-kutu">
                <span>Yıllık karşılığı</span>
                <b style={{ fontSize: 19 }}>{para(asim.toplamAsim * 12)}</b>
              </div>
            </Col>
          </Row>

          <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
            Yalnızca çalışan ve ücreti tanımlı personel değerlendirilir. Satırı
            açarak aralık dışında kalan kişileri görebilirsiniz.
          </Paragraph>

          <Tablo
            rowKey="bolum"
            size="small"
            pagination={false}
            dataSource={asim.pozisyonlar}
            expandable={{
              rowExpandable: (p: any) => p.ustundeSayi > 0 || p.altindaSayi > 0,
              expandedRowRender: (p: any) => (
                <div>
                  {p.ustundekiler?.length > 0 && (
                    <>
                      <Title level={5} style={{ fontSize: 13, marginTop: 0 }}>
                        Üst sınırın üzerinde ({p.ustundekiler.length})
                      </Title>
                      <Tablo
                        rowKey="personelKodu"
                        size="small"
                        className="kp-ic-tablo"
                        pagination={false}
                        dataSource={p.ustundekiler}
                        columns={kisiSutunlari("ust", p)}
                      />
                    </>
                  )}

                  {p.altindakiler?.length > 0 && (
                    <>
                      <Title level={5} style={{ fontSize: 13, marginTop: 14 }}>
                        Alt sınırın altında ({p.altindakiler.length})
                      </Title>
                      <Tablo
                        rowKey="personelKodu"
                        size="small"
                        className="kp-ic-tablo"
                        pagination={false}
                        dataSource={p.altindakiler}
                        columns={kisiSutunlari("alt", p)}
                      />
                    </>
                  )}
                </div>
              ),
            }}
            columns={[
              {
                title: "Pozisyon",
                dataIndex: "bolum",
                width: 200,
                render: (v: string) => <Text strong>{v}</Text>,
              },
              {
                title: "Skala",
                key: "skala",
                width: 210,
                render: (_v, p: any) => (
                  <Tag color="blue">
                    {para(p.altSinir)} – {para(p.ustSinir)}
                  </Tag>
                ),
              },
              {
                title: "Kişi",
                dataIndex: "kisiSayisi",
                width: 80,
                align: "center",
              },
              {
                title: "Ortalama",
                dataIndex: "ortalamaUcret",
                width: 130,
                align: "right",
                sorter: (a: any, b: any) => a.ortalamaUcret - b.ortalamaUcret,
                render: (v: number, p: any) => (
                  <Tooltip title={`En düşük ${para(p.enDusuk)} · en yüksek ${para(p.enYuksek)}`}>
                    <Text strong>{para(v)}</Text>
                  </Tooltip>
                ),
              },
              {
                title: "Üzerinde",
                dataIndex: "ustundeSayi",
                width: 105,
                align: "center",
                defaultSortOrder: "descend",
                sorter: (a: any, b: any) => a.ustundeSayi - b.ustundeSayi,
                render: (v: number) =>
                  v > 0 ? (
                    <Tag color="red">{v}</Tag>
                  ) : (
                    <span style={{ color: "#bbb" }}>—</span>
                  ),
              },
              {
                title: "Altında",
                dataIndex: "altindaSayi",
                width: 100,
                align: "center",
                sorter: (a: any, b: any) => a.altindaSayi - b.altindaSayi,
                render: (v: number) =>
                  v > 0 ? (
                    <Tag color="gold">{v}</Tag>
                  ) : (
                    <span style={{ color: "#bbb" }}>—</span>
                  ),
              },
              {
                title: "Uygun",
                dataIndex: "uygunSayi",
                width: 95,
                align: "center",
                render: (v: number) =>
                  v > 0 ? (
                    <Tag color="green">{v}</Tag>
                  ) : (
                    <span style={{ color: "#bbb" }}>—</span>
                  ),
              },
              {
                title: "Aylık Aşım",
                dataIndex: "asimTutari",
                width: 135,
                align: "right",
                sorter: (a: any, b: any) => a.asimTutari - b.asimTutari,
                render: (v: number) =>
                  v > 0 ? (
                    <Text strong style={{ color: RENK.turuncu }}>
                      {para(v)}
                    </Text>
                  ) : (
                    <span style={{ color: "#bbb" }}>—</span>
                  ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

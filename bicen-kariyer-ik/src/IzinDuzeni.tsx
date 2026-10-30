/**
 * ---------------------------------------------------------------------------
 * İzin Düzeni
 * ---------------------------------------------------------------------------
 * Haftalık izin günleri ve nöbet takvimi.
 *
 * İkisi de "kim hangi gün çalışmıyor" sorusunun parçası. Haftalık izin
 * günü personelin kendi seçtiği, mağaza müdürünün onayladığı gün; nöbet ise
 * merkez ofisin dönüşümlü cumartesi görevi. Nöbet Excel'de takip ediliyordu
 * ve sıra ancak dosyayı açan kişi tarafından biliniyordu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  CalendarDays,
  Check,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";
import { RENK } from "./sabitler";
import { PersonelAdi } from "./personelKarti";

const { Text } = Typography;

const GUNLER = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
];

const gunAdi = (g: number | null | undefined) =>
  g === null || g === undefined ? "—" : GUNLER[g] ?? "—";

/* ========================================================================== */

export default function IzinDuzeni() {
  return (
    <div className="ik-icerik">
      <Tabs
        items={[
          { key: "haftalik", label: "Haftalık İzin Günleri", children: <HaftalikIzinler /> },
          { key: "nobet", label: "Nöbet Takvimi", children: <NobetTakvimi /> },
        ]}
      />
    </div>
  );
}

/* ========================================================================== */
/* Haftalık izin günleri                                                      */
/* ========================================================================== */

interface IzinKaydi {
  id: number;
  personelKodu: string;
  adSoyad: string | null;
  subeAdi: string | null;
  pozisyon: string | null;
  gun: number | null;
  talepGun: number | null;
  talepTarihi: string | null;
  talepNotu: string | null;
  durum: string;
  onayTarihi: string | null;
  onaylayan: string | null;
  redSebebi: string | null;
}

function HaftalikIzinler() {
  const { message } = AntdApp.useApp();

  const [kayitlar, setKayitlar] = useState<IzinKaydi[]>([]);
  const [bekleyen, setBekleyen] = useState(0);
  const [ara, setAra] = useState("");
  const [yalnizBekleyen, setYalnizBekleyen] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);

  const [reddedilen, setReddedilen] = useState<IzinKaydi | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{ kayitlar: IzinKaydi[]; bekleyen: number }>(
        `/api/HaftalikIzin?ara=${encodeURIComponent(ara.trim())}`
      );

      setKayitlar(c.kayitlar ?? []);
      setBekleyen(c.bekleyen ?? 0);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kayıtlar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [ara, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const onayla = async (k: IzinKaydi, onay: boolean, sebep?: string) => {
    try {
      await api.gonder(`/api/HaftalikIzin/Onay/${k.id}`, { onay, sebep });

      message.success(onay ? "Talep onaylandı." : "Talep reddedildi.");
      setReddedilen(null);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "İşlem tamamlanamadı.");
    }
  };

  const satirlar = useMemo(
    () => (yalnizBekleyen ? kayitlar.filter((k) => k.talepGun !== null) : kayitlar),
    [kayitlar, yalnizBekleyen]
  );

  return (
    <>
      {bekleyen > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${bekleyen} talep onay bekliyor`}
          description="Onaylanmayan gün geçerli sayılmaz; personel o gün karekod okutmadığında raporda eksik görünür."
        />
      )}

      <Card size="small" className="ik-filtre">
        <Space wrap>
          <Input
            allowClear
            prefix={<Search size={14} strokeWidth={2} />}
            placeholder="Ad, sicil ya da şube"
            style={{ width: 260 }}
            value={ara}
            onChange={(e) => setAra(e.target.value)}
          />

          <Button
            type={yalnizBekleyen ? "primary" : "default"}
            onClick={() => setYalnizBekleyen((o) => !o)}
          >
            Yalnızca bekleyenler
          </Button>

          <Tooltip title="Yenile">
            <Button
              icon={<RotateCcw size={15} strokeWidth={2} />}
              onClick={getir}
            />
          </Tooltip>
        </Space>
      </Card>

      {satirlar.length === 0 && !yukleniyor ? (
        <Empty description="Kayıt yok. Personel uygulamadan izin günü seçtiğinde burada görünür." />
      ) : (
        <Tablo
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={satirlar}
          scroll={{ x: 900 }}
          columns={[
            {
              title: "Personel",
              dataIndex: "adSoyad",
              width: 230,
              render: (a: string, k: IzinKaydi) => (
                <div>
                  <div style={{ fontWeight: 500 }}><PersonelAdi kod={k.personelKodu}>{a || "—"}</PersonelAdi></div>
                  <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                    {k.personelKodu}
                    {k.pozisyon ? ` · ${k.pozisyon}` : ""}
                  </div>
                </div>
              ),
            },
            { title: "Şube", dataIndex: "subeAdi", width: 170, ellipsis: true },
            {
              title: "Geçerli gün",
              dataIndex: "gun",
              width: 140,
              render: (g: number | null) =>
                g === null ? (
                  <Tag>Henüz yok</Tag>
                ) : (
                  <Tag color="green">{gunAdi(g)}</Tag>
                ),
            },
            {
              title: "Bekleyen talep",
              dataIndex: "talepGun",
              width: 230,
              render: (t: number | null, k: IzinKaydi) =>
                t === null ? (
                  <Text type="secondary">—</Text>
                ) : (
                  <Space direction="vertical" size={2}>
                    <Space size={4}>
                      <Tag color="orange">{gunAdi(t)}</Tag>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {k.talepTarihi
                          ? dayjs(k.talepTarihi).format("DD.MM.YYYY HH:mm")
                          : ""}
                      </Text>
                    </Space>

                    {k.talepNotu && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {k.talepNotu}
                      </Text>
                    )}
                  </Space>
                ),
            },
            {
              title: "Son işlem",
              width: 180,
              render: (_: unknown, k: IzinKaydi) =>
                k.redSebebi ? (
                  <Text type="danger" style={{ fontSize: 12 }}>
                    Reddedildi: {k.redSebebi}
                  </Text>
                ) : k.onayTarihi ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(k.onayTarihi).format("DD.MM.YYYY")}
                    {k.onaylayan ? ` · ${k.onaylayan}` : ""}
                  </Text>
                ) : (
                  <Text type="secondary">—</Text>
                ),
            },
            {
              title: "",
              width: 120,
              render: (_: unknown, k: IzinKaydi) =>
                k.talepGun === null ? null : (
                  <Space size={4}>
                    <Tooltip title="Onayla">
                      <Button
                        size="small"
                        type="primary"
                        icon={<Check size={14} strokeWidth={2} />}
                        onClick={() => onayla(k, true)}
                      />
                    </Tooltip>

                    <Tooltip title="Reddet">
                      <Button
                        size="small"
                        danger
                        icon={<X size={14} strokeWidth={2} />}
                        onClick={() => setReddedilen(k)}
                      />
                    </Tooltip>
                  </Space>
                ),
            },
          ]}
        />
      )}

      {reddedilen && (
        <RedFormu
          kayit={reddedilen}
          kapat={() => setReddedilen(null)}
          gonder={(sebep) => onayla(reddedilen, false, sebep)}
        />
      )}
    </>
  );
}

/* ========================================================================== */

function RedFormu({
  kayit,
  kapat,
  gonder,
}: {
  kayit: IzinKaydi;
  kapat: () => void;
  gonder: (sebep: string) => void;
}) {
  const [sebep, setSebep] = useState("");

  return (
    <Modal
      open
      title={`Talebi reddet — ${kayit.adSoyad ?? kayit.personelKodu}`}
      onCancel={kapat}
      onOk={() => gonder(sebep.trim())}
      okText="Reddet"
      okButtonProps={{ danger: true }}
      cancelText="Vazgeç"
      width={460}
    >
      <Text type="secondary" style={{ fontSize: 12.5 }}>
        Sebep personele bildirim olarak gider. Önceki izin günü korunur;
        reddedilen talep yüzünden personelin hiç izin günü kalmaması, o günü
        de "okutmadı" saydırırdı.
      </Text>

      <Input.TextArea
        rows={3}
        style={{ marginTop: 10 }}
        value={sebep}
        onChange={(e) => setSebep(e.target.value)}
        placeholder="Örn. Cumartesi kasa yoğunluğu var, pazartesi uygun olur."
      />
    </Modal>
  );
}

/* ========================================================================== */
/* Nöbet takvimi                                                              */
/* ========================================================================== */

interface Nobet {
  id: number;
  tarih: string;
  personelKodu: string;
  adSoyad: string | null;
  pozisyon: string | null;
  aciklama: string | null;
  durum: string;
}

interface GrupOzet {
  id: number;
  ad: string;
  pozisyonlar: string | null;
}

function NobetTakvimi() {
  const { message } = AntdApp.useApp();

  const [nobetler, setNobetler] = useState<Nobet[]>([]);
  const [gruplar, setGruplar] = useState<GrupOzet[]>([]);
  const [duzenleyebilir, setDuzenleyebilir] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);

  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(1, "month"),
    dayjs().add(3, "month"),
  ]);

  const [uretimAcik, setUretimAcik] = useState(false);
  const [eklemeAcik, setEklemeAcik] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{
        nobetler: Nobet[];
        gruplar: GrupOzet[];
        duzenleyebilir: boolean;
      }>(
        `/api/Nobet?bas=${aralik[0].format("YYYY-MM-DD")}&bit=${aralik[1].format(
          "YYYY-MM-DD"
        )}`
      );

      setNobetler(c.nobetler ?? []);
      setGruplar(c.gruplar ?? []);
      setDuzenleyebilir(!!c.duzenleyebilir);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Nöbetler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/Nobet/${id}`);
      message.success("Nöbet silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  const bugun = dayjs().startOf("day");

  return (
    <>
      <Card size="small" className="ik-filtre">
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <DatePicker.RangePicker
              format="DD.MM.YYYY"
              value={aralik}
              onChange={(d) => d && setAralik(d as [Dayjs, Dayjs])}
              allowClear={false}
            />

            <Tooltip title="Yenile">
              <Button
                icon={<RotateCcw size={15} strokeWidth={2} />}
                onClick={getir}
              />
            </Tooltip>
          </Space>

          {duzenleyebilir && (
            <Space>
              <Button
                icon={<Plus size={15} strokeWidth={2} />}
                onClick={() => setEklemeAcik(true)}
              >
                Nöbet ekle
              </Button>

              <Button
                type="primary"
                icon={<Wand2 size={15} strokeWidth={2} />}
                onClick={() => setUretimAcik(true)}
              >
                Sırayla üret
              </Button>
            </Space>
          )}
        </Space>
      </Card>

      {nobetler.length === 0 && !yukleniyor ? (
        <Empty
          description={
            <>
              Bu aralıkta nöbet yok.
              <br />
              <Text type="secondary">
                "Sırayla üret" ile gruptaki personeli dönüşümlü olarak
                dağıtabilirsiniz.
              </Text>
            </>
          }
        />
      ) : (
        <Tablo
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={nobetler}
          scroll={{ x: 700 }}
          rowClassName={(k: Nobet) =>
            dayjs(k.tarih).isSame(bugun, "day") ? "nb-bugun" : ""
          }
          columns={[
            {
              title: "Tarih",
              dataIndex: "tarih",
              width: 190,
              render: (t: string) => {
                const g = dayjs(t);
                const gecti = g.isBefore(bugun, "day");

                return (
                  <Space size={6}>
                    <Text strong delete={gecti}>
                      {g.format("DD.MM.YYYY")}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {GUNLER[g.day()]}
                    </Text>
                  </Space>
                );
              },
            },
            {
              title: "Nöbetçi",
              dataIndex: "adSoyad",
              render: (a: string, k: Nobet) => (
                <div>
                  <div style={{ fontWeight: 500 }}><PersonelAdi kod={k.personelKodu}>{a || k.personelKodu}</PersonelAdi></div>
                  {k.pozisyon && (
                    <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                      {k.pozisyon}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: "Not",
              dataIndex: "aciklama",
              width: 220,
              render: (a: string) => a || <Text type="secondary">—</Text>,
            },
            ...(duzenleyebilir
              ? [
                  {
                    title: "",
                    width: 60,
                    render: (_: unknown, k: Nobet) => (
                      <Popconfirm
                        title="Nöbet silinsin mi?"
                        okText="Sil"
                        cancelText="Vazgeç"
                        onConfirm={() => sil(k.id)}
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<Trash2 size={15} strokeWidth={2} />}
                        />
                      </Popconfirm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {uretimAcik && (
        <UretimFormu
          gruplar={gruplar}
          kapat={() => setUretimAcik(false)}
          bitti={() => {
            setUretimAcik(false);
            getir();
          }}
        />
      )}

      {eklemeAcik && (
        <EklemeFormu
          kapat={() => setEklemeAcik(false)}
          bitti={() => {
            setEklemeAcik(false);
            getir();
          }}
        />
      )}
    </>
  );
}

/* ========================================================================== */

function UretimFormu({
  gruplar,
  kapat,
  bitti,
}: {
  gruplar: GrupOzet[];
  kapat: () => void;
  bitti: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [grupId, setGrupId] = useState<number | undefined>(gruplar[0]?.id);
  const [baslangic, setBaslangic] = useState<Dayjs>(dayjs());
  const [gun, setGun] = useState(6);
  const [periyot, setPeriyot] = useState(5);
  const [hafta, setHafta] = useState(12);
  const [sira, setSira] = useState(0);
  const [uretiliyor, setUretiliyor] = useState(false);

  const uret = async () => {
    if (!grupId) return message.warning("Grup seçiniz.");

    setUretiliyor(true);

    try {
      const c = await api.gonder<{ eklenen: number; atlanan: number; bilgi?: string }>(
        "/api/Nobet/Uret",
        {
          grupId,
          baslangic: baslangic.format("YYYY-MM-DD"),
          gun,
          periyot,
          hafta,
          baslangicSirasi: sira,
        }
      );

      message.success(
        `${c.eklenen} nöbet oluşturuldu.${c.bilgi ? " " + c.bilgi : ""}`
      );

      bitti();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Üretilemedi.");
    } finally {
      setUretiliyor(false);
    }
  };

  return (
    <Modal
      open
      width={520}
      title="Nöbet çizelgesi üret"
      onCancel={kapat}
      onOk={uret}
      okText="Üret"
      cancelText="Vazgeç"
      confirmLoading={uretiliyor}
    >
      <Text type="secondary" style={{ fontSize: 12.5 }}>
        Gruptaki personel ada göre sıralanıp seçilen güne dönüşümlü
        dağıtılır. Var olan nöbetlerin üzerine yazılmaz — elle yaptığınız
        değişiklik korunur.
      </Text>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Pozisyon grubu
          </Text>
          <Select
            style={{ width: "100%" }}
            value={grupId}
            onChange={setGrupId}
            placeholder="Grup seçiniz"
            options={gruplar.map((g) => ({ value: g.id, label: g.ad }))}
          />
        </Col>

        <Col xs={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Başlangıç
          </Text>
          <DatePicker
            style={{ width: "100%" }}
            format="DD.MM.YYYY"
            value={baslangic}
            onChange={(d) => d && setBaslangic(d)}
            allowClear={false}
          />
        </Col>

        <Col xs={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Hangi gün
          </Text>
          <Select
            style={{ width: "100%" }}
            value={gun}
            onChange={setGun}
            options={GUNLER.map((g, i) => ({ value: i, label: g }))}
          />
        </Col>

        <Col xs={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Kaç haftada bir
          </Text>
          <InputNumber
            min={1}
            max={12}
            style={{ width: "100%" }}
            value={periyot}
            onChange={(d) => setPeriyot(d ?? 5)}
          />
        </Col>

        <Col xs={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Kaç nöbet
          </Text>
          <InputNumber
            min={1}
            max={52}
            style={{ width: "100%" }}
            value={hafta}
            onChange={(d) => setHafta(d ?? 12)}
          />
        </Col>

        <Col xs={8}>
          <Tooltip title="Sıraya kaçıncı kişiden başlanacağı. Çizelgeyi yenilerken kaldığınız yerden devam etmek için.">
            <Text type="secondary" style={{ fontSize: 12 }}>
              Başlangıç sırası
            </Text>
          </Tooltip>
          <InputNumber
            min={0}
            style={{ width: "100%" }}
            value={sira}
            onChange={(d) => setSira(d ?? 0)}
          />
        </Col>
      </Row>
    </Modal>
  );
}

/* ========================================================================== */

function EklemeFormu({ kapat, bitti }: { kapat: () => void; bitti: () => void }) {
  const { message } = AntdApp.useApp();

  const [personeller, setPersoneller] = useState<
    { personelKodu: string; ad: string; soyad: string; sube: string | null }[]
  >([]);
  const [kod, setKod] = useState<string | undefined>();
  const [tarih, setTarih] = useState<Dayjs>(dayjs());
  const [aciklama, setAciklama] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    api
      .al<{ personeller: any[] }>("/api/Personel?durum=calisan")
      .then((c) => setPersoneller(c?.personeller ?? []))
      .catch(() => setPersoneller([]));
  }, []);

  const kaydet = async () => {
    if (!kod) return message.warning("Personel seçiniz.");

    setKaydediliyor(true);

    try {
      await api.gonder("/api/Nobet", {
        id: 0,
        tarih: tarih.format("YYYY-MM-DD"),
        personelKodu: kod,
        aciklama: aciklama.trim() || null,
      });

      message.success("Nöbet eklendi, personele bildirim gitti.");
      bitti();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eklenemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      width={480}
      title="Nöbet ekle"
      onCancel={kapat}
      onOk={kaydet}
      okText="Ekle"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Tarih
          </Text>
          <DatePicker
            style={{ width: "100%" }}
            format="DD.MM.YYYY"
            value={tarih}
            onChange={(d) => d && setTarih(d)}
            allowClear={false}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Personel
          </Text>
          <Select
            showSearch
            style={{ width: "100%" }}
            placeholder="Ad soyad ya da sicil"
            value={kod}
            onChange={setKod}
            optionFilterProp="label"
            filterOption={(g, o) =>
              (o?.label as string ?? "")
                .toLocaleLowerCase("tr")
                .includes(g.toLocaleLowerCase("tr"))
            }
            options={personeller.map((p) => ({
              value: p.personelKodu,
              label: `${p.ad} ${p.soyad} · ${p.personelKodu}${
                p.sube ? ` · ${p.sube}` : ""
              }`,
            }))}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Not
          </Text>
          <Input
            placeholder="İsteğe bağlı"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
          />
        </div>
      </Space>
    </Modal>
  );
}

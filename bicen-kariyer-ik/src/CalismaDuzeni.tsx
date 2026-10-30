/**
 * ---------------------------------------------------------------------------
 * Çalışma Düzeni
 * ---------------------------------------------------------------------------
 * Resmi tatiller ve pozisyon grupları. İkisi de yıllık izin hesabını
 * doğrudan etkiliyor.
 *
 * Resmi tatil ve haftalık izin günleri bakiyeden düşülmemeli: 1 Mayıs'a
 * denk gelen bir izin haftası personelin bakiyesinden hak etmediği bir gün
 * yiyordu, mağaza personelinin haftalık izni de yıllık izninden gidiyordu.
 * Bu bilgi hiçbir yerde tutulmadığı için hesap bütün takvim günlerini
 * sayıyordu.
 *
 * Pozisyon grupları ileride yetki tanımında da kullanılacak: ünvan ünvan
 * yetki vermek yerine "Mağaza Müdürleri" grubuna verilecek.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Checkbox,
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
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { CalendarPlus, Pencil, Plus, Trash2, Users } from "lucide-react";

import { api } from "./api";
import { RENK } from "./sabitler";

const { Text } = Typography;

/** 0=Pazar … 6=Cumartesi — JavaScript'in gün numaralarıyla aynı */
const GUNLER = [
  { deger: 1, ad: "Pazartesi" },
  { deger: 2, ad: "Salı" },
  { deger: 3, ad: "Çarşamba" },
  { deger: 4, ad: "Perşembe" },
  { deger: 5, ad: "Cuma" },
  { deger: 6, ad: "Cumartesi" },
  { deger: 0, ad: "Pazar" },
];

const gunAdi = (d: number) => GUNLER.find((g) => g.deger === d)?.ad ?? String(d);

/* ========================================================================== */

export default function CalismaDuzeni() {
  return (
    <Tabs
      items={[
        { key: "gruplar", label: "Pozisyon Grupları", children: <Gruplar /> },
        { key: "tatiller", label: "Resmi Tatiller", children: <Tatiller /> },
      ]}
    />
  );
}

/* ========================================================================== */
/* Pozisyon grupları                                                          */
/* ========================================================================== */

interface Grup {
  id: number;
  ad: string;
  aciklama: string | null;
  pozisyonlar: string | null;
  haftalikIzin: number;
  izinGunleri: string | null;
  mesaiBaslangic: string | null;
  mesaiBitis: string | null;
  hatirlatmaDakika: number;
  izinSecebilir: boolean;
  isAtayabilir: boolean;
  aktif: boolean;
  sira: number;
}

function Gruplar() {
  const { message } = AntdApp.useApp();

  const [gruplar, setGruplar] = useState<Grup[]>([]);
  const [pozisyonlar, setPozisyonlar] = useState<string[]>([]);
  const [duzenleyebilir, setDuzenleyebilir] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [duzenlenen, setDuzenlenen] = useState<Partial<Grup> | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{
        gruplar: Grup[];
        pozisyonlar: string[];
        duzenleyebilir: boolean;
      }>("/api/CalismaDuzeni/Gruplar");

      setGruplar(c.gruplar ?? []);
      setPozisyonlar(c.pozisyonlar ?? []);
      setDuzenleyebilir(!!c.duzenleyebilir);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Gruplar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/CalismaDuzeni/Grup/${id}`);
      message.success("Grup silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  return (
    <>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }} wrap>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Ünvanları ortak çalışma düzenine göre kümeler. Buradaki izin
          günleri yıllık izin hesabından düşülmez: mağaza personelinin
          haftalık izni, merkez ofisin hafta sonu tatili bakiyeden
          gitmemeli.
        </Text>

        {duzenleyebilir && (
          <Button
            type="primary"
            icon={<Plus size={15} strokeWidth={2} />}
            onClick={() => setDuzenlenen({ aktif: true, haftalikIzin: 1 })}
          >
            Grup ekle
          </Button>
        )}
      </Space>

      {gruplar.length === 0 && !yukleniyor ? (
        <Empty
          description={
            <>
              Henüz grup tanımlanmadı.
              <br />
              <Text type="secondary">
                Grup yokken izin hesabı eski biçimde, bütün takvim günlerini
                sayarak çalışır.
              </Text>
            </>
          }
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={gruplar}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: "Grup",
              dataIndex: "ad",
              width: 200,
              render: (a: string, k: Grup) => (
                <div>
                  <Space size={6}>
                    <Text strong>{a}</Text>
                    {!k.aktif && <Tag>Pasif</Tag>}
                  </Space>

                  {k.aciklama && (
                    <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                      {k.aciklama}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: "Ünvanlar",
              dataIndex: "pozisyonlar",
              render: (p: string) => {
                const liste = (p ?? "").split(",").filter(Boolean);

                return liste.length === 0 ? (
                  <Text type="secondary">—</Text>
                ) : (
                  <Space size={4} wrap>
                    {liste.map((x) => (
                      <Tag key={x}>{x}</Tag>
                    ))}
                  </Space>
                );
              },
            },
            {
              title: "İzin günleri",
              dataIndex: "izinGunleri",
              width: 230,
              render: (g: string, k: Grup) => {
                const liste = (g ?? "")
                  .split(",")
                  .filter(Boolean)
                  .map((x) => Number(x));

                return (
                  <Space direction="vertical" size={2}>
                    {liste.length === 0 ? (
                      <Tooltip title="Sabit izin günü yok; yalnızca resmi tatiller düşülmez.">
                        <Text type="secondary">Değişken</Text>
                      </Tooltip>
                    ) : (
                      <Space size={4} wrap>
                        {liste.map((x) => (
                          <Tag color="green" key={x}>
                            {gunAdi(x)}
                          </Tag>
                        ))}
                      </Space>
                    )}

                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      haftada {k.haftalikIzin} gün
                      {k.izinSecebilir ? " · personel seçer" : ""}
                      {k.isAtayabilir ? " · iş atar" : ""}
                    </Text>
                  </Space>
                );
              },
            },
            {
              title: "Mesai",
              dataIndex: "mesaiBaslangic",
              width: 150,
              render: (b: string, k: Grup) =>
                !b ? (
                  <Text type="secondary">—</Text>
                ) : (
                  <Space direction="vertical" size={0}>
                    <Text>
                      {b}
                      {k.mesaiBitis ? ` – ${k.mesaiBitis}` : ""}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {k.hatirlatmaDakika} dk sonra hatırlat
                    </Text>
                  </Space>
                ),
            },
            ...(duzenleyebilir
              ? [
                  {
                    title: "",
                    width: 90,
                    render: (_: unknown, k: Grup) => (
                      <Space size={0}>
                        <Tooltip title="Düzenle">
                          <Button
                            type="text"
                            size="small"
                            icon={<Pencil size={15} strokeWidth={2} />}
                            onClick={() => setDuzenlenen(k)}
                          />
                        </Tooltip>

                        <Popconfirm
                          title="Grup silinsin mi?"
                          description="İzin hesabı bu gruptaki ünvanlar için eski biçime döner."
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
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {duzenlenen && (
        <GrupFormu
          grup={duzenlenen}
          pozisyonlar={pozisyonlar}
          kapat={() => setDuzenlenen(null)}
          kaydedildi={() => {
            setDuzenlenen(null);
            getir();
          }}
        />
      )}
    </>
  );
}

/* ========================================================================== */

function GrupFormu({
  grup,
  pozisyonlar,
  kapat,
  kaydedildi,
}: {
  grup: Partial<Grup>;
  pozisyonlar: string[];
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [ad, setAd] = useState(grup.ad ?? "");
  const [aciklama, setAciklama] = useState(grup.aciklama ?? "");
  const [secili, setSecili] = useState<string[]>(
    (grup.pozisyonlar ?? "").split(",").filter(Boolean)
  );
  const [gunler, setGunler] = useState<number[]>(
    (grup.izinGunleri ?? "")
      .split(",")
      .filter(Boolean)
      .map((x) => Number(x))
  );
  const [haftalik, setHaftalik] = useState(grup.haftalikIzin ?? 1);
  const [mesaiBas, setMesaiBas] = useState(grup.mesaiBaslangic ?? "");
  const [mesaiBit, setMesaiBit] = useState(grup.mesaiBitis ?? "");
  const [gecikme, setGecikme] = useState(grup.hatirlatmaDakika ?? 30);
  const [secebilir, setSecebilir] = useState(grup.izinSecebilir ?? false);
  const [isAtar, setIsAtar] = useState(grup.isAtayabilir ?? false);
  const [aktif, setAktif] = useState(grup.aktif ?? true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const kaydet = async () => {
    if (!ad.trim()) return message.warning("Grup adını giriniz.");

    setKaydediliyor(true);

    try {
      await api.gonder("/api/CalismaDuzeni/Grup", {
        id: grup.id ?? 0,
        ad: ad.trim(),
        aciklama: aciklama.trim() || null,
        pozisyonlar: secili,
        haftalikIzin: haftalik,
        izinGunleri: gunler,
        mesaiBaslangic: mesaiBas.trim() || null,
        mesaiBitis: mesaiBit.trim() || null,
        hatirlatmaDakika: gecikme,
        izinSecebilir: secebilir,
        isAtayabilir: isAtar,
        aktif,
        sira: grup.sira ?? 0,
      });

      message.success("Grup kaydedildi.");
      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      width={620}
      title={grup.id ? `Grup düzenle: ${grup.ad}` : "Yeni pozisyon grubu"}
      onCancel={kapat}
      onOk={kaydet}
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Grup adı
          </Text>
          <Input
            placeholder="Örn. Mağaza Personeli"
            value={ad}
            onChange={(e) => setAd(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Açıklama
          </Text>
          <Input
            placeholder="İsteğe bağlı"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Ünvanlar
          </Text>

          {/* Liste Mikro'dan: elle yazılan ünvan eşleşmediğinde grup
              sessizce boşa düşüyordu. */}
          <Select
            mode="multiple"
            allowClear
            style={{ width: "100%" }}
            placeholder="Bu gruba girecek ünvanları seçiniz"
            value={secili}
            onChange={setSecili}
            options={pozisyonlar.map((p) => ({ value: p, label: p }))}
            filterOption={(g, o) =>
              (o?.label as string ?? "")
                .toLocaleLowerCase("tr")
                .includes(g.toLocaleLowerCase("tr"))
            }
          />
        </div>

        <Card size="small" title="Haftalık izin düzeni">
          <Text type="secondary" style={{ fontSize: 12 }}>
            İşaretli günler yıllık izin hesabında bakiyeden düşülmez.
            Mağaza personelinde izin günü haftadan haftaya değişiyorsa
            hiçbirini işaretlemeyiniz — o zaman yalnızca resmi tatiller
            düşülmez.
          </Text>

          {/* Sık kullanılan iki düzen için kısayol: cumartesi ve pazarı tek
              tek işaretlemek merkez ofis gruplarında her seferinde tekrar
              eden bir işti. */}
          {/* İzin günü sabit olan gruplarda seçim ekranı çıkmamalı;
              personeli olmayan bir hakka yönlendiriyordu. */}
          <Checkbox
            checked={secebilir}
            onChange={(e) => setSecebilir(e.target.checked)}
            style={{ marginTop: 4 }}
          >
            Personel izin gününü kendisi seçebilsin
          </Checkbox>

          {/* İş atama yetkisi: ünvan adından tahmin edilmesi, ünvanında
              "müdür" geçmeyen ama işi atayan kişileri dışarıda
              bırakıyordu. */}
          <Checkbox
            checked={isAtar}
            onChange={(e) => setIsAtar(e.target.checked)}
            style={{ marginTop: 4 }}
          >
            Mobil uygulamadan iş emri atayabilsin
          </Checkbox>

          <Space size={6} style={{ marginTop: 8 }} wrap>
            <Button size="small" onClick={() => setGunler([0, 6])}>
              Hafta sonu izinli
            </Button>
            <Button size="small" onClick={() => setGunler([0])}>
              Yalnızca pazar
            </Button>
            <Button size="small" onClick={() => setGunler([])}>
              Değişken
            </Button>
          </Space>

          <div style={{ marginTop: 10 }}>
            <Checkbox.Group
              value={gunler}
              onChange={(d) => setGunler(d as number[])}
            >
              <Row gutter={[8, 8]}>
                {GUNLER.map((g) => (
                  <Col xs={12} md={8} key={g.deger}>
                    <Checkbox value={g.deger}>{g.ad}</Checkbox>
                  </Col>
                ))}
              </Row>
            </Checkbox.Group>
          </div>

          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Haftada kaç gün izin
              </Text>
              <br />
              <InputNumber
                min={0}
                max={7}
                value={haftalik}
                onChange={(d) => setHaftalik(d ?? 1)}
              />
            </Col>

            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Durum
              </Text>
              <br />
              <Switch
                checked={aktif}
                onChange={setAktif}
                checkedChildren="Aktif"
                unCheckedChildren="Pasif"
              />
            </Col>
          </Row>
        </Card>

        <Card size="small" title="Mesai saati ve hatırlatma">
          <Text type="secondary" style={{ fontSize: 12 }}>
            Mesai başlangıcından belirtilen süre sonra karekod okutmamış
            personele "henüz vardiya girişi yapmadınız" bildirimi gider.
            Saat boş bırakılırsa hatırlatma gönderilmez.
          </Text>

          <Row gutter={12} style={{ marginTop: 10 }}>
            <Col xs={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Başlangıç
              </Text>
              <Input
                placeholder="08:30"
                value={mesaiBas}
                onChange={(e) => setMesaiBas(e.target.value)}
              />
            </Col>

            <Col xs={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Bitiş
              </Text>
              <Input
                placeholder="18:00"
                value={mesaiBit}
                onChange={(e) => setMesaiBit(e.target.value)}
              />
            </Col>

            <Col xs={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Kaç dk sonra
              </Text>
              {/* Tam saatinde gönderilen bildirim, yolda olan personeli
                  boşuna rahatsız ediyordu. */}
              <InputNumber
                min={0}
                max={480}
                style={{ width: "100%" }}
                value={gecikme}
                onChange={(d) => setGecikme(d ?? 30)}
              />
            </Col>
          </Row>
        </Card>
      </Space>
    </Modal>
  );
}

/* ========================================================================== */
/* Resmi tatiller                                                             */
/* ========================================================================== */

interface Tatil {
  id: number;
  tarih: string;
  ad: string;
  yarimGun: boolean;
  aktif: boolean;
}

function Tatiller() {
  const { message } = AntdApp.useApp();

  const [tatiller, setTatiller] = useState<Tatil[]>([]);
  const [yillar, setYillar] = useState<number[]>([]);
  const [yil, setYil] = useState<number>(dayjs().year());
  const [duzenleyebilir, setDuzenleyebilir] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);

  const [tarih, setTarih] = useState<Dayjs | null>(null);
  const [ad, setAd] = useState("");
  const [yarim, setYarim] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{
        tatiller: Tatil[];
        yillar: number[];
        duzenleyebilir: boolean;
      }>(`/api/CalismaDuzeni/Tatiller?yil=${yil}`);

      setTatiller(c.tatiller ?? []);
      setYillar(c.yillar ?? []);
      setDuzenleyebilir(!!c.duzenleyebilir);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Tatiller alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [yil, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const ekle = async () => {
    if (!tarih) return message.warning("Tarih seçiniz.");
    if (!ad.trim()) return message.warning("Tatil adını giriniz.");

    try {
      await api.gonder("/api/CalismaDuzeni/Tatil", {
        id: 0,
        tarih: tarih.format("YYYY-MM-DD"),
        ad: ad.trim(),
        yarimGun: yarim,
        aktif: true,
      });

      message.success("Tatil eklendi.");
      setTarih(null);
      setAd("");
      setYarim(false);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eklenemedi.");
    }
  };

  const varsayilan = async () => {
    try {
      const c = await api.gonder<{ eklenen: number; bilgi: string }>(
        `/api/CalismaDuzeni/TatilVarsayilan/${yil}`,
        {}
      );

      message.success(`${c.eklenen} tatil eklendi. ${c.bilgi}`);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eklenemedi.");
    }
  };

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/CalismaDuzeni/Tatil/${id}`);
      message.success("Tatil silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Buradaki günler yıllık izin bakiyesinden düşülmez"
        description="Dinî bayramların tarihi her yıl kaydığı için elle eklenmelidir. Sabit tarihli millî bayramları tek dokunuşla ekleyebilirsiniz."
      />

      <Card size="small" className="ik-filtre">
        <Row gutter={[10, 10]} align="middle">
          <Col xs={12} md={4}>
            <Select
              style={{ width: "100%" }}
              value={yil}
              onChange={setYil}
              options={Array.from(
                new Set([dayjs().year(), dayjs().year() + 1, ...yillar])
              )
                .sort((a, b) => b - a)
                .map((y) => ({ value: y, label: String(y) }))}
            />
          </Col>

          {duzenleyebilir && (
            <>
              <Col xs={12} md={4}>
                <DatePicker
                  style={{ width: "100%" }}
                  format="DD.MM.YYYY"
                  placeholder="Tarih"
                  value={tarih}
                  onChange={setTarih}
                />
              </Col>

              <Col xs={24} md={6}>
                <Input
                  placeholder="Tatil adı (ör. Ramazan Bayramı 1. gün)"
                  value={ad}
                  onChange={(e) => setAd(e.target.value)}
                  onPressEnter={ekle}
                />
              </Col>

              <Col xs={12} md={4}>
                <Checkbox checked={yarim} onChange={(e) => setYarim(e.target.checked)}>
                  Yarım gün
                </Checkbox>
              </Col>

              <Col xs={12} md={6} style={{ textAlign: "right" }}>
                <Space>
                  <Button
                    icon={<Plus size={15} strokeWidth={2} />}
                    type="primary"
                    onClick={ekle}
                  >
                    Ekle
                  </Button>

                  <Tooltip title="Sabit tarihli millî bayramları bu yıla ekler">
                    <Button
                      icon={<CalendarPlus size={15} strokeWidth={2} />}
                      onClick={varsayilan}
                    >
                      Millî bayramlar
                    </Button>
                  </Tooltip>
                </Space>
              </Col>
            </>
          )}
        </Row>
      </Card>

      {tatiller.length === 0 && !yukleniyor ? (
        <Empty description={`${yil} yılı için tatil tanımlanmadı.`} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={tatiller}
          pagination={false}
          columns={[
            {
              title: "Tarih",
              dataIndex: "tarih",
              width: 160,
              render: (t: string) => (
                <Space size={6}>
                  <Text strong>{dayjs(t).format("DD.MM.YYYY")}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {gunAdi(dayjs(t).day())}
                  </Text>
                </Space>
              ),
            },
            { title: "Tatil", dataIndex: "ad" },
            {
              title: "Süre",
              dataIndex: "yarimGun",
              width: 110,
              render: (y: boolean) =>
                y ? <Tag color="orange">Yarım gün</Tag> : <Tag color="green">Tam gün</Tag>,
            },
            ...(duzenleyebilir
              ? [
                  {
                    title: "",
                    width: 60,
                    render: (_: unknown, k: Tatil) => (
                      <Popconfirm
                        title="Tatil silinsin mi?"
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
    </>
  );
}

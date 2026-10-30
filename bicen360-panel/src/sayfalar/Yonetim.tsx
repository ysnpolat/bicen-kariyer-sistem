/**
 * ---------------------------------------------------------------------------
 * Yönetim
 * ---------------------------------------------------------------------------
 * Departmanlar, temsilcileri ve arıza kategorileri. Bu tanımlar arıza kaydı
 * ekranından ayrıldı: yılda birkaç kez dokunulan listelerdi ve her gün
 * kullanılan ekranın içinde durmaları hem orayı kalabalıklaştırıyor hem de
 * yanlışlıkla değiştirilmelerini kolaylaştırıyordu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Tabs,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  Checkbox,
  Spin,
} from "antd";
import {
  Building2,
  ListTree,
  Image as ImageIcon,
  Lock,
  Users,
  Pencil,
  Plus,
  Store,
  Tags,
  Trash2,
  Layout,
  Smartphone,
  ShieldCheck,
} from "lucide-react";

import { api } from "../api";
import { RENK } from "../sabitler";
import RakipLogosu from "../RakipLogosu";
import SoruAkisi from "./SoruAkisi";
import Yetkiler from "./Yetkiler";
import Kullanicilar from "./Kullanicilar";
import Roller from "./Roller";
import PortalGorunumu from "./PortalGorunumu";
import SubeDepo from "./SubeDepo";
import UrunGorselleri from "./UrunGorselleri";

/**
 * Tanım işlerinin tamamı burada: departmanlar, arıza kategorileri ve
 * yetkiler. Üçü de yılda birkaç kez dokunulan işler; menüde ayrı maddeler
 * tutmak her gün kullanılan sayfaları aşağı itiyordu.
 */
export default function Yonetim() {
  /* Sekme dışarıdan da değiştirilebiliyor: kategori satırındaki "Akışı
     düzenle", kullanıcıyı Soru Akışı sekmesine o tür seçili olarak
     götürüyor. Aynı türü listeden bir kez daha bulmak zorunda kalmasın. */
  const [sekme, setSekme] = useState("departmanlar");
  const [akisTuru, setAkisTuru] = useState<number | null>(null);

  const akisaGit = (turId: number) => {
    setAkisTuru(turId);
    setSekme("akis");
  };

  return (
    <Tabs
      activeKey={sekme}
      onChange={setSekme}
      items={[
        {
          key: "departmanlar",
          label: (
            <Etiket simge={<Building2 size={15} strokeWidth={2} />} ad="Departmanlar" />
          ),
          children: <Departmanlar />,
        },
        {
          key: "kategoriler",
          label: <Etiket simge={<Tags size={15} strokeWidth={2} />} ad="Arıza Kategorileri" />,
          children: <Kategoriler akisaGit={akisaGit} />,
        },
        {
          key: "akis",
          label: <Etiket simge={<ListTree size={15} strokeWidth={2} />} ad="Soru Akışı" />,
          children: <SoruAkisi baslangicTuru={akisTuru} />,
        },
        {
          key: "rakipler",
          label: <Etiket simge={<Store size={15} strokeWidth={2} />} ad="Rakip Firmalar" />,
          children: <RakipFirmalar />,
        },
        {
          /* Karşılama sayfasının içeriği. Metinleri koda gömmek, her
             duyuru değişikliğinde yeni sürüm yayınlamak demekti. */
          key: "portal",
          label: (
            <Etiket simge={<Layout size={15} strokeWidth={2} />} ad="Portal Görünümü" />
          ),
          children: <PortalGorunumu />,
        },
        {
          /* Depo numarası fiyat sorgusunun temel girdisi; mail ayarları
             da burada çünkü ikisi de kurulum işi. */
          key: "subedepo",
          label: (
            <Etiket simge={<Store size={15} strokeWidth={2} />} ad="Şube ve Mail" />
          ),
          children: <SubeDepo />,
        },
        {
          /* Fiyat sorgusunda görünen ürün fotoğrafları; toplu yükleme
             burada çünkü binlerce ürünü tek tek eklemek mümkün değil. */
          key: "urungorsel",
          label: (
            <Etiket
              simge={<ImageIcon size={15} strokeWidth={2} />}
              ad="Ürün Görselleri"
            />
          ),
          children: <UrunGorselleri />,
        },
        {
          key: "kullanicilar",
          label: <Etiket simge={<Users size={15} strokeWidth={2} />} ad="Kullanıcılar" />,
          children: <Kullanicilar />,
        },
        {
          /* Portal rolleri (13.10.2026): sayfa, departman, rapor ve
             tutar yetkisi tek tanımda */
          key: "roller",
          label: <Etiket simge={<ShieldCheck size={15} strokeWidth={2} />} ad="Roller" />,
          children: <Roller />,
        },
        {
          key: "yetkiler",
          label: <Etiket simge={<Lock size={15} strokeWidth={2} />} ad="Yetkiler" />,
          children: <Yetkiler />,
        },
      ]}
    />
  );
}

function Etiket({ simge, ad }: { simge: JSX.Element; ad: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {simge}
      {ad}
    </span>
  );
}

/* ========================================================================== */
/* Kategoriler                                                                */
/* ========================================================================== */

interface Kategori {
  id: number;
  ad: string;
  departmanId: number | null;
  departman: string | null;
  aciklama: string | null;
  slaSaat: number;
  cihazTurleri: string | null;
  soru: string | null;
  akisZorunlu: boolean;
  aktif: boolean;
  sira: number;
  kayitSayisi: number;

  /** Bu tür için tanımlı etkin soru akışı adımı sayısı */
  adimSayisi: number;

  /** Varsayılan sorumlu: bu kategoride açılan kayıt ona atanır */
  atananKodu: string | null;
  atananAdi: string | null;
}

interface KategoriVeri {
  kategoriler: Kategori[];
  departmanlar: { id: number; ad: string }[];
  cihazTurleri: string[];
  temsilciler?: { departmanId: number; sicil: string; adSoyad: string; pozisyon?: string }[];

  /** false: yalnızca kendi departmanlarının türleri (13.10.2026) */
  hepsi?: boolean;
}

/* Arıza Kayıtları sayfasından da açılıyor: departman kendi türlerini
   oradan yönetir (13.10.2026) */
export function Kategoriler({ akisaGit }: { akisaGit: (turId: number) => void }) {
  const [veri, setVeri] = useState<KategoriVeri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<Partial<Kategori> | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      setVeri(await api.getir<KategoriVeri>("Yonetim/Kategoriler"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kategoriler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const sil = async (id: number) => {
    try {
      const c = await api.sil<{ bilgi?: string }>(`Yonetim/Kategori/${id}`);
      message.success(c?.bilgi ?? "Kategori silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  const liste = veri?.kategoriler ?? [];

  return (
    <>
      {hata && <Alert type="error" message={hata} showIcon style={{ marginBottom: 12 }} />}

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Kutu baslik="Toplam kategori" deger={liste.length} />
        <Kutu
          baslik="Aktif"
          deger={liste.filter((k) => k.aktif).length}
          renk={RENK.yesilKoyu}
        />
        <Kutu
          baslik="Departmana özel"
          deger={liste.filter((k) => k.departmanId).length}
        />
        <Kutu
          baslik="Genel"
          deger={liste.filter((k) => !k.departmanId).length}
        />
      </Row>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button
            type="primary"
            icon={<Plus size={16} strokeWidth={2} />}
            style={{ background: RENK.yesil }}
            onClick={() =>
              setDuzenlenen({
                slaSaat: 72,
                aktif: true,
                sira: 0,
                departmanId: veri?.hepsi === false ? veri.departmanlar[0]?.id ?? null : undefined,
              })
            }
          >
            Yeni kategori
          </Button>

          <Typography.Text type="secondary">
            SLA süresi, kaydın çözülmesi için hedeflenen süredir; gecikme buna
            göre ölçülür.
          </Typography.Text>
        </Space>
      </Card>

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
                <div style={{ fontWeight: 500 }}>
                  {ad}{" "}
                  {!k.aktif && <Tag>Pasif</Tag>}
                </div>
                {k.aciklama && (
                  <div style={{ fontSize: 12, color: RENK.metinPasif }}>{k.aciklama}</div>
                )}
              </div>
            ),
          },
          {
            title: "Departman",
            dataIndex: "departman",
            width: 190,
            render: (d: string | null) =>
              d ? <Tag color="blue">{d}</Tag> : <Tag color="green">Genel</Tag>,
          },
          {
            title: "Sorumlu",
            dataIndex: "atananAdi",
            width: 170,
            render: (d: string | null) =>
              d ? (
                <Tag color="purple">{d}</Tag>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  otomatik atama yok
                </Typography.Text>
              ),
          },
          {
            title: "SLA",
            dataIndex: "slaSaat",
            width: 100,
            render: (s: number) => <Tag>{s} saat</Tag>,
          },
          {
            title: "Cihaz türleri",
            dataIndex: "cihazTurleri",
            render: (c: string | null) => {
              const liste = (c ?? "").split(",").filter(Boolean);

              if (liste.length === 0)
                return <Typography.Text type="secondary">Tümü</Typography.Text>;

              return (
                <Space size={4} wrap>
                  {liste.slice(0, 3).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  {liste.length > 3 && <Tag>+{liste.length - 3}</Tag>}
                </Space>
              );
            },
          },
          {
            title: "Soru akışı",
            dataIndex: "adimSayisi",
            width: 130,
            render: (a: number, k: Kategori) => (
              <Space size={4}>
                {a > 0 ? (
                  <>
                    <Tag color="green">{a} adım</Tag>
                    {k.akisZorunlu && <Tag color="red">Zorunlu</Tag>}
                  </>
                ) : (
                  <Typography.Text type="secondary">Yok</Typography.Text>
                )}

                <Tooltip title="Donanımları ve soruları buradan tanımlarsınız.">
                  <Button type="link" size="small" onClick={() => akisaGit(k.id)}>
                    {a > 0 ? "Düzenle" : "Tanımla"}
                  </Button>
                </Tooltip>
              </Space>
            ),
          },
          { title: "Kayıt", dataIndex: "kayitSayisi", width: 80 },
          {
            title: "",
            width: 90,
            render: (_, k: Kategori) => (
              <Space size={4}>
                <Button
                  type="text"
                  size="small"
                  icon={<Pencil size={15} strokeWidth={2} />}
                  onClick={() => setDuzenlenen(k)}
                />
                <Popconfirm
                  title="Kategori kaldırılsın mı?"
                  description="Kaydı varsa silinmez, pasife alınır."
                  okText="Kaldır"
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
        ]}
      />

      {duzenlenen && veri && (
        <KategoriForm
          kategori={duzenlenen}
          veri={veri}
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

function KategoriForm({
  kategori,
  veri,
  kapat,
  kaydedildi,
}: {
  kategori: Partial<Kategori>;
  veri: KategoriVeri;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();
      setKaydediliyor(true);

      await api.gonder("Yonetim/Kategori", {
        id: kategori.id ?? 0,
        ad: d.ad,
        departmanId: d.departmanId ?? 0,
        aciklama: d.aciklama ?? null,
        slaSaat: d.slaSaat,
        cihazTurleri: d.cihazTurleri ?? [],
        soru: d.soru ?? null,
        akisZorunlu: !!d.akisZorunlu,
        atananKodu: d.atananKodu ?? "",
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
      okButtonProps={{ style: { background: RENK.yesil } }}
      width={620}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ad: kategori.ad,
          departmanId: kategori.departmanId ?? undefined,
          aciklama: kategori.aciklama,
          slaSaat: kategori.slaSaat ?? 72,
          cihazTurleri: (kategori.cihazTurleri ?? "").split(",").filter(Boolean),
          soru: kategori.soru,
          akisZorunlu: kategori.akisZorunlu ?? false,
          atananKodu: kategori.atananKodu ?? undefined,
          aktif: kategori.aktif ?? true,
          sira: kategori.sira ?? 0,
        }}
      >
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="ad"
              label="Kategori adı"
              rules={[{ required: true, message: "Kategori adını giriniz." }]}
            >
              <Input placeholder="Örn. Kasa donanım arızası" />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              name="departmanId"
              label="Departman"
              extra={veri.hepsi === false ? "Yalnızca kendi departmanlarınıza tür tanımlayabilirsiniz." : "Boş bırakılırsa tüm departmanlar kullanabilir."}
              rules={veri.hepsi === false ? [{ required: true, message: "Departman seçiniz." }] : []}
            >
              <Select
                allowClear={veri.hepsi !== false}
                placeholder={veri.hepsi === false ? "Departman seçiniz" : "Genel kategori (tüm departmanlar)"}
                options={veri.departmanlar.map((d) => ({ value: d.id, label: d.ad }))}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* Varsayılan sorumlu: seçilen departmanın temsilcileri listeleniyor.
            Departman boşsa bütün temsilciler. Kayıt açıldığı anda bu kişiye
            atanıyor ve bildirim gidiyor; sonradan elle değiştirilebilir. */}
        <Form.Item noStyle shouldUpdate={(a, b) => a.departmanId !== b.departmanId}>
          {({ getFieldValue }) => {
            const dep = getFieldValue("departmanId");

            const adaylar = (veri.temsilciler ?? [])
              .filter((t) => !dep || t.departmanId === dep)
              .filter((t, i, dizi) => dizi.findIndex((x) => x.sicil === t.sicil) === i);

            return (
              <Form.Item
                name="atananKodu"
                label="Sorumlu (otomatik atama)"
                extra={
                  adaylar.length === 0
                    ? "Bu departmanın temsilcisi yok. Önce Departmanlar sekmesinden temsilci ekleyin."
                    : "Bu kategoride açılan kayıt kendiliğinden bu kişiye atanır ve bildirim gider. Boş bırakılırsa atama yapılmaz."
                }
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={adaylar.length ? "Temsilci seçiniz" : "Temsilci yok"}
                  disabled={adaylar.length === 0 && !getFieldValue("atananKodu")}
                  options={adaylar.map((t) => ({
                    value: t.sicil,
                    label: `${t.adSoyad}${t.pozisyon ? ` · ${t.pozisyon}` : ""}`,
                  }))}
                />
              </Form.Item>
            );
          }}
        </Form.Item>

        <Form.Item name="aciklama" label="Açıklama">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item
              name="slaSaat"
              label="SLA süresi (saat)"
              rules={[
                { required: true, message: "SLA süresini giriniz." },
                {
                  type: "number",
                  min: 1,
                  max: 720,
                  message: "1 ile 720 saat arasında olmalı.",
                },
              ]}
              extra="Çözüm için hedeflenen süre"
            >
              <InputNumber min={1} max={720} style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={16}>
            <Form.Item
              name="cihazTurleri"
              label="İlgili cihaz türleri"
              extra="Boş bırakılırsa tüm cihaz türleri için kullanılabilir. Liste envantere girilen türlerden geliyor."
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Cihaz türlerini seçiniz"
                options={veri.cihazTurleri.map((t) => ({ value: t, label: t }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={16}>
            <Form.Item
              name="soru"
              label="Soru akışının ilk sorusu"
              extra="Donanımlar ve alt sorular Soru Akışı sekmesinde tanımlanır. Boş bırakılırsa ekranda “Hangisi?” yazar."
            >
              <Input placeholder="Örn. Yazarkasada sorun nerede?" />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item
              name="akisZorunlu"
              label="Akış"
              valuePropName="checked"
              extra="Açıksa akış sonuna kadar tamamlanmadan kayıt açılamaz."
            >
              <Switch checkedChildren="Zorunlu" unCheckedChildren="İsteğe bağlı" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="sira" label="Sıra">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={16}>
            <Form.Item
              name="aktif"
              label="Durum"
              valuePropName="checked"
              extra="Pasif kategoriler yeni kayıt açılırken görünmez."
            >
              <Switch checkedChildren="Aktif" unCheckedChildren="Pasif" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

/* ========================================================================== */
/* Departmanlar                                                               */
/* ========================================================================== */

interface Personel {
  sicil: string;
  adSoyad: string;
  pozisyon: string;
  sube: string;

  /* Aramada kullanılıyor, ekranda gösterilmiyor: sicili bilmeyen
     kullanıcı kimlik numarasıyla arayabilsin. */
  kimlik?: string;
}

interface Departman {
  id: number;
  ad: string;
  aciklama: string | null;
  aktif: boolean;
  sira: number;
  temsilciler: string[];
}

function Departmanlar() {
  const [liste, setListe] = useState<Departman[]>([]);
  const [sayilar, setSayilar] = useState<Record<number, number>>({});
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [duzenlenen, setDuzenlenen] = useState<Partial<Departman> | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.getir<{
        departmanlar: Departman[];
        kayitSayilari: { departmanId: number; sayi: number }[];
        personeller: Personel[];
        personelHatasi?: string | null;
      }>("Yonetim/Departmanlar");

      setListe(c.departmanlar ?? []);
      setPersoneller(c.personeller ?? []);

      /* Liste okunamadıysa sebebi bir kez gösteriliyor: boş açılır kutu
         hatasız görünüyordu ve temsilci eklenemiyordu. */
      if ((c.personeller ?? []).length === 0 && c.personelHatasi)
        message.error(`Personel listesi alınamadı: ${c.personelHatasi}`, 8);
      setSayilar(
        Object.fromEntries((c.kayitSayilari ?? []).map((x) => [x.departmanId, x.sayi])),
      );
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Departmanlar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const sil = async (id: number) => {
    try {
      const c = await api.sil<{ bilgi?: string }>(`Yonetim/Departman/${id}`);
      message.success(c?.bilgi ?? "Departman silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button
            type="primary"
            icon={<Plus size={16} strokeWidth={2} />}
            style={{ background: RENK.yesil }}
            onClick={() => setDuzenlenen({ aktif: true, sira: 0, temsilciler: [] })}
          >
            Yeni departman
          </Button>

          <Typography.Text type="secondary">
            Temsilci, departmanına açılan tüm kayıtları görür ve durumlarını
            değiştirebilir. Sicil numarasıyla tanımlanır.
          </Typography.Text>
        </Space>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={liste}
        pagination={false}
        locale={{ emptyText: <Empty description="Henüz departman tanımlanmamış." /> }}
        columns={[
          {
            title: "Departman",
            dataIndex: "ad",
            render: (ad: string, d: Departman) => (
              <div>
                <div style={{ fontWeight: 500 }}>
                  {ad} {!d.aktif && <Tag>Pasif</Tag>}
                </div>
                {d.aciklama && (
                  <div style={{ fontSize: 12, color: RENK.metinPasif }}>{d.aciklama}</div>
                )}
              </div>
            ),
          },
          {
            title: "Temsilciler",
            dataIndex: "temsilciler",
            render: (t: string[]) =>
              t.length === 0 ? (
                <Typography.Text type="secondary">
                  Tanımsız — kayıt açılınca kimseye bildirim gitmez
                </Typography.Text>
              ) : (
                /* İlk ikisi yazılıyor, kalanı sayı olarak: kalabalık
                   departmanlarda satır yüksekliği ekranı bozuyordu.
                   Tamamı ipucunda görünüyor. */
                <Tooltip
                  title={t
                    .map((k) => personeller.find((p) => p.sicil === k)?.adSoyad ?? k)
                    .join(", ")}
                >
                  <Space size={4} wrap>
                    {t.slice(0, 2).map((k) => (
                      <Tag key={k}>
                        {personeller.find((p) => p.sicil === k)?.adSoyad ?? k}
                      </Tag>
                    ))}
                    {t.length > 2 && <Tag>+{t.length - 2}</Tag>}
                  </Space>
                </Tooltip>
              ),
          },
          {
            title: "Kayıt",
            width: 80,
            render: (_, d: Departman) => sayilar[d.id] ?? 0,
          },
          {
            title: "",
            width: 90,
            render: (_, d: Departman) => (
              <Space size={4}>
                <Button
                  type="text"
                  size="small"
                  icon={<Pencil size={15} strokeWidth={2} />}
                  onClick={() => setDuzenlenen(d)}
                />
                <Popconfirm
                  title="Departman kaldırılsın mı?"
                  description="Kaydı varsa silinmez, pasife alınır."
                  okText="Kaldır"
                  cancelText="Vazgeç"
                  onConfirm={() => sil(d.id)}
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
        ]}
      />

      {duzenlenen && (
        <DepartmanForm
          departman={duzenlenen}
          personeller={personeller}
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

function DepartmanForm({
  departman,
  personeller,
  kapat,
  kaydedildi,
}: {
  departman: Partial<Departman>;
  personeller: Personel[];
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();
      setKaydediliyor(true);

      await api.gonder("Yonetim/Departman", {
        id: departman.id ?? 0,
        ad: d.ad,
        aciklama: d.aciklama ?? null,
        aktif: d.aktif,
        sira: d.sira ?? 0,
        temsilciler: d.temsilciler ?? [],
      });

      message.success("Departman kaydedildi.");
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
      title={departman.id ? `Departman düzenle: ${departman.ad}` : "Yeni departman"}
      onCancel={kapat}
      onOk={kaydet}
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      okButtonProps={{ style: { background: RENK.yesil } }}
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ad: departman.ad,
          aciklama: departman.aciklama,
          aktif: departman.aktif ?? true,
          sira: departman.sira ?? 0,
          temsilciler: departman.temsilciler ?? [],
        }}
      >
        <Form.Item
          name="ad"
          label="Departman adı"
          rules={[{ required: true, message: "Departman adını giriniz." }]}
        >
          <Input placeholder="Örn. Bilgi Teknolojileri" />
        </Form.Item>

        <Form.Item name="aciklama" label="Açıklama">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item
          name="temsilciler"
          label="Temsilciler"
          extra="Bir kişi birden fazla departmanın temsilcisi olabilir. Temsilci, departmanına açılan tüm kayıtları görür ve durumlarını değiştirebilir."
        >
          <Select
            mode="multiple"
            showSearch
            allowClear
            placeholder="Personel arayınız"
            optionFilterProp="ara"
            maxTagCount="responsive"
            /* Etikette yalnızca ad: görev ve mağaza da yazılınca tek bir
               isim kutunun tamamını dolduruyordu. Ayrıntı açılır listede
               duruyor, seçim yaparken zaten orada görünüyor. */
            labelRender={(secim) => <span>{secim.title ?? secim.value}</span>}
            optionRender={(secenek) => (
              <div style={{ lineHeight: 1.3, paddingBlock: 2 }}>
                <div style={{ fontWeight: 500 }}>{secenek.data.title}</div>
                <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                  {secenek.data.alt}
                </div>
              </div>
            )}
            /* Ada, sicile, göreve ve mağazaya göre aranabilsin: aynı adda
               birden fazla kişi olduğunda ayırt etmenin tek yolu bu. */
            options={personeller.map((p) => ({
              value: p.sicil,
              title: p.adSoyad,
              alt: [p.pozisyon, p.sube].filter(Boolean).join(" · "),
              label: p.adSoyad,
              ara: `${p.adSoyad} ${p.sicil} ${p.pozisyon} ${p.sube} ${p.kimlik ?? ""}`,
            }))}
            notFoundContent={
              personeller.length === 0
                ? "Personel listesi alınamadı. Mikro veritabanına ulaşılamıyor olabilir."
                : "Personel bulunamadı"
            }
          />
        </Form.Item>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="sira" label="Sıra">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={16}>
            <Form.Item name="aktif" label="Durum" valuePropName="checked">
              <Switch checkedChildren="Aktif" unCheckedChildren="Pasif" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

/* ========================================================================== */
/* Rakip firmalar                                                             */
/* ========================================================================== */

interface Firma {
  id: number;
  ad: string;
  aktif: boolean;
  sira: number;
  kayitSayisi: number;
  /* Logo (12.10.2026) */
  logo?: string | null;
  logoAdres?: string | null;
  logoIndirildi?: boolean;
}

/**
 * Rakip firmalar.
 *
 * Fiyat karşılaştırmasında personel bu listeden seçim yapıyor. Serbest metin
 * bırakılsaydı aynı firma "Çağrı", "ÇAĞRI A.Ş.", "cagri" diye üç ayrı satır
 * olur ve rapor kırılımı işe yaramazdı.
 */
function RakipFirmalar() {
  const [liste, setListe] = useState<Firma[]>([]);
  const [yeni, setYeni] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);

  /* Logo penceresi: bağlantı ya da görsel */
  const [logoFirma, setLogoFirma] = useState<Firma | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setListe(await api.getir<Firma[]>("Yonetim/RakipFirmalar"));
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Firmalar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async (firma: Partial<Firma>) => {
    try {
      await api.gonder("Yonetim/RakipFirma", {
        id: firma.id ?? 0,
        ad: firma.ad,
        aktif: firma.aktif ?? true,
        sira: firma.sira ?? 0,
      });
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    }
  };

  const sil = async (id: number) => {
    try {
      const c = await api.sil<{ bilgi?: string }>(`Yonetim/RakipFirma/${id}`);
      message.success(c?.bilgi ?? "Firma silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  const ekle = () => {
    if (!yeni.trim()) return;
    kaydet({ ad: yeni.trim() });
    setYeni("");
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph style={{ color: RENK.metinPasif, marginBottom: 0 }}>
        Mobilde rakip fiyat okutulurken bu listeden seçim yapılıyor. Pasife
        alınan firma yeni okutmalarda görünmez, eski kayıtlarda durur.
      </Typography.Paragraph>

      <Card size="small">
        <Space.Compact style={{ width: "100%", maxWidth: 460 }}>
          <Input
            placeholder="Yeni firma adı"
            value={yeni}
            onChange={(e) => setYeni(e.target.value)}
            onPressEnter={ekle}
          />
          <Button
            type="primary"
            icon={<Plus size={16} strokeWidth={2} />}
            style={{ background: RENK.yesil }}
            onClick={ekle}
          >
            Ekle
          </Button>
        </Space.Compact>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={liste}
        pagination={false}
        locale={{ emptyText: <Empty description="Henüz firma tanımlanmamış." /> }}
        columns={[
          {
            title: "Logo",
            width: 96,
            render: (_, f: Firma) => (
              <Tooltip title={f.logo ? "Logoyu değiştir" : "Logo ekle (bağlantı ya da görsel)"}>
                <Button
                  type="text"
                  size="small"
                  onClick={() => setLogoFirma(f)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingInline: 4 }}
                >
                  <RakipLogosu id={f.id} ad={f.ad} logo={f.logo} boyut={28} />
                  <span style={{ fontSize: 12, color: RENK.metinPasif }}>{f.logo ? "Değiştir" : "Ekle"}</span>
                </Button>
              </Tooltip>
            ),
          },
          {
            title: "Firma",
            dataIndex: "ad",
            render: (ad: string, f: Firma) => (
              <Input
                variant="borderless"
                defaultValue={ad}
                onBlur={(e) => {
                  const d = e.target.value.trim();
                  if (d && d !== ad) kaydet({ ...f, ad: d });
                }}
              />
            ),
          },
          { title: "Okutma", dataIndex: "kayitSayisi", width: 100 },
          {
            title: "Sıra",
            dataIndex: "sira",
            width: 90,
            render: (s: number, f: Firma) => (
              <InputNumber
                size="small"
                defaultValue={s}
                style={{ width: 70 }}
                onBlur={(e) => {
                  const d = Number((e.target as HTMLInputElement).value);
                  if (!Number.isNaN(d) && d !== s) kaydet({ ...f, sira: d });
                }}
              />
            ),
          },
          {
            title: "Aktif",
            dataIndex: "aktif",
            width: 80,
            render: (a: boolean, f: Firma) => (
              <Switch size="small" checked={a} onChange={(d) => kaydet({ ...f, aktif: d })} />
            ),
          },
          {
            title: "",
            width: 60,
            render: (_, f: Firma) => (
              <Popconfirm
                title="Firma kaldırılsın mı?"
                description="Okutması varsa silinmez, pasife alınır."
                okText="Kaldır"
                cancelText="Vazgeç"
                onConfirm={() => sil(f.id)}
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
        ]}
      />

      <LogoPenceresi
        firma={logoFirma}
        kapat={() => setLogoFirma(null)}
        degisti={async () => {
          await getir();
        }}
      />
    </Space>
  );
}

/**
 * Rakip logosu: bağlantı yapıştırılır (sunucu görseli indirip saklar) ya da
 * görsel yüklenir. PNG, JPEG, WEBP, GIF; en çok 2 MB. Logo portalın Rakip
 * Fiyat sayfasında ve uygulamanın 1.7 sürümünde rakip seçiminde görünür.
 */
function LogoPenceresi({
  firma,
  kapat,
  degisti,
}: {
  firma: Firma | null;
  kapat: () => void;
  degisti: () => Promise<void>;
}) {
  const [adres, setAdres] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);
  const [onizleme, setOnizleme] = useState<string | null>(null);
  const dosyaAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAdres(firma?.logoAdres ?? "");
    setOnizleme(firma?.logo ?? null);
  }, [firma]);

  if (!firma) return null;

  const baglantiKaydet = async () => {
    setCalisiyor(true);
    try {
      const c = await api.gonder<{ bilgi?: string; logoHata?: string }>("Yonetim/RakipFirma", {
        id: firma.id,
        ad: firma.ad,
        aktif: firma.aktif,
        sira: firma.sira,
        logoAdres: adres.trim(),
      });
      if (c?.logoHata) message.warning(c.logoHata, 7);
      else message.success(c?.bilgi ?? "Logo kaydedildi.");
      await degisti();
      kapat();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Logo kaydedilemedi.");
    } finally {
      setCalisiyor(false);
    }
  };

  const dosyaYukle = async (dosya: File) => {
    if (dosya.size > 2 * 1024 * 1024) {
      message.error("Logo en çok 2 MB olabilir.");
      return;
    }
    setCalisiyor(true);
    try {
      const form = new FormData();
      form.append("dosya", dosya);
      await api.dosyaGonder(`Yonetim/RakipFirma/${firma.id}/Logo`, form);
      message.success("Logo yüklendi.");
      await degisti();
      kapat();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Logo yüklenemedi.");
    } finally {
      setCalisiyor(false);
    }
  };

  const kaldir = async () => {
    setCalisiyor(true);
    try {
      await api.sil(`Yonetim/RakipFirma/${firma.id}/Logo`);
      message.success("Logo kaldırıldı.");
      await degisti();
      kapat();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Logo kaldırılamadı.");
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Modal open title={`${firma.ad} · logo`} onCancel={kapat} footer={null} destroyOnClose>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <RakipLogosu id={firma.id} ad={firma.ad} logo={onizleme} boyut={64} />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {firma.logo
              ? firma.logoAdres && !firma.logoIndirildi
                ? "Logo bağlantıdan gösteriliyor (sunucu indiremedi)."
                : "Logo sunucuda kayıtlı."
              : "Henüz logo yok; baş harf gösteriliyor."}
          </Typography.Text>
        </div>

        <div>
          <Typography.Text strong>Logo bağlantısı</Typography.Text>
          <Space.Compact style={{ width: "100%", marginTop: 6 }}>
            <Input
              placeholder="https://… (png, jpg, webp)"
              value={adres}
              onChange={(e) => setAdres(e.target.value)}
              onPressEnter={baglantiKaydet}
              allowClear
            />
            <Button type="primary" loading={calisiyor} onClick={baglantiKaydet} style={{ background: RENK.yesil }}>
              Kaydet
            </Button>
          </Space.Compact>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "6px 0 0" }}>
            Sunucu görseli indirip saklar; rakip sitesi görseli kaldırsa da logo kaybolmaz. SVG desteklenmiyor.
            Bağlantıyı silip kaydetmek logoyu kaldırır.
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong>ya da görsel yükleyin</Typography.Text>
          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              ref={dosyaAlani}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => {
                const d = e.target.files?.[0];
                e.target.value = "";
                if (d) dosyaYukle(d);
              }}
            />
            <Button
              loading={calisiyor}
              icon={<ImageIcon size={15} strokeWidth={2} />}
              onClick={() => dosyaAlani.current?.click()}
            >
              Görsel seç
            </Button>
            {firma.logo ? (
              <Popconfirm title="Logo kaldırılsın mı?" okText="Kaldır" cancelText="Vazgeç" onConfirm={kaldir}>
                <Button danger loading={calisiyor} icon={<Trash2 size={15} strokeWidth={2} />}>
                  Logoyu kaldır
                </Button>
              </Popconfirm>
            ) : null}
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "6px 0 0" }}>
            PNG, JPEG, WEBP ya da GIF; en çok 2 MB. Kare ya da yatay, şeffaf zeminli logo en iyi görünür.
          </Typography.Paragraph>
        </div>
      </Space>
    </Modal>
  );
}

/* ========================================================================== */

function Kutu({
  baslik,
  deger,
  renk,
}: {
  baslik: string;
  deger: number;
  renk?: string;
}) {
  return (
    <Col xs={12} md={6}>
      <Card size="small">
        <Statistic
          title={baslik}
          value={deger}
          valueStyle={{ fontSize: 22, color: renk ?? RENK.siyah }}
        />
      </Card>
    </Col>
  );
}

/* ========================================================================== */

/**
 * Mobil alt menü.
 *
 * Uygulamanın altındaki sekmelerde hangi modüllerin görüneceği buradan
 * seçiliyor. Ayar Kariyer servisinde tutuluyor; portal oraya yazıyor
 * çünkü aynı ayarı iki yerde tutmak ikisini tutarlı tutma sorununu
 * getirirdi.
 */
function AltMenu() {
  const [adaylar, setAdaylar] = useState<{ kod: string; ad: string }[]>([]);
  const [secili, setSecili] = useState<string[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yetkiler, setYetkiler] = useState<any>(null);

  const getir = async () => {
    setYukleniyor(true);

    try {
      const c = await kariyerApi.getir<any>("Mobil/ModulYetkileri");

      setAdaylar(c?.altMenuAdaylari ?? c?.moduller ?? []);
      setSecili(c?.altMenu ?? []);
      setYetkiler(c?.yetkiler ?? null);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Alt menü alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      /* Yetkiler olduğu gibi geri gönderiliyor: uç ikisini birlikte
         yazıyor ve boş gönderilirse modül yetkileri siliniyordu. */
      await kariyerApi.gonder("Mobil/ModulYetkileri", {
        yetkiler: yetkiler ?? {},
        altMenu: secili,
      });

      message.success("Alt menü kaydedildi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Spin />;

  return (
    <Card size="small">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Uygulamanın altındaki sekmelerde görünecek modüller. Ana Sayfa ve Diğer
        her zaman vardır; buradan en fazla <b>dört modül</b> seçebilirsiniz.
        Seçilmeyenler Diğer sekmesinde listelenir. Listede portal modülleri de
        var; yetkisi olmayan personelde sekme çıkmaz.
      </Typography.Paragraph>

      <Checkbox.Group
        value={secili}
        onChange={(d) => {
          /* Dört sınırı: alt menüde beşinci sekme sığmıyor ve
             etiketler kırpılıyordu. */
          if (d.length > 4) {
            message.warning("En fazla dört modül seçebilirsiniz.");
            return;
          }

          setSecili(d as string[]);
        }}
        style={{ width: "100%" }}
      >
        <Row gutter={[8, 10]}>
          {adaylar.map((m) => (
            <Col xs={12} md={8} key={m.kod}>
              <Checkbox value={m.kod}>{m.ad}</Checkbox>
            </Col>
          ))}
        </Row>
      </Checkbox.Group>

      <Button
        type="primary"
        loading={kaydediliyor}
        onClick={kaydet}
        style={{ marginTop: 16 }}
      >
        Kaydet
      </Button>
    </Card>
  );
}

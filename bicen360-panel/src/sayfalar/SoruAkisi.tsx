/**
 * ---------------------------------------------------------------------------
 * Soru Akışı
 * ---------------------------------------------------------------------------
 * Arıza türü seçildikten sonra mobilde sorulacak adımlar burada tanımlanıyor.
 *
 * Personel eskiden tek satır yazıp bitiriyordu ("kasam çalışmıyor") ve
 * teknisyen mağazaya gidene kadar neyin bozulduğunu bilmiyordu. Akış bunun
 * yerine adım adım soruyor: Yazarkasa › Fiş yazıcı › Silik çıkarıyor.
 *
 * Ağaç tek yapıda ve istenildiği kadar derinleşiyor. Bir düğüm hem seçenek
 * (ad) hem de kendi alt seçeneklerinin sorusudur (soru) — "donanım" ve "soru"
 * için ayrı tablolar iki seviyeyle sınırlı kalıyordu, oysa teknik işlerde
 * Dolap › Şarküteri › Kapak gibi kırılımlar var.
 *
 * Sağdaki önizleme mobil ekranın aynısını yürütüyor: akış kaydedilmeden önce
 * tarayıcıda denenebilsin. Telefonda denemek için yayın almak, küçük bir
 * yazım hatasını bile pahalı hâle getiriyordu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Tree,
  Typography,
  message,
} from "antd";
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Image as ImageSimge,
  ListPlus,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { api } from "../api";
import { RENK } from "../sabitler";

/* -------------------------------------------------------------------------- */

interface Adim {
  id: number;
  ustId: number | null;
  ad: string;
  soru: string | null;
  ipucu: string | null;
  coklu: boolean;
  cihazTuru: string | null;
  aciklamaIster: boolean;
  aciklamaZorunlu: boolean;
  gorselIster: boolean;
  gorselZorunlu: boolean;
  oncelik: string | null;
  aktif: boolean;
  sira: number;
  kullanim: number;
  cocuklar: Adim[];
}

interface Tur {
  id: number;
  ad: string;
  soru: string | null;
  akisZorunlu: boolean;
  aktif: boolean;
  cihazTurleri: string | null;
  adimSayisi: number;
}

interface Veri {
  turler: Tur[];
  cihazTurleri: string[];
  tur: Tur | null;
  soru: string;
  adimlar: Adim[];
}

const ONCELIKLER = [
  { value: "dusuk", label: "Düşük" },
  { value: "orta", label: "Orta" },
  { value: "yuksek", label: "Yüksek" },
  { value: "acil", label: "Acil" },
];

const oncelikAdi = (kod: string | null) =>
  ONCELIKLER.find((o) => o.value === kod)?.label ?? kod;

/** Ağacı düz listeye açar; arama ve üst adım seçimi için gerekiyor. */
const duzlestir = (adimlar: Adim[], derinlik = 0): { adim: Adim; derinlik: number }[] =>
  adimlar.flatMap((a) => [
    { adim: a, derinlik },
    ...duzlestir(a.cocuklar ?? [], derinlik + 1),
  ]);

/* ========================================================================== */

export default function SoruAkisi({ baslangicTuru }: { baslangicTuru?: number | null }) {
  const [turId, setTurId] = useState<number | null>(baslangicTuru ?? null);

  /* Kategoriler sekmesinden "Akışı düzenle" ile gelindiğinde o tür
     seçili açılıyor: kullanıcı listeden aynı türü bir kez daha bulmak
     zorunda kalmasın. */
  useEffect(() => {
    if (baslangicTuru) setTurId(baslangicTuru);
  }, [baslangicTuru]);
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);

  const [duzenlenen, setDuzenlenen] = useState<Partial<Adim> & { ustId?: number | null } | null>(
    null,
  );

  /* Toplu ekleme penceresi hangi adımın altına ekliyor; null = ilk seviye */
  const [toplu, setToplu] = useState<{ ustId: number | null; ad: string } | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      const c = await api.getir<Veri>(`Yonetim/Akis?turId=${turId ?? 0}`);

      setVeri(c);

      /* İlk açılışta tür seçili değil: kullanıcı listeden seçene kadar
         boş ekran göstermek yerine adımı olan ilk türe düşülüyor. */
      if (!turId && c.turler?.length) {
        const ilk = c.turler.find((t) => t.adimSayisi > 0) ?? c.turler[0];
        if (ilk) setTurId(ilk.id);
      }
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Akış alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [turId]);

  useEffect(() => {
    getir();
  }, [getir]);

  const tur = veri?.tur ?? null;
  const adimlar = veri?.adimlar ?? [];

  const sil = async (id: number) => {
    try {
      const c = await api.sil<{ bilgi?: string; silinen?: number }>(`Yonetim/Adim/${id}`);
      message.success(c?.bilgi ?? "Adım kaldırıldı.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    }
  };

  const tasi = async (id: number, yon: "yukari" | "asagi") => {
    try {
      await api.gonder("Yonetim/AdimSira", { id, yon });
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Taşınamadı.");
    }
  };

  /* Ağaç düğümü: solda ad ve rozetler, sağda işlem düğmeleri. İşlemleri
     ayrı bir sütuna almak, derin ağaçta hangi satıra ait olduklarını
     belirsizleştiriyordu. */
  const dugum = (a: Adim, kardesler: Adim[], sira: number): any => ({
    key: a.id,
    title: (
      <div className="b3-akis-dugum">
        <div style={{ minWidth: 0 }}>
          <Space size={6} wrap>
            <Typography.Text
              strong
              delete={!a.aktif}
              type={a.aktif ? undefined : "secondary"}
            >
              {a.ad}
            </Typography.Text>

            {a.coklu && <Tag color="purple">Çoklu</Tag>}
            {a.cihazTuru && <Tag color="blue">Cihaz: {a.cihazTuru}</Tag>}
            {a.oncelik && <Tag color="orange">{oncelikAdi(a.oncelik)}</Tag>}

            {(a.aciklamaIster || a.aciklamaZorunlu) && (
              <Tooltip title={a.aciklamaZorunlu ? "Açıklama zorunlu" : "Açıklama istenir"}>
                <Tag color={a.aciklamaZorunlu ? "red" : "default"}>
                  <MessageSquare size={11} style={{ verticalAlign: -1 }} />
                </Tag>
              </Tooltip>
            )}

            {(a.gorselIster || a.gorselZorunlu) && (
              <Tooltip title={a.gorselZorunlu ? "Fotoğraf zorunlu" : "Fotoğraf istenir"}>
                <Tag color={a.gorselZorunlu ? "red" : "default"}>
                  <ImageSimge size={11} style={{ verticalAlign: -1 }} />
                </Tag>
              </Tooltip>
            )}

            {!a.aktif && <Tag>Pasif</Tag>}
            {a.kullanim > 0 && <Tag color="green">{a.kullanim} kayıt</Tag>}
          </Space>

          {(a.soru || (a.cocuklar ?? []).length > 0) && (
            <div style={{ fontSize: 12, color: RENK.metinPasif, marginTop: 2 }}>
              {a.soru ?? "Soru yazılmadı — ekranda “Hangisi?” yazacak"}
            </div>
          )}
        </div>

        <Space size={0} className="b3-akis-islem">
          <Tooltip title="Alt seçenek ekle">
            <Button
              type="text"
              size="small"
              icon={<CornerDownRight size={14} strokeWidth={2} />}
              onClick={(e) => {
                e.stopPropagation();
                setDuzenlenen({ ustId: a.id, aktif: true });
              }}
            />
          </Tooltip>

          <Tooltip title="Alt seçenekleri liste hâlinde ekle">
            <Button
              type="text"
              size="small"
              icon={<ListPlus size={14} strokeWidth={2} />}
              onClick={(e) => {
                e.stopPropagation();
                setToplu({ ustId: a.id, ad: a.ad });
              }}
            />
          </Tooltip>

          <Tooltip title="Düzenle">
            <Button
              type="text"
              size="small"
              icon={<Pencil size={14} strokeWidth={2} />}
              onClick={(e) => {
                e.stopPropagation();
                setDuzenlenen(a);
              }}
            />
          </Tooltip>

          <Tooltip title="Yukarı">
            <Button
              type="text"
              size="small"
              disabled={sira === 0}
              icon={<ChevronUp size={14} strokeWidth={2} />}
              onClick={(e) => {
                e.stopPropagation();
                tasi(a.id, "yukari");
              }}
            />
          </Tooltip>

          <Tooltip title="Aşağı">
            <Button
              type="text"
              size="small"
              disabled={sira === kardesler.length - 1}
              icon={<ChevronDown size={14} strokeWidth={2} />}
              onClick={(e) => {
                e.stopPropagation();
                tasi(a.id, "asagi");
              }}
            />
          </Tooltip>

          <Popconfirm
            title="Adım kaldırılsın mı?"
            description="Altındaki seçenekler de kaldırılır. Kayıtlarda kullanılmışsa silinmez, pasife alınır."
            okText="Kaldır"
            cancelText="Vazgeç"
            onConfirm={() => sil(a.id)}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<Trash2 size={14} strokeWidth={2} />}
              onClick={(e) => e.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      </div>
    ),
    children: (a.cocuklar ?? []).map((c, i) => dugum(c, a.cocuklar ?? [], i)),
  });

  return (
    <>
      <style>{`
        .b3-akis-dugum {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
          padding: 2px 0;
        }
        .b3-akis-islem { opacity: 0; transition: opacity .12s; flex: none; }
        .b3-akis-dugum:hover .b3-akis-islem { opacity: 1; }
        .b3-akis-agac .ant-tree-node-content-wrapper { width: 100%; }
      `}</style>

      {hata && <Alert type="error" message={hata} showIcon style={{ marginBottom: 12 }} />}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap align="center">
          <Select
            style={{ width: 300 }}
            placeholder="Arıza türü seçiniz"
            value={turId ?? undefined}
            onChange={(d) => setTurId(d)}
            options={(veri?.turler ?? []).map((t) => ({
              value: t.id,
              label: `${t.ad}${t.aktif ? "" : " · pasif"} — ${t.adimSayisi} adım`,
            }))}
          />

          <Button
            type="primary"
            disabled={!turId}
            icon={<Plus size={16} strokeWidth={2} />}
            style={{ background: turId ? RENK.yesil : undefined }}
            onClick={() => setDuzenlenen({ ustId: null, aktif: true })}
          >
            Ana seçenek ekle
          </Button>

          <Button
            disabled={!turId}
            icon={<ListPlus size={16} strokeWidth={2} />}
            onClick={() => setToplu({ ustId: null, ad: "" })}
          >
            Liste hâlinde ekle
          </Button>

          <Typography.Text type="secondary">
            Adımlar istenildiği kadar derinleşebilir; her seçeneğin altına
            yenisi eklenebilir.
          </Typography.Text>
        </Space>
      </Card>

      {!turId ? (
        <Empty description="Akışını tanımlamak istediğiniz arıza türünü seçiniz." />
      ) : (
        <Row gutter={12}>
          <Col xs={24} lg={14}>
            <Card
              size="small"
              title="Adımlar"
              loading={yukleniyor}
              extra={
                <Tooltip title="Yenile">
                  <Button
                    type="text"
                    size="small"
                    icon={<RotateCcw size={14} strokeWidth={2} />}
                    onClick={getir}
                  />
                </Tooltip>
              }
            >
              {tur && (
                <TurAyari
                  tur={tur}
                  kaydedildi={getir}
                />
              )}

              {adimlar.length === 0 ? (
                <Empty
                  description={
                    <>
                      Bu tür için adım tanımlanmamış.
                      <br />
                      <Typography.Text type="secondary">
                        “Ana seçenek ekle” ile başlayınız: örneğin Fiş yazıcı,
                        Çekmece, Ekran.
                      </Typography.Text>
                    </>
                  }
                />
              ) : (
                <Tree
                  className="b3-akis-agac"
                  blockNode
                  selectable={false}
                  defaultExpandAll
                  treeData={adimlar.map((a, i) => dugum(a, adimlar, i))}
                />
              )}
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Onizleme soru={veri?.soru ?? "Hangisi?"} adimlar={adimlar} />
          </Col>
        </Row>
      )}

      {toplu && turId && (
        <TopluEkle
          turId={turId}
          ustId={toplu.ustId}
          ustAd={toplu.ad}
          kapat={() => setToplu(null)}
          kaydedildi={() => {
            setToplu(null);
            getir();
          }}
        />
      )}

      {duzenlenen && turId && (
        <AdimForm
          adim={duzenlenen}
          turId={turId}
          adimlar={adimlar}
          cihazTurleri={veri?.cihazTurleri ?? []}
          kapat={() => setDuzenlenen(null)}
          kaydedildi={(yenisi) => {
            /* "Kaydet ve yeni ekle": aynı seviyeye arka arkaya seçenek
               girilirken pencereyi her seferinde yeniden açmak, on
               seçenekli bir listeyi zahmetli hâle getiriyordu. */
            setDuzenlenen(yenisi ? { ustId: duzenlenen.ustId ?? null, aktif: true } : null);
            getir();
          }}
        />
      )}
    </>
  );
}

/* ========================================================================== */
/* Tür ayarı                                                                  */
/* ========================================================================== */

/**
 * Türün ilk sorusu ve akışın zorunluluğu.
 *
 * Kategori formundan ayrı: akış ekranından kategoriyi tümüyle göndermek,
 * burada görünmeyen SLA ve cihaz türü alanlarını boşaltıyordu.
 */
function TurAyari({ tur, kaydedildi }: { tur: Tur; kaydedildi: () => void }) {
  const [soru, setSoru] = useState(tur.soru ?? "");
  const [zorunlu, setZorunlu] = useState(tur.akisZorunlu);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    setSoru(tur.soru ?? "");
    setZorunlu(tur.akisZorunlu);
  }, [tur.id, tur.soru, tur.akisZorunlu]);

  const degisti = (soru ?? "") !== (tur.soru ?? "") || zorunlu !== tur.akisZorunlu;

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("Yonetim/AkisAyar", {
        turId: tur.id,
        soru: soru.trim() || null,
        akisZorunlu: zorunlu,
      });

      message.success("Akış ayarı kaydedildi.");
      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div
      style={{
        background: RENK.yesilAcik,
        border: `1px solid ${RENK.cizgi}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 12,
      }}
    >
      <Row gutter={8} align="middle">
        <Col flex="auto">
          <Input
            addonBefore="İlk soru"
            placeholder="Örn. Yazarkasada sorun nerede?"
            value={soru}
            onChange={(e) => setSoru(e.target.value)}
          />
        </Col>

        <Col flex="none">
          <Tooltip title="İşaretliyse personel akışı sonuna kadar tamamlamadan kaydı açamaz.">
            <Space size={6}>
              <Switch size="small" checked={zorunlu} onChange={setZorunlu} />
              <Typography.Text style={{ fontSize: 13 }}>Zorunlu</Typography.Text>
            </Space>
          </Tooltip>
        </Col>

        <Col flex="none">
          <Button
            type="primary"
            size="small"
            disabled={!degisti}
            loading={kaydediliyor}
            style={{ background: degisti ? RENK.yesil : undefined }}
            onClick={kaydet}
          >
            Kaydet
          </Button>
        </Col>
      </Row>
    </div>
  );
}

/* ========================================================================== */
/* Adım formu                                                                 */
/* ========================================================================== */

function AdimForm({
  adim,
  turId,
  adimlar,
  cihazTurleri,
  kapat,
  kaydedildi,
}: {
  adim: Partial<Adim> & { ustId?: number | null };
  turId: number;
  adimlar: Adim[];
  cihazTurleri: string[];
  kapat: () => void;
  kaydedildi: (yenisi: boolean) => void;
}) {
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const duz = useMemo(() => duzlestir(adimlar), [adimlar]);

  /* Kendisi ve altındakiler üst adım listesinde çıkmıyor: bir adımı kendi
     altına taşımak ağacı döngüye sokuyordu. Sunucu da denetliyor. */
  const yasak = useMemo(() => {
    if (!adim.id) return new Set<number>();

    const bul = (liste: Adim[]): Adim | null => {
      for (const a of liste) {
        if (a.id === adim.id) return a;
        const c = bul(a.cocuklar ?? []);
        if (c) return c;
      }
      return null;
    };

    const kendisi = bul(adimlar);
    const kume = new Set<number>();

    const gez = (a: Adim) => {
      kume.add(a.id);
      (a.cocuklar ?? []).forEach(gez);
    };

    if (kendisi) gez(kendisi);

    return kume;
  }, [adim.id, adimlar]);

  const kaydet = async (yenisi: boolean) => {
    try {
      const d = await form.validateFields();
      setKaydediliyor(true);

      await api.gonder("Yonetim/Adim", {
        id: adim.id ?? 0,
        turId,
        ustId: d.ustId ?? 0,
        ad: d.ad,
        soru: d.soru ?? null,
        ipucu: d.ipucu ?? null,
        coklu: !!d.coklu,
        cihazTuru: d.cihazTuru ?? null,
        aciklamaIster: !!d.aciklamaIster || !!d.aciklamaZorunlu,
        aciklamaZorunlu: !!d.aciklamaZorunlu,
        gorselIster: !!d.gorselIster || !!d.gorselZorunlu,
        gorselZorunlu: !!d.gorselZorunlu,
        oncelik: d.oncelik ?? null,
        aktif: d.aktif ?? true,
        sira: adim.sira ?? 0,
      });

      message.success("Adım kaydedildi.");

      if (yenisi) form.resetFields();

      kaydedildi(yenisi);
    } catch (h: any) {
      if (!h?.errorFields) message.error(h?.message ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      width={640}
      title={adim.id ? `Adım düzenle: ${adim.ad}` : "Yeni adım"}
      onCancel={kapat}
      footer={[
        <Button key="vazgec" onClick={kapat}>
          Vazgeç
        </Button>,
        !adim.id && (
          <Button key="yeni" loading={kaydediliyor} onClick={() => kaydet(true)}>
            Kaydet ve yenisini ekle
          </Button>
        ),
        <Button
          key="kaydet"
          type="primary"
          loading={kaydediliyor}
          style={{ background: RENK.yesil }}
          onClick={() => kaydet(false)}
        >
          Kaydet
        </Button>,
      ].filter(Boolean)}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ustId: adim.ustId ?? undefined,
          ad: adim.ad,
          soru: adim.soru,
          ipucu: adim.ipucu,
          coklu: adim.coklu ?? false,
          cihazTuru: adim.cihazTuru ?? undefined,
          aciklamaIster: adim.aciklamaIster ?? false,
          aciklamaZorunlu: adim.aciklamaZorunlu ?? false,
          gorselIster: adim.gorselIster ?? false,
          gorselZorunlu: adim.gorselZorunlu ?? false,
          oncelik: adim.oncelik ?? undefined,
          aktif: adim.aktif ?? true,
        }}
      >
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="ad"
              label="Seçenek metni"
              rules={[{ required: true, message: "Seçenek metnini giriniz." }]}
              extra="Personelin ekranda göreceği düğme: Fiş yazıcı, Şarküteri, Silik çıkarıyor…"
            >
              <Input placeholder="Örn. Fiş yazıcı" autoFocus />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              name="ustId"
              label="Üst adım"
              extra="Boş bırakılırsa akışın ilk seviyesinde çıkar."
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="İlk seviye"
                options={duz
                  .filter((x) => !yasak.has(x.adim.id))
                  .map((x) => ({
                    value: x.adim.id,
                    label: `${"— ".repeat(x.derinlik)}${x.adim.ad}`,
                  }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="soru"
          label="Alt seçenekler sorulurken yazacak soru"
          extra="Bu seçenek işaretlendikten sonra ekranda görünür. Alt seçeneği yoksa boş bırakınız."
        >
          <Input placeholder="Örn. Fiş yazıcınızda nasıl bir sorun yaşıyorsunuz?" />
        </Form.Item>

        <Form.Item name="ipucu" label="Yardım metni" extra="Sorunun altında küçük yazıyla çıkar.">
          <Input placeholder="Örn. Cihazın üzerindeki uyarı ışığına bakınız." />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="cihazTuru"
              label="Envanterden cihaz sor"
              extra="Seçilirse personelden kendi mağazasındaki bu türde bir cihazı seçmesi istenir."
            >
              <Select
                allowClear
                showSearch
                placeholder="Cihaz sorulmasın"
                options={cihazTurleri.map((t) => ({ value: t, label: t }))}
              />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              name="oncelik"
              label="Kaydın önceliği"
              extra="Boş bırakılırsa personelin seçtiği öncelik geçerli olur."
            >
              <Select allowClear placeholder="Değiştirme" options={ONCELIKLER} />
            </Form.Item>
          </Col>
        </Row>

        <Card size="small" title="Bu seçenek işaretlenince" style={{ marginBottom: 12 }}>
          <Space direction="vertical" size={6}>
            <Form.Item name="aciklamaIster" valuePropName="checked" noStyle>
              <Checkbox>Açıklama kutusu çıksın</Checkbox>
            </Form.Item>

            <Form.Item name="aciklamaZorunlu" valuePropName="checked" noStyle>
              <Checkbox>Açıklama zorunlu olsun</Checkbox>
            </Form.Item>

            <Form.Item name="gorselIster" valuePropName="checked" noStyle>
              <Checkbox>Fotoğraf istensin</Checkbox>
            </Form.Item>

            <Form.Item name="gorselZorunlu" valuePropName="checked" noStyle>
              <Checkbox>Fotoğraf zorunlu olsun</Checkbox>
            </Form.Item>
          </Space>

          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}
          >
            Zorunlu seçenekler kutuyu kendiliğinden açar; ikisini birden
            işaretlemeye gerek yok.
          </Typography.Paragraph>
        </Card>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="coklu"
              label="Alt seçenekler"
              valuePropName="checked"
              extra="Açıksa birden fazla seçenek işaretlenebilir; o adım akışın sonu olur."
            >
              <Switch checkedChildren="Çoklu seçim" unCheckedChildren="Tek seçim" />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              name="aktif"
              label="Durum"
              valuePropName="checked"
              extra="Pasif adımlar mobilde görünmez; geçmiş kayıtlar etkilenmez."
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
/* Toplu ekleme                                                               */
/* ========================================================================== */

/**
 * Aynı seviyeye satır satır seçenek ekler.
 *
 * Bir yazarkasanın donanımları ya da bir donanımın belirtileri onlarca satır
 * oluyordu ve her biri için pencere açıp kapamak tanım işini caydırıcı hâle
 * getiriyordu. Buraya liste yapıştırılıyor, ayrıntılı ayarlar (açıklama,
 * fotoğraf, öncelik) sonradan tek tek düzenleniyor.
 *
 * Ortak alt soru alanı, eklenen her seçeneğe aynı cümleyi yazıyor:
 * donanım başına tek tek yazılınca unutuluyordu.
 */
function TopluEkle({
  turId,
  ustId,
  ustAd,
  kapat,
  kaydedildi,
}: {
  turId: number;
  ustId: number | null;
  ustAd: string;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [metin, setMetin] = useState("");
  const [altSoru, setAltSoru] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const adlar = metin
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const kaydet = async () => {
    if (adlar.length === 0) return;

    setKaydediliyor(true);

    try {
      const c = await api.gonder<{ eklenen: number; atlanan: number }>(
        "Yonetim/AdimToplu",
        { turId, ustId: ustId ?? 0, adlar, altSoru: altSoru.trim() || null },
      );

      message.success(
        c.atlanan > 0
          ? `${c.eklenen} seçenek eklendi, ${c.atlanan} tanesi zaten vardı.`
          : `${c.eklenen} seçenek eklendi.`,
      );

      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eklenemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      width={560}
      title={ustId ? `“${ustAd}” altına seçenek ekle` : "İlk seviyeye seçenek ekle"}
      onCancel={kapat}
      onOk={kaydet}
      okText={adlar.length > 0 ? `${adlar.length} seçenek ekle` : "Ekle"}
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      okButtonProps={{ disabled: adlar.length === 0, style: { background: RENK.yesil } }}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Her satıra bir seçenek yazınız. Örneğin yazarkasa donanımları:
          Fiş yazıcı, Dokunmatik ekran, Çekmece, Barkod okuyucu, Terazi
          bağlantısı.
        </Typography.Text>

        <Input.TextArea
          rows={9}
          autoFocus
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          placeholder={"Fiş yazıcı\nDokunmatik ekran\nÇekmece\nBarkod okuyucu"}
        />

        <Input
          addonBefore="Ortak alt soru"
          value={altSoru}
          onChange={(e) => setAltSoru(e.target.value)}
          placeholder="Örn. Bu donanımda nasıl bir sorun yaşıyorsunuz?"
        />

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Alt soru, eklenen her seçeneğin altındaki adımlar sorulurken
          ekranda çıkar. Şimdi boş bırakıp sonradan da yazabilirsiniz.
        </Typography.Text>
      </Space>
    </Modal>
  );
}

/* ========================================================================== */
/* Önizleme                                                                   */
/* ========================================================================== */

/**
 * Mobil akışın tarayıcıdaki karşılığı.
 *
 * Akışı telefonda denemek için yayın almak gerekiyordu; küçük bir yazım
 * hatası bile pahalıya mal oluyordu. Burada tıklayarak sonuna kadar
 * gidilebiliyor ve altta kaydın başlığı olacak özet görünüyor.
 */
function Onizleme({ soru, adimlar }: { soru: string; adimlar: Adim[] }) {
  const [yol, setYol] = useState<Adim[]>([]);

  useEffect(() => {
    setYol([]);
  }, [adimlar]);

  const son = yol[yol.length - 1] ?? null;

  const secenekler = (son ? son.cocuklar ?? [] : adimlar).filter((a) => a.aktif);

  const suSoru = son ? son.soru || "Hangisi?" : soru;

  const ozet = yol.map((a) => a.ad).join(" › ");

  return (
    <Card size="small" title="Mobilde nasıl sorulacak">
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        {yol.length > 0 && (
          <div>
            <Space size={4} wrap>
              <Button size="small" type="link" onClick={() => setYol([])}>
                Baştan
              </Button>

              <Typography.Text strong style={{ fontSize: 13 }}>
                {ozet}
              </Typography.Text>
            </Space>
          </div>
        )}

        {secenekler.length === 0 ? (
          <Alert
            type="success"
            showIcon
            message="Akış burada bitiyor"
            description={
              yol.length > 0 ? (
                <>
                  Kaydın başlığı şu olacak:
                  <br />
                  <Typography.Text code>{ozet}</Typography.Text>
                  {son?.aciklamaZorunlu && (
                    <div style={{ marginTop: 6 }}>Açıklama zorunlu tutulacak.</div>
                  )}
                  {son?.gorselZorunlu && <div>Fotoğraf zorunlu tutulacak.</div>}
                  {son?.cihazTuru && (
                    <div>Envanterden “{son.cihazTuru}” türünde cihaz sorulacak.</div>
                  )}
                </>
              ) : (
                "Bu tür için henüz seçenek eklenmemiş."
              )
            }
          />
        ) : (
          <>
            <Typography.Text strong>{suSoru}</Typography.Text>

            {son?.ipucu && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {son.ipucu}
              </Typography.Text>
            )}

            {son?.coklu && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Birden fazla seçilebilir; bu adım akışın sonu olur.
              </Typography.Text>
            )}

            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {secenekler.map((a) => (
                <Button
                  key={a.id}
                  block
                  style={{ textAlign: "left", height: "auto", padding: "7px 12px" }}
                  onClick={() => setYol((o) => [...o, a])}
                >
                  <Space size={6} wrap>
                    {a.ad}
                    {a.cihazTuru && <Tag color="blue">{a.cihazTuru}</Tag>}
                    {a.oncelik && <Tag color="orange">{oncelikAdi(a.oncelik)}</Tag>}
                  </Space>
                </Button>
              ))}
            </Space>
          </>
        )}
      </Space>
    </Card>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Eğitim Dokümanları
 * ---------------------------------------------------------------------------
 * İK ve Bilgi Teknolojileri'nin personele paylaştığı video, belge ve
 * bağlantılar.
 *
 * Bunlar şu ana kadar WhatsApp gruplarında dolaşıyordu: yeni gelen personel
 * hiçbirini görmüyor, eski paylaşımlar akışta kayboluyordu. Burada kalıcı
 * duruyor ve kimin açtığı görünüyor — "paylaştık" ile "okundu" ayrı şeyler.
 *
 * Hedef pozisyon boşsa herkese açık, doluysa yalnızca o ünvanlardakiler
 * görüyor. Kasiyere depo eğitimi göstermek listeyi kullanışsız yapıyordu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  ExternalLink,
  FileText,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  Video,
} from "lucide-react";

import { api } from "./api";
import { RENK } from "./sabitler";
import YardimVideolari from "./YardimVideolari";

const { Text } = Typography;

interface Egitim {
  id: number;
  baslik: string;
  aciklama: string | null;
  tur: string;
  bolum: string | null;
  ozgunAd: string | null;
  boyut: number;
  adres: string | null;
  pozisyonlar: string | null;
  zorunlu: boolean;
  aktif: boolean;
  yukleyen: string | null;
  olusturma: string;
  okuyan: number;
}

const TURLER: Record<string, { ad: string; renk: string }> = {
  video: { ad: "Video", renk: "orange" },
  belge: { ad: "Belge", renk: "blue" },
  baglanti: { ad: "Bağlantı", renk: "purple" },
};

const boyutYaz = (b: number) =>
  !b
    ? ""
    : b < 1024 * 1024
    ? `${Math.round(b / 1024)} KB`
    : `${(b / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;

/* ========================================================================== */

/**
 * Eğitim dokümanları ve uygulama yardım videoları aynı yerde: ikisi de
 * personelin uygulamayı ve işini öğrenmesi için.
 */
export default function Egitimler() {
  const [gorunum, setGorunum] = useState<"egitim" | "yardim">("egitim");

  return (
    <div className="ik-icerik">
      <Segmented
        style={{ marginBottom: 14 }}
        value={gorunum}
        onChange={(v) => setGorunum(v as "egitim" | "yardim")}
        options={[
          { value: "egitim", label: "Eğitim dokümanları" },
          { value: "yardim", label: "Uygulama yardım videoları" },
        ]}
      />
      {gorunum === "egitim" ? <EgitimListesi /> : <YardimVideolari />}
    </div>
  );
}

function EgitimListesi() {
  const { message } = AntdApp.useApp();

  const [egitimler, setEgitimler] = useState<Egitim[]>([]);
  const [pozisyonlar, setPozisyonlar] = useState<string[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [formAcik, setFormAcik] = useState(false);
  const [okuyanlar, setOkuyanlar] = useState<Egitim | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{ egitimler: Egitim[]; pozisyonlar: string[] }>(
        "/api/Egitim"
      );

      setEgitimler(c.egitimler ?? []);
      setPozisyonlar(c.pozisyonlar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Eğitimler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/Egitim/${id}`);
      message.success("Eğitim kaldırıldı.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    }
  };

  return (
    <div>
      <Space
        style={{ width: "100%", justifyContent: "space-between", marginBottom: 14 }}
        wrap
      >
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Paylaşılan doküman hedef ünvanlardaki personelin uygulamasında
          görünür ve bildirim gider. Ünvan seçilmezse herkese açılır.
        </Text>

        <Space>
          <Tooltip title="Yenile">
            <Button icon={<RotateCcw size={15} strokeWidth={2} />} onClick={getir} />
          </Tooltip>

          <Button
            type="primary"
            icon={<Plus size={15} strokeWidth={2} />}
            onClick={() => setFormAcik(true)}
          >
            Doküman ekle
          </Button>
        </Space>
      </Space>

      {egitimler.length === 0 && !yukleniyor ? (
        <Empty description="Henüz eğitim dokümanı paylaşılmadı." />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={egitimler}
          pagination={false}
          scroll={{ x: 900 }}
          rowClassName={(k: Egitim) => (k.aktif ? "" : "eg-pasif")}
          columns={[
            {
              title: "Doküman",
              dataIndex: "baslik",
              render: (b: string, k: Egitim) => (
                <div>
                  <Space size={6} wrap>
                    <Tag color={TURLER[k.tur]?.renk ?? "default"}>
                      {TURLER[k.tur]?.ad ?? k.tur}
                    </Tag>

                    <Text strong delete={!k.aktif}>
                      {b}
                    </Text>

                    {k.zorunlu && <Tag color="red">Zorunlu</Tag>}
                  </Space>

                  {k.aciklama && (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: RENK.metinPasif,
                        whiteSpace: "pre-wrap",
                        marginTop: 2,
                      }}
                    >
                      {k.aciklama}
                    </div>
                  )}

                  <div style={{ fontSize: 11.5, color: "#b0b4ba", marginTop: 3 }}>
                    {k.bolum ? `${k.bolum} · ` : ""}
                    {k.ozgunAd ?? k.adres}
                    {k.boyut ? ` · ${boyutYaz(k.boyut)}` : ""}
                  </div>
                </div>
              ),
            },
            {
              title: "Kimler görüyor",
              dataIndex: "pozisyonlar",
              width: 240,
              render: (p: string) => {
                const liste = (p ?? "").split(",").filter(Boolean);

                return liste.length === 0 ? (
                  <Tag color="green">Tüm pozisyonlar</Tag>
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
              title: "Açan",
              dataIndex: "okuyan",
              width: 120,
              align: "center",
              /* "Paylaştık" ile "okundu" ayrı şeyler; zorunlu eğitimlerde
                 kimin açtığını görmek gerekiyor. */
              render: (o: number, k: Egitim) => (
                <Button
                  type="link"
                  size="small"
                  icon={<Users size={14} strokeWidth={2} />}
                  onClick={() => setOkuyanlar(k)}
                >
                  {o}
                </Button>
              ),
            },
            {
              title: "Paylaşım",
              dataIndex: "olusturma",
              width: 150,
              render: (t: string, k: Egitim) => (
                <div style={{ fontSize: 12 }}>
                  <div>{dayjs(t).format("DD.MM.YYYY")}</div>
                  <div style={{ color: RENK.metinPasif }}>{k.yukleyen}</div>
                </div>
              ),
            },
            {
              title: "",
              width: 60,
              render: (_: unknown, k: Egitim) =>
                !k.aktif ? null : (
                  <Popconfirm
                    title="Doküman kaldırılsın mı?"
                    description="Personelin listesinden çıkar; dosya sunucuda kalır."
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
                ),
            },
          ]}
        />
      )}

      {formAcik && (
        <EgitimFormu
          pozisyonlar={pozisyonlar}
          kapat={() => setFormAcik(false)}
          eklendi={() => {
            setFormAcik(false);
            getir();
          }}
        />
      )}

      {okuyanlar && (
        <OkuyanlarPenceresi egitim={okuyanlar} kapat={() => setOkuyanlar(null)} />
      )}
    </div>
  );
}

/* ========================================================================== */

function EgitimFormu({
  pozisyonlar,
  kapat,
  eklendi,
}: {
  pozisyonlar: string[];
  kapat: () => void;
  eklendi: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [tur, setTur] = useState("belge");
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [bolum, setBolum] = useState("İnsan Kaynakları");
  const [adres, setAdres] = useState("");
  const [secili, setSecili] = useState<string[]>([]);
  const [zorunlu, setZorunlu] = useState(false);
  const [dosya, setDosya] = useState<File | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const baglantiMi = tur === "baglanti";

  const kaydet = async () => {
    if (!baslik.trim()) return message.warning("Başlık giriniz.");

    if (baglantiMi && !adres.trim())
      return message.warning("Bağlantı adresini giriniz.");

    if (!baglantiMi && !dosya) return message.warning("Dosya seçiniz.");

    setYukleniyor(true);

    const form = new FormData();

    form.append("baslik", baslik.trim());
    form.append("aciklama", aciklama.trim());
    form.append("tur", tur);
    form.append("bolum", bolum.trim());
    form.append("adres", baglantiMi ? adres.trim() : "");
    form.append("pozisyonlar", secili.join(","));
    form.append("zorunlu", String(zorunlu));

    if (dosya) form.append("dosya", dosya);

    try {
      await api.dosyaGonder("/api/Egitim", form);
      message.success("Doküman paylaşıldı, hedef personele bildirim gitti.");
      eklendi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Paylaşılamadı.");
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <Modal
      open
      width={600}
      title="Eğitim dokümanı paylaş"
      onCancel={kapat}
      onOk={kaydet}
      okText="Paylaş"
      cancelText="Vazgeç"
      confirmLoading={yukleniyor}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Segmented
          block
          value={tur}
          onChange={(d) => setTur(String(d))}
          options={[
            { value: "belge", label: "Belge", icon: <FileText size={14} /> },
            { value: "video", label: "Video", icon: <Video size={14} /> },
            {
              value: "baglanti",
              label: "Bağlantı",
              icon: <ExternalLink size={14} />,
            },
          ]}
        />

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Başlık
          </Text>
          <Input
            placeholder="Örn. Yeni kasa ekranı kullanımı"
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Açıklama
          </Text>
          <Input.TextArea
            rows={3}
            placeholder="Personelin ne öğreneceğini kısaca yazınız"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
          />
        </div>

        <Row gutter={12}>
          <Col xs={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Paylaşan bölüm
            </Text>
            <Select
              style={{ width: "100%" }}
              value={bolum}
              onChange={setBolum}
              options={[
                "İnsan Kaynakları",
                "Bilgi Teknolojileri",
                "Operasyon",
                "Kalite",
                "İş Güvenliği",
              ].map((b) => ({ value: b, label: b }))}
            />
          </Col>

          <Col xs={12} style={{ display: "flex", alignItems: "flex-end" }}>
            {/* Zorunlu eğitimler personelin listesinde başta duruyor ve
                açmadıkça uyarı görünüyor. */}
            <Checkbox
              checked={zorunlu}
              onChange={(e) => setZorunlu(e.target.checked)}
            >
              Zorunlu eğitim
            </Checkbox>
          </Col>
        </Row>

        {baglantiMi ? (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Bağlantı adresi
            </Text>
            <Input
              placeholder="https://..."
              value={adres}
              onChange={(e) => setAdres(e.target.value)}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              Video platformu, doküman bağlantısı ya da form adresi olabilir.
            </Text>
          </div>
        ) : (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Dosya
            </Text>
            <Input
              type="file"
              accept=".pdf,.mp4,.mov,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              onChange={(e) => setDosya(e.target.files?.[0] ?? null)}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              Video, PDF, resim, Word, Excel ve sunum · en fazla 500 MB
            </Text>
          </div>
        )}

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Kimler görsün
          </Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: "100%" }}
            placeholder="Boş bırakılırsa tüm pozisyonlar görür"
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
      </Space>
    </Modal>
  );
}

/* ========================================================================== */

function OkuyanlarPenceresi({
  egitim,
  kapat,
}: {
  egitim: Egitim;
  kapat: () => void;
}) {
  const [liste, setListe] = useState<
    { personelKodu: string; adSoyad: string | null; olusturma: string }[]
  >([]);
  const [yukleniyor, setYukleniyor] = useState(true);

  useEffect(() => {
    api
      .al<{ okuyanlar: any[] }>(`/api/Egitim/Okuyanlar/${egitim.id}`)
      .then((c) => setListe(c.okuyanlar ?? []))
      .catch(() => setListe([]))
      .finally(() => setYukleniyor(false));
  }, [egitim.id]);

  return (
    <Modal
      open
      width={520}
      title={`Açanlar — ${egitim.baslik}`}
      onCancel={kapat}
      footer={null}
    >
      {liste.length === 0 && !yukleniyor ? (
        <Empty description="Henüz kimse açmadı." />
      ) : (
        <Table
          rowKey="personelKodu"
          size="small"
          loading={yukleniyor}
          dataSource={liste}
          pagination={false}
          scroll={{ y: 380 }}
          columns={[
            {
              title: "Personel",
              dataIndex: "adSoyad",
              render: (a: string, k: any) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{a || "—"}</div>
                  <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                    {k.personelKodu}
                  </div>
                </div>
              ),
            },
            {
              title: "Açtığı zaman",
              dataIndex: "olusturma",
              width: 160,
              render: (t: string) => dayjs(t).format("DD.MM.YYYY HH:mm"),
            },
          ]}
        />
      )}
    </Modal>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Şube, Depo ve Mail Ayarları
 * ---------------------------------------------------------------------------
 * Fiyat ve stok sorgusu depo numarasıyla çalışıyor; şube açıldığında ya da
 * numara değiştiğinde yeni sürüm yayınlamak yerine burada tanımlanıyor.
 *
 * Mail ayarları da burada: yapılandırma dosyasına yazmak, her değişiklikte
 * sunucuya erişmek ve yayın betiğinin o dosyayı korumasıyla uğraşmak
 * demekti.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
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
  Typography,
  Tag,
  message,
} from "antd";
import {
  Download,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

import { api } from "../api";

const { Text, Paragraph } = Typography;

/* -------------------------------------------------------------------------- */

interface Sube {
  id: number;
  subeKodu: string;
  subeAdi: string | null;
  depoNo: number | null;
  eposta: string | null;
  aktif: boolean;
}

export default function SubeDepo() {
  return (
    <Tabs
      items={[
        { key: "sube", label: "Şube ve Depo", children: <SubeListesi /> },
        { key: "mail", label: "Mail Ayarları", children: <MailAyarlari /> },
      ]}
    />
  );
}

/* ========================================================================== */

function SubeListesi() {
  const [subeler, setSubeler] = useState<Sube[]>([]);
  const [depolar, setDepolar] = useState<{ no: number; ad: string }[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [duzenlenen, setDuzenlenen] = useState<Partial<Sube> | null>(null);

  /* Toplu işlem için seçilenler ve arama. Otuz dört şubeyi tek tek açıp
     kapatmak, sezonluk kapanan mağazalarda uzun bir işti. */
  const [secilenler, setSecilenler] = useState<number[]>([]);
  const [ara, setAra] = useState("");

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.getir<{ subeler: Sube[]; depolar: any[] }>("SubeDepo");

      setSubeler(c.subeler ?? []);
      setDepolar(c.depolar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Tanımlar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const kaydet = async (d: Partial<Sube>) => {
    try {
      await api.gonder("SubeDepo", d);
      message.success("Kaydedildi.");
      setDuzenlenen(null);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    }
  };

  const sil = async (id: number) => {
    try {
      await api.sil(`SubeDepo/${id}`);
      message.success("Silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  const iceAktar = async () => {
    try {
      const c = await api.gonder<{ eklenen: number; toplam: number }>(
        "SubeDepo/IceAktar",
        {}
      );

      message.success(
        `${c.eklenen} şube eklendi (${c.toplam} depo bulundu). Depo numaralarını ve e-posta adreslerini kontrol ediniz.`
      );

      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "İçe aktarılamadı.");
    }
  };

  const topluDurum = async (aktif: boolean) => {
    if (secilenler.length === 0) return;

    try {
      const c = await api.gonder<{ etkilenen: number }>("SubeDepo/TopluDurum", {
        idler: secilenler,
        aktif,
      });

      message.success(
        `${c.etkilenen} şube ${aktif ? "aktif" : "pasif"} duruma alındı.`
      );

      setSecilenler([]);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "İşlem tamamlanamadı.");
    }
  };

  const eksikDepo = subeler.filter((s) => s.aktif && !s.depoNo).length;

  /* Arama listeyi süzüyor ama seçimi bozmuyor: süzgeç değiştiğinde
     seçtiklerini kaybetmek can sıkıcı. */
  const gorunen = ara.trim()
    ? subeler.filter((s) =>
        `${s.subeAdi ?? ""} ${s.subeKodu}`
          .toLocaleLowerCase("tr")
          .includes(ara.toLocaleLowerCase("tr"))
      )
    : subeler;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {eksikDepo > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${eksikDepo} şubede depo numarası tanımlı değil`}
          description="Depo numarası olmayan şubede eldeki stok hesaplanamaz; fiyat yine görünür."
        />
      )}

      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Space wrap>
          <Input
            allowClear
            style={{ width: 200 }}
            placeholder="Şube ara"
            value={ara}
            onChange={(e) => setAra(e.target.value)}
          />

          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Depo numarası fiyat ve stok sorgusunun temel girdisi.
          </Text>
        </Space>

        <Space>
          <Button
            icon={<Download size={15} strokeWidth={2} />}
            onClick={iceAktar}
          >
            Mikro'dan içe aktar
          </Button>

          <Button
            type="primary"
            icon={<Plus size={15} strokeWidth={2} />}
            onClick={() => setDuzenlenen({ aktif: true })}
          >
            Şube ekle
          </Button>
        </Space>
      </Space>

      {/* Toplu işlem çubuğu yalnızca seçim varken: boşken duran bir çubuk,
          ne yapacağı belirsiz düğmelerle yer kaplıyordu. */}
      {secilenler.length > 0 && (
        <Alert
          type="info"
          message={
            <Space wrap>
              <Text strong>{secilenler.length} şube seçildi</Text>

              <Button size="small" onClick={() => topluDurum(true)}>
                Aktif yap
              </Button>

              <Popconfirm
                title={`${secilenler.length} şube pasife alınsın mı?`}
                description="Pasif şube fiyat sorgusunda seçilemez."
                okText="Pasife al"
                cancelText="Vazgeç"
                onConfirm={() => topluDurum(false)}
              >
                <Button size="small" danger>
                  Pasife al
                </Button>
              </Popconfirm>

              <Button size="small" type="text" onClick={() => setSecilenler([])}>
                Seçimi temizle
              </Button>
            </Space>
          }
        />
      )}

      {subeler.length === 0 && !yukleniyor ? (
        <Empty description="Tanımlı şube yok. Mikro'dan içe aktarabilirsiniz." />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={gorunen}
          pagination={false}
          rowSelection={{
            selectedRowKeys: secilenler,
            onChange: (k) => setSecilenler(k as number[]),
          }}
          columns={[
            {
              title: "Şube",
              dataIndex: "subeKodu",
              render: (k: string, s: Sube) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{s.subeAdi || k}</div>
                  {s.subeAdi && s.subeAdi !== k && (
                    <div style={{ fontSize: 12, color: "#8a9196" }}>{k}</div>
                  )}
                </div>
              ),
            },
            {
              title: "Depo no",
              dataIndex: "depoNo",
              width: 110,
              render: (d: number | null) =>
                d ? (
                  <Tag color="blue">{d}</Tag>
                ) : (
                  <Tag color="orange">tanımsız</Tag>
                ),
            },
            {
              title: "E-posta",
              dataIndex: "eposta",
              render: (e: string) => e || <Text type="secondary">—</Text>,
            },
            {
              title: "Durum",
              dataIndex: "aktif",
              width: 100,
              render: (a: boolean) =>
                a ? <Tag color="green">Aktif</Tag> : <Tag>Pasif</Tag>,
            },
            {
              title: "",
              width: 90,
              render: (_: unknown, s: Sube) => (
                <Space size={4}>
                  <Button
                    type="text"
                    size="small"
                    icon={<Pencil size={15} strokeWidth={2} />}
                    onClick={() => setDuzenlenen(s)}
                  />

                  <Popconfirm
                    title="Şube tanımı silinsin mi?"
                    okText="Sil"
                    cancelText="Vazgeç"
                    onConfirm={() => sil(s.id)}
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
      )}

      {duzenlenen && (
        <SubeFormu
          kayit={duzenlenen}
          depolar={depolar}
          kapat={() => setDuzenlenen(null)}
          kaydet={kaydet}
        />
      )}
    </Space>
  );
}

/* ========================================================================== */

function SubeFormu({
  kayit,
  depolar,
  kapat,
  kaydet,
}: {
  kayit: Partial<Sube>;
  depolar: { no: number; ad: string }[];
  kapat: () => void;
  kaydet: (d: Partial<Sube>) => void;
}) {
  const [d, setD] = useState<Partial<Sube>>(kayit);

  return (
    <Modal
      open
      title={kayit.id ? "Şube tanımı" : "Şube ekle"}
      onCancel={kapat}
      onOk={() => kaydet(d)}
      okText="Kaydet"
      cancelText="Vazgeç"
      width={520}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Şube kodu
          </Text>
          <Input
            value={d.subeKodu ?? ""}
            disabled={!!kayit.id}
            onChange={(e) => setD({ ...d, subeKodu: e.target.value })}
            placeholder="Mikro'daki depo adıyla aynı olmalı"
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Görünen ad
          </Text>
          <Input
            value={d.subeAdi ?? ""}
            onChange={(e) => setD({ ...d, subeAdi: e.target.value })}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Depo numarası
          </Text>

          {/* Listeden seçim: numarayı elle yazmak, yanlış depoya bağlanan
              bir şubeyi fark etmeyi zorlaştırıyordu. */}
          {depolar.length > 0 ? (
            <Select
              showSearch
              allowClear
              style={{ width: "100%" }}
              value={d.depoNo ?? undefined}
              onChange={(v) => setD({ ...d, depoNo: v ?? null })}
              placeholder="Mikro'daki depo"
              optionFilterProp="label"
              options={depolar.map((x) => ({
                value: x.no,
                label: `${x.no} · ${x.ad}`,
              }))}
            />
          ) : (
            <InputNumber
              style={{ width: "100%" }}
              value={d.depoNo ?? undefined}
              onChange={(v) => setD({ ...d, depoNo: v ?? null })}
            />
          )}
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            E-posta
          </Text>
          <Input
            value={d.eposta ?? ""}
            onChange={(e) => setD({ ...d, eposta: e.target.value })}
            placeholder="Etiket listesi ve servis formu bu adrese gider"
          />
        </div>

        <Space>
          <Switch
            checked={d.aktif !== false}
            onChange={(v) => setD({ ...d, aktif: v })}
          />
          <Text>Aktif</Text>
        </Space>
      </Space>
    </Modal>
  );
}

/* ========================================================================== */

function MailAyarlari() {
  const [d, setD] = useState<any>({});
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [denemeAdres, setDenemeAdres] = useState("");
  const [deneniyor, setDeneniyor] = useState(false);

  useEffect(() => {
    api
      .getir<any>("SubeDepo/Mail")
      .then(setD)
      .catch(() => setD({}))
      .finally(() => setYukleniyor(false));
  }, []);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("SubeDepo/Mail", d);
      message.success("Mail ayarları kaydedildi.");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  /* Hata metni ekranda kalıcı duruyor.

     Uçan bildirim birkaç saniyede kayboluyor ve SMTP hataları uzun
     oluyor: kullanıcı sebebi okuyamadan mesaj gidiyor, geriye "gitmiyor"
     izlenimi kalıyordu. */
  const [sonuc, setSonuc] = useState<{ iyi: boolean; metin: string } | null>(null);

  const dene = async () => {
    if (!denemeAdres.trim()) {
      message.warning("Deneme adresi giriniz.");
      return;
    }

    setDeneniyor(true);
    setSonuc(null);

    try {
      await api.gonder("SubeDepo/Mail/Deneme", { adres: denemeAdres.trim() });

      setSonuc({
        iyi: true,
        metin: `Deneme maili ${denemeAdres.trim()} adresine gönderildi.`,
      });
    } catch (h) {
      setSonuc({
        iyi: false,
        metin: h instanceof Error ? h.message : "Gönderilemedi.",
      });
    } finally {
      setDeneniyor(false);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Bu ayarlar teknik servis formu ve etiket listesi gönderiminde kullanılır"
        description={
          <span style={{ fontSize: 12.5 }}>
            Parola kaydedildikten sonra ekranda gösterilmez; boş bırakırsanız
            var olan parola korunur. Port <b>465</b> ise bağlantı baştan
            şifreli kurulur, <b>587</b> ise şifrelemeye sonradan geçilir —
            ikisinde de SSL açık kalmalıdır. Sağlayıcınızın verdiği portu
            olduğu gibi yazınız.
          </span>
        }
      />

      <Card size="small" loading={yukleniyor} title={<Space size={8}><Mail size={16} />Sunucu</Space>}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={16}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              SMTP sunucusu
            </Text>
            <Input
              value={d.sunucu ?? ""}
              onChange={(e) => setD({ ...d, sunucu: e.target.value })}
              placeholder="mail.bicen.com.tr"
            />
          </Col>

          <Col xs={12} md={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Port
            </Text>
            <Input
              value={d.port ?? ""}
              onChange={(e) => setD({ ...d, port: e.target.value })}
              placeholder="587"
            />
          </Col>

          <Col xs={12} md={4} style={{ display: "flex", alignItems: "flex-end" }}>
            <Space>
              <Switch
                checked={d.ssl !== false}
                onChange={(v) => setD({ ...d, ssl: v })}
              />
              <Text>SSL</Text>
            </Space>
          </Col>

          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Kullanıcı adı
            </Text>
            <Input
              value={d.kullanici ?? ""}
              onChange={(e) => setD({ ...d, kullanici: e.target.value })}
              placeholder="Boş bırakılırsa kimlik doğrulaması yapılmaz"
            />
          </Col>

          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Parola {d.parolaVar && <Tag color="green">kayıtlı</Tag>}
            </Text>
            <Input.Password
              value={d.parola ?? ""}
              onChange={(e) => setD({ ...d, parola: e.target.value })}
              placeholder={d.parolaVar ? "Değiştirmek için yazınız" : ""}
            />
          </Col>

          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Gönderen adı
            </Text>
            <Input
              value={d.gonderenAd ?? ""}
              onChange={(e) => setD({ ...d, gonderenAd: e.target.value })}
              placeholder="Biçen360"
            />
          </Col>

          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Gönderen adresi
            </Text>
            <Input
              value={d.gonderenAdres ?? ""}
              onChange={(e) => setD({ ...d, gonderenAdres: e.target.value })}
              placeholder="portal@bicen.com.tr"
            />
          </Col>

          <Col xs={24}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İmza (maillerin altına eklenir)
            </Text>
            <Input.TextArea
              rows={3}
              value={d.imza ?? ""}
              onChange={(e) => setD({ ...d, imza: e.target.value })}
              placeholder="Biçen Market · Bilgi Teknolojileri"
            />
          </Col>
        </Row>

        <Space style={{ marginTop: 14 }} wrap>
          <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
            Kaydet
          </Button>

          <Input
            style={{ width: 240 }}
            value={denemeAdres}
            onChange={(e) => setDenemeAdres(e.target.value)}
            placeholder="Deneme maili adresi"
          />

          <Button
            icon={<Send size={15} strokeWidth={2} />}
            loading={deneniyor}
            onClick={dene}
          >
            Deneme gönder
          </Button>
        </Space>

        {sonuc && (
          <Alert
            style={{ marginTop: 12 }}
            type={sonuc.iyi ? "success" : "error"}
            showIcon
            closable
            onClose={() => setSonuc(null)}
            message={sonuc.iyi ? "Gönderildi" : "Gönderilemedi"}
            description={
              <span style={{ fontSize: 12.5, wordBreak: "break-word" }}>
                {sonuc.metin}
              </span>
            }
          />
        )}
      </Card>

    </Space>
  );
}


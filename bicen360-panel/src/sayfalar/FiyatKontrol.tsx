/**
 * ---------------------------------------------------------------------------
 * Fiyat Kontrol
 * ---------------------------------------------------------------------------
 * Barkod okutulduğunda ürünün üç fiyatı, yer kodu ve şubedeki eldeki
 * stoğu gösterilir.
 *
 * Hangi şubenin sorgulandığı personelin kendi şubesinden gelir; merkez
 * ofisten sorgulayan bir kez şube seçer ve seçim değiştirilene kadar
 * saklanır. Her sorguda yeniden seçmek, otuz dört şube arasından her
 * seferinde arama yapmak demekti.
 *
 * Okutulan ürünler listeye biriktirilebilir ve barkodları şubeye mail
 * olarak gönderilebilir; şube bu listeden raf etiketi basıyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  Copy,
  Image as ImageSimge,
  ListPlus,
  Mail,
  Search,
  Trash2,
} from "lucide-react";

import { API_TABAN, api } from "../api";

const { Text, Title } = Typography;

/* -------------------------------------------------------------------------- */

const paraYaz = (d: number | null | undefined) =>
  d === null || d === undefined
    ? "—"
    : d.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

/* ========================================================================== */

/* Sayfa tek bir ekran: ürün görselleri Yönetim → Ürün Görselleri
   sekmesinde yönetiliyor ve burada ikinci bir sekme tutmak aynı işi iki
   yerde sunmak olurdu. */
export default function FiyatKontrol() {
  const [subeler, setSubeler] = useState<any[]>([]);
  const [secilen, setSecilen] = useState<string | undefined>();
  const [tanimliMi, setTanimliMi] = useState(true);

  const [listeAdlari, setListeAdlari] = useState<Record<number, string>>({});

  const [barkod, setBarkod] = useState("");
  const [sonuc, setSonuc] = useState<any>(null);
  const [sorguluyor, setSorguluyor] = useState(false);
  const [hata, setHata] = useState("");

  /* Okutulan ürünler: şubeye gönderilecek etiket listesi */
  const [liste, setListe] = useState<any[]>([]);
  const [mailAcik, setMailAcik] = useState(false);

  const girdiRef = useRef<any>(null);

  useEffect(() => {
    api
      .getir<any>("FiyatKontrol/Sube")
      .then((c) => {
        setSubeler(c.subeler ?? []);
        setSecilen(c.secilen ?? undefined);
        setTanimliMi(!!c.tanimliMi);
      })
      .catch(() => setTanimliMi(false));

    api
      .getir<any>("FiyatKontrol/Listeler")
      .then((c) => {
        const d: Record<number, string> = {};

        (c.listeler ?? []).forEach((x: any) => {
          d[x.sira] = x.ad;
        });

        setListeAdlari(d);
      })
      .catch(() => undefined);
  }, []);

  const subeSec = async (kod: string) => {
    setSecilen(kod);

    try {
      await api.gonder("FiyatKontrol/Sube", { subeKodu: kod });
      message.success("Şube seçildi.");

      /* Ekrandaki sonuç eski şubeye ait; yanıltmasın diye siliniyor. */
      setSonuc(null);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Şube seçilemedi.");
    }
  };

  const sorgula = useCallback(
    async (deger?: string) => {
      const hedef = (deger ?? barkod).trim();

      if (!hedef) return;

      setSorguluyor(true);
      setHata("");

      try {
        const c = await api.getir<any>(
          `FiyatKontrol/Sorgula?barkod=${encodeURIComponent(hedef)}&g=2`
        );

        setSonuc(c);
        setBarkod("");

        /* Odak girdide kalıyor: elde barkod okuyucuyla çalışan personel
           arka arkaya okutuyor ve her seferinde tıklamak zorunda
           kalıyordu. */
        setTimeout(() => girdiRef.current?.focus(), 50);
      } catch (h) {
        setSonuc(null);
        setHata(h instanceof Error ? h.message : "Sorgulanamadı.");
      } finally {
        setSorguluyor(false);
      }
    },
    [barkod]
  );

  const listeyeEkle = () => {
    if (!sonuc?.urun) return;

    const u = sonuc.urun;

    if (liste.some((x) => x.barkod === u.barkod)) {
      message.info("Bu ürün listede zaten var.");
      return;
    }

    setListe((o) => [
      ...o,
      {
        barkod: u.barkod,
        stokKodu: u.stokKodu,
        urunAdi: u.urunAdi,
        fiyat1: u.satisFiyati ?? u.fiyat1,
        fiyatTuru: u.fiyatTuru,
      },
    ]);

    message.success("Listeye eklendi.");
  };

  const u = sonuc?.urun;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {!tanimliMi && (
        <Alert
          type="warning"
          showIcon
          message="Şube tanımı yok"
          description="Yönetim → Şube ve Mail ekranından şubeleri ve depo numaralarını tanımlayınız. Depo numarası olmadan eldeki stok gösterilemez."
        />
      )}

      {/* ------------------------------------------------------- sorgu */}
      <Card size="small">
        <Row gutter={[10, 10]} align="middle">
          <Col xs={24} md={7}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Sorgulanan şube
            </Text>
            <Select
              style={{ width: "100%" }}
              showSearch
              optionFilterProp="label"
              placeholder="Şube seçiniz"
              value={secilen}
              onChange={subeSec}
              options={subeler.map((s) => ({
                value: s.subeKodu,
                label: `${s.subeAdi ?? s.subeKodu}${s.depoNo ? "" : " (depo yok)"}`,
              }))}
            />
          </Col>

          <Col xs={24} md={17}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Barkod
            </Text>
            <Space.Compact style={{ width: "100%" }}>
              <Input
                ref={girdiRef}
                size="large"
                autoFocus
                value={barkod}
                onChange={(e) => setBarkod(e.target.value)}
                onPressEnter={() => sorgula()}
                placeholder="Barkodu okutunuz ya da yazıp Enter'a basınız"
                prefix={<Search size={16} strokeWidth={2} color="#9aa3af" />}
              />

              <Button
                size="large"
                type="primary"
                loading={sorguluyor}
                onClick={() => sorgula()}
              >
                Sorgula
              </Button>
            </Space.Compact>
          </Col>
        </Row>
      </Card>

      {hata && <Alert type="error" showIcon message={hata} />}

      {/* ------------------------------------------------------- sonuç */}
      {u && (
        <Card size="small">
          <Row gutter={[16, 16]}>
            <Col xs={24} md={6}>
              <UrunGorseli
                stokKodu={u.stokKodu}
                gorselId={sonuc.gorselId}
                yenile={() => sorgula(u.barkod)}
              />
            </Col>

            <Col xs={24} md={18}>
              <Space size={8} wrap style={{ marginBottom: 6 }}>
                <Title level={4} style={{ margin: 0 }}>
                  {u.urunAdi}
                </Title>

                {u.pasif && <Tag color="red">Pasif ürün</Tag>}
                {u.satisDursun && <Tag color="orange">Satış durduruldu</Tag>}
              </Space>

              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {u.stokKodu} · {u.barkod} · {u.birim}
                {u.yerKodu ? ` · Yer: ${u.yerKodu}` : ""}
              </Text>

              <Row gutter={[12, 12]} style={{ marginTop: 14 }}>
                {/* Geçerli fiyat (09.10.2026): BiCard 0'dan büyükse BiCard,
                    değilse raf fiyatı. */}
                <Col xs={24} md={8}>
                  <Card size="small" className="fk-raf">
                    <Statistic
                      title={
                        <Space size={6}>
                          <span>Satış fiyatı</span>
                          <Tag color={u.fiyatTuru === "bicard" ? "green" : "default"} style={{ margin: 0 }}>
                            {u.fiyatTuru === "bicard"
                              ? listeAdlari[2] ?? "BiCard"
                              : listeAdlari[1] ?? "Raf"}
                          </Tag>
                        </Space>
                      }
                      value={paraYaz(u.satisFiyati ?? u.fiyat1)}
                      valueStyle={{ fontSize: 24, fontWeight: 800, color: "#5f8c10" }}
                    />
                  </Card>
                </Col>

                {[1, 2, 3].map((n) => (
                  <Col xs={12} md={4} key={n}>
                    <Card size="small">
                      <Statistic
                        title={listeAdlari[n] ?? `Fiyat ${n}`}
                        value={paraYaz(u[`fiyat${n}`])}
                        valueStyle={{ fontSize: 17, fontWeight: 600, color: "#1f2933" }}
                      />
                    </Card>
                  </Col>
                ))}

                <Col xs={12} md={4}>
                  <Card size="small">
                    <Statistic
                      title="Eldeki stok"
                      value={sonuc.stok ?? 0}
                      suffix={u.birim}
                      valueStyle={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: (sonuc.stok ?? 0) <= 0 ? "#cf1322" : "#1f2933",
                      }}
                    />
                  </Card>
                </Col>
              </Row>

              <Space style={{ marginTop: 14 }} wrap>
                <Button
                  type="primary"
                  icon={<ListPlus size={15} strokeWidth={2} />}
                  onClick={listeyeEkle}
                >
                  Etiket listesine ekle
                </Button>

                {u.sonFiyatTarihi && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Son fiyat değişikliği:{" "}
                    {new Date(u.sonFiyatTarihi).toLocaleDateString("tr-TR")}
                  </Text>
                )}
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {/* ------------------------------------------------------ liste */}
      <Card
        size="small"
        title={`Etiket listesi (${liste.length})`}
        extra={
          liste.length > 0 && (
            <Space>
              <Button
                size="small"
                icon={<Copy size={14} strokeWidth={2} />}
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(liste.map((x) => x.barkod).join("\n"))
                    .then(() => message.success("Barkodlar kopyalandı."))
                    .catch(() => message.error("Kopyalanamadı."));
                }}
              >
                Barkodları kopyala
              </Button>

              <Button
                size="small"
                type="primary"
                icon={<Mail size={14} strokeWidth={2} />}
                onClick={() => setMailAcik(true)}
              >
                Şubeye gönder
              </Button>

              <Button size="small" danger onClick={() => setListe([])}>
                Temizle
              </Button>
            </Space>
          )
        }
      >
        {liste.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Okuttuğunuz ürünleri buraya ekleyip şubeye gönderebilirsiniz."
          />
        ) : (
          <Table
            rowKey="barkod"
            size="small"
            dataSource={liste}
            pagination={false}
            columns={[
              { title: "Barkod", dataIndex: "barkod", width: 160 },
              { title: "Ürün", dataIndex: "urunAdi" },
              {
                title: "Satış fiyatı",
                dataIndex: "fiyat1",
                width: 150,
                align: "right",
                render: (d: number, k: any) => (
                  <>
                    {paraYaz(d)}
                    {k.fiyatTuru === "bicard" && (
                      <Tag color="green" style={{ marginLeft: 6, marginRight: 0 }}>
                        BiCard
                      </Tag>
                    )}
                  </>
                ),
              },
              {
                title: "",
                width: 50,
                render: (_: unknown, k: any) => (
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<Trash2 size={14} />}
                    onClick={() =>
                      setListe((o) => o.filter((x) => x.barkod !== k.barkod))
                    }
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      {mailAcik && (
        <MailPenceresi
          liste={liste}
          subeler={subeler}
          secilen={secilen}
          kapat={() => setMailAcik(false)}
          gonderildi={() => {
            setMailAcik(false);
            setListe([]);
          }}
        />
      )}
    </Space>
  );
}

/* ========================================================================== */

/**
 * Ürün görseli ve yükleme.
 *
 * Personel ürünü adından değil görüntüsünden tanıyor; etiketi doğru ürüne
 * takmak bununla kolaylaşıyor.
 */
function UrunGorseli({
  stokKodu,
  gorselId,
  yenile,
}: {
  stokKodu: string;
  gorselId: number | null;
  yenile: () => void;
}) {
  const [yukleniyor, setYukleniyor] = useState(false);

  const yukle = async (dosya: File) => {
    setYukleniyor(true);

    const form = new FormData();

    form.append("stokKodu", stokKodu);
    form.append("dosya", dosya);

    try {
      await api.dosyaGonder("FiyatKontrol/Gorsel", form);
      message.success("Görsel yüklendi.");
      yenile();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <div>
      <div className="fk-gorsel">
        {gorselId ? (
          <img
            src={`${API_TABAN}/api/FiyatKontrol/Gorsel/${gorselId}`}
            alt={stokKodu}
          />
        ) : (
          <ImageSimge size={32} strokeWidth={1.4} color="#c2c8cf" />
        )}
      </div>

      <input
          type="file"
          className="dosya-secici"
        accept=".jpg,.jpeg,.png,.webp"
        disabled={yukleniyor}
        style={{ marginTop: 8 }}
        onChange={(e) => {
          const d = e.target.files?.[0];

          e.target.value = "";

          if (d) yukle(d);
        }}
      />
    </div>
  );
}

/* ========================================================================== */

function MailPenceresi({
  liste,
  subeler,
  secilen,
  kapat,
  gonderildi,
}: {
  liste: any[];
  subeler: any[];
  secilen?: string;
  kapat: () => void;
  gonderildi: () => void;
}) {
  const sube = subeler.find((s) => s.subeKodu === secilen);

  const [adres, setAdres] = useState(sube?.eposta ?? "");
  const [not, setNot] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const gonder = async () => {
    if (!adres.trim()) return message.warning("Adres giriniz.");

    setGonderiliyor(true);

    try {
      await api.gonder("FiyatKontrol/ListeGonder", {
        adres: adres.trim(),
        subeKodu: secilen,
        not: not.trim() || null,
        barkodlar: liste.map((x) => x.barkod),
      });

      message.success("Liste gönderildi.");
      gonderildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      open
      title="Etiket listesini şubeye gönder"
      onCancel={kapat}
      onOk={gonder}
      okText="Gönder"
      cancelText="Vazgeç"
      confirmLoading={gonderiliyor}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Adres
          </Text>
          <Input
            value={adres}
            onChange={(e) => setAdres(e.target.value)}
            placeholder="magaza@bicen.com.tr"
          />

          {!sube?.eposta && (
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              Bu şubenin adresi tanımlı değil. Yönetim → Şube ve Mail
              ekranından girerseniz bir dahakine hazır gelir.
            </Text>
          )}
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Not
          </Text>
          <Input.TextArea
            rows={2}
            value={not}
            onChange={(e) => setNot(e.target.value)}
            placeholder="İsteğe bağlı"
          />
        </div>

        <Text type="secondary" style={{ fontSize: 12 }}>
          {liste.length} barkod gönderilecek; mailde alt alta liste hâlinde
          yer alır.
        </Text>
      </Space>
    </Modal>
  );
}

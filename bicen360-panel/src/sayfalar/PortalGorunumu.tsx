/**
 * ---------------------------------------------------------------------------
 * Portal Görünümü
 * ---------------------------------------------------------------------------
 * Karşılama sayfasının içeriği: logo, kapak, slaytlar, duyurular, sistem
 * özellikleri ve iletişim bilgileri.
 *
 * Metin ve görselleri koda gömmek, her duyuru değişikliğinde yeni sürüm
 * yayınlamak demekti. Burada girilen her şey karşılama sayfasında anında
 * görünüyor.
 *
 * Kaydetme yalnızca değişen alanları gönderiyor: bütün ayarı yazmak, bir
 * bölümden kaydeden kullanıcının diğerini silmesine yol açardı.
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
  Popconfirm,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  Boxes,
  ClipboardCheck,
  Headphones,
  Image as ImageSimge,
  Plus,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";

import { API_TABAN, api } from "../api";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */

interface Gorsel {
  id: number;
  tur: string;
  baslik: string | null;
  aciklama: string | null;
  bag: string | null;
  sira: number;
  aktif: boolean;
  ozgunAd: string | null;
}

interface Duyuru {
  baslik: string;
  metin: string;
  tarih?: string;
}

interface Ozellik {
  baslik: string;
  metin: string;
  simge?: string;
}

const SIMGE_SECENEKLERI = [
  { value: "ariza", label: "Arıza / teknik", simge: Wrench },
  { value: "envanter", label: "Envanter", simge: Boxes },
  { value: "destek", label: "Destek", simge: Headphones },
  { value: "kontrol", label: "Kontrol listesi", simge: ClipboardCheck },
];

const gorselAdresi = (id: number) => `${API_TABAN}/api/Portal/Gorsel/${id}`;

/** JSON metnini güvenle çözer; bozuk kayıt ekranı kilitlememeli */
const coz = <T,>(ham: string | undefined, varsayilan: T): T => {
  try {
    return ham ? (JSON.parse(ham) as T) : varsayilan;
  } catch {
    return varsayilan;
  }
};

/* ========================================================================== */

export default function PortalGorunumu() {
  const [ayarlar, setAyarlar] = useState<Record<string, string>>({});
  const [gorseller, setGorseller] = useState<Gorsel[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.getir<{
        ayarlar: Record<string, string>;
        gorseller: Gorsel[];
      }>("Portal/Ayarlar");

      setAyarlar(c.ayarlar ?? {});
      setGorseller(c.gorseller ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Ayarlar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const yaz = (anahtar: string, deger: string) =>
    setAyarlar((o) => ({ ...o, [anahtar]: deger }));

  const kaydet = async (anahtarlar: string[]) => {
    setKaydediliyor(true);

    try {
      const gonderilecek: Record<string, string> = {};

      anahtarlar.forEach((a) => {
        gonderilecek[a] = ayarlar[a] ?? "";
      });

      await api.gonder("Portal/Ayarlar", gonderilecek);
      message.success("Kaydedildi.");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const gorselYukle = async (
    tur: string,
    dosya: File,
    ek?: { baslik?: string; aciklama?: string; bag?: string }
  ) => {
    const form = new FormData();

    form.append("tur", tur);
    form.append("dosya", dosya);
    form.append("baslik", ek?.baslik ?? "");
    form.append("aciklama", ek?.aciklama ?? "");
    form.append("bag", ek?.bag ?? "");

    try {
      await api.dosyaGonder("Portal/Gorsel", form);
      message.success("Görsel yüklendi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yüklenemedi.");
    }
  };

  const gorselSil = async (id: number) => {
    try {
      await api.sil(`Portal/Gorsel/${id}`);
      message.success("Görsel silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  const tekGorsel = (tur: string) =>
    gorseller.find((g) => g.tur === tur && g.aktif);

  const slaytlar = gorseller.filter((g) => g.tur === "slayt");

  const duyurular = coz<Duyuru[]>(ayarlar.duyurular, []);
  const ozellikler = coz<Ozellik[]>(ayarlar.ozellikler, []);

  return (
    <Tabs
      items={[
        /* ------------------------------------------------------- kapak */
        {
          key: "kapak",
          label: "Kapak ve logo",
          children: (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                message="Buradaki içerik oturum açmadan herkese görünür"
                description="Karşılama sayfası portalın adresini bilen herkese açıktır. Kuruma özel bilgileri buraya yazmayınız."
              />

              <Row gutter={[14, 14]}>
                <Col xs={24} md={12}>
                  <GorselKart
                    ad="Logo"
                    aciklama="Üst çubukta görünür. Geniş ve saydam zeminli bir dosya en iyi sonucu verir."
                    gorsel={tekGorsel("logo")}
                    yukle={(d) => gorselYukle("logo", d)}
                    sil={gorselSil}
                  />
                </Col>

                <Col xs={24} md={12}>
                  <GorselKart
                    ad="Kapak görseli"
                    aciklama="Kapağın arkasında soluk olarak durur; üstündeki yazının okunması önceliklidir."
                    gorsel={tekGorsel("kapak")}
                    yukle={(d) => gorselYukle("kapak", d)}
                    sil={gorselSil}
                  />
                </Col>
              </Row>

              <Card size="small" title="Kapak yazıları">
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Başlık
                    </Text>
                    <Input
                      value={ayarlar.baslik ?? ""}
                      onChange={(e) => yaz("baslik", e.target.value)}
                      placeholder="Biçen360"
                    />
                  </div>

                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Alt başlık
                    </Text>
                    <Input
                      value={ayarlar.altBaslik ?? ""}
                      onChange={(e) => yaz("altBaslik", e.target.value)}
                      placeholder="Biçen Market kurum içi yönetim sistemi"
                    />
                  </div>

                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Açıklama
                    </Text>
                    <Input.TextArea
                      rows={3}
                      value={ayarlar.kapakYazisi ?? ""}
                      onChange={(e) => yaz("kapakYazisi", e.target.value)}
                      placeholder="Sistemin ne işe yaradığını iki üç cümleyle anlatınız."
                    />
                  </div>

                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Sayfa altı notu
                    </Text>
                    <Input
                      value={ayarlar.dipnot ?? ""}
                      onChange={(e) => yaz("dipnot", e.target.value)}
                      placeholder="© 2026 Biçen Market"
                    />
                  </div>

                  <Button
                    type="primary"
                    loading={kaydediliyor}
                    onClick={() =>
                      kaydet(["baslik", "altBaslik", "kapakYazisi", "dipnot"])
                    }
                  >
                    Kaydet
                  </Button>
                </Space>
              </Card>
            </Space>
          ),
        },

        /* ------------------------------------------------------ slaytlar */
        {
          key: "slayt",
          label: `Slaytlar (${slaytlar.length})`,
          children: (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Kapağın altında dönen görseller. Başlık ve açıklama
                yazarsanız görselin üstünde koyu bir şerit içinde görünür.
                Tek slayt varsa dönmez.
              </Text>

              <SlaytEkle yukle={(d, b, a) => gorselYukle("slayt", d, { baslik: b, aciklama: a })} />

              {slaytlar.length === 0 ? (
                <Empty description="Henüz slayt eklenmedi." />
              ) : (
                <Row gutter={[14, 14]}>
                  {slaytlar.map((g) => (
                    <Col xs={24} md={12} lg={8} key={g.id}>
                      <Card
                        size="small"
                        cover={
                          <img
                            src={gorselAdresi(g.id)}
                            alt={g.baslik ?? ""}
                            style={{ height: 150, objectFit: "cover" }}
                          />
                        }
                        actions={[
                          <Popconfirm
                            key="sil"
                            title="Slayt silinsin mi?"
                            okText="Sil"
                            cancelText="Vazgeç"
                            onConfirm={() => gorselSil(g.id)}
                          >
                            <Trash2 size={15} strokeWidth={2} />
                          </Popconfirm>,
                        ]}
                      >
                        <Card.Meta
                          title={g.baslik || "Başlıksız"}
                          description={g.aciklama || g.ozgunAd}
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </Space>
          ),
        },

        /* ----------------------------------------------------- duyurular */
        {
          key: "duyuru",
          label: `Duyurular (${duyurular.length})`,
          children: (
            <ListeDuzenle
              baslikAlan="Duyuru başlığı"
              metinAlan="Duyuru metni"
              tarihVar
              kayitlar={duyurular}
              degisti={(d) => yaz("duyurular", JSON.stringify(d))}
              kaydet={() => kaydet(["duyurular"])}
              kaydediliyor={kaydediliyor}
              bos="Henüz duyuru yok. Karşılama sayfasında duyuru bölümü hiç görünmez."
            />
          ),
        },

        /* ---------------------------------------------------- özellikler */
        {
          key: "ozellik",
          label: `Özellikler (${ozellikler.length})`,
          children: (
            <ListeDuzenle
              baslikAlan="Özellik adı"
              metinAlan="Kısa açıklama"
              simgeVar
              kayitlar={ozellikler}
              degisti={(d) => yaz("ozellikler", JSON.stringify(d))}
              kaydet={() => kaydet(["ozellikler"])}
              kaydediliyor={kaydediliyor}
              bos="Henüz özellik eklenmedi."
            />
          ),
        },

        /* ------------------------------------------------------ iletişim */
        {
          key: "iletisim",
          label: "İletişim",
          children: (
            <Card size="small" loading={yukleniyor}>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {[
                  { a: "adres", ad: "Adres", ipucu: "Merkez adresi" },
                  { a: "telefon", ad: "Telefon", ipucu: "(0212) 000 00 00" },
                  { a: "eposta", ad: "E-posta", ipucu: "bilgi@bicen.com.tr" },
                  { a: "web", ad: "Web", ipucu: "www.bicen.com.tr" },
                  {
                    a: "calismaSaati",
                    ad: "Çalışma saatleri",
                    ipucu: "Hafta içi 08:30 – 18:00",
                  },
                ].map((x) => (
                  <div key={x.a}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {x.ad}
                    </Text>
                    <Input
                      value={ayarlar[x.a] ?? ""}
                      onChange={(e) => yaz(x.a, e.target.value)}
                      placeholder={x.ipucu}
                    />
                  </div>
                ))}

                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  Boş bırakılan alan karşılama sayfasında hiç görünmez.
                </Text>

                <Button
                  type="primary"
                  loading={kaydediliyor}
                  onClick={() =>
                    kaydet(["adres", "telefon", "eposta", "web", "calismaSaati"])
                  }
                >
                  Kaydet
                </Button>
              </Space>
            </Card>
          ),
        },
      ]}
    />
  );
}

/* ========================================================================== */

function GorselKart({
  ad,
  aciklama,
  gorsel,
  yukle,
  sil,
}: {
  ad: string;
  aciklama: string;
  gorsel?: Gorsel;
  yukle: (d: File) => void;
  sil: (id: number) => void;
}) {
  return (
    <Card
      size="small"
      title={ad}
      extra={
        gorsel && (
          <Popconfirm
            title="Görsel silinsin mi?"
            okText="Sil"
            cancelText="Vazgeç"
            onConfirm={() => sil(gorsel.id)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        )
      }
    >
      <div
        style={{
          height: 120,
          background: "#f5f7f3",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          marginBottom: 10,
        }}
      >
        {gorsel ? (
          <img
            src={gorselAdresi(gorsel.id)}
            alt={ad}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : (
          <ImageSimge size={26} strokeWidth={1.6} color="#b0b4ba" />
        )}
      </div>

      <Text type="secondary" style={{ fontSize: 11.5, display: "block", marginBottom: 8 }}>
        {aciklama}
      </Text>

      {/* Antd Upload yerine düz dosya girdisi: bileşenin kendi yükleme
          akışı devreye girip isteği iki kez göndermeye çalışıyordu. */}
      <input
          type="file"
          className="dosya-secici"
        accept=".jpg,.jpeg,.png,.webp,.svg"
        onChange={(e) => {
          const d = e.target.files?.[0];

          e.target.value = "";

          if (d) yukle(d);
        }}
      />
    </Card>
  );
}

/* ========================================================================== */

function SlaytEkle({
  yukle,
}: {
  yukle: (d: File, baslik: string, aciklama: string) => void;
}) {
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");

  return (
    <Card size="small" title="Slayt ekle">
      <Row gutter={[10, 10]}>
        <Col xs={24} md={7}>
          <Input
            placeholder="Başlık (isteğe bağlı)"
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
          />
        </Col>

        <Col xs={24} md={10}>
          <Input
            placeholder="Açıklama (isteğe bağlı)"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
          />
        </Col>

        <Col xs={24} md={7}>
          <input
          type="file"
          className="dosya-secici"
            accept=".jpg,.jpeg,.png,.webp"
            onChange={(e) => {
              const d = e.target.files?.[0];

              e.target.value = "";

              if (!d) return;

              yukle(d, baslik.trim(), aciklama.trim());
              setBaslik("");
              setAciklama("");
            }}
          />
        </Col>
      </Row>
    </Card>
  );
}

/* ========================================================================== */

/**
 * Duyuru ve özellik listelerini düzenler.
 *
 * İkisi de "başlık + metin" yapısında; ayrı bileşen yazmak aynı düzeni
 * iki yerde ayrı ayrı güncellemek demekti.
 */
function ListeDuzenle({
  kayitlar,
  degisti,
  kaydet,
  kaydediliyor,
  baslikAlan,
  metinAlan,
  tarihVar,
  simgeVar,
  bos,
}: {
  kayitlar: any[];
  degisti: (d: any[]) => void;
  kaydet: () => void;
  kaydediliyor: boolean;
  baslikAlan: string;
  metinAlan: string;
  tarihVar?: boolean;
  simgeVar?: boolean;
  bos: string;
}) {
  const guncelle = (sira: number, alan: string, deger: string) =>
    degisti(kayitlar.map((k, i) => (i === sira ? { ...k, [alan]: deger } : k)));

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Button
          icon={<Plus size={15} strokeWidth={2} />}
          onClick={() => degisti([...kayitlar, { baslik: "", metin: "" }])}
        >
          Ekle
        </Button>

        <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
          Kaydet
        </Button>
      </Space>

      {kayitlar.length === 0 ? (
        <Empty description={bos} />
      ) : (
        kayitlar.map((k, sira) => (
          <Card
            key={sira}
            size="small"
            extra={
              <Button
                type="text"
                size="small"
                danger
                icon={<Trash2 size={14} strokeWidth={2} />}
                onClick={() => degisti(kayitlar.filter((_, i) => i !== sira))}
              />
            }
            title={`${sira + 1}.`}
          >
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <Row gutter={10}>
                <Col xs={24} md={tarihVar || simgeVar ? 16 : 24}>
                  <Input
                    placeholder={baslikAlan}
                    value={k.baslik ?? ""}
                    onChange={(e) => guncelle(sira, "baslik", e.target.value)}
                  />
                </Col>

                {tarihVar && (
                  <Col xs={24} md={8}>
                    <Input
                      placeholder="Tarih (ör. 12 Eylül 2026)"
                      value={k.tarih ?? ""}
                      onChange={(e) => guncelle(sira, "tarih", e.target.value)}
                    />
                  </Col>
                )}

                {simgeVar && (
                  <Col xs={24} md={8}>
                    <Select
                      style={{ width: "100%" }}
                      placeholder="Simge"
                      value={k.simge || undefined}
                      onChange={(d) => guncelle(sira, "simge", d)}
                      options={SIMGE_SECENEKLERI.map((x) => ({
                        value: x.value,
                        label: x.label,
                      }))}
                    />
                  </Col>
                )}
              </Row>

              <Input.TextArea
                rows={2}
                placeholder={metinAlan}
                value={k.metin ?? ""}
                onChange={(e) => guncelle(sira, "metin", e.target.value)}
              />
            </Space>
          </Card>
        ))
      )}
    </Space>
  );
}

/**
 * ---------------------------------------------------------------------------
 * Ücret Pusulaları
 * ---------------------------------------------------------------------------
 * Aylık bordroların personele iletilmesi ve onay takibi.
 *
 * Pusulalar eskiden elden ya da e-postayla veriliyordu; kimin aldığı, kimin
 * itirazı olduğu hiçbir yerde tutulmuyordu. Burada her pusulanın durumu
 * görünüyor: bekliyor, onaylandı ya da itiraz var.
 *
 * Onay imza yerine geçiyor. Personel yedi gün içinde işlem yapmazsa pusula
 * onaylanmış sayılıyor; bu kural personele yükleme anında bildiriliyor,
 * sessizce uygulanan bir varsayılan değil. Öyle onaylananlar listede
 * "süre doldu" notuyla ayrılıyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Progress,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  FileText,
  MessageSquareWarning,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import Tablo from "./Tablo";
import { RENK } from "./sabitler";
import Tahakkuk from "./Tahakkuk";
import { api } from "./api";
import { PersonelAdi } from "./personelKarti";

const { Text, Title } = Typography;

interface Pusula {
  id: number;
  personelKodu: string;
  adSoyad: string | null;
  donem: string;
  ozgunAd: string | null;
  boyut: number;
  durum: string;
  otomatik: boolean;
  sonGun: string | null;
  goruntuleme: string | null;
  onayTarihi: string | null;
  itirazSebebi: string | null;
  itirazMetni: string | null;
  itirazTarihi: string | null;
  itirazYanit: string | null;
  yukleyen: string | null;
  olusturma: string;
}

const DURUMLAR: Record<string, { ad: string; renk: string }> = {
  bekliyor: { ad: "Bekliyor", renk: "blue" },
  onaylandi: { ad: "Onaylandı", renk: "green" },
  itiraz: { ad: "İtiraz", renk: "volcano" },
};

/** "2026-09" → "Eylül 2026" */
const donemAdi = (d: string) =>
  d ? dayjs(`${d}-01`).locale("tr").format("MMMM YYYY") : "";

/* ========================================================================== */

/**
 * Tahakkuk sekmesi görünsün mü.
 *
 * Bölüm hazır ve çalışıyor ama şimdilik kullanılmıyor; sekmeyi ekranda
 * tutmak İK'yı henüz devreye alınmamış bir işe yönlendiriyordu. Açmak
 * için bu değeri `true` yapmak yeterli — kod, uç ve menü yetkisi
 * yerinde duruyor.
 */
const TAHAKKUK_GORUNSUN = false;

/**
 * Sayfa kabuğu.
 *
 * İki sekme aynı işin iki ucu: Tahakkuk bordroyu Mikro'dan üretiyor,
 * dağıtım onu personele iletip onayını topluyor. Ayrı menülerde
 * durduklarında kullanıcı hangisinden ne yapacağını karıştırıyordu.
 */
export default function Pusulalar() {
  /* Sayfa kendi kenar boşluğunu kuruyor: Content'in kendisinde boşluk yok
     ve sarmalayıcı unutulduğunda içerik sol menüye yapışıyordu. */
  return (
    <div className="ik-icerik">
      <Tabs
        items={[
          {
            key: "dagitim",
            label: "Personel Pusulaları",
            children: <Dagitim />,
          },
          {
            key: "toplu",
            label: "Toplu yükleme",
            children: <TopluYukleme />,
          },
          ...(TAHAKKUK_GORUNSUN
            ? [
                {
                  key: "tahakkuk",
                  label: "Tahakkuk · Makbuz üret",
                  children: <Tahakkuk />,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

/* ========================================================================== */

function Dagitim() {
  const { message } = AntdApp.useApp();

  const [pusulalar, setPusulalar] = useState<Pusula[]>([]);
  const [donemler, setDonemler] = useState<string[]>([]);
  const [onayGunu, setOnayGunu] = useState(7);

  const [donem, setDonem] = useState<string | undefined>();
  const [ara, setAra] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);

  const [formAcik, setFormAcik] = useState(false);
  const [yanitlanan, setYanitlanan] = useState<Pusula | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.al<{
        pusulalar: Pusula[];
        donemler: string[];
        onayGunu: number;
      }>(
        `/api/Pusula?donem=${encodeURIComponent(donem ?? "")}&ara=${encodeURIComponent(
          ara.trim()
        )}`
      );

      setPusulalar(c.pusulalar ?? []);
      setDonemler(c.donemler ?? []);

      if (c.onayGunu) setOnayGunu(c.onayGunu);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Pusulalar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [donem, ara, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Üst şerit: İK'nın bakması gereken tek sayı itirazlar, ama bekleyenin
     de görünmesi gerekiyor — dönem kapanmadan kimin işlem yapmadığı. */
  const ozet = useMemo(
    () => ({
      toplam: pusulalar.length,
      bekleyen: pusulalar.filter((x) => x.durum === "bekliyor").length,
      onaylanan: pusulalar.filter((x) => x.durum === "onaylandi").length,
      itiraz: pusulalar.filter((x) => x.durum === "itiraz").length,
      acilmayan: pusulalar.filter((x) => !x.goruntuleme).length,
    }),
    [pusulalar]
  );

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/Pusula/${id}`);
      message.success("Pusula kaldırıldı.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    }
  };

  return (
    <>
      <Row gutter={[12, 12]} className="rp-satir">
        <Kutu ad="Toplam" deger={ozet.toplam} />
        <Kutu ad="Bekliyor" deger={ozet.bekleyen} renk="#0958d9" />
        <Kutu ad="Onaylandı" deger={ozet.onaylanan} renk={RENK.yesilKoyu} />
        <Kutu ad="İtiraz" deger={ozet.itiraz} renk={RENK.turuncu} />
        <Kutu
          ad="Hiç açılmadı"
          deger={ozet.acilmayan}
          renk="#ad4e00"
          alt="pusulayı hiç açmayanlar"
        />
      </Row>

      <Card size="small" className="ik-filtre">
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <Select
              allowClear
              style={{ width: 190 }}
              placeholder="Tüm dönemler"
              value={donem}
              onChange={setDonem}
              options={donemler.map((d) => ({ value: d, label: donemAdi(d) }))}
            />

            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Ad ya da sicil"
              style={{ width: 230 }}
              value={ara}
              onChange={(e) => setAra(e.target.value)}
            />

            <Tooltip title="Yenile">
              <Button
                icon={<RotateCcw size={15} strokeWidth={2} />}
                onClick={getir}
              />
            </Tooltip>
          </Space>

          <Button
            type="primary"
            icon={<Upload size={15} strokeWidth={2} />}
            onClick={() => setFormAcik(true)}
          >
            Pusula yükle
          </Button>
        </Space>
      </Card>

      {ozet.itiraz > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${ozet.itiraz} pusulaya itiraz edildi`}
          description="İtirazı yanıtladığınızda pusula yeniden onay bekler duruma geçer ve personele bildirim gider."
        />
      )}

      {pusulalar.length === 0 && !yukleniyor ? (
        <Card>
          <Empty description="Bu süzgeçte pusula yok." />
        </Card>
      ) : (
        <Tablo
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={pusulalar}
          scroll={{ x: 1000 }}
          columns={[
            {
              title: "Personel",
              dataIndex: "adSoyad",
              width: 220,
              render: (a: string, k: Pusula) => (
                <div>
                  <div style={{ fontWeight: 500 }}><PersonelAdi kod={k.personelKodu}>{a || "—"}</PersonelAdi></div>
                  <div style={{ fontSize: 12, color: "#8a8f98" }}>
                    {k.personelKodu}
                  </div>
                </div>
              ),
            },
            {
              title: "Dönem",
              dataIndex: "donem",
              width: 130,
              render: (d: string) => donemAdi(d),
            },
            {
              title: "Durum",
              dataIndex: "durum",
              width: 200,
              render: (d: string, k: Pusula) => (
                <Space direction="vertical" size={2}>
                  <Space size={4}>
                    <Tag color={DURUMLAR[d]?.renk ?? "default"}>
                      {DURUMLAR[d]?.ad ?? d}
                    </Tag>

                    {/* Süre dolduğu için onaylananlar ayrılıyor: elle
                        onaylanmış bir pusulayla aynı görünmesi sonradan
                        çıkan bir uyuşmazlıkta yanıltıcı olurdu. */}
                    {k.otomatik && <Tag>süre doldu</Tag>}
                  </Space>

                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {d === "onaylandi" && k.onayTarihi
                      ? dayjs(k.onayTarihi).format("DD.MM.YYYY HH:mm")
                      : d === "itiraz" && k.itirazTarihi
                      ? dayjs(k.itirazTarihi).format("DD.MM.YYYY HH:mm")
                      : k.sonGun
                      ? `Son gün ${dayjs(k.sonGun).format("DD.MM.YYYY")}`
                      : ""}
                  </Text>
                </Space>
              ),
            },
            {
              title: "Açtı mı",
              dataIndex: "goruntuleme",
              width: 130,
              render: (g: string) =>
                g ? (
                  <Tooltip title={dayjs(g).format("DD.MM.YYYY HH:mm")}>
                    <Tag color="green">Açtı</Tag>
                  </Tooltip>
                ) : (
                  <Tooltip title="Personel pusulayı hiç açmamış.">
                    <Tag>Açmadı</Tag>
                  </Tooltip>
                ),
            },
            {
              title: "İtiraz",
              dataIndex: "itirazSebebi",
              width: 260,
              render: (i: string, k: Pusula) =>
                !i ? (
                  <span style={{ color: "#bbb" }}>—</span>
                ) : (
                  <div style={{ fontSize: 12.5 }}>
                    <div style={{ fontWeight: 500 }}>{i}</div>

                    {k.itirazMetni && (
                      <div style={{ color: "#8a8f98", whiteSpace: "pre-wrap" }}>
                        {k.itirazMetni}
                      </div>
                    )}

                    {k.itirazYanit && (
                      <div style={{ color: "#389e0d", marginTop: 3 }}>
                        Yanıtlandı: {k.itirazYanit}
                      </div>
                    )}
                  </div>
                ),
            },
            {
              title: "",
              width: 150,
              render: (_: unknown, k: Pusula) => (
                <Space size={0}>
                  <Tooltip title="Pusulayı aç">
                    <Button
                      type="text"
                      size="small"
                      icon={<FileText size={15} strokeWidth={2} />}
                      onClick={() =>
                        window.open(api.pusulaAdresi(k.id), "_blank", "noopener")
                      }
                    />
                  </Tooltip>

                  {k.durum === "itiraz" && (
                    <Tooltip title="İtirazı yanıtla">
                      <Button
                        type="text"
                        size="small"
                        icon={<MessageSquareWarning size={15} strokeWidth={2} />}
                        onClick={() => setYanitlanan(k)}
                      />
                    </Tooltip>
                  )}

                  <Popconfirm
                    title="Pusula kaldırılsın mı?"
                    description="Personel listesinden çıkar; dosya sunucuda kalır."
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
      )}

      <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 10 }}>
        Personel {onayGunu} gün içinde onaylamaz ya da itiraz etmezse pusula
        onaylanmış sayılır. Bu kural personele yükleme anında bildirilir.
      </Text>

      {formAcik && (
        <YuklemeFormu
          kapat={() => setFormAcik(false)}
          yuklendi={() => {
            setFormAcik(false);
            getir();
          }}
        />
      )}

      {yanitlanan && (
        <YanitFormu
          pusula={yanitlanan}
          kapat={() => setYanitlanan(null)}
          gonderildi={() => {
            setYanitlanan(null);
            getir();
          }}
        />
      )}
    </>
  );
}

/* ========================================================================== */

/** Panelin diğer ekranlarındaki özet kartıyla aynı desen. */
function Kutu({
  ad,
  deger,
  renk,
  alt,
}: {
  ad: string;
  deger: number;
  renk?: string;
  alt?: string;
}) {
  return (
    <Col xs={12} md={renk === undefined ? 4 : 5}>
      <Card size="small" className="rp-ozet">
        <div className="rp-ozet-baslik">{ad}</div>

        <div className="rp-ozet-deger" style={renk ? { color: renk } : undefined}>
          {deger}
        </div>

        {alt && <div className="rp-ozet-alt">{alt}</div>}
      </Card>
    </Col>
  );
}

/* ========================================================================== */

interface PersonelSecim {
  personelKodu: string;
  ad: string;
  soyad: string;
  kimlikNo: string | null;
  sube: string | null;
  pozisyon: string | null;
}

function YuklemeFormu({
  kapat,
  yuklendi,
}: {
  kapat: () => void;
  yuklendi: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [kod, setKod] = useState("");
  const [donem, setDonem] = useState(dayjs().subtract(1, "month").format("YYYY-MM"));
  const [dosya, setDosya] = useState<File | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  /* Personel listesi bir kez çekilip bellekte süzülüyor: her tuşta sunucuya
     sormak, Mikro sorgusunu binlerce kez tetikliyordu. */
  const [personeller, setPersoneller] = useState<PersonelSecim[]>([]);
  const [listeYukleniyor, setListeYukleniyor] = useState(true);

  const [listeHatasi, setListeHatasi] = useState("");

  useEffect(() => {
    /* Uç bir dizi değil, içinde sayımlar ve süzgeç seçenekleri de olan bir
       nesne döndürüyor; personeller onun bir alanında. */
    api
      .al<{ personeller: PersonelSecim[] }>("/api/Personel?durum=calisan")
      .then((c) => setPersoneller(c?.personeller ?? []))
      .catch((h) =>
        setListeHatasi(
          h instanceof Error ? h.message : "Personel listesi alınamadı."
        )
      )
      .finally(() => setListeYukleniyor(false));
  }, []);

  const secenekler = useMemo(
    () =>
      personeller.map((p) => {
        const ad = `${p.ad} ${p.soyad}`.trim();

        return {
          value: p.personelKodu,

          /* Arama ad, sicil ve kimlik numarası üzerinden yapılabilsin diye
             üçü de etikete giriyor; İK bazen yalnızca TC'yi biliyor. */
          label: `${ad} · ${p.personelKodu}${p.kimlikNo ? ` · ${p.kimlikNo}` : ""}`,

          /* Listede okunur hâli: kimlik numarası küçük yazıyla altta */
          gorunum: (
            <div>
              <div style={{ fontWeight: 500 }}>{ad}</div>
              <div style={{ fontSize: 12, color: "#8a8f98" }}>
                {p.personelKodu}
                {p.kimlikNo ? ` · ${p.kimlikNo}` : ""}
                {p.sube ? ` · ${p.sube}` : ""}
              </div>
            </div>
          ),
        };
      }),
    [personeller]
  );

  const secili = personeller.find((p) => p.personelKodu === kod);

  const kaydet = async () => {
    if (!kod.trim()) return message.warning("Personel seçiniz.");
    if (!dosya) return message.warning("PDF seçiniz.");

    setYukleniyor(true);

    const form = new FormData();

    form.append("kod", kod.trim());
    form.append("donem", donem);
    form.append("dosya", dosya);

    try {
      await api.dosyaGonder("/api/Pusula", form);
      message.success("Pusula yüklendi, personele bildirim gitti.");
      yuklendi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <Modal
      open
      title="Ücret pusulası yükle"
      onCancel={kapat}
      onOk={kaydet}
      okText="Yükle"
      cancelText="Vazgeç"
      confirmLoading={yukleniyor}
      width={480}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Personel
          </Text>

          <Select
            showSearch
            allowClear
            autoFocus
            style={{ width: "100%" }}
            loading={listeYukleniyor}
            placeholder="Ad soyad, sicil ya da T.C. kimlik numarası"
            value={kod || undefined}
            onChange={(d) => setKod(d ?? "")}
            optionFilterProp="label"
            /* Etikette üç alan da var; arama ad, sicil ve kimlik üzerinden
               çalışsın diye harf büyüklüğü yok sayılıyor. */
            filterOption={(girdi, secenek) =>
              (secenek?.label ?? "")
                .toLocaleLowerCase("tr")
                .includes(girdi.toLocaleLowerCase("tr"))
            }
            options={secenekler}
            optionRender={(secenek) =>
              (secenek.data as any)?.gorunum ?? secenek.label
            }
          />

          {secili && (
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {secili.pozisyon ?? ""}
              {secili.sube ? ` · ${secili.sube}` : ""}
            </Text>
          )}

          {/* Liste boş kaldığında sebebi görünmeli: kullanıcı personeli
              bulamadığında sorunun arama mı bağlantı mı olduğunu
              anlayamıyordu. */}
          {listeHatasi ? (
            <Text type="danger" style={{ fontSize: 11.5 }}>
              {listeHatasi}
            </Text>
          ) : !listeYukleniyor && personeller.length === 0 ? (
            <Text type="warning" style={{ fontSize: 11.5 }}>
              Personel listesi boş geldi. Mikro bağlantısını kontrol ediniz.
            </Text>
          ) : null}
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Dönem
          </Text>
          <Input
            placeholder="2026-09"
            value={donem}
            onChange={(e) => setDonem(e.target.value)}
          />
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            yyyy-aa biçiminde. Aynı döneme ikinci yükleme eskisinin yerine geçer.
          </Text>
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Pusula (PDF)
          </Text>
          <Input
            type="file"
            accept=".pdf"
            onChange={(e) => setDosya(e.target.files?.[0] ?? null)}
          />
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            Yalnızca PDF: telefonda açılabilmesi ve yazdırılabilmesi gerekiyor.
          </Text>
        </div>
      </Space>
    </Modal>
  );
}

/* ========================================================================== */

function YanitFormu({
  pusula,
  kapat,
  gonderildi,
}: {
  pusula: Pusula;
  kapat: () => void;
  gonderildi: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [yanit, setYanit] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const gonder = async () => {
    if (!yanit.trim()) return message.warning("Yanıt yazınız.");

    setGonderiliyor(true);

    try {
      await api.gonder(`/api/Pusula/ItirazYanit/${pusula.id}`, { yanit: yanit.trim() });
      message.success("Yanıt iletildi, pusula yeniden onay bekliyor.");
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
      title={`İtirazı yanıtla — ${pusula.adSoyad ?? pusula.personelKodu}`}
      onCancel={kapat}
      onOk={gonder}
      okText="Yanıtı gönder"
      cancelText="Vazgeç"
      confirmLoading={gonderiliyor}
      width={520}
    >
      <Card size="small" style={{ marginBottom: 12 }}>
        <Title level={5} style={{ marginTop: 0 }}>
          {pusula.itirazSebebi}
        </Title>

        <Text style={{ whiteSpace: "pre-wrap" }}>{pusula.itirazMetni}</Text>
      </Card>

      <Text type="secondary" style={{ fontSize: 12 }}>
        Yanıtınız personele bildirim olarak gider. Pusula yeniden onay bekler
        duruma geçer ve süre baştan başlar — personel açıklamanızı okumadan
        kaydın onaylanmış görünmesi, itirazın çözüldüğü anlamına gelmiyor.
      </Text>

      <Input.TextArea
        rows={4}
        style={{ marginTop: 8 }}
        value={yanit}
        onChange={(e) => setYanit(e.target.value)}
        placeholder="İncelenmiştir, fazla mesai eylül bordrosuna işlenmiştir…"
      />
    </Modal>
  );
}

/* ========================================================================== */
/* Toplu yükleme                                                              */
/* ========================================================================== */

/**
 * Şube şube ilerleyen toplu yükleme ekranı.
 *
 * Dokuz yüz kişilik bir dönemi tek tek pencere açarak yüklemek günler
 * sürerdi. Burada önce dönem ve şube seçiliyor, sonra o şubenin personeli
 * listeleniyor: kimin pusulası yüklenmiş, kimin eksik tek bakışta
 * görünüyor.
 *
 * Asıl hızlandıran, dosya adından eşleştirme: bordro programından çıkan
 * PDF'lerin adında sicil numarası geçiyor. Klasördeki bütün dosyalar bir
 * kerede seçiliyor, her biri adındaki sicile göre doğru personele
 * gidiyor.
 */
function TopluYukleme() {
  const { message } = AntdApp.useApp();

  const [donem, setDonem] = useState(dayjs().subtract(1, "month").format("YYYY-MM"));
  const [personeller, setPersoneller] = useState<PersonelSecim[]>([]);
  const [mevcut, setMevcut] = useState<Pusula[]>([]);
  const [sube, setSube] = useState<string | null>(null);
  const [ara, setAra] = useState("");

  const [yukleniyor, setYukleniyor] = useState(true);
  const [islem, setIslem] = useState<{ toplam: number; biten: number } | null>(null);
  const [sonuc, setSonuc] = useState<string[] | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const [p, d] = await Promise.all([
        api.al<{ personeller: PersonelSecim[] }>("/api/Personel?durum=calisan"),
        api.al<{ pusulalar: Pusula[] }>(
          `/api/Pusula?donem=${encodeURIComponent(donem)}`
        ),
      ]);

      setPersoneller(p?.personeller ?? []);
      setMevcut(d?.pusulalar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [donem, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Yüklenmiş pusulalar sicile göre: satırda "yüklendi mi" bunun üzerinden */
  const yuklenenler = useMemo(() => {
    const kume = new Map<string, Pusula>();

    mevcut.forEach((x) => kume.set((x.personelKodu ?? "").trim(), x));

    return kume;
  }, [mevcut]);

  /* Şube kartları: her şubede kaç kişi var, kaçının pusulası yüklenmiş */
  const subeler = useMemo(() => {
    const kume = new Map<string, { ad: string; kisi: number; yuklu: number }>();

    personeller.forEach((p) => {
      const ad = (p.sube ?? "").trim() || "Birimsiz";
      const kayit = kume.get(ad) ?? { ad, kisi: 0, yuklu: 0 };

      kayit.kisi += 1;

      if (yuklenenler.has((p.personelKodu ?? "").trim())) kayit.yuklu += 1;

      kume.set(ad, kayit);
    });

    return Array.from(kume.values()).sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
  }, [personeller, yuklenenler]);

  const satirlar = useMemo(() => {
    const k = ara.trim().toLocaleLowerCase("tr");

    return personeller
      .filter((p) => (sube ? ((p.sube ?? "").trim() || "Birimsiz") === sube : true))
      .filter((p) =>
        !k
          ? true
          : `${p.ad} ${p.soyad} ${p.personelKodu} ${p.kimlikNo ?? ""}`
              .toLocaleLowerCase("tr")
              .includes(k)
      )
      .map((p) => ({
        ...p,
        pusula: yuklenenler.get((p.personelKodu ?? "").trim()) ?? null,
      }));
  }, [personeller, sube, ara, yuklenenler]);

  /** Tek bir dosyayı belirli bir personele yükler. */
  const yukle = async (kod: string, dosya: File) => {
    const form = new FormData();

    form.append("kod", kod);
    form.append("donem", donem);
    form.append("dosya", dosya);

    await api.dosyaGonder("/api/Pusula", form);
  };

  /**
   * Çoklu dosya: her dosya adındaki sicile göre eşleştirilip sırayla
   * yükleniyor.
   *
   * Aynı anda göndermek yerine sırayla: dokuz yüz isteği paralel açmak
   * sunucuyu kilitliyor ve hangisinin başarısız olduğu kaybolıyordu.
   */
  const topluYukle = async (dosyalar: FileList) => {
    const liste = Array.from(dosyalar);

    if (liste.length === 0) return;

    const kodlar = personeller.map((p) => (p.personelKodu ?? "").trim());
    const raporlar: string[] = [];

    setIslem({ toplam: liste.length, biten: 0 });
    setSonuc(null);

    for (const [sira, dosya] of liste.entries()) {
      /* Dosya adındaki en uzun rakam dizisi sicil kabul ediliyor; bordro
         çıktısında ad genelde "14264_agustos.pdf" gibi. */
      const rakamlar = (dosya.name.match(/\d+/g) ?? []).sort(
        (a, b) => b.length - a.length
      );

      const kod = rakamlar.find((r) => kodlar.includes(r));

      if (!kod) {
        raporlar.push(`${dosya.name} · eşleşen personel bulunamadı`);
      } else {
        try {
          await yukle(kod, dosya);
        } catch (h) {
          raporlar.push(
            `${dosya.name} · ${h instanceof Error ? h.message : "yüklenemedi"}`
          );
        }
      }

      setIslem({ toplam: liste.length, biten: sira + 1 });
    }

    setIslem(null);
    setSonuc(raporlar);

    message.success(
      raporlar.length === 0
        ? `${liste.length} pusula yüklendi.`
        : `${liste.length - raporlar.length} pusula yüklendi, ${raporlar.length} dosya atlandı.`
    );

    getir();
  };

  const eksik = satirlar.filter((x) => !x.pusula).length;

  return (
    <>
      <Card size="small" className="ik-filtre">
        <Row gutter={[10, 10]} align="middle">
          <Col xs={24} md={5}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Dönem
            </Text>
            <Input
              value={donem}
              onChange={(e) => setDonem(e.target.value)}
              placeholder="2026-08"
            />
          </Col>

          <Col xs={24} md={7}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Klasördeki bütün pusulaları seçiniz
            </Text>

            {/* Dosya adındaki sicile göre eşleşiyor; tek tek pencere açmaya
                gerek kalmıyor. */}
            <Input
              type="file"
              accept=".pdf"
              multiple
              disabled={!!islem}
              onChange={(e) => {
                if (e.target.files) topluYukle(e.target.files);
                e.target.value = "";
              }}
            />
          </Col>

          <Col xs={24} md={7}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Personel ara
            </Text>
            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Ad, sicil ya da kimlik"
              value={ara}
              onChange={(e) => setAra(e.target.value)}
            />
          </Col>

          <Col xs={24} md={5} style={{ textAlign: "right" }}>
            <Button
              icon={<RotateCcw size={15} strokeWidth={2} />}
              onClick={getir}
              loading={yukleniyor}
            >
              Yenile
            </Button>
          </Col>
        </Row>

        {islem && (
          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Yükleniyor: {islem.biten}/{islem.toplam}
            </Text>
            <Progress
              percent={Math.round((islem.biten / islem.toplam) * 100)}
              strokeColor={RENK.yesil}
              size="small"
            />
          </div>
        )}
      </Card>

      {sonuc && sonuc.length > 0 && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setSonuc(null)}
          style={{ marginBottom: 12 }}
          message={`${sonuc.length} dosya yüklenemedi`}
          description={
            <div style={{ maxHeight: 160, overflowY: "auto", fontSize: 12.5 }}>
              {sonuc.map((x) => (
                <div key={x}>{x}</div>
              ))}
            </div>
          }
        />
      )}

      {/* ------------------------------------------------------- şubeler */}
      <Row gutter={[10, 10]} className="rp-satir">
        <Col xs={12} md={4}>
          <Card
            size="small"
            className="rp-ozet pu-sube"
            style={sube === null ? { borderColor: RENK.yesil } : undefined}
            onClick={() => setSube(null)}
          >
            <div className="rp-ozet-baslik">Tüm birimler</div>
            <div className="rp-ozet-deger">{personeller.length}</div>
            <div className="rp-ozet-alt">{yuklenenler.size} yüklendi</div>
          </Card>
        </Col>

        {subeler.map((x) => (
          <Col xs={12} md={4} key={x.ad}>
            <Card
              size="small"
              className="rp-ozet pu-sube"
              style={sube === x.ad ? { borderColor: RENK.yesil } : undefined}
              onClick={() => setSube(x.ad)}
            >
              <div className="rp-ozet-baslik" title={x.ad}>
                {x.ad}
              </div>

              <div
                className="rp-ozet-deger"
                style={{
                  color: x.yuklu === x.kisi ? RENK.yesilKoyu : RENK.metin,
                  fontSize: 20,
                }}
              >
                {x.yuklu}/{x.kisi}
              </div>

              <div className="rp-ozet-alt">
                {x.yuklu === x.kisi ? "tamam" : `${x.kisi - x.yuklu} eksik`}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ------------------------------------------------------ personel */}
      <Card
        size="small"
        title={
          <Space size={8}>
            <span>{sube ?? "Tüm birimler"}</span>
            <Tag color={eksik === 0 ? "green" : "orange"}>
              {eksik === 0 ? "Hepsi yüklendi" : `${eksik} eksik`}
            </Tag>
          </Space>
        }
      >
        <Tablo
          rowKey="personelKodu"
          size="small"
          loading={yukleniyor}
          dataSource={satirlar}
          scroll={{ x: 760 }}
          columns={[
            {
              title: "Personel",
              dataIndex: "ad",
              render: (_: unknown, k: any) => (
                <div>
                  <div style={{ fontWeight: 500 }}>
                    <PersonelAdi kod={k.personelKodu}>{k.ad} {k.soyad}</PersonelAdi>
                  </div>
                  <div style={{ fontSize: 12, color: RENK.metinPasif }}>
                    {k.personelKodu}
                    {k.kimlikNo ? ` · ${k.kimlikNo}` : ""}
                  </div>
                </div>
              ),
            },
            {
              title: "Birim",
              dataIndex: "sube",
              width: 180,
              ellipsis: true,
            },
            {
              title: "Durum",
              width: 200,
              render: (_: unknown, k: any) =>
                !k.pusula ? (
                  <Tag>Yüklenmedi</Tag>
                ) : (
                  <Space direction="vertical" size={2}>
                    <Tag color={DURUMLAR[k.pusula.durum]?.renk ?? "default"}>
                      {DURUMLAR[k.pusula.durum]?.ad ?? k.pusula.durum}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {dayjs(k.pusula.olusturma).format("DD.MM.YYYY HH:mm")}
                    </Text>
                  </Space>
                ),
            },
            {
              title: "",
              width: 230,
              render: (_: unknown, k: any) => (
                <Space size={6}>
                  {/* Tek kişilik yükleme: eksik kalan birkaç kişi için
                      bütün klasörü yeniden seçmeye gerek kalmasın. */}
                  <Input
                    type="file"
                    accept=".pdf"
                    size="small"
                    style={{ width: 150 }}
                    disabled={!!islem}
                    onChange={async (e) => {
                      const d = e.target.files?.[0];

                      e.target.value = "";

                      if (!d) return;

                      try {
                        await yukle(k.personelKodu, d);
                        message.success("Pusula yüklendi.");
                        getir();
                      } catch (h) {
                        message.error(
                          h instanceof Error ? h.message : "Yüklenemedi."
                        );
                      }
                    }}
                  />

                  {k.pusula && (
                    <Tooltip title="Pusulayı aç">
                      <Button
                        type="text"
                        size="small"
                        icon={<FileText size={15} strokeWidth={2} />}
                        onClick={() =>
                          window.open(
                            api.pusulaAdresi(k.pusula.id),
                            "_blank",
                            "noopener"
                          )
                        }
                      />
                    </Tooltip>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

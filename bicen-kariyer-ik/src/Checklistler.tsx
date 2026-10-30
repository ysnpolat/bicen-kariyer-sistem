/**
 * ---------------------------------------------------------------------------
 * Kontrol Listeleri
 * ---------------------------------------------------------------------------
 * İki sekme:
 *
 *  1. Listeler — tanımlı kontrol listeleri; yetkili roller yeni liste
 *     oluşturur, maddelerini düzenler, pasife alır.
 *  2. Doldurmalar — seçilen listenin seçilen gündeki doldurulma kayıtları;
 *     kim doldurdu, hangi mağaza, madde madde cevaplar, eklenen görseller
 *     ve panelden yazılan değerlendirme.
 *
 * Görseller sunucuda yedi gün duruyor. Süresi dolmuş kayıtlarda cevaplar
 * ve yorumlar görünmeye devam eder, yalnızca fotoğraf gider.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  ClipboardCheck,
  Copy,
  ImageOff,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  ClipboardPaste,
} from "lucide-react";

import { API_TABAN, api, oturumOku } from "./api";

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

/** Liste tanımlayabilen roller; sunucudaki yetkiyle aynı olmalı */
const TANIM_ROLLERI = [
  "Admin",
  "IKYoneticisi",
  "GenelMudurYardimcisi",
  "BolgeKoordinatoru",
  "BolgeMuduru",
];

const SIKLIKLAR = [
  { value: "gunluk", label: "Her gün" },
  { value: "haftalik", label: "Haftalık" },
  { value: "tek", label: "Tek seferlik" },
];

const CEVAP_ADI: Record<string, { ad: string; renk: string }> = {
  evet: { ad: "Evet", renk: "green" },
  hayir: { ad: "Hayır", renk: "red" },
  uygundegil: { ad: "Uygun değil", renk: "orange" },
};

export default function Checklistler() {
  const { message, modal } = AntdApp.useApp();
  const oturum = oturumOku();

  const yetkili = !!oturum && TANIM_ROLLERI.includes(oturum.rol);

  /* Bölge müdürü yalnızca kendi bölgesini görür; sunucu zaten diğer
     bölgeleri göndermiyor. Sıralama sütunu da gizlenir — elindeki veri
     tüm mağazaları kapsamadığı için "4 / 31" yanıltıcı olurdu. */
  const kendiBolgesi = oturum?.rol === "BolgeMuduru";

  const [sekme, setSekme] = useState("listeler");

  /* ------------------------------------------------------------ listeler */
  const [listeler, setListeler] = useState<any[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);

  /* Tanım penceresi */
  const [tanimAcik, setTanimAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<number>(0);
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Seçenekler: pozisyon ve şube listeleri sunucudan */
  const [pozisyonlar, setPozisyonlar] = useState<string[]>([]);

  /* Seçenekler alınamadığında sebebi gösteriliyor: liste sessizce boş
     kaldığında kullanıcı kendi tanımının eksik olduğunu sanıp yönetim
     ekranlarında arıyordu. */
  const [secenekUyarisi, setSecenekUyarisi] = useState("");

  /* Toplu madde ekleme penceresi */
  const [topluAcik, setTopluAcik] = useState(false);
  const [topluMetin, setTopluMetin] = useState("");
  const [subeler, setSubeler] = useState<string[]>([]);

  /* --------------------------------------------------------- doldurmalar */
  const [seciliListe, setSeciliListe] = useState<any>(null);
  const [gun, setGun] = useState<Dayjs>(dayjs());
  const [doldurmalar, setDoldurmalar] = useState<any[]>([]);
  const [doldurmaYukleniyor, setDoldurmaYukleniyor] = useState(false);

  /* Ayrıntı çekmecesi */
  const [ayrinti, setAyrinti] = useState<any>(null);
  const [ayrintiYukleniyor, setAyrintiYukleniyor] = useState(false);
  const [degerlendirme, setDegerlendirme] = useState("");

  /* Madde bazlı değerlendirme: maddeId → { puan, not } */
  const [maddePuan, setMaddePuan] = useState<Record<number, any>>({});

  const listeleriGetir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setListeler(await api.al<any[]>("/api/Checklist/Listeler?pasifDahil=true"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    listeleriGetir();
  }, [listeleriGetir]);

  /* Pozisyon ve şube seçenekleri; hedef kitle bunlardan seçiliyor */
  useEffect(() => {
    api
      .al<any>("/api/Checklist/Secenekler")
      .then((d) => {
        setPozisyonlar(d?.pozisyonlar ?? []);
        setSubeler(d?.subeler ?? []);
        setSecenekUyarisi(d?.uyari ?? "");
      })
      .catch((hata) => {
        /* Hata metni ekranda gösteriliyor.

           Önce sessizce yutuluyordu: liste boş kalınca kullanıcı kendi
           tanımının eksik olduğunu sanıyor, sebebi ancak tarayıcının ağ
           sekmesinden anlaşılıyordu. */
        setSecenekUyarisi(
          `Pozisyon ve şube seçenekleri yüklenemedi: ${
            hata instanceof Error ? hata.message : "bilinmeyen hata"
          }. Değerleri elle yazabilirsiniz.`
        );
      });
  }, []);

  const doldurmalariGetir = useCallback(async () => {
    if (!seciliListe) return;

    setDoldurmaYukleniyor(true);

    try {
      setDoldurmalar(
        await api.al<any[]>(
          `/api/Checklist/${seciliListe.id}/Doldurmalar?gun=${gun.format(
            "YYYY-MM-DD"
          )}`
        )
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDoldurmaYukleniyor(false);
    }
  }, [seciliListe, gun, message]);

  useEffect(() => {
    doldurmalariGetir();
  }, [doldurmalariGetir]);

  /* ------------------------------------------------------------- tanım */

  const yeniAc = () => {
    setDuzenlenen(0);

    form.setFieldsValue({
      baslik: "",
      aciklama: "",
      pozisyonlar: [],
      subeler: [],
      siklik: "gunluk",
      basSaat: null,
      bitSaat: null,
      aktif: true,
      maddeler: [{ soru: "", gorselZorunlu: false, yorumZorunlu: false }],
    });

    setTanimAcik(true);
  };

  /**
   * Listeyi maddeleriyle çoğaltır.
   *
   * Kopya pasif açılıyor ve hemen düzenlemeye giriliyor: düzenlenmeden
   * personele düşen bir kopya, aynı işin iki kez yapılmasına yol açardı.
   */
  const kopyala = async (k: any) => {
    try {
      const c = await api.gonder<{ id: number }>(
        `/api/Checklist/${k.id}/Kopyala`,
        {}
      );

      message.success("Liste çoğaltıldı, pasif olarak açıldı.");
      await getir();
      duzenleAc(c.id);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Çoğaltılamadı.");
    }
  };

  const duzenleAc = async (id: number) => {
    try {
      const d = await api.al<any>(`/api/Checklist/${id}`);

      setDuzenlenen(id);

      form.setFieldsValue({
        baslik: d.liste.baslik,
        aciklama: d.liste.aciklama ?? "",
        pozisyonlar: d.liste.pozisyonlar
          ? String(d.liste.pozisyonlar).split(",").map((x: string) => x.trim())
          : [],
        subeler: d.liste.subeler
          ? String(d.liste.subeler).split(",").map((x: string) => x.trim())
          : [],
        siklik: d.liste.siklik,
        basSaat: d.liste.basSaat,
        bitSaat: d.liste.bitSaat,
        aktif: d.liste.aktif,
        maddeler: (d.maddeler ?? []).map((m: any) => ({
          id: m.id,
          soru: m.soru,
          gorselZorunlu: m.gorselZorunlu,
          yorumZorunlu: m.yorumZorunlu,
        })),
      });

      setTanimAcik(true);
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const kaydet = async () => {
    const d = await form.validateFields();

    setKaydediliyor(true);

    try {
      await api.gonder("/api/Checklist/Kaydet", { id: duzenlenen, ...d });

      message.success(duzenlenen ? "Liste güncellendi." : "Liste oluşturuldu.");
      setTanimAcik(false);
      listeleriGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  /* -------------------------------------------------------- doldurma */

  const ayrintiAc = async (doldurmaId: number) => {
    setAyrintiYukleniyor(true);
    setAyrinti({ yukleniyor: true });

    try {
      const d = await api.al<any>(`/api/Checklist/Doldurma/${doldurmaId}`);

      setAyrinti(d);
      setDegerlendirme(d.kayit?.degerlendirme ?? "");

      const baslangic: Record<number, any> = {};

      (d.cevaplar ?? []).forEach((c: any) => {
        baslangic[c.maddeId] = {
          puan: c.puan ?? null,
          not: c.degerlendirme ?? "",
        };
      });

      setMaddePuan(baslangic);
    } catch (hata: any) {
      message.error(hata.message);
      setAyrinti(null);
    } finally {
      setAyrintiYukleniyor(false);
    }
  };

  /** Bir maddeyi personele iade eder; tekrar yapması istenir */
  const iadeEt = (c: any) => {
    let not = "";

    modal.confirm({
      title: "Tekrar yapılmasını iste",
      width: 480,
      content: (
        <div style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {c.soru}
          </Text>

          <TextArea
            rows={3}
            style={{ marginTop: 10 }}
            placeholder="Neyin düzeltilmesi gerekiyor? Personel bu notu görecek."
            onChange={(e) => {
              not = e.target.value;
            }}
          />
        </div>
      ),
      okText: "Gönder",
      cancelText: "Vazgeç",
      onOk: async () => {
        if (!not.trim()) {
          message.warning("Neyin düzeltilmesi gerektiğini yazınız.");
          throw new Error("bos");
        }

        await api.gonder(
          `/api/Checklist/Doldurma/${ayrinti.kayit.id}/Iade/${c.maddeId}`,
          { not }
        );

        message.success("Madde iade edildi, personele bildirildi.");
        ayrintiAc(ayrinti.kayit.id);
        doldurmalariGetir();
      },
    });
  };

  const degerlendir = async () => {
    try {
      await api.gonder(
        `/api/Checklist/Doldurma/${ayrinti.kayit.id}/Degerlendir`,
        {
          degerlendirme,
          maddeler: Object.entries(maddePuan).map(([id, v]: any) => ({
            maddeId: Number(id),
            puan: v.puan,
            degerlendirme: v.not,
          })),
        }
      );

      message.success("Değerlendirme kaydedildi.");
      setAyrinti(null);
      doldurmalariGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /* ------------------------------------------------------------ görünüm */

  /* Genel puan elle girilmez; madde puanlarının ortalamasıdır */
  const ortalamaPuan = (() => {
    const p = Object.values(maddePuan)
      .map((x: any) => x?.puan)
      .filter((x) => x !== null && x !== undefined);

    return p.length === 0
      ? null
      : Math.round(p.reduce((t: number, x: number) => t + x, 0) / p.length);
  })();

  const listeSutunlari = [
    {
      title: "Liste",
      dataIndex: "baslik",
      render: (v: string, k: any) => (
        <div>
          <Text strong>{v}</Text>
          {!k.aktif && (
            <Tag color="default" style={{ marginLeft: 8 }}>
              Pasif
            </Tag>
          )}
          {k.aciklama && (
            <div>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {k.aciklama}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Hedef",
      dataIndex: "pozisyonlar",
      width: 220,
      render: (v: string, k: any) => (
        <Space size={4} wrap>
          {v ? (
            String(v)
              .split(",")
              .map((x) => (
                <Tag key={x} color="blue">
                  {x.trim()}
                </Tag>
              ))
          ) : (
            <Tag>Tüm pozisyonlar</Tag>
          )}
          {k.subeler ? <Tag color="purple">şube sınırlı</Tag> : null}
        </Space>
      ),
    },
    {
      title: "Madde",
      dataIndex: "maddeSayisi",
      width: 80,
      align: "center" as const,
    },
    {
      title: "Bugün dolduran",
      dataIndex: "bugunDolduran",
      width: 130,
      align: "center" as const,
      render: (v: number) => <Badge count={v} showZero color="#52c41a" />,
    },
    {
      title: "",
      width: 250,
      render: (_: any, k: any) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setSeciliListe(k);
              setSekme("doldurmalar");
            }}
          >
            Doldurmalar
          </Button>

          {yetkili && (
            <>
              <Button size="small" type="link" onClick={() => duzenleAc(k.id)}>
                Düzenle
              </Button>

              {/* Benzer listeler sıfırdan yazılıyordu: kasap ve manav
                  listesi arasında üç madde fark varken yirmi madde
                  yeniden giriliyor, arada satır atlanıyordu. */}
              <Tooltip title="Maddeleriyle birlikte çoğalt">
                <Button
                  size="small"
                  type="link"
                  icon={<Copy size={14} strokeWidth={2} />}
                  onClick={() => kopyala(k)}
                />
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ];

  /* Kırılım üç kademeli: bölge → şube → personel. Tek düz liste 35
     mağazada okunmuyordu; bölge müdürü önce kendi bölgesine bakıyor. */
  const subeOzetleri = (() => {
    const harita = new Map<string, any[]>();

    doldurmalar.forEach((d) => {
      const ad = d.subeAdi || "Belirtilmemiş";

      if (!harita.has(ad)) harita.set(ad, []);
      harita.get(ad)!.push(d);
    });

    const ham = Array.from(harita.entries()).map(([sube, kisiler]) => {
      const puanlar = kisiler
        .map((k) => k.puan)
        .filter((p) => p !== null && p !== undefined);

      return {
        sube,
        bolge: kisiler[0]?.bolge ?? "Bölgesiz",
        kisiler,
        kisiSayisi: kisiler.length,
        tamamlanan: kisiler.filter((k) => k.tamamlandi).length,
        iadeSayisi: kisiler.reduce((t, k) => t + (k.iadeSayisi ?? 0), 0),
        gorselSayisi: kisiler.reduce((t, k) => t + (k.gorselSayisi ?? 0), 0),
        ortalama:
          puanlar.length === 0
            ? null
            : Math.round(
                puanlar.reduce((t: number, p: number) => t + p, 0) /
                  puanlar.length
              ),
      };
    });

    /* Sıralama tüm şubeler arasında; puanı olmayanlar sıraya girmez */
    const puanli = ham
      .filter((x) => x.ortalama !== null)
      .sort((a, b) => (b.ortalama ?? 0) - (a.ortalama ?? 0));

    return ham.map((x) => ({
      ...x,
      sira:
        x.ortalama === null
          ? null
          : puanli.findIndex((y) => y.sube === x.sube) + 1,
      toplamSube: puanli.length,
    }));
  })();

  const bolgeSatirlari = (() => {
    const harita = new Map<string, any[]>();

    subeOzetleri.forEach((x) => {
      if (!harita.has(x.bolge)) harita.set(x.bolge, []);
      harita.get(x.bolge)!.push(x);
    });

    return Array.from(harita.entries())
      .map(([bolge, subeler]) => {
        const puanlar = subeler
          .map((x) => x.ortalama)
          .filter((p) => p !== null);

        const kisi = subeler.reduce((t, x) => t + x.kisiSayisi, 0);
        const tamam = subeler.reduce((t, x) => t + x.tamamlanan, 0);

        return {
          bolge,
          subeler,
          subeSayisi: subeler.length,
          kisiSayisi: kisi,
          tamamlanan: tamam,
          oran: kisi === 0 ? 0 : Math.round((tamam / kisi) * 100),
          iadeSayisi: subeler.reduce((t, x) => t + x.iadeSayisi, 0),
          ortalama:
            puanlar.length === 0
              ? null
              : Math.round(
                  puanlar.reduce((t: number, p: number) => t + p, 0) /
                    puanlar.length
                ),
        };
      })
      .sort((a, b) => a.bolge.localeCompare(b.bolge, "tr"));
  })();

  const puanEtiketi = (v: number | null) =>
    v === null ? (
      <Text type="secondary">—</Text>
    ) : (
      <Space size={4}>
        <Star size={13} strokeWidth={2} color="#faad14" />
        <Text strong>{v}</Text>
      </Space>
    );

  const bolgeSutunlari = [
    {
      title: "Bölge",
      dataIndex: "bolge",
      render: (v: string, k: any) => (
        <div>
          <Text strong>{v}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {k.subeSayisi} mağaza
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: "Kontrol oranı",
      dataIndex: "oran",
      width: 190,
      render: (v: number, k: any) => (
        <Space direction="vertical" size={2} style={{ width: 150 }}>
          <Progress
            percent={v}
            size="small"
            strokeColor={v >= 80 ? "#52c41a" : v >= 50 ? "#faad14" : "#ff4d4f"}
          />
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            {k.tamamlanan} / {k.kisiSayisi} tamamlandı
          </Text>
        </Space>
      ),
    },
    {
      title: "İade",
      dataIndex: "iadeSayisi",
      width: 90,
      align: "center" as const,
      render: (v: number) =>
        v > 0 ? <Tag color="orange">{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: "Genel puan",
      dataIndex: "ortalama",
      width: 130,
      align: "center" as const,
      render: puanEtiketi,
    },
  ];

  const subeSutunlari = [
    { title: "Mağaza", dataIndex: "sube" },

    ...(kendiBolgesi
      ? []
      : [
          {
            title: "Sıra",
            dataIndex: "sira",
            width: 110,
            align: "center" as const,
            render: (v: number | null, k: any) =>
              v === null ? (
                <Text type="secondary">—</Text>
              ) : (
                <Tooltip title="Tüm mağazalar arasındaki sırası">
                  <Tag
                    color={
                      v <= 3 ? "green" : v > k.toplamSube - 3 ? "red" : "default"
                    }
                  >
                    {v} / {k.toplamSube}
                  </Tag>
                </Tooltip>
              ),
          },
        ]),
    {
      title: "Dolduran",
      dataIndex: "kisiSayisi",
      width: 120,
      align: "center" as const,
      render: (v: number, k: any) => (
        <Text>
          {k.tamamlanan} / {v}
        </Text>
      ),
    },
    {
      title: "Görsel",
      dataIndex: "gorselSayisi",
      width: 90,
      align: "center" as const,
    },
    {
      title: "Puan",
      dataIndex: "ortalama",
      width: 110,
      align: "center" as const,
      render: puanEtiketi,
    },
  ];

  const doldurmaSutunlari = [
    { title: "Personel", dataIndex: "adSoyad" },
    { title: "Görev", dataIndex: "gorev", width: 150 },
    {
      title: "İade",
      dataIndex: "iadeSayisi",
      width: 80,
      align: "center" as const,
      render: (v: number) =>
        v > 0 ? <Tag color="orange">{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: "Durum",
      dataIndex: "tamamlandi",
      width: 110,
      render: (v: boolean) =>
        v ? <Tag color="green">Tamam</Tag> : <Tag color="orange">Yarım</Tag>,
    },
    {
      title: "Görsel",
      dataIndex: "gorselSayisi",
      width: 90,
      align: "center" as const,
    },
    {
      title: "Puan",
      dataIndex: "puan",
      width: 90,
      align: "center" as const,
      render: (v: number | null) =>
        v === null || v === undefined ? (
          <Text type="secondary">—</Text>
        ) : (
          <Space size={4}>
            <Star size={13} strokeWidth={2} color="#faad14" />
            <Text strong>{v}</Text>
          </Space>
        ),
    },
    {
      title: "",
      width: 100,
      render: (_: any, k: any) => (
        <Button size="small" onClick={() => ayrintiAc(k.id)}>
          İncele
        </Button>
      ),
    },
  ];

  return (
    /* Sayfa kendi kenar boşluğunu kuruyor; sarmalayıcı unutulunca içerik
       sol menüye ve sağ kenara yapışıyordu. */
    <div className="ik-icerik">
      <Tabs
        activeKey={sekme}
        onChange={setSekme}
        tabBarExtraContent={
          sekme === "listeler" && yetkili ? (
            <Button
              type="primary"
              icon={<Plus size={15} strokeWidth={2} />}
              onClick={yeniAc}
            >
              Yeni liste
            </Button>
          ) : null
        }
        items={[
          {
            key: "listeler",
            label: (
              <Space size={6}>
                <ClipboardCheck size={15} strokeWidth={2} />
                Listeler
              </Space>
            ),
            children: (
              <Table
                rowKey="id"
                loading={yukleniyor}
                dataSource={listeler}
                columns={listeSutunlari}
                pagination={false}
                locale={{
                  emptyText: (
                    <Empty description="Henüz kontrol listesi tanımlanmamış." />
                  ),
                }}
              />
            ),
          },
          {
            key: "doldurmalar",
            label: "Doldurmalar",
            children: (
              <div>
                <Space wrap style={{ marginBottom: 14 }}>
                  <Select
                    value={seciliListe?.id}
                    onChange={(v) =>
                      setSeciliListe(listeler.find((x) => x.id === v) ?? null)
                    }
                    placeholder="Liste seçiniz"
                    style={{ width: 320 }}
                    options={listeler.map((x) => ({
                      value: x.id,
                      label: x.baslik,
                    }))}
                  />

                  <DatePicker
                    value={gun}
                    onChange={(d) => d && setGun(d)}
                    format="DD.MM.YYYY"
                    allowClear={false}
                  />

                  <Button onClick={() => setGun(dayjs())}>Bugün</Button>
                  <Button onClick={() => setGun(dayjs().subtract(1, "day"))}>
                    Dün
                  </Button>
                </Space>

                {!seciliListe ? (
                  <Empty description="Doldurmalarını görmek için bir liste seçiniz." />
                ) : (
                  <Table
                    rowKey="bolge"
                    loading={doldurmaYukleniyor}
                    dataSource={bolgeSatirlari}
                    columns={bolgeSutunlari}
                    pagination={false}
                    expandable={{
                      expandedRowRender: (b: any) => (
                        <Table
                          rowKey="sube"
                          size="small"
                          dataSource={b.subeler}
                          columns={subeSutunlari}
                          pagination={false}
                          expandable={{
                            expandedRowRender: (k: any) => (
                              <Table
                                rowKey="id"
                                size="small"
                                dataSource={k.kisiler}
                                columns={doldurmaSutunlari}
                                pagination={false}
                              />
                            ),
                          }}
                        />
                      ),
                    }}
                    locale={{
                      emptyText: (
                        <Empty description="Bu tarihte kimse doldurmamış." />
                      ),
                    }}
                  />
                )}
              </div>
            ),
          },
        ]}
      />

      {/* ===================================================== tanım penceresi */}
      <Modal
        open={tanimAcik}
        title={duzenlenen ? "Listeyi düzenle" : "Yeni kontrol listesi"}
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={kaydediliyor}
        onOk={kaydet}
        onCancel={() => setTanimAcik(false)}
        width={720}
        destroyOnClose
      >
        {secenekUyarisi && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={secenekUyarisi}
          />
        )}

        <Form form={form} layout="vertical">
          <Form.Item
            name="baslik"
            label="Başlık"
            rules={[{ required: true, message: "Başlık zorunludur." }]}
          >
            <Input placeholder="Günlük manav kontrolü" maxLength={200} />
          </Form.Item>

          <Form.Item name="aciklama" label="Açıklama">
            <TextArea
              rows={2}
              placeholder="Personelin ne yapması beklendiğini kısaca yazınız"
            />
          </Form.Item>

          <Space size="middle" wrap style={{ width: "100%" }}>
            <Form.Item
              name="pozisyonlar"
              label="Hedef pozisyonlar"
              tooltip="Boş bırakılırsa tüm pozisyonlar görür"
            >
              <Select
                mode="tags"
                style={{ width: 300 }}
                placeholder="Manav, Kasap…"
                options={pozisyonlar.map((x) => ({ value: x, label: x }))}
              />
            </Form.Item>

            <Form.Item
              name="subeler"
              label="Şube sınırı"
              tooltip="Boş bırakılırsa tüm şubeler"
            >
              <Select
                mode="tags"
                style={{ width: 300 }}
                placeholder="Tüm şubeler"
                options={subeler.map((x) => ({ value: x, label: x }))}
              />
            </Form.Item>
          </Space>

          <Space size="middle" wrap>
            <Form.Item name="siklik" label="Sıklık">
              <Select style={{ width: 160 }} options={SIKLIKLAR} />
            </Form.Item>

            <Form.Item
              name="basSaat"
              label="Başlangıç saati"
              tooltip="Boş bırakılırsa gün boyu doldurulabilir"
            >
              <InputNumber min={0} max={23} style={{ width: 130 }} placeholder="08" />
            </Form.Item>

            <Form.Item name="bitSaat" label="Bitiş saati">
              <InputNumber min={1} max={24} style={{ width: 130 }} placeholder="11" />
            </Form.Item>

            <Form.Item name="aktif" label="Aktif" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          {/* ------------------------------------------------------ maddeler */}
          <Title level={5} style={{ fontSize: 14, marginTop: 4 }}>
            Maddeler
          </Title>

          <Form.List name="maddeler">
            {(alanlar, { add, remove }) => (
              <>
                {alanlar.map((alan) => (
                  <Card
                    key={alan.key}
                    size="small"
                    style={{ marginBottom: 10 }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <Form.Item name={[alan.name, "id"]} hidden>
                      <Input />
                    </Form.Item>

                    <Form.Item
                      name={[alan.name, "soru"]}
                      rules={[{ required: true, message: "Soru zorunludur." }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder="Günlük manav sevkiyatı tezgâhlara dizildi mi?" />
                    </Form.Item>

                    <Space wrap>
                      <Form.Item
                        name={[alan.name, "gorselZorunlu"]}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Switch
                          size="small"
                          checkedChildren="Görsel zorunlu"
                          unCheckedChildren="Görsel isteğe bağlı"
                        />
                      </Form.Item>

                      <Form.Item
                        name={[alan.name, "yorumZorunlu"]}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Switch
                          size="small"
                          checkedChildren="Yorum zorunlu"
                          unCheckedChildren="Yorum isteğe bağlı"
                        />
                      </Form.Item>

                      <Tooltip title="Maddeyi kaldır">
                        <Button
                          size="small"
                          danger
                          type="text"
                          icon={<Trash2 size={14} strokeWidth={2} />}
                          onClick={() => remove(alan.name)}
                        />
                      </Tooltip>
                    </Space>
                  </Card>
                ))}

                <Space style={{ width: "100%" }} direction="vertical" size={8}>
                  <Button
                    block
                    icon={<Plus size={15} strokeWidth={2} />}
                    onClick={() =>
                      add({ soru: "", gorselZorunlu: false, yorumZorunlu: false })
                    }
                  >
                    Madde ekle
                  </Button>

                  {/* Toplu ekleme: on beş maddelik bir çek listesini tek tek
                      yazmak dakikalar sürüyordu. Hazır listeyi olduğu gibi
                      yapıştırmak, her satırı bir madde yapıyor. */}
                  <Button
                    block
                    type="dashed"
                    icon={<ClipboardPaste size={15} strokeWidth={2} />}
                    onClick={() => setTopluAcik(true)}
                  >
                    Listeyi yapıştırarak ekle
                  </Button>

                  <Modal
                    open={topluAcik}
                    title="Listeyi yapıştırarak ekle"
                    okText="Maddeleri ekle"
                    cancelText="Vazgeç"
                    onCancel={() => setTopluAcik(false)}
                    onOk={() => {
                      const satirlar = topluMetin
                        .split(/\r?\n/)
                        /* Baştaki numara ve işaretler atılıyor: hazır
                           listeler "1-", "1.", "•" gibi önekle geliyor ve
                           madde metnine karışması istenmiyor. */
                        .map((x) => x.replace(/^\s*(\d+\s*[-.)]|[-•*])\s*/, "").trim())
                        .filter((x) => x.length > 0);

                      if (satirlar.length === 0) {
                        message.warning("Eklenecek satır bulunamadı.");
                        return;
                      }

                      satirlar.forEach((soru) =>
                        add({ soru, gorselZorunlu: false, yorumZorunlu: false })
                      );

                      message.success(`${satirlar.length} madde eklendi.`);
                      setTopluMetin("");
                      setTopluAcik(false);
                    }}
                  >
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                      Her satır bir madde olur. Satır başındaki numaralar
                      (1-, 1., •) kendiliğinden ayıklanır. Görsel ve yorum
                      zorunluluğunu ekledikten sonra madde madde
                      ayarlayabilirsiniz.
                    </Typography.Paragraph>

                    <Input.TextArea
                      rows={12}
                      value={topluMetin}
                      onChange={(e) => setTopluMetin(e.target.value)}
                      placeholder={"1- Mağaza açılış saatine uyuldu mu?\n2- Personel kılık kıyafeti uygun mu?\n3- ..."}
                    />
                  </Modal>
                </Space>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* =================================================== ayrıntı çekmecesi */}
      <Drawer
        open={!!ayrinti}
        onClose={() => setAyrinti(null)}
        width="min(760px, 96vw)"
        title={
          ayrinti?.kayit ? (
            <Space size={8}>
              <ClipboardCheck size={16} strokeWidth={2} />
              <Text strong>{ayrinti.kayit.adSoyad}</Text>
              <Tag>{ayrinti.kayit.subeAdi}</Tag>
            </Space>
          ) : (
            "Doldurma"
          )
        }
      >
        {ayrintiYukleniyor ? (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <Spin />
          </div>
        ) : ayrinti?.kayit ? (
          <>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {ayrinti.kayit.baslik} ·{" "}
              {dayjs(ayrinti.kayit.gun).format("DD.MM.YYYY")} ·{" "}
              {ayrinti.kayit.gorev}
            </Text>

            {(ayrinti.cevaplar ?? []).map((c: any) => {
              const gorseller = (ayrinti.gorseller ?? []).filter(
                (g: any) => g.maddeId === c.maddeId
              );

              return (
                <Card
                  key={c.maddeId}
                  size="small"
                  style={{ marginTop: 12 }}
                  title={
                    <Space>
                      <Text strong style={{ fontSize: 13.5 }}>
                        {c.soru}
                      </Text>
                    </Space>
                  }
                  extra={
                    <Space size={6}>
                      {c.iade ? <Tag color="orange">İade edildi</Tag> : null}

                      {c.cevap ? (
                        <Tag color={CEVAP_ADI[c.cevap]?.renk ?? "default"}>
                          {CEVAP_ADI[c.cevap]?.ad ?? c.cevap}
                        </Tag>
                      ) : (
                        <Tag>Cevapsız</Tag>
                      )}

                      {yetkili && c.cevap && !c.iade ? (
                        <Tooltip title="Bu maddeyi tekrar yaptır">
                          <Button
                            size="small"
                            icon={<RotateCcw size={13} strokeWidth={2} />}
                            onClick={() => iadeEt(c)}
                          />
                        </Tooltip>
                      ) : null}
                    </Space>
                  }
                >
                  {c.iade ? (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 10 }}
                      message={`Tekrar isteniyor — ${c.iadeEden ?? ""}`}
                      description={c.iadeNotu}
                    />
                  ) : null}

                  {c.yorum ? (
                    <Paragraph style={{ fontSize: 13, marginBottom: 8 }}>
                      {c.yorum}
                    </Paragraph>
                  ) : null}

                  {gorseller.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Fotoğraf yok
                    </Text>
                  ) : (
                    <Space wrap>
                      {gorseller.map((g: any) =>
                        g.silindi ? (
                          <Tooltip
                            key={g.id}
                            title="Görsel yedi günlük süre dolduğu için silindi"
                          >
                            <div style={silinmisKutu}>
                              <ImageOff size={20} strokeWidth={1.6} />
                            </div>
                          </Tooltip>
                        ) : (
                          <Image
                            key={g.id}
                            width={92}
                            height={92}
                            style={{ objectFit: "cover", borderRadius: 8 }}
                            src={`${API_TABAN}/api/Checklist/Gorsel/${g.id}?t=${encodeURIComponent(
                              oturum?.token ?? ""
                            )}`}
                            alt="kontrol görseli"
                          />
                        )
                      )}
                    </Space>
                  )}
                  {/* --------------------------- madde değerlendirmesi */}
                  <div style={maddeDegerlendirmeKutu}>
                    <Space wrap style={{ width: "100%" }}>
                      <Text style={{ fontSize: 12.5 }}>Puan</Text>

                      <InputNumber
                        size="small"
                        min={0}
                        max={100}
                        value={maddePuan[c.maddeId]?.puan ?? null}
                        onChange={(v) =>
                          setMaddePuan((o) => ({
                            ...o,
                            [c.maddeId]: { ...(o[c.maddeId] ?? {}), puan: v },
                          }))
                        }
                        disabled={!yetkili || !c.cevap}
                      />

                      <Input
                        size="small"
                        style={{ width: 360 }}
                        placeholder="Bu maddeye ilişkin notunuz"
                        value={maddePuan[c.maddeId]?.not ?? ""}
                        onChange={(e) =>
                          setMaddePuan((o) => ({
                            ...o,
                            [c.maddeId]: {
                              ...(o[c.maddeId] ?? {}),
                              not: e.target.value,
                            },
                          }))
                        }
                        disabled={!yetkili || !c.cevap}
                      />
                    </Space>

                    {!c.cevap && (
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        Cevaplanmamış madde puanlanamaz.
                      </Text>
                    )}
                  </div>
                </Card>
              );
            })}

            {/* ------------------------------------------- değerlendirme */}
            <Card size="small" style={{ marginTop: 16 }} title="Genel değerlendirme">
              {!yetkili && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message="Değerlendirme yazma yetkiniz yok; mevcut değerlendirmeyi görebilirsiniz."
                />
              )}

              <Space direction="vertical" style={{ width: "100%" }}>
                <Space>
                  <Text>Ortalama puan</Text>
                  <Tag color="gold">{ortalamaPuan ?? "—"}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Maddelere verdiğiniz puanlardan hesaplanır
                  </Text>
                </Space>

                <TextArea
                  rows={3}
                  value={degerlendirme}
                  onChange={(e) => setDegerlendirme(e.target.value)}
                  disabled={!yetkili}
                  placeholder="Gözlemleriniz ve varsa personele iletilecek not"
                />

                {ayrinti.kayit.degerlendiren && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Son değerlendiren: {ayrinti.kayit.degerlendiren}
                  </Text>
                )}

                {yetkili && (
                  <Button type="primary" onClick={degerlendir}>
                    Değerlendirmeyi kaydet
                  </Button>
                )}
              </Space>
            </Card>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

const maddeDegerlendirmeKutu: React.CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px dashed #f0f0f0",
};

const silinmisKutu: React.CSSProperties = {
  width: 92,
  height: 92,
  borderRadius: 8,
  border: "1px dashed #d9d9d9",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#bfbfbf",
};

/**
 * ---------------------------------------------------------------------------
 * Güvenlik Günlüğü
 * ---------------------------------------------------------------------------
 * Engellenen başvurular, hız sınırı aşımları ve giriş denemeleri burada
 * görüntülenir. Sunucudaki dosyaları açmaya gerek kalmaz.
 *
 * Kayıtlar gün bazında tutulur ve 30 gün saklanır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Row,
  Space,
  Switch,
  Tabs,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  Ban,
  DoorOpen,
  MailCheck,
  MailX,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  Wrench,
} from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";

const { Text, Paragraph } = Typography;

/**
 * Özet kutusundaki sayının rengi.
 *
 * Saldırı belirtisi olan olaylar kırmızı, koruma çalıştığını gösterenler
 * yeşil, bilgi amaçlı olanlar nötr kalır.
 */
const olayVurgu = (olay: string): string | undefined => {
  const o = olay.toLocaleUpperCase("tr");

  if (["TEKRAR FOTOĞRAF", "ŞABLON TEKRARI", "BAL KÜPÜ", "YAPAY ZEKÂ RET",
       "ALAN REDDİ", "KAYNAK UYUŞMAZLIĞI", "KORUMALI KİP",
       "TOPLU GÖNDERİM"].some((x) => o.includes(x))) {
    return "#cf1322";
  }

  if (o.includes("GİRİŞ") && !o.includes("BAŞARISIZ")) return "#389e0d";

  return undefined;
};

/** Olay türüne göre renk */
const olayRengi = (olay: string): string => {
  if (olay.includes("BAL KÜPÜ")) return "purple";
  if (olay.includes("HIZ SINIRI")) return "orange";
  if (olay.includes("BAŞARISIZ")) return "red";
  if (olay === "GİRİŞ") return "green";
  return "default";
};

export default function GuvenlikGunlugu() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [gun, setGun] = useState<Dayjs>(dayjs());

  /* Günlük süzgeçleri */
  const [olaySuzgec, setOlaySuzgec] = useState<string | null>(null);
  const [gunlukArama, setGunlukArama] = useState("");
  const [seciliKayit, setSeciliKayit] = useState<any>(null);

  /* SMS sınaması */
  const [smsNumara, setSmsNumara] = useState("");
  const [smsSonuc, setSmsSonuc] = useState<any>(null);
  const [smsSinaniyor, setSmsSinaniyor] = useState(false);

  const smsSina = async () => {
    setSmsSinaniyor(true);
    setSmsSonuc(null);

    try {
      const sorgu = smsNumara.trim()
        ? `?telefon=${encodeURIComponent(smsNumara.trim())}`
        : "";

      setSmsSonuc(await api.al<any>(`/api/KaraListe/SmsSinama${sorgu}`));
    } catch (hata: any) {
      setSmsSonuc({ hata: hata.message });
    } finally {
      setSmsSinaniyor(false);
    }
  };


  const [veri, setVeri] = useState<any>(null);

  /* Olay türü ve serbest metin süzgeci birlikte uygulanır */
  const suzulmusKayitlar = useMemo(() => {
    let liste = veri?.kayitlar ?? [];

    if (olaySuzgec) liste = liste.filter((k: any) => k.olay === olaySuzgec);

    const q = gunlukArama.trim().toLocaleLowerCase("tr");

    if (q) {
      liste = liste.filter((k: any) =>
        [k.olay, k.adres, k.ayrinti]
          .filter(Boolean)
          .some((x: string) => x.toLocaleLowerCase("tr").includes(q))
      );
    }

    return liste;
  }, [veri, olaySuzgec, gunlukArama]);
  const [gunler, setGunler] = useState<string[]>([]);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const [kayit, liste] = await Promise.all([
        api.al<any>(`/api/Gunluk/Kayitlar?gun=${gun.format("YYYY-MM-DD")}`),
        api.al<any>("/api/Gunluk/Gunler"),
      ]);

      setVeri(kayit);
      setGunler(liste?.gunler ?? []);
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [gun, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* ------------------------------------------------------- kara liste */

  const [kara, setKara] = useState<any[]>([]);
  const [yeniIp, setYeniIp] = useState("");
  const [yeniSebep, setYeniSebep] = useState("");
  const [ekleniyor, setEkleniyor] = useState(false);

  const karaGetir = useCallback(async () => {
    try {
      const d = await api.al<any>("/api/KaraListe");
      setKara(d?.kayitlar ?? []);
    } catch {
      // Yetkisi yoksa sessizce geçilir
    }
  }, []);

  useEffect(() => {
    karaGetir();
  }, [karaGetir]);

  const karaEkle = async () => {
    if (!yeniIp.trim()) {
      message.error("Adres yazınız.");
      return;
    }

    setEkleniyor(true);

    try {
      await api.gonder("/api/KaraListe", {
        ip: yeniIp.trim(),
        sebep: yeniSebep.trim(),
      });

      message.success("Adres engellendi.");
      setYeniIp("");
      setYeniSebep("");
      karaGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setEkleniyor(false);
    }
  };

  const karaKaldir = async (kayit: any) => {
    try {
      await api.sil(`/api/KaraListe/${kayit.id}`);
      message.success("Engel kaldırıldı.");
      karaGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /* ---------------------------------------------------- geçiş sınaması */

  /* İzin verilen e-posta alan adları */
  const [izinliler, setIzinliler] = useState<any[]>([]);
  const [yeniIzinli, setYeniIzinli] = useState("");

  /* Engellenen e-posta alan adları */
  const [alanlar, setAlanlar] = useState<any[]>([]);
  const [yeniAlan, setYeniAlan] = useState("");
  const [alanSebep, setAlanSebep] = useState("");
  const [alanIsleniyor, setAlanIsleniyor] = useState(false);

  const [sinamaKimlik, setSinamaKimlik] = useState("");
  const [sinamaSonuc, setSinamaSonuc] = useState<any>(null);
  const [sinaniyor, setSinaniyor] = useState(false);

  /** Mikro resim tablosunun yapısını getirir */
  const resimTablosu = async () => {
    setSinaniyor(true);
    setSinamaSonuc(null);

    try {
      setSinamaSonuc(await api.al<any>("/api/Personel/ResimTablosu"));
    } catch (hata: any) {
      setSinamaSonuc({ hata: hata.message });
    } finally {
      setSinaniyor(false);
    }
  };

  const alanlariGetir = useCallback(async () => {
    try {
      setAlanlar(await api.al<any[]>("/api/KaraListe/EngelliAlanlar"));
    } catch {
      setAlanlar([]);
    }
  }, []);

  useEffect(() => {
    alanlariGetir();
  }, [alanlariGetir]);

  const izinlileriGetir = useCallback(async () => {
    try {
      setIzinliler(await api.al<any[]>("/api/KaraListe/IzinliAlanlar"));
    } catch {
      setIzinliler([]);
    }
  }, []);

  useEffect(() => {
    izinlileriGetir();
  }, [izinlileriGetir]);

  const izinliEkle = async () => {
    if (!yeniIzinli.trim()) {
      message.error("Alan adı giriniz.");
      return;
    }

    try {
      const sonuc = await api.gonder<any>("/api/KaraListe/IzinliAlan", {
        alan: yeniIzinli.trim(),
      });

      message.success(`${sonuc.alan} izinli listeye eklendi.`);
      setYeniIzinli("");
      izinlileriGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const izinliDurum = async (kayit: any, aktif: boolean) => {
    try {
      await api.gonder(
        `/api/KaraListe/IzinliAlan/${kayit.id}/Durum?aktif=${aktif}`,
        {}
      );
      izinlileriGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const izinliSil = async (kayit: any) => {
    try {
      await api.sil(`/api/KaraListe/IzinliAlan/${kayit.id}`);
      message.success("Listeden çıkarıldı.");
      izinlileriGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const alanEkle = async () => {
    if (!yeniAlan.trim()) {
      message.error("Alan adı giriniz.");
      return;
    }

    setAlanIsleniyor(true);

    try {
      const sonuc = await api.gonder<any>("/api/KaraListe/EngelliAlan", {
        alan: yeniAlan.trim(),
        sebep: alanSebep.trim() || null,
      });

      message.success(`${sonuc.alan} engellendi.`);
      setYeniAlan("");
      setAlanSebep("");
      alanlariGetir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setAlanIsleniyor(false);
    }
  };

  const alanDurum = async (kayit: any, aktif: boolean) => {
    try {
      await api.gonder(
        `/api/KaraListe/EngelliAlan/${kayit.id}/Durum?aktif=${aktif}`,
        {}
      );
      alanlariGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const alanSil = async (kayit: any) => {
    try {
      await api.sil(`/api/KaraListe/EngelliAlan/${kayit.id}`);
      message.success("Engel kaldırıldı.");
      alanlariGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const gecisSina = async () => {
    setSinaniyor(true);
    setSinamaSonuc(null);

    try {
      const sorgu = sinamaKimlik.trim()
        ? `?kimlikNo=${encodeURIComponent(sinamaKimlik.trim())}`
        : "";

      setSinamaSonuc(await api.al<any>(`/api/Personel/GecisSinama${sorgu}`));
    } catch (hata: any) {
      setSinamaSonuc({ hata: hata.message });
    } finally {
      setSinaniyor(false);
    }
  };

  return (
    <>
      <Tabs
      defaultActiveKey="gunluk"
      items={[
        {
          key: "gunluk",
          label: (
            <Space size={6}>
              <ScrollText size={15} strokeWidth={2} />
              Günlük
            </Space>
          ),
          children: (
            <>
              {/* ------------------------------------------------------ kara liste */}
                    <Card
                      size="small"
                      className="rp-satir"
                      title={
                        <Space size={8}>
                          <Ban size={16} strokeWidth={2} />
                          Engellenen Adresler
                          {kara.length > 0 && <Tag color="red">{kara.length}</Tag>}
                        </Space>
                      }
                    >
                      <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                        Buradaki adreslerden gelen istekler karşılanmaz. Tek adres
                        (<Text code>24.133.13.148</Text>) veya önek
                        (<Text code>24.133.13.</Text>) yazabilirsiniz; önek yazdığınızda o
                        aralığın tamamı engellenir.
                      </Paragraph>

                      <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
                        <Input
                          placeholder="IP adresi"
                          value={yeniIp}
                          onChange={(e) => setYeniIp(e.target.value)}
                          style={{ maxWidth: 200 }}
                        />
                        <Input
                          placeholder="Sebep (isteğe bağlı)"
                          value={yeniSebep}
                          onChange={(e) => setYeniSebep(e.target.value)}
                        />
                        <Button type="primary" loading={ekleniyor} onClick={karaEkle}>
                          Engelle
                        </Button>
                      </Space.Compact>

                      {kara.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="Engellenen adres bulunmuyor."
                        />
                      ) : (
                        <Tablo
                          rowKey="id"
                          size="small"
                          pagination={false}
                          dataSource={kara}
                          columns={[
                            {
                              title: "Adres",
                              dataIndex: "ip",
                              width: 180,
                              render: (v: string) => <Text code>{v}</Text>,
                            },
                            { title: "Sebep", dataIndex: "sebep", ellipsis: true },
                            { title: "Ekleyen", dataIndex: "ekleyen", width: 130 },
                            {
                              title: "Tarih",
                              dataIndex: "olusturma",
                              width: 150,
                              render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm"),
                            },
                            {
                              title: "",
                              key: "islem",
                              width: 110,
                              render: (_v, k: any) => (
                                <Popconfirm
                                  title="Engel kaldırılsın mı?"
                                  okText="Kaldır"
                                  cancelText="Vazgeç"
                                  onConfirm={() => karaKaldir(k)}
                                >
                                  <Button size="small" danger>
                                    Kaldır
                                  </Button>
                                </Popconfirm>
                              ),
                            },
                          ]}
                        />
                      )}
                    </Card>

                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Bu kayıtlar ne işe yarar?"
                      description="Aday formuna yapılan otomatik gönderimler, kısa sürede çok sayıda başvuru denemeleri ve panele yapılan giriş denemeleri buraya yazılır. Olağandışı bir hareket olduğunda kaynağını buradan görebilirsiniz."
                    />

                    <Row gutter={[10, 10]} align="middle" style={{ marginBottom: 12 }}>
                      <Col xs={16} md={5}>
                        <DatePicker
                          value={gun}
                          format="DD.MM.YYYY"
                          allowClear={false}
                          style={{ width: "100%" }}
                          disabledDate={(d) => !!d && d > dayjs().endOf("day")}
                          onChange={(d) => d && setGun(d)}
                        />
                      </Col>

                      <Col xs={8} md={3}>
                        <Tag
                          icon={<RefreshCw size={12} strokeWidth={2} />}
                          style={{ cursor: "pointer" }}
                          onClick={getir}
                        >
                          Yenile
                        </Tag>
                      </Col>

                      <Col xs={24} md={16}>
                        {gunler.length > 0 && (
                          <Text type="secondary" style={{ fontSize: 12.5 }}>
                            Kayıt bulunan günler:{" "}
                            {gunler.slice(0, 8).map((g) => (
                              <Tag
                                key={g}
                                style={{ cursor: "pointer", marginInlineEnd: 4 }}
                                color={g === gun.format("YYYY-MM-DD") ? "green" : undefined}
                                onClick={() => setGun(dayjs(g))}
                              >
                                {dayjs(g).format("DD.MM")}
                              </Tag>
                            ))}
                            {gunler.length > 8 && `+${gunler.length - 8}`}
                          </Text>
                        )}
                      </Col>
                    </Row>

                    {yukleniyor ? (
                      <div style={{ textAlign: "center", padding: "50px 0" }}>
                        <Spin />
                      </div>
                    ) : !veri || veri.kayitlar?.length === 0 ? (
                      <Empty description="Bu güne ait kayıt bulunmuyor." />
                    ) : (
                      <>
                        {/* --------------------------------------------------------- özet */}
                        <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
                          {veri.ozet?.map((o: any) => (
                            <Col xs={12} md={5} key={o.olay}>
                              {/* Tıklanınca o olaya süzülür */}
                              <button
                                className={`gg-ozet${
                                  olaySuzgec === o.olay ? " gg-ozet-secili" : ""
                                }`}
                                onClick={() =>
                                  setOlaySuzgec(
                                    olaySuzgec === o.olay ? null : o.olay
                                  )
                                }
                              >
                                <span>{o.olay}</span>
                                <b style={{ color: olayVurgu(o.olay) }}>
                                  {o.adet}
                                </b>
                              </button>
                            </Col>
                          ))}
                        </Row>

                        {/* ------------------------------------------------------ adresler */}
                        {veri.adresler?.length > 0 && (
                          <Card size="small" className="rp-satir" title="En Çok İşlem Yapan Adresler">
                            <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                              Tek bir adresten çok sayıda engellenmiş işlem varsa otomatik bir
                              araç kullanılıyor olabilir.
                            </Paragraph>

                            <Tablo
                              rowKey="adres"
                              size="small"
                              pagination={false}
                              dataSource={veri.adresler}
                              columns={[
                                {
                                  title: "Adres",
                                  dataIndex: "adres",
                                  width: 200,
                                  render: (v: string) => <Text code>{v}</Text>,
                                },
                                {
                                  title: "İşlem",
                                  dataIndex: "adet",
                                  width: 100,
                                  align: "center",
                                  sorter: (a: any, b: any) => a.adet - b.adet,
                                  defaultSortOrder: "descend",
                                  render: (v: number) => (
                                    <Tag color={v > 20 ? "red" : v > 5 ? "orange" : "default"}>
                                      {v}
                                    </Tag>
                                  ),
                                },
                                {
                                  title: "Olay Türleri",
                                  dataIndex: "olaylar",
                                  render: (v: string[]) => (
                                    <Space size={4} wrap>
                                      {v.map((o) => (
                                        <Tag key={o} color={olayRengi(o)} style={{ marginInlineEnd: 0 }}>
                                          {o}
                                        </Tag>
                                      ))}
                                    </Space>
                                  ),
                                },
                              ]}
                            />
                          </Card>
                        )}

                        {/* ------------------------------------------------------ kayıtlar */}
                        <Card
                          size="small"
                          title={
                            <Space size={8}>
                              <ShieldAlert size={16} strokeWidth={2} />
                              Kayıtlar ({veri.kayitlar.length})
                            </Space>
                          }
                        >
                          <Tablo
                            rowKey={(k: any, i?: number) => `${k.zaman}-${i}`}
                            size="small"
                            pagination={{ pageSize: 50, showSizeChanger: false }}
                            dataSource={suzulmusKayitlar}
                            onRow={(kayit: any) => ({
                              onClick: () => setSeciliKayit(kayit),
                              style: { cursor: "pointer" },
                            })}
                            scroll={{ x: 720 }}
                            columns={[
                              {
                                title: "Zaman",
                                dataIndex: "zaman",
                                width: 150,
                                render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm:ss"),
                              },
                              {
                                title: "Olay",
                                dataIndex: "olay",
                                width: 155,
                                render: (v: string) => <Tag color={olayRengi(v)}>{v}</Tag>,
                              },
                              {
                                title: "Adres",
                                dataIndex: "adres",
                                width: 160,
                                render: (v: string) => <Text code>{v}</Text>,
                              },
                              {
                                title: "Ayrıntı",
                                dataIndex: "ayrinti",
                                ellipsis: true,
                                render: (v: string) =>
                                  v ? (
                                    <Tooltip title={v}>
                                      <span style={{ fontSize: 12.5 }}>{v}</span>
                                    </Tooltip>
                                  ) : (
                                    <span style={{ color: "#bbb" }}>—</span>
                                  ),
                              },
                            ]}
                          />
                        </Card>
                      </>
                    )}
            </>
          ),
        },
        {
          key: "eposta",
          label: (
            <Space size={6}>
              <MailCheck size={15} strokeWidth={2} />
              E-posta Alanları
            </Space>
          ),
          children: (
            <>
              {/* --------------------------------------- izinli e-posta alanları */}
                    <Card
                      size="small"
                      className="rp-satir"
                      style={{ marginBottom: 12 }}
                      title={
                        <Space size={8}>
                          <MailCheck size={16} strokeWidth={2} />
                          İzin Verilen E-posta Sağlayıcıları
                          <Tag color={izinliler.filter((a) => a.aktif).length > 0
                            ? "green" : "default"}>
                            {izinliler.filter((a) => a.aktif).length > 0
                              ? "yalnızca listedekiler"
                              : "kısıt yok"}
                          </Tag>
                        </Space>
                      }
                    >
                      <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                        Bu listede <b>en az bir kayıt varsa</b> yalnızca buradaki
                        sağlayıcılardan başvuru kabul edilir. Liste boşken kısıt uygulanmaz
                        ve aşağıdaki engelli liste geçerli olur.
                      </Paragraph>

                      <Space.Compact style={{ width: "100%", maxWidth: 420 }}>
                        <Input
                          placeholder="@gmail.com"
                          value={yeniIzinli}
                          onChange={(e) => setYeniIzinli(e.target.value)}
                          onPressEnter={izinliEkle}
                        />
                        <Button
                          type="primary"
                          icon={<MailCheck size={15} strokeWidth={2} />}
                          onClick={izinliEkle}
                        >
                          İzin ver
                        </Button>
                      </Space.Compact>

                      {izinliler.length === 0 ? (
                        <Paragraph
                          type="secondary"
                          style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}
                        >
                          Liste boş; her sağlayıcıdan başvuru kabul ediliyor. Yaygın
                          olanları eklemek için: @gmail.com, @hotmail.com, @outlook.com,
                          @icloud.com
                        </Paragraph>
                      ) : (
                        <div className="gg-alanlar">
                          {izinliler.map((a) => (
                            <div
                              className={`gg-alan gg-alan-izinli${
                                a.aktif ? "" : " gg-alan-pasif"
                              }`}
                              key={a.id}
                            >
                              <div className="gg-alan-ad">
                                <b>@{a.alan}</b>
                                {a.aciklama && <span>{a.aciklama}</span>}
                              </div>

                              <Space size={6}>
                                <Switch
                                  size="small"
                                  checked={a.aktif}
                                  onChange={(v) => izinliDurum(a, v)}
                                />

                                <Popconfirm
                                  title="Listeden çıkarılsın mı?"
                                  okText="Çıkar"
                                  cancelText="Vazgeç"
                                  onConfirm={() => izinliSil(a)}
                                >
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<Trash2 size={14} strokeWidth={2} />}
                                  />
                                </Popconfirm>
                              </Space>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>

              {/* --------------------------------------- engelli e-posta alanları */}
                    <Card
                      size="small"
                      className="rp-satir"
                      style={{ marginBottom: 12 }}
                      title={
                        <Space size={8}>
                          <MailX size={16} strokeWidth={2} />
                          Engellenen E-posta Alan Adları
                          {alanlar.filter((a) => a.aktif).length > 0 && (
                            <Tag>{alanlar.filter((a) => a.aktif).length} etkin</Tag>
                          )}
                        </Space>
                      }
                    >
                      <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                        Bu alan adlarından başvuru kabul edilmez. Alt alan adları da
                        kapsanır: <code>ornek.com</code> engelliyse{" "}
                        <code>posta.ornek.com</code> da engellidir.
                      </Paragraph>

                      <Space.Compact style={{ width: "100%", maxWidth: 560 }}>
                        <Input
                          placeholder="@ornek.com"
                          value={yeniAlan}
                          onChange={(e) => setYeniAlan(e.target.value)}
                          onPressEnter={alanEkle}
                          style={{ maxWidth: 220 }}
                        />
                        <Input
                          placeholder="Sebep (isteğe bağlı)"
                          value={alanSebep}
                          onChange={(e) => setAlanSebep(e.target.value)}
                          onPressEnter={alanEkle}
                        />
                        <Button
                          type="primary"
                          loading={alanIsleniyor}
                          icon={<Ban size={15} strokeWidth={2} />}
                          onClick={alanEkle}
                        >
                          Engelle
                        </Button>
                      </Space.Compact>

                      {alanlar.length > 0 && (
                        <div className="gg-alanlar">
                          {alanlar.map((a) => (
                            <div
                              className={`gg-alan${a.aktif ? "" : " gg-alan-pasif"}`}
                              key={a.id}
                            >
                              <div className="gg-alan-ad">
                                <b>@{a.alan}</b>
                                {a.sebep && <span>{a.sebep}</span>}
                              </div>

                              <Space size={6}>
                                {a.engelleme > 0 && (
                                  <Tooltip
                                    title={
                                      a.sonDeneme
                                        ? `Son deneme: ${dayjs(a.sonDeneme).format(
                                            "DD.MM.YYYY HH:mm"
                                          )}`
                                        : undefined
                                    }
                                  >
                                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                                      {a.engelleme} deneme engellendi
                                    </Tag>
                                  </Tooltip>
                                )}

                                <Switch
                                  size="small"
                                  checked={a.aktif}
                                  onChange={(v) => alanDurum(a, v)}
                                />

                                <Popconfirm
                                  title="Listeden silinsin mi?"
                                  okText="Sil"
                                  cancelText="Vazgeç"
                                  onConfirm={() => alanSil(a)}
                                >
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<Trash2 size={14} strokeWidth={2} />}
                                  />
                                </Popconfirm>
                              </Space>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
            </>
          ),
        },
        {
          key: "araclar",
          label: (
            <Space size={6}>
              <Wrench size={15} strokeWidth={2} />
              Araçlar
            </Space>
          ),
          children: (
            <>
              {/* --------------------------------------------------- SMS sınaması */}
              <Card
                size="small"
                className="rp-satir"
                style={{ marginBottom: 12 }}
                title={
                  <Space size={8}>
                    <MessageSquare size={16} strokeWidth={2} />
                    JetSMS Bağlantısı
                  </Space>
                }
              >
                <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                  Başvuru formundaki SMS doğrulaması çalışmıyorsa buradan
                  sınayınız. Numara yazarsanız gerçek bir test SMS'i gönderilir;
                  boş bırakırsanız yalnızca servisin açık olup olmadığı
                  görünür.
                </Paragraph>

                <Space.Compact style={{ width: "100%", maxWidth: 460 }}>
                  <Input
                    placeholder="5xxxxxxxxx (isteğe bağlı)"
                    value={smsNumara}
                    onChange={(e) => setSmsNumara(e.target.value)}
                    onPressEnter={smsSina}
                  />
                  <Button type="primary" loading={smsSinaniyor} onClick={smsSina}>
                    Sına
                  </Button>
                </Space.Compact>

                {smsSonuc && (
                  <pre className="gg-sinama">
                    {JSON.stringify(smsSonuc, null, 2)}
                  </pre>
                )}

                <Paragraph
                  type="secondary"
                  style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}
                >
                  Hata dönerse appsettings.json → JetSms → Alanlar altındaki
                  isimleri JetSMS panelinizdeki örnek isteğe göre düzeltiniz.
                </Paragraph>
              </Card>

              {/* -------------------------------------------------- geçiş sınaması */}
                    <Card
                      size="small"
                      className="rp-satir"
                      title={
                        <Space size={8}>
                          <DoorOpen size={16} strokeWidth={2} />
                          QR Geçiş Bağlantısı
                        </Space>
                      }
                    >
                      <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                        Personel ekranında geçiş bilgisi görünmüyorsa buradan sınayınız.
                        Kimlik numarası yazarsanız o kişinin eşleşip eşleşmediği de
                        denetlenir.
                      </Paragraph>

                      <Space.Compact style={{ width: "100%", maxWidth: 460 }}>
                        <Input
                          placeholder="T.C. kimlik numarası (isteğe bağlı)"
                          value={sinamaKimlik}
                          onChange={(e) => setSinamaKimlik(e.target.value)}
                          onPressEnter={gecisSina}
                        />
                        <Button type="primary" loading={sinaniyor} onClick={gecisSina}>
                          Sına
                        </Button>
                      </Space.Compact>

                      <Button
                        size="small"
                        style={{ marginTop: 10 }}
                        loading={sinaniyor}
                        onClick={resimTablosu}
                      >
                        Mikro resim tablosunun yapısını göster
                      </Button>

                      {sinamaSonuc && (
                        <pre className="gg-sinama">
                          {JSON.stringify(sinamaSonuc, null, 2)}
                        </pre>
                      )}
                    </Card>
            </>
          ),
        },
      ]}
    />

      {/* --------------------------------------------- kayıt ayrıntısı */}
      <Drawer
        open={!!seciliKayit}
        onClose={() => setSeciliKayit(null)}
        width="min(620px, 96vw)"
        className="rp-cekmece"
        title={
          seciliKayit && (
            <Space size={8}>
              <ShieldAlert size={16} strokeWidth={2} />
              <Text strong>{seciliKayit.olay}</Text>
            </Space>
          )
        }
      >
        {seciliKayit && (
          <>
            <div className="gg-detay">
              <div>
                <span>Zaman</span>
                <b>{dayjs(seciliKayit.zaman).format("DD.MM.YYYY HH:mm:ss")}</b>
              </div>

              <div>
                <span>Olay</span>
                <b>
                  <Tag color={olayRengi(seciliKayit.olay)}>
                    {seciliKayit.olay}
                  </Tag>
                </b>
              </div>

              <div>
                <span>Adres</span>
                <b>
                  <Text copyable={{ text: seciliKayit.adres }}>
                    {seciliKayit.adres || "—"}
                  </Text>
                </b>
              </div>
            </div>

            {seciliKayit.ayrinti && (
              <>
                <div className="gg-detay-baslik">Ayrıntı</div>
                <div className="gg-detay-metin">{seciliKayit.ayrinti}</div>
              </>
            )}

            {/* Aynı adresin o günkü diğer hareketleri */}
            {(() => {
              const digerleri = (veri?.kayitlar ?? []).filter(
                (k: any) =>
                  k.adres === seciliKayit.adres &&
                  k.zaman !== seciliKayit.zaman
              );

              if (digerleri.length === 0) return null;

              return (
                <>
                  <div className="gg-detay-baslik">
                    Bu adresin diğer hareketleri ({digerleri.length})
                  </div>

                  <div className="gg-detay-liste">
                    {digerleri.slice(0, 30).map((k: any, i: number) => (
                      <div key={i}>
                        <span>{dayjs(k.zaman).format("HH:mm:ss")}</span>
                        <Tag
                          color={olayRengi(k.olay)}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {k.olay}
                        </Tag>
                        <i>{k.ayrinti}</i>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}

            {seciliKayit.adres && seciliKayit.adres !== "-" && (
              <Button
                danger
                style={{ marginTop: 14 }}
                icon={<Ban size={15} strokeWidth={2} />}
                onClick={() => {
                  setYeniIp(seciliKayit.adres);
                  setSeciliKayit(null);
                  message.info(
                    "Adres kara liste alanına yazıldı; sebep girip ekleyebilirsiniz."
                  );
                }}
              >
                Bu adresi kara listeye al
              </Button>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}

/**
 * Personel Performansı
 * ---------------------------------------------------------------------------
 * Mağaza performans sisteminde (biDb) hesaplanan dönemsel değerlendirme
 * puanları. Bu sayfa yalnızca okur: puanlar orada PD_Rapor saklı yordamıyla
 * üretiliyor, burada yeniden hesaplanmaz.
 *
 * Yalnızca şube personeli listelenir. Merkez büro ve depo görevlerinde
 * mağaza ölçütleri (ciro, fire, müşteri sayısı) uygulanmıyor; onları aynı
 * tabloda göstermek sıralamayı anlamsız kılar.
 */

import { OlcutBilgi, donemAyrinti } from "./perfOlcut";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Avatar,
  Col,
  Collapse,
  Drawer,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Award,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";

import Tablo from "./Tablo";
import dayjs from "dayjs";

import { api } from "./api";

const { Title, Text, Paragraph } = Typography;

interface Kayit {
  perId: number;
  ad: string;
  soyad: string;
  gorevAdi: string | null;
  subeAdi: string | null;
  magazaToplam: number | null;
  yetkinlikToplam: number | null;
  gorevSirasi: number;
  sirketSirasi: number;
}

/** Toplam puana göre renk: bakarken göz hemen ayırt etsin */
const puanRengi = (t: number) =>
  t >= 70 ? "#5f8c10" : t >= 50 ? "#d46b08" : "#cf1322";

const toplamPuan = (k: Kayit) =>
  (k.magazaToplam ?? 0) + (k.yetkinlikToplam ?? 0);

export default function PersonelPerformansi() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [donem, setDonem] = useState<string | undefined>();
  const [arama, setArama] = useState("");
  const [sube, setSube] = useState<string | undefined>();
  const [gorev, setGorev] = useState<string | undefined>();
  const [gorunum, setGorunum] = useState<"sube" | "enIyi" | "sureklilik">("sube");

  /* Puan aralığı süzgeci. Dilimler prim hak edişindekilerle aynı:
     60-70 %3, 70-80 %5, 80-90 %7, 90+ %10. Aynı sınırları kullanmak,
     iki ekranın aynı dili konuşmasını sağlıyor. */
  const [puanAralik, setPuanAralik] = useState<string>("hepsi");

  /* Seçilen kişinin ölçüt kırılımı; personel kartındakiyle aynı veri */
  const [detayKisi, setDetayKisi] = useState<Kayit | null>(null);
  const [detay, setDetay] = useState<any>(null);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);

  /* Detay penceresinde gösterilen dönem; sayfa üstündeki dönemden
     bağımsızdır, kişi bazında geçmişe bakılabilsin. */
  const [perfDonemSec, setPerfDonemSec] = useState<string | undefined>();

  /* Grafikten tıklanan şube aşağıdaki listede açılır */
  const [acikSube, setAcikSube] = useState<string | undefined>();

  /* Üst üste tam puan alanlar */
  const [sureklilik, setSureklilik] = useState<any>(null);

  const detayAc = async (k: Kayit) => {
    setDetayKisi(k);
    setDetay(null);
    setPerfDonemSec(donem);
    setDetayYukleniyor(true);

    try {
      /* Dönem süzgeci uygulanmaz: bir önceki dönemle karşılaştırma
         yapabilmek için en az iki döneme ihtiyaç var. Hangi dönemin
         gösterileceğine ekranda karar verilir. */
      const sorgu = new URLSearchParams({ perId: String(k.perId) });

      setDetay(await api.al<any>(`/api/Performans/Personel?${sorgu}`));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDetayYukleniyor(false);
    }
  };

  const getir = useCallback(
    async (secilenDonem?: string) => {
      setYukleniyor(true);

      try {
        const sorgu = new URLSearchParams();

        if (secilenDonem) {
          const [y, a] = secilenDonem.split("-");
          sorgu.set("yil", y);
          sorgu.set("ay", a);
        }

        const d = await api.al<any>(`/api/Performans/Ozet?${sorgu}`);
        setVeri(d);

        /* İlk açılışta sunucunun seçtiği dönem kutuya yazılır */
        if (!secilenDonem && d?.yil) setDonem(`${d.yil}-${d.ay}`);
      } catch (hata: any) {
        message.error(hata.message);
        setVeri(null);
      } finally {
        setYukleniyor(false);
      }
    },
    [message]
  );

  useEffect(() => {
    getir();

    api
      .al<any>("/api/Performans/Sureklilik?donem=3")
      .then(setSureklilik)
      .catch(() => undefined);
  }, [getir]);

  /* Yalnızca şube personeli. Şubesi olmayan kayıtlar merkez büro, depo
     ya da bölge müdürlüğüdür; mağaza ölçütleri onlara uygulanmadığı için
     aynı sıralamaya girmeleri yanıltıcı olur. */
  const subeKayitlari: Kayit[] = useMemo(
    () =>
      (veri?.kayitlar ?? []).filter(
        (k: Kayit) =>
          k.subeAdi &&
          k.subeAdi.trim().length > 0 &&
          !/merkez|depo|b[üu]ro/i.test(k.subeAdi)
      ),
    [veri]
  );

  const subeler = useMemo(
    () =>
      [...new Set(subeKayitlari.map((k) => k.subeAdi!).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "tr")
      ),
    [subeKayitlari]
  );

  const gorevler = useMemo(
    () =>
      [
        ...new Set(subeKayitlari.map((k) => k.gorevAdi ?? "").filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, "tr")),
    [subeKayitlari]
  );

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return subeKayitlari.filter((k) => {
      if (sube && k.subeAdi !== sube) return false;
      if (gorev && k.gorevAdi !== gorev) return false;

      if (puanAralik !== "hepsi") {
        const t = toplamPuan(k);

        const uyuyor =
          puanAralik === "60-70" ? t >= 60 && t < 70 :
          puanAralik === "70-80" ? t >= 70 && t < 80 :
          puanAralik === "80-90" ? t >= 80 && t < 90 :
          puanAralik === "90-100" ? t >= 90 : true;

        if (!uyuyor) return false;
      }

      if (q) {
        const metin = `${k.ad} ${k.soyad} ${k.subeAdi ?? ""} ${k.gorevAdi ?? ""}`;
        if (!metin.toLocaleLowerCase("tr").includes(q)) return false;
      }

      return true;
    });
  }, [subeKayitlari, arama, sube, gorev, puanAralik]);

  /* Özet sayılar: puanı olmayan kayıtlar ortalamaya girmez, aksi hâlde
     verisi girilmemiş kişiler ortalamayı sıfıra çeker. */
  const ozet = useMemo(() => {
    const puanlilar = liste.filter((k) => toplamPuan(k) > 0);

    const ortalama =
      puanlilar.length > 0
        ? puanlilar.reduce((t, k) => t + toplamPuan(k), 0) / puanlilar.length
        : 0;

    return {
      kisi: liste.length,
      puanli: puanlilar.length,
      ortalama: Math.round(ortalama),
      yuksek: puanlilar.filter((k) => toplamPuan(k) >= 70).length,
      dusuk: puanlilar.filter((k) => toplamPuan(k) < 50).length,
    };
  }, [liste]);

  /* Şube bazında gruplama: liste 500 satır olduğunda tek tabloda
     taramak zor; şubeye tıklayınca personeli açılır. */
  const subeGruplari = useMemo(() => {
    const harita = new Map<string, Kayit[]>();

    liste.forEach((k) => {
      const ad = k.subeAdi ?? "Belirtilmemiş";
      if (!harita.has(ad)) harita.set(ad, []);
      harita.get(ad)!.push(k);
    });

    return [...harita.entries()]
      .map(([subeAdi, kisiler]) => {
        const puanlilar = kisiler.filter((k) => toplamPuan(k) > 0);

        return {
          subeAdi,
          kisiler: kisiler.sort((a, b) => toplamPuan(b) - toplamPuan(a)),
          kisi: kisiler.length,
          ortalama:
            puanlilar.length > 0
              ? Math.round(
                  puanlilar.reduce((t, k) => t + toplamPuan(k), 0) /
                    puanlilar.length
                )
              : 0,
          yuksek: puanlilar.filter((k) => toplamPuan(k) >= 70).length,
        };
      })
      .sort((a, b) => b.ortalama - a.ortalama);
  }, [liste]);

  const enIyiler = useMemo(
    () =>
      [...liste]
        .filter((k) => toplamPuan(k) > 0)
        .sort((a, b) => toplamPuan(b) - toplamPuan(a))
        .slice(0, 10),
    [liste]
  );

  /* En yüksek puan çubukların ölçeğini belirler */
  const enYuksek = enIyiler.length > 0 ? toplamPuan(enIyiler[0]) : 100;

  const filtreVar = !!(arama || sube || gorev || puanAralik !== "hepsi");

  return (
    <div>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={12}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
            <Space size={8}>
              <TrendingUp size={18} strokeWidth={2} />
              Personel Performansı
            </Space>
          </Title>
        </Col>

        <Col xs={24} md={12} style={{ textAlign: "right" }}>
          <Space wrap>
            <Select
              style={{ width: 150 }}
              placeholder="Dönem"
              value={donem}
              onChange={(v) => {
                setDonem(v);
                getir(v);
              }}
              options={(veri?.donemler ?? []).map((d: any) => ({
                value: `${d.yil}-${d.ay}`,
                label: `${d.yil} / ${String(d.ay).padStart(2, "0")}`,
              }))}
            />

            <Button
              icon={<RefreshCw size={15} strokeWidth={2} />}
              loading={yukleniyor}
              onClick={() => getir(donem)}
            >
              Yenile
            </Button>
          </Space>
        </Col>
      </Row>

      {veri?.hata ? (
        <Alert
          type="warning"
          showIcon
          message={veri.hata}
          description={
            veri.ayrinti ??
            "Performans veritabanı bağlantısı tanımlı olmayabilir (appsettings.json → ConnectionStrings → Performans)."
          }
        />
      ) : yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : (
        <>
          {/* ------------------------------------------------- özet kartları */}
          <Row gutter={[10, 10]} justify="center" style={{ marginBottom: 14 }}>
            {[
              { baslik: "Değerlendirilen", deger: ozet.kisi, ek: "şube personeli" },
              {
                baslik: "Ortalama Puan",
                deger: ozet.ortalama,
                ek: `${ozet.puanli} kişi üzerinden`,
                renk: puanRengi(ozet.ortalama),
              },
              {
                baslik: "70 ve üzeri",
                deger: ozet.yuksek,
                ek: "yüksek performans",
                renk: "#5f8c10",
              },
              {
                baslik: "50 altı",
                deger: ozet.dusuk,
                ek: "gelişim alanı",
                renk: "#cf1322",
              },
            ].map((k) => (
              <Col xs={12} sm={6} md={4} key={k.baslik}>
                <Card size="small" style={{ textAlign: "center" }}>
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {k.baslik}
                  </Text>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      lineHeight: 1.3,
                      color: k.renk ?? "#1f2933",
                    }}
                  >
                    {k.deger}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {k.ek}
                  </Text>
                </Card>
              </Col>
            ))}
          </Row>

          {/* ---------------------------------------------------- süzgeçler */}
          <Card size="small" style={{ marginBottom: 12 }}>
            <Row gutter={[10, 10]} align="middle">
              <Col xs={24} md={7}>
                <Input
                  allowClear
                  prefix={<Search size={14} strokeWidth={2} />}
                  placeholder="Ad, şube veya görev ara"
                  value={arama}
                  onChange={(e) => setArama(e.target.value)}
                />
              </Col>

              <Col xs={12} md={5}>
                <Select
                  allowClear
                  showSearch
                  style={{ width: "100%" }}
                  placeholder="Şube"
                  value={sube}
                  onChange={setSube}
                  options={subeler.map((x) => ({ value: x, label: x }))}
                />
              </Col>

              <Col xs={12} md={5}>
                <Select
                  allowClear
                  showSearch
                  style={{ width: "100%" }}
                  placeholder="Görev"
                  value={gorev}
                  onChange={setGorev}
                  options={gorevler.map((x) => ({ value: x, label: x }))}
                />
              </Col>

              <Col xs={24} md={7} style={{ textAlign: "right" }}>
                <Space wrap>
                  {filtreVar && (
                    <Button
                      onClick={() => {
                        setArama("");
                        setSube(undefined);
                        setGorev(undefined);
                        setPuanAralik("hepsi");
                      }}
                    >
                      Temizle
                    </Button>
                  )}

                  <Segmented
                    size="small"
                    value={puanAralik}
                    onChange={(v) => setPuanAralik(v as string)}
                    options={[
                      { label: "Hepsi", value: "hepsi" },
                      { label: "60-70", value: "60-70" },
                      { label: "70-80", value: "70-80" },
                      { label: "80-90", value: "80-90" },
                      { label: "90-100", value: "90-100" },
                    ]}
                  />

                  <Segmented
                    value={gorunum}
                    onChange={(v) => setGorunum(v as any)}
                    options={[
                      { label: "Şubeler", value: "sube" },
                      { label: "En iyi 10", value: "enIyi" },
                      {
                        label: `Süreklilik${
                          sureklilik?.kayitlar?.length
                            ? ` (${sureklilik.kayitlar.length})`
                            : ""
                        }`,
                        value: "sureklilik",
                      },
                    ]}
                  />
                </Space>
              </Col>
            </Row>
          </Card>

          {/* ------------------------------------------- şube grafiği */}
          {subeGruplari.length > 0 && gorunum === "sube" && (
            <Card
              size="small"
              style={{ marginBottom: 12 }}
              title="Şube Ortalamaları"
              extra={
                <Space size={12}>
                  <span className="gr-gosterge">
                    <i className="gr-nokta gr-nokta-yesil" /> 70 ve üzeri
                  </span>
                  <span className="gr-gosterge">
                    <i className="gr-nokta gr-nokta-kirmizi" /> 70 altı
                  </span>
                </Space>
              }
            >
              {/* Yatay çubuklar: otuz beş şube dikey sığmıyor, adlar
                  sıkışıyordu. Yatay düzende ad tam okunur ve şubeler
                  arası fark tek bakışta görünür. */}
              <div className="gr-grafik">
                {subeGruplari.map((g) => (
                  <Tooltip
                    key={g.subeAdi}
                    title={
                      <span>
                        Personel: {g.kisi}
                        <br />
                        70 ve üzeri: {g.yuksek}
                        <br />
                        Ortalama: {g.ortalama}
                      </span>
                    }
                  >
                    <div
                      className="gr-satir rp-tiklanabilir"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        /* Grafikten şubeye tıklayınca aşağıdaki liste o
                           şubeyi açar; kullanıcı ikinci kez aramak
                           zorunda kalmasın. */
                        setAcikSube(g.subeAdi);

                        document
                          .querySelector(".pp-sube-listesi")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setAcikSube(g.subeAdi);
                        }
                      }}
                    >
                      <span className="gr-satir-ad">{g.subeAdi}</span>

                      <span className="gr-satir-alan">
                        <span
                          className="gr-satir-cubuk"
                          style={{ width: `${Math.min(100, g.ortalama)}%` }}
                        >
                          <span
                            style={{
                              display: "block",
                              width: "100%",
                              height: "100%",
                              background:
                                g.ortalama >= 70 ? "#7CB518" : "#E8481C",
                            }}
                          />
                        </span>
                      </span>

                      <span className="gr-satir-sayi">
                        <b
                          style={{
                            color:
                              g.ortalama >= 70 ? "#5f8c10" : "#cf1322",
                          }}
                        >
                          {g.ortalama}
                        </b>
                        <i>/ {g.kisi}</i>
                      </span>

                      <span
                        className="gr-satir-sayi"
                        style={{
                          color: g.yuksek > 0 ? "#5f8c10" : "#bbb",
                        }}
                      >
                        {g.yuksek > 0 ? `${g.yuksek} kişi` : "—"}
                      </span>
                    </div>
                  </Tooltip>
                ))}
              </div>
            </Card>
          )}

          {/* ---------------------------------------------------- en iyi 10 */}
          {gorunum === "enIyi" ? (
            <Card
              size="small"
              title={
                <Space size={8}>
                  <Award size={16} strokeWidth={2} />
                  <Text strong>En İyi 10</Text>
                  {filtreVar && <Tag>süzülmüş liste</Tag>}
                </Space>
              }
            >
              {enIyiler.length === 0 ? (
                <Empty description="Puanı girilmiş personel bulunamadı." />
              ) : (
                enIyiler.map((k, i) => {
                  const t = toplamPuan(k);

                  return (
                    <div
                      key={k.perId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "9px 0",
                        borderBottom: "1px solid #f0f2ee",
                      }}
                    >
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          flex: "0 0 auto",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 700,
                          background: i < 3 ? "#f2f9e8" : "#f1f2ef",
                          color: i < 3 ? "#5f8c10" : "#6b7280",
                        }}
                      >
                        {i + 1}
                      </span>

                      <span style={{ flex: "1 1 200px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                          {k.ad} {k.soyad}
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {k.gorevAdi} · {k.subeAdi}
                        </Text>
                      </span>

                      {/* Çubuk, sayıyı okumadan farkı göstersin */}
                      <span
                        style={{
                          flex: "0 0 160px",
                          height: 8,
                          borderRadius: 4,
                          background: "#eef0ec",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${Math.round((t / enYuksek) * 100)}%`,
                            background: puanRengi(t),
                          }}
                        />
                      </span>

                      <b
                        style={{
                          width: 46,
                          textAlign: "right",
                          color: puanRengi(t),
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {t}
                      </b>
                    </div>
                  );
                })
              )}
            </Card>
          ) : gorunum === "sureklilik" ? (
            /* ----------------------------------------------- süreklilik */
            <Card
              size="small"
              title={
                <Space size={8}>
                  <Award size={16} strokeWidth={2} />
                  <Text strong>Üst üste 3 dönem tam puan</Text>
                </Space>
              }
            >
              {sureklilik?.yeterliDonemYok ? (
                <Alert
                  type="info"
                  showIcon
                  message="Yeterli dönem verisi yok"
                  description={`Süreklilik için ${sureklilik.istenen} dönem gerekiyor, sistemde ${sureklilik.mevcut} dönem var.`}
                />
              ) : (sureklilik?.kayitlar ?? []).length === 0 ? (
                <Empty description="Üst üste üç dönem tam puan alan personel yok." />
              ) : (
                <>
                  <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                    Son üç değerlendirme döneminin <b>hepsinde</b> 100 puan
                    almış personel. Aradaki bir dönemde düşen kişi listeye
                    girmez; aranan şey tek seferlik başarı değil süreklilik.
                  </Paragraph>

                  <Tablo
                    rowKey="perId"
                    size="small"
                    dataSource={sureklilik.kayitlar}
                    pagination={false}
                    columns={[
                      {
                        title: "Personel",
                        key: "ad",
                        width: 200,
                        render: (_v: any, k: any) => (
                          <Space size={6}>
                            <Award size={14} strokeWidth={2} color="#d4a017" />
                            <b>
                              {k.ad} {k.soyad}
                            </b>
                          </Space>
                        ),
                      },
                      {
                        title: "Görev",
                        dataIndex: "gorevAdi",
                        width: 180,
                        ellipsis: true,
                        render: (v: string) =>
                          v ? <Tag color="blue">{v}</Tag> : "—",
                      },
                      { title: "Şube", dataIndex: "subeAdi", width: 160 },
                      {
                        title: "Dönem",
                        dataIndex: "donemSayisi",
                        width: 100,
                        align: "center" as const,
                        render: (v: number) => <Tag color="green">{v} dönem</Tag>,
                      },
                    ]}
                  />
                </>
              )}
            </Card>
          ) : (
            /* --------------------------------------------- şube kırılımı */
            <Card size="small" className="pp-sube-listesi">
              <Space size={8} style={{ marginBottom: 10 }}>
                <Users size={15} strokeWidth={2} />
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {subeGruplari.length} şube · {liste.length} personel
                </Text>
              </Space>

              {subeGruplari.length === 0 ? (
                <Empty description="Bu dönem için değerlendirme bulunmuyor." />
              ) : (
                <Collapse
                  accordion
                  activeKey={acikSube}
                  onChange={(k) =>
                    setAcikSube(Array.isArray(k) ? k[0] : (k as string))
                  }
                  items={subeGruplari.map((g) => ({
                    key: g.subeAdi,
                    label: (
                      <Row align="middle" gutter={[8, 4]} style={{ width: "100%" }}>
                        <Col flex="auto">
                          <b style={{ fontSize: 13.5 }}>{g.subeAdi}</b>
                        </Col>
                        <Col>
                          <Space size={6} wrap>
                            <Tag>{g.kisi} kişi</Tag>
                            {g.yuksek > 0 && (
                              <Tooltip title="70 ve üzeri puan alan personel">
                                <Tag color="green">{g.yuksek} yüksek</Tag>
                              </Tooltip>
                            )}
                            <Tooltip title="Şube ortalaması">
                              <Tag color={g.ortalama >= 70 ? "green" : undefined}>
                                ort. {g.ortalama}
                              </Tag>
                            </Tooltip>
                          </Space>
                        </Col>
                      </Row>
                    ),
                    children: (
                      <Tablo
                        rowKey="perId"
                        size="small"
                        dataSource={g.kisiler}
                        pagination={false}
                        rowClassName="rp-tiklanabilir"
                        onRow={(k: Kayit) => ({ onClick: () => detayAc(k) })}
                        columns={[
                          {
                            title: "Personel",
                            key: "ad",
                            width: 190,
                            render: (_v: any, k: Kayit) => (
                              <b>
                                {k.ad} {k.soyad}
                              </b>
                            ),
                          },
                          {
                            title: "Görev",
                            dataIndex: "gorevAdi",
                            width: 175,
                            ellipsis: true,
                            render: (v: string) =>
                              v ? <Tag color="blue">{v}</Tag> : "—",
                          },
                          {
                            title: "Mağaza",
                            dataIndex: "magazaToplam",
                            width: 90,
                            align: "right" as const,
                            render: (v: number) =>
                              v ? v : <Text type="secondary">—</Text>,
                          },
                          {
                            title: "Yetkinlik",
                            dataIndex: "yetkinlikToplam",
                            width: 95,
                            align: "right" as const,
                            render: (v: number) =>
                              v ? v : <Text type="secondary">—</Text>,
                          },
                          {
                            title: "Toplam",
                            key: "toplam",
                            width: 100,
                            align: "right" as const,
                            render: (_v: any, k: Kayit) => {
                              const t = toplamPuan(k);

                              if (t === 0)
                                return (
                                  <Text type="secondary">veri yok</Text>
                                );

                              return (
                                <b style={{ color: puanRengi(t) }}>{t}</b>
                              );
                            },
                          },
                          {
                            title: "Sıra",
                            dataIndex: "sirketSirasi",
                            width: 80,
                            align: "center" as const,
                            render: (v: number) =>
                              v > 0 ? `#${v}` : <Text type="secondary">—</Text>,
                          },
                        ]}
                      />
                    ),
                  }))}
                />
              )}
            </Card>
          )}
        </>
      )}

      {/* --------------------------------------------- puan kırılımı */}
      <Drawer
        open={!!detayKisi}
        onClose={() => setDetayKisi(null)}
        width="min(640px, 96vw)"
        title={
          detayKisi && (
            <Space size={8} wrap>
              <Text strong>
                {detayKisi.ad} {detayKisi.soyad}
              </Text>
              {detayKisi.gorevAdi && (
                <Tag color="blue">{detayKisi.gorevAdi}</Tag>
              )}
              {donem && (
                <Tag>
                  {donem.split("-")[0]} /{" "}
                  {String(donem.split("-")[1]).padStart(2, "0")}
                </Tag>
              )}
            </Space>
          )
        }
      >
        {detayYukleniyor ? (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <Spin />
          </div>
        ) : !detay?.bulundu || detay.donemler.length === 0 ? (
          <Empty description="Bu dönem için değerlendirme bulunamadı." />
        ) : (
          (() => {
            /* Seçili dönem ve bir öncesi. Karşılaştırma, takvim ayına
               değil listedeki sıraya göre yapılır: değerlendirme her ay
               yapılmayabiliyor, "geçen ay" yerine "bir önceki dönem"
               doğru olan. */
            const sirali = detay.donemler;

            const sira = perfDonemSec
              ? sirali.findIndex(
                  (d: any) => `${d.yil}-${d.ay}` === perfDonemSec
                )
              : 0;

            const simdi = sirali[sira < 0 ? 0 : sira];
            const onceki = sirali[(sira < 0 ? 0 : sira) + 1];

            if (!simdi) return <Empty description="Dönem bulunamadı." />;

            const kisi = detay.kisi;

            return [simdi].map((d: any, i: number) => (
            <div key={i}>
              {/* ------------------------------------- personel künyesi */}
              <div className="cm-kisi" style={{ marginBottom: 14 }}>
                <Avatar
                  size={52}
                  src={
                    kisi?.personelKodu
                      ? api.resimAdresi(kisi.personelKodu)
                      : undefined
                  }
                  style={{
                    background: "var(--yesil-acik)",
                    color: "var(--yesil-koyu)",
                    fontSize: 16,
                    fontWeight: 700,
                    flex: "0 0 auto",
                  }}
                >
                  {`${detayKisi?.ad ?? ""} ${detayKisi?.soyad ?? ""}`
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((x) => x[0])
                    .join("")}
                </Avatar>

                <div className="cm-kisi-govde">
                  <p className="cm-kisi-ad">
                    {detayKisi?.ad} {detayKisi?.soyad}
                  </p>

                  <Space size={6} wrap style={{ marginBottom: 5 }}>
                    {d.gorevAdi && <Tag color="green">{d.gorevAdi}</Tag>}
                    {d.subeAdi && <Tag>{d.subeAdi}</Tag>}
                    {kisi?.cikisTarihi && <Tag color="orange">ayrıldı</Tag>}
                  </Space>

                  <div className="cm-kisi-meta">
                    {kisi?.personelKodu && <span>Sicil {kisi.personelKodu}</span>}
                    {kisi?.telefon && <span>{kisi.telefon}</span>}
                    {kisi?.girisTarihi && (
                      <span>
                        Giriş {dayjs(kisi.girisTarihi).format("DD.MM.YYYY")}
                      </span>
                    )}
                    {kisi?.cikisTarihi && (
                      <span>
                        Çıkış {dayjs(kisi.cikisTarihi).format("DD.MM.YYYY")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="cm-kisi-islem">
                  {d.sirketSirasi > 0 && (
                    <Tooltip title="Şirket genelindeki sıralaması">
                      <Tag color="purple">#{d.sirketSirasi}</Tag>
                    </Tooltip>
                  )}
                  <Tag color="green">
                    {(d.magazaToplam ?? 0) + (d.yetkinlikToplam ?? 0)} puan
                  </Tag>
                </div>
              </div>

              {/* -------------------------------------- dönem seçimi */}
              <Space wrap style={{ marginBottom: 12 }}>
                <Select
                  size="small"
                  style={{ width: 150 }}
                  value={`${d.yil}-${d.ay}`}
                  onChange={setPerfDonemSec}
                  options={sirali.map((x: any) => ({
                    value: `${x.yil}-${x.ay}`,
                    label: `${x.yil} / ${String(x.ay).padStart(2, "0")}`,
                  }))}
                />

                {onceki ? (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>
                    {onceki.yil} / {String(onceki.ay).padStart(2, "0")} dönemiyle
                    karşılaştırılıyor
                  </Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>
                    Karşılaştırılacak önceki dönem yok
                  </Text>
                )}
              </Space>

              {/* ------------------------------------ değişim özeti */}
              {onceki && (
                <Card size="small" style={{ marginBottom: 12 }}>
                  <Row gutter={[10, 10]}>
                    {[
                      {
                        ad: "Mağaza",
                        simdi: d.magazaToplam ?? 0,
                        onceki: onceki.magazaToplam ?? 0,
                      },
                      {
                        ad: "Yetkinlik",
                        simdi: d.yetkinlikToplam ?? 0,
                        onceki: onceki.yetkinlikToplam ?? 0,
                      },
                      {
                        ad: "Toplam",
                        simdi:
                          (d.magazaToplam ?? 0) + (d.yetkinlikToplam ?? 0),
                        onceki:
                          (onceki.magazaToplam ?? 0) +
                          (onceki.yetkinlikToplam ?? 0),
                      },
                    ].map((x) => {
                      const fark = x.simdi - x.onceki;

                      return (
                        <Col xs={8} key={x.ad}>
                          <Text type="secondary" style={{ fontSize: 11.5 }}>
                            {x.ad}
                          </Text>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>
                            {x.simdi}
                          </div>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color:
                                fark > 0
                                  ? "#5f8c10"
                                  : fark < 0
                                  ? "#cf1322"
                                  : "#6b7280",
                            }}
                          >
                            {fark > 0 ? "▲ +" : fark < 0 ? "▼ " : "● "}
                            {fark === 0 ? "değişmedi" : fark}
                          </Text>
                        </Col>
                      );
                    })}
                  </Row>
                </Card>
              )}

              {[
                {
                  baslik: "Mağaza Performansı",
                  olcutler: donemAyrinti(detay, d)?.magaza ?? detay.magazaOlcutleri,
                  toplam: d.magazaToplam,
                  agirlik: donemAyrinti(detay, d)?.magazaAgirlik,
                },
                {
                  baslik: "Yetkinlik Ölçütleri",
                  olcutler: donemAyrinti(detay, d)?.yetkinlik ?? detay.yetkinlikOlcutleri,
                  toplam: d.yetkinlikToplam,
                  agirlik: donemAyrinti(detay, d)?.yetkinlikAgirlik,
                },
              ].filter((b) => !donemAyrinti(detay, d) || b.olcutler.length > 0).map((bolum) => {
                /* Boş hücre "veri girilmedi", 0 ise "puan alamadı".
                   İkisini ayırmazsak girilmemiş ölçüt sıfır almış gibi
                   görünür ve haksız bir tablo çıkar. */
                const dolu = bolum.olcutler.filter(
                  (o: string) =>
                    d[o] !== null && d[o] !== undefined && d[o] !== ""
                );

                const bos = bolum.olcutler.length - dolu.length;

                return (
                  <Card
                    key={bolum.baslik}
                    size="small"
                    style={{ marginBottom: 12 }}
                    title={
                      <Space size={8} wrap>
                        <Text strong style={{ fontSize: 13 }}>
                          {bolum.baslik}
                          {bolum.agirlik ? <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}> (ortalamanın %{bolum.agirlik}'ünü oluşturur)</Text> : null}
                        </Text>
                        <Tag color="green">{bolum.toplam ?? 0} puan</Tag>
                        {bos > 0 && (
                          <Text type="secondary" style={{ fontSize: 11.5 }}>
                            {bos} ölçütün verisi girilmemiş
                          </Text>
                        )}
                      </Space>
                    }
                  >
                    {dolu.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        Bu dönem için veri girilmemiş.
                      </Text>
                    ) : (
                      dolu.map((o: string) => (
                        <div
                          key={o}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "6px 0",
                            borderBottom: "1px solid #f0f2ee",
                            fontSize: 13,
                          }}
                        >
                          <span>
                            {o}

                            {/* Şirket ortalaması ve referans puan: "0"
                                tek başına neyin kaçırıldığını söylemiyor. */}
                            {donemAyrinti(detay, d)?.satirlar?.[o] ? (
                              <OlcutBilgi s={donemAyrinti(detay, d).satirlar[o]} puan={d[o]} />
                            ) : donemAyrinti(detay, d) ? null : (() => {
                              const ort = detay.ortalamalar?.[o];
                              const ref = detay.referanslar?.[o];
                              const puan = Number(d[o]);

                              const parcalar: string[] = [];

                              /* Şirket ortalaması ile kişinin puanı her
                                 satırda yan yana yazılır. */
                              if (ort !== null && ort !== undefined)
                                parcalar.push(
                                  `Şirket Ortalaması: ${ort} — Sizin Puanınız: ${
                                    Number.isFinite(puan) ? puan : "—"
                                  }`
                                );

                              if (
                                puan <= 0 &&
                                ref !== null &&
                                ref !== undefined &&
                                Number(ref) > 0
                              )
                                parcalar.push(
                                  `Şirket ortalamasının altında kaldığınız için bu ` +
                                    `bölümden puan alamadınız — (Referans Puan: ${ref})`
                                );

                              if (parcalar.length === 0) return null;

                              return (
                                <div
                                  style={{
                                    fontSize: 11.5,
                                    color: puan <= 0 ? "#cf1322" : "#8a8f98",
                                    marginTop: 1,
                                  }}
                                >
                                  {parcalar.map((x, i2) => (
                                    <div key={i2}>{x}</div>
                                  ))}
                                </div>
                              );
                            })()}
                          </span>

                          <Space size={8}>
                            {/* Önceki dönemle fark: hangi ölçütte
                                ilerleme olduğu satır satır görünsün. */}
                            {onceki &&
                              onceki[o] !== null &&
                              onceki[o] !== undefined &&
                              onceki[o] !== "" &&
                              (() => {
                                const fark = Number(d[o]) - Number(onceki[o]);

                                if (fark === 0)
                                  return (
                                    <Text
                                      type="secondary"
                                      style={{ fontSize: 11.5 }}
                                    >
                                      aynı
                                    </Text>
                                  );

                                return (
                                  <Text
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: fark > 0 ? "#5f8c10" : "#cf1322",
                                    }}
                                  >
                                    {fark > 0 ? `▲ +${fark}` : `▼ ${fark}`}
                                  </Text>
                                );
                              })()}

                            <b
                              style={{
                                color:
                                  Number(d[o]) > 0 ? "#5f8c10" : "#e8481c",
                              }}
                            >
                              {d[o]}
                            </b>
                          </Space>
                        </div>
                      ))
                    )}
                  </Card>
                );
              })}
            </div>
            ));
          })()
        )}
      </Drawer>
    </div>
  );
}

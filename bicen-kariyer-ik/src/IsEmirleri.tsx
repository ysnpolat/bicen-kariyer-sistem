/**
 * ---------------------------------------------------------------------------
 * İş Emirleri
 * ---------------------------------------------------------------------------
 * Geriye dönük tüm iş emirleri tek yerde. Üç sekme:
 *
 *  1. Bana atananlar — açık ve kapanmış işlerim
 *  2. Attıklarım — başkalarına verdiğim işler ve durumları
 *  3. Yeni ata — kayda bağlı olmayan serbest iş emri
 *
 * Bildirim çekmecesindeki kartlar kısa özet verir; ayrıntı burada açılır.
 * Emre tıklanınca açılan pencerede işin tamamı görünür: açıklama, ilgili
 * kayıt, kim ne zaman gördü, bitirirken ne yazdı.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Progress,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import IsIcerik, { ilerlemeHesapla } from "./IsIcerik";
import { ClipboardList, Send } from "lucide-react";

import { api, oturumOku } from "./api";
import { EKRAN_SEKME, sayfayaGit } from "./gecis";
import IsEmriAta from "./IsEmriAta";

const { Text, Title, Paragraph } = Typography;

const DURUM_RENGI: Record<string, string> = {
  Yeni: "purple",
  Görüldü: "blue",
  Bitti: "green",
  İptal: "default",
};

/** Atama yapabilen roller; sunucudaki yetkiyle aynı */
const ATAMA_ROLLERI = ["Admin", "IKYoneticisi", "GenelMudurYardimcisi"];

export default function IsEmirleri() {
  const { message } = AntdApp.useApp();
  const oturum = oturumOku();

  const yetkili = !!oturum && ATAMA_ROLLERI.includes(oturum.rol);

  const [sekme, setSekme] = useState("bana");
  const [bana, setBana] = useState<any[]>([]);
  const [attiklarim, setAttiklarim] = useState<any[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [secili, setSecili] = useState<any>(null);

  /* İçerik blokları ve doldurulan değerler ayrı tutuluyor: işi atan neyi
     verdiğini, atanan neyi doldurduğunu ayrı görmeli. */
  const [bloklar, setBloklar] = useState<any[]>([]);
  const [doldurma, setDoldurma] = useState<Record<string, any>>({});
  const [icerikDuzenle, setIcerikDuzenle] = useState(false);
  const [icerikKaydediliyor, setIcerikKaydediliyor] = useState(false);

  /* Kayıt açılınca JSON çözülüyor; bozuk içerik ekranı kilitlemesin diye
     ayrıştırma hatası yutuluyor ve boş içerik gösteriliyor. */
  useEffect(() => {
    if (!secili) return;

    const coz = (m: any, varsayilan: any) => {
      try {
        return m ? JSON.parse(m) : varsayilan;
      } catch {
        return varsayilan;
      }
    };

    setBloklar(coz(secili.icerik, []));
    setDoldurma(coz(secili.doldurma, {}));
    setIcerikDuzenle(false);
  }, [secili]);

  const ilerleme = useMemo(
    () => ilerlemeHesapla(bloklar as any, doldurma),
    [bloklar, doldurma]
  );

  /**
   * İçeriği düzenleme hakkı.
   *
   * Kayıt "Attıklarım" sekmesinden geliyorsa zaten bu kullanıcının attığı
   * iştir; ayrıca atayan alanı karşılaştırılıyor çünkü aynı pencere
   * "Bana atananlar" sekmesinden de açılabiliyor.
   */
  const atayanBenim = (k: any) =>
    !!k &&
    (sekme === "attiklarim" ||
      String(k.atayan ?? "").toLowerCase() ===
        String(oturum?.kullaniciAdi ?? "").toLowerCase());

  /**
   * Ayrıntı penceresini açar.
   *
   * Liste ucu içerik alanlarını döndürmüyor — otuz işi listelerken her
   * birinin çizelgesini taşımak gereksiz. Pencere açılırken tam kayıt ayrı
   * isteniyor; gelmezse listedeki özetle açılıyor ki pencere hiç
   * açılmamaktansa eksik açılsın.
   */
  const ayrintiAc = async (k: any) => {
    setSecili(k);

    try {
      const tam = await api.al<any>(`/api/IsEmri/${k.id}`);

      setSecili(tam);
    } catch {
      /* Özet kayıtla devam */
    }
  };

  /**
   * İçeriği şablon olarak kaydeder.
   *
   * Ad sorulup kaydediliyor; iş atama penceresindeki şablon listesinde
   * kendiliğinden görünüyor.
   */
  const sablonYap = () => {
    if (bloklar.length === 0) {
      message.warning("Önce çizelge oluşturunuz.");
      return;
    }

    let ad = secili?.baslik ?? "";

    Modal.confirm({
      title: "Şablon olarak kaydet",
      content: (
        <Input
          defaultValue={ad}
          placeholder="Şablon adı"
          onChange={(e) => {
            ad = e.target.value;
          }}
        />
      ),
      okText: "Kaydet",
      cancelText: "Vazgeç",
      onOk: async () => {
        if (!ad.trim()) {
          message.warning("Şablon adı giriniz.");
          return;
        }

        try {
          await api.gonder("/api/IsEmri/Sablon", {
            ad: ad.trim(),
            aciklama: null,
            icerik: JSON.stringify(bloklar),
          });

          message.success("Şablon kaydedildi.");
        } catch (h) {
          message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
        }
      },
    });
  };

  const icerikKaydet = async () => {
    if (!secili) return;

    setIcerikKaydediliyor(true);

    try {
      await api.gonder(`/api/IsEmri/${secili.id}/Icerik`, {
        icerik: JSON.stringify(bloklar),
      });

      message.success("İçerik kaydedildi.");
      setIcerikDuzenle(false);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setIcerikKaydediliyor(false);
    }
  };

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const istekler: Promise<any>[] = [
        api.al<any[]>("/api/IsEmri/Bana?tumu=true"),
      ];

      if (yetkili) istekler.push(api.al<any[]>("/api/IsEmri/Attiklarim"));

      const [b, a] = await Promise.all(istekler);

      setBana(b ?? []);
      setAttiklarim(a ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [yetkili, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const ortakSutunlar = [
    {
      title: "İş",
      dataIndex: "baslik",
      render: (v: string, k: any) => (
        <div>
          <Text strong>{v}</Text>
          {k.oncelik === "Acil" && (
            <Tag color="red" style={{ marginLeft: 8 }}>
              Acil
            </Tag>
          )}
          {k.kaynakBaslik && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {k.kaynakBaslik}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Durum",
      dataIndex: "durum",
      width: 110,
      render: (v: string) => <Tag color={DURUM_RENGI[v] ?? "default"}>{v}</Tag>,
    },
    {
      title: "Oluşturma",
      dataIndex: "olusturma",
      width: 140,
      render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm"),
    },
    {
      title: "",
      width: 90,
      render: (_: any, k: any) => (
        <Button size="small" onClick={() => ayrintiAc(k)}>
          Ayrıntı
        </Button>
      ),
    },
  ];

  const banaSutunlar = [
    ortakSutunlar[0],
    { title: "Atayan", dataIndex: "atayanAd", width: 180 },
    ...ortakSutunlar.slice(1),
  ];

  const attiklarimSutunlar = [
    ortakSutunlar[0],
    {
      title: "Atanan",
      dataIndex: "atananAd",
      width: 200,
      render: (v: string, k: any) => (
        <Space size={6}>
          <Text>{v}</Text>
          <Tag>{k.atananTur === "panel" ? "panel" : "mağaza"}</Tag>
        </Space>
      ),
    },
    ...ortakSutunlar.slice(1),
  ];

  return (
    /* Sayfa kendi kenar boşluğunu kuruyor; sarmalayıcı unutulunca içerik
       sol menüye ve sağ kenara yapışıyordu. */
    <div className="ik-icerik">
      <Tabs
        activeKey={sekme}
        onChange={setSekme}
        tabBarExtraContent={
          yetkili ? (
            <IsEmriAta ekran="isemri" tip="primary" />
          ) : null
        }
        items={[
          {
            key: "bana",
            label: (
              <Space size={6}>
                <ClipboardList size={15} strokeWidth={2} />
                Bana atananlar
              </Space>
            ),
            children: (
              <Table
                rowKey="id"
                loading={yukleniyor}
                dataSource={bana}
                columns={banaSutunlar}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                locale={{
                  emptyText: <Empty description="Size atanmış iş yok." />,
                }}
              />
            ),
          },

          ...(yetkili
            ? [
                {
                  key: "attiklarim",
                  label: (
                    <Space size={6}>
                      <Send size={15} strokeWidth={2} />
                      Attıklarım
                    </Space>
                  ),
                  children: (
                    <Table
                      rowKey="id"
                      loading={yukleniyor}
                      dataSource={attiklarim}
                      columns={attiklarimSutunlar}
                      pagination={{ pageSize: 20, hideOnSinglePage: true }}
                      locale={{
                        emptyText: <Empty description="Henüz iş atamadınız." />,
                      }}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      {/* ===================================================== ayrıntı penceresi */}
      <Modal
        open={!!secili}
        onCancel={() => setSecili(null)}
        footer={null}
        width={620}
        title={
          secili && (
            <Space size={8}>
              <ClipboardList size={17} strokeWidth={2} color="#E8481C" />
              <span>{secili.baslik}</span>
            </Space>
          )
        }
      >
        {secili && (
          <>
            <Space wrap size={6} style={{ marginBottom: 12 }}>
              <Tag color={DURUM_RENGI[secili.durum] ?? "default"}>
                {secili.durum}
              </Tag>
              {secili.oncelik === "Acil" && <Tag color="red">Acil</Tag>}
              {secili.sonTarih && (
                <Tag>Son tarih: {dayjs(secili.sonTarih).format("DD.MM.YYYY")}</Tag>
              )}
            </Space>

            <Card size="small" title="İş tanımı" style={{ marginBottom: 12 }}>
              <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                {secili.aciklama || "Açıklama girilmemiş."}
              </Paragraph>
            </Card>

            {/* Yapılandırılmış içerik: tablo, kontrol listesi ve biçimli
                metin. Düzenleme yalnızca işi atana açık; kilitli sütunların
                anlamı buna bağlı. */}
            <Card
              size="small"
              title="İçerik"
              style={{ marginBottom: 12 }}
              extra={
                atayanBenim(secili) && (
                  <Space size={6}>
                    {icerikDuzenle ? (
                      <>
                        <Button size="small" onClick={() => setIcerikDuzenle(false)}>
                          Vazgeç
                        </Button>

                        {/* Şablon: aynı çizelge her hafta yeniden
                            kuruluyordu. */}
                        <Button size="small" onClick={sablonYap}>
                          Şablon yap
                        </Button>

                        <Button
                          size="small"
                          type="primary"
                          loading={icerikKaydediliyor}
                          onClick={icerikKaydet}
                        >
                          Kaydet
                        </Button>
                      </>
                    ) : (
                      <Button size="small" onClick={() => setIcerikDuzenle(true)}>
                        Düzenle
                      </Button>
                    )}
                  </Space>
                )
              }
            >
              <IsIcerik
                bloklar={bloklar}
                setBloklar={setBloklar}
                doldurma={doldurma}
                setDoldurma={setDoldurma}
                kip={icerikDuzenle ? "duzenle" : "goster"}
              />

              {ilerleme !== null && !icerikDuzenle && (
                <div style={{ marginTop: 10 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    İlerleme
                  </Text>
                  <Progress percent={ilerleme} size="small" />
                </div>
              )}
            </Card>

            <Card size="small" title="Bilgiler" style={{ marginBottom: 12 }}>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Text>
                  <Text type="secondary">Atayan: </Text>
                  {secili.atayanAd}
                </Text>

                {secili.atananAd && (
                  <Text>
                    <Text type="secondary">Atanan: </Text>
                    {secili.atananAd}
                  </Text>
                )}

                <Text>
                  <Text type="secondary">Oluşturma: </Text>
                  {dayjs(secili.olusturma).format("DD.MM.YYYY HH:mm")}
                </Text>

                {secili.kaynakBaslik && (
                  <Space>
                    <Text type="secondary">İlgili kayıt:</Text>
                    <Text>{secili.kaynakBaslik}</Text>

                    {secili.kaynakEkran &&
                    secili.kaynakId &&
                    EKRAN_SEKME[secili.kaynakEkran] ? (
                      <Button
                        size="small"
                        onClick={() => {
                          setSecili(null);
                          sayfayaGit(
                            EKRAN_SEKME[secili.kaynakEkran],
                            secili.kaynakId
                          );
                        }}
                      >
                        Kaydı aç
                      </Button>
                    ) : null}
                  </Space>
                )}
              </Space>
            </Card>

            {secili.durum === "Bitti" && (
              <Card size="small" title="Yapılan iş">
                <Paragraph style={{ whiteSpace: "pre-wrap" }}>
                  {secili.sonuc}
                </Paragraph>

                <Text type="secondary" style={{ fontSize: 12 }}>
                  {secili.bitirenAd} ·{" "}
                  {secili.bitisTarihi
                    ? dayjs(secili.bitisTarihi).format("DD.MM.YYYY HH:mm")
                    : ""}
                </Text>
              </Card>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

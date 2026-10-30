/**
 * Uygulama yardım videoları
 * ---------------------------------------------------------------------------
 * Mobil uygulamada her sayfanın başlığında hareketli bir çiçek duruyor;
 * dokununca o sayfanın nasıl kullanıldığını anlatan video açılıyor. Bu
 * ekrandan her sayfanın videosu izleniyor, yenisi yükleniyor ya da
 * uygulamada gizleniyor.
 *
 * Uygulamayla hazır gelen videolar var ("Hazır"). Yüklenen video onun
 * yerine geçiyor; silinince hazır videoya dönülüyor. Videosu olmayan ya da
 * kapatılan sayfada çiçek görünmüyor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Modal, Popconfirm, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { Play, RotateCcw, Trash2, Upload } from "lucide-react";

import { api, API_TABAN, oturumOku } from "./api";

const { Text } = Typography;

interface Sayfa {
  kod: string;
  ad: string;
  var: boolean;
  kaynak: "hazir" | "yuklenen" | null;
  kapali: boolean;
  boyut: number;
  tarih: string | null;
}

const boyutYaz = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;

export default function YardimVideolari() {
  const { message } = AntdApp.useApp();

  const [sayfalar, setSayfalar] = useState<Sayfa[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [isleniyor, setIsleniyor] = useState<string | null>(null);
  const [izlenen, setIzlenen] = useState<Sayfa | null>(null);

  const dosyaGirdisi = useRef<HTMLInputElement>(null);
  const hedefKod = useRef<string | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const c = await api.al<{ sayfalar: Sayfa[] }>("/api/YardimVideo");
      setSayfalar(c.sayfalar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const dosyaSec = (kod: string) => {
    hedefKod.current = kod;
    if (dosyaGirdisi.current) {
      dosyaGirdisi.current.value = "";
      dosyaGirdisi.current.click();
    }
  };

  const yukle = async (dosya: File) => {
    const kod = hedefKod.current;
    if (!kod) return;

    if (!dosya.name.toLowerCase().endsWith(".mp4")) {
      message.error("Yalnızca MP4 video yüklenebilir.");
      return;
    }

    const form = new FormData();
    form.append("dosya", dosya);

    setIsleniyor(kod);
    try {
      await api.dosyaGonder(`/api/YardimVideo/${encodeURIComponent(kod)}`, form);
      message.success("Video yüklendi. Uygulama bir sonraki açılışta yeni videoyu gösterir.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yüklenemedi.");
    } finally {
      setIsleniyor(null);
    }
  };

  const sil = async (kod: string) => {
    setIsleniyor(kod);
    try {
      await api.sil(`/api/YardimVideo/${encodeURIComponent(kod)}`);
      message.success("Yüklenen video kaldırıldı.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    } finally {
      setIsleniyor(null);
    }
  };

  const durum = async (kod: string, acik: boolean) => {
    setIsleniyor(kod);
    try {
      await api.gonder("/api/YardimVideo/Durum", { kod, acik });
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setIsleniyor(null);
    }
  };

  const izleAdresi = (s: Sayfa) => {
    const o = oturumOku();
    return o
      ? `${API_TABAN}/api/YardimVideo/Izle/${encodeURIComponent(s.kod)}?t=${encodeURIComponent(o.token)}&v=${
          s.tarih ?? ""
        }`
      : "";
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 14 }} wrap>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Uygulamada sayfa başlığındaki çiçeğe dokunulunca o sayfanın videosu açılır. Videosu olmayan ya da
          kapatılan sayfada çiçek görünmez. Dikey (telefon ekranı) MP4 video önerilir.
        </Text>
        <Tooltip title="Yenile">
          <Button icon={<RotateCcw size={15} strokeWidth={2} />} onClick={getir} />
        </Tooltip>
      </Space>

      <input
        ref={dosyaGirdisi}
        type="file"
        accept="video/mp4"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) yukle(f);
        }}
      />

      <Table<Sayfa>
        rowKey="kod"
        size="middle"
        loading={yukleniyor}
        pagination={false}
        dataSource={sayfalar}
        columns={[
          {
            title: "Sayfa",
            render: (_, s) => (
              <div>
                <div style={{ fontWeight: 600 }}>{s.ad}</div>
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  {s.kod}
                </Text>
              </div>
            ),
          },
          {
            title: "Video",
            width: 230,
            render: (_, s) =>
              !s.var ? (
                <Tag>Yok</Tag>
              ) : (
                <Space size={6} wrap>
                  <Tag color={s.kaynak === "yuklenen" ? "blue" : "green"}>
                    {s.kaynak === "yuklenen" ? "Yüklenen" : "Hazır"}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {boyutYaz(s.boyut)}
                    {s.tarih ? ` · ${dayjs(s.tarih).format("DD.MM.YYYY")}` : ""}
                  </Text>
                </Space>
              ),
          },
          {
            title: "Uygulamada",
            width: 120,
            render: (_, s) => (
              <Switch
                size="small"
                checked={s.var && !s.kapali}
                disabled={!s.var || isleniyor === s.kod}
                onChange={(acik) => durum(s.kod, acik)}
              />
            ),
          },
          {
            title: "",
            width: 290,
            align: "right",
            render: (_, s) => (
              <Space size={6}>
                <Button size="small" icon={<Play size={14} />} disabled={!s.var} onClick={() => setIzlenen(s)}>
                  İzle
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<Upload size={14} />}
                  loading={isleniyor === s.kod}
                  onClick={() => dosyaSec(s.kod)}
                >
                  {s.var ? "Değiştir" : "Yükle"}
                </Button>
                {s.kaynak === "yuklenen" && (
                  <Popconfirm
                    title="Yüklenen video kaldırılsın mı?"
                    description="Varsa uygulamayla gelen hazır videoya dönülür."
                    okText="Kaldır"
                    cancelText="Vazgeç"
                    onConfirm={() => sil(s.kod)}
                  >
                    <Button size="small" danger icon={<Trash2 size={14} />} />
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={!!izlenen}
        title={izlenen ? `Yardım videosu · ${izlenen.ad}` : ""}
        footer={null}
        width={420}
        destroyOnClose
        onCancel={() => setIzlenen(null)}
      >
        {izlenen && (
          <video
            src={izleAdresi(izlenen)}
            controls
            autoPlay
            style={{ width: "100%", maxHeight: "70vh", background: "#000", borderRadius: 10 }}
          />
        )}
      </Modal>
    </div>
  );
}

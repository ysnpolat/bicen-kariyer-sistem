/**
 * ---------------------------------------------------------------------------
 * Personel Fotoğrafı Yükleme
 * ---------------------------------------------------------------------------
 * Seçilen görsel tarayıcıda küçültülüp sıkıştırılır, sonra Mikro'ya yazılır.
 * Fotoğraf Mikro'nun kendi arayüzünde de görünür.
 *
 * Mikro üretim veritabanı olduğu için yazma öncesi mevcut hâl yedeklenir.
 * Bu ekrandan geçmiş görüntülenebilir ve gerektiğinde işlem geri alınabilir.
 * ---------------------------------------------------------------------------
 */

import { useRef, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { Camera, History, RotateCcw, Upload } from "lucide-react";

import { api } from "./api";

const { Text, Paragraph } = Typography;

/**
 * Çıktı ölçüleri.
 *
 * Mikro'nun personel kartındaki fotoğraf kutusu vesikalık oranındadır (3:4).
 * Görsel bu orana kırpılmazsa kutuya sığdırılırken kenarlarda boşluk kalır.
 * Bu yüzden ortadan kırpılıp tam olarak bu ölçülere getirilir.
 */
const GENISLIK = 480;
const YUKSEKLIK = 640;

/** JPEG sıkıştırma oranı */
const KALITE = 0.85;

export default function ResimYukle({
  personelKodu,
  personelAdi,
  yuklendi,
  gorunum = "dugme",
}: {
  personelKodu: string;
  personelAdi?: string;
  yuklendi?: () => void;
  /**
   * "kaplama": personel kartındaki fotoğrafın üzerinde iki küçük simge
   * (yükle sağ altta, geçmiş sol altta; Personeller.css "pl-foto-*").
   */
  gorunum?: "dugme" | "kaplama";
}) {
  const { message } = AntdApp.useApp();
  const dosyaRef = useRef<HTMLInputElement>(null);

  const [isleniyor, setIsleniyor] = useState(false);
  const [gecmisAcik, setGecmisAcik] = useState(false);
  const [gecmis, setGecmis] = useState<any[]>([]);
  const [gecmisYukleniyor, setGecmisYukleniyor] = useState(false);

  /**
   * Görseli vesikalık oranına kırpar, küçültür ve JPEG'e çevirir.
   *
   * Kırpma ortadan yapılır: geniş bir fotoğrafta sağ ve sol kenarlar,
   * uzun bir fotoğrafta alt ve üst kesilir. Yüz genellikle ortada ve üst
   * yarıda olduğu için dikey kırpmada üstten daha az kesilir.
   */
  const kucult = (dosya: File): Promise<string> =>
    new Promise((coz, hata) => {
      const okuyucu = new FileReader();

      okuyucu.onerror = () => hata(new Error("Dosya okunamadı."));

      okuyucu.onload = () => {
        const resim = new Image();

        resim.onerror = () => hata(new Error("Görsel açılamadı."));

        resim.onload = () => {
          const hedefOran = GENISLIK / YUKSEKLIK;
          const kaynakOran = resim.width / resim.height;

          /* Kaynaktan alınacak bölge; hedef orana göre ortadan seçilir */
          let kesGenislik = resim.width;
          let kesYukseklik = resim.height;
          let kesX = 0;
          let kesY = 0;

          if (kaynakOran > hedefOran) {
            /* Fotoğraf hedeften geniş: yanlardan kırpılır */
            kesGenislik = resim.height * hedefOran;
            kesX = (resim.width - kesGenislik) / 2;
          } else if (kaynakOran < hedefOran) {
            /* Fotoğraf hedeften uzun: alt ve üstten kırpılır.
               Yüz üst yarıda olduğu için üstten daha az kesilir. */
            kesYukseklik = resim.width / hedefOran;
            kesY = (resim.height - kesYukseklik) * 0.35;
          }

          const tuval = document.createElement("canvas");
          tuval.width = GENISLIK;
          tuval.height = YUKSEKLIK;

          const baglam = tuval.getContext("2d");

          if (!baglam) {
            hata(new Error("Görsel işlenemedi."));
            return;
          }

          /* Beyaz zemin: şeffaf PNG'ler JPEG'de siyah çıkmasın */
          baglam.fillStyle = "#ffffff";
          baglam.fillRect(0, 0, GENISLIK, YUKSEKLIK);

          baglam.drawImage(
            resim,
            kesX, kesY, kesGenislik, kesYukseklik,
            0, 0, GENISLIK, YUKSEKLIK
          );

          coz(tuval.toDataURL("image/jpeg", KALITE));
        };

        resim.src = okuyucu.result as string;
      };

      okuyucu.readAsDataURL(dosya);
    });

  const dosyaSecildi = async (olay: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = olay.target.files?.[0];
    if (!dosya) return;

    if (!dosya.type.startsWith("image/")) {
      message.error("Lütfen bir görsel dosyası seçiniz.");
      return;
    }

    setIsleniyor(true);

    try {
      const base64 = await kucult(dosya);

      const sonuc = await api.gonder<any>("/api/Personel/ResimYukle", {
        personelKodu,
        base64,
      });

      message.success(sonuc.mesaj ?? "Fotoğraf yüklendi.");
      yuklendi?.();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIsleniyor(false);
      if (dosyaRef.current) dosyaRef.current.value = "";
    }
  };

  const gecmisGetir = async () => {
    setGecmisAcik(true);
    setGecmisYukleniyor(true);

    try {
      setGecmis(
        await api.al<any[]>(
          `/api/Personel/ResimGecmisi?kod=${encodeURIComponent(personelKodu)}`
        )
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setGecmisYukleniyor(false);
    }
  };

  const geriAl = async (kayit: any) => {
    try {
      const sonuc = await api.gonder<any>(
        `/api/Personel/ResimGeriAl/${kayit.id}`,
        {}
      );

      message.success(sonuc.mesaj ?? "İşlem geri alındı.");
      gecmisGetir();
      yuklendi?.();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  return (
    <>
      <input
        ref={dosyaRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={dosyaSecildi}
      />

      {gorunum === "kaplama" ? (
        <>
          <Tooltip title="Fotoğraf yükle · Mikro'ya yazılır">
            <button
              type="button"
              className="pl-foto-yukle"
              aria-label="Fotoğraf yükle"
              disabled={isleniyor}
              onClick={() => dosyaRef.current?.click()}
            >
              {isleniyor ? <Spin size="small" /> : <Upload size={15} strokeWidth={2.2} />}
            </button>
          </Tooltip>

          <Tooltip title="Yükleme geçmişi ve geri alma">
            <button
              type="button"
              className="pl-foto-gecmis"
              aria-label="Fotoğraf yükleme geçmişi"
              onClick={gecmisGetir}
            >
              <History size={14} strokeWidth={2.2} />
            </button>
          </Tooltip>
        </>
      ) : (
      <Space size={6}>
        <Tooltip title="Fotoğrafı Mikro'ya yükle">
          <Button
            size="small"
            loading={isleniyor}
            icon={<Upload size={14} strokeWidth={2} />}
            onClick={() => dosyaRef.current?.click()}
          >
            Fotoğraf yükle
          </Button>
        </Tooltip>

        <Tooltip title="Yükleme geçmişi ve geri alma">
          <Button
            size="small"
            type="text"
            icon={<History size={14} strokeWidth={2} />}
            onClick={gecmisGetir}
          />
        </Tooltip>
      </Space>
      )}

      {/* ------------------------------------------------------------ geçmiş */}
      <Modal
        open={gecmisAcik}
        onCancel={() => setGecmisAcik(false)}
        footer={null}
        width={720}
        title={
          <Space size={8}>
            <Camera size={17} strokeWidth={2} />
            Fotoğraf Geçmişi
            {personelAdi && <Text type="secondary">{personelAdi}</Text>}
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ margin: "14px 0" }}
          message="Yüklenen her fotoğrafın öncesi yedeklenir"
          description="Mikro üretim veritabanıdır. Yazma öncesi mevcut hâl kendi veritabanımıza alınır; sorun çıkarsa buradan geri alabilirsiniz."
        />

        <Table
          rowKey="id"
          size="small"
          loading={gecmisYukleniyor}
          pagination={false}
          dataSource={gecmis}
          locale={{ emptyText: "Henüz fotoğraf yüklenmemiş." }}
          columns={[
            {
              title: "Tarih",
              dataIndex: "olusturma",
              width: 140,
              render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm"),
            },
            {
              title: "İşlem",
              dataIndex: "islem",
              width: 120,
              render: (v: string) => (
                <Tag color={v === "EKLEME" ? "green" : "blue"}>
                  {v === "EKLEME" ? "Yeni eklendi" : "Değiştirildi"}
                </Tag>
              ),
            },
            { title: "Yükleyen", dataIndex: "kullanici", ellipsis: true },
            {
              title: "Durum",
              key: "durum",
              width: 190,
              render: (_v: unknown, k: any) =>
                k.geriAlindi ? (
                  <Tooltip
                    title={
                      k.geriAlmaTarihi
                        ? dayjs(k.geriAlmaTarihi).format("DD.MM.YYYY HH:mm")
                        : undefined
                    }
                  >
                    <Tag>geri alındı</Tag>
                  </Tooltip>
                ) : (
                  <Popconfirm
                    title="İşlem geri alınsın mı?"
                    description={
                      k.islem === "EKLEME"
                        ? "Eklenen fotoğraf Mikro'dan silinecek."
                        : "Önceki fotoğraf geri yüklenecek."
                    }
                    okText="Geri al"
                    cancelText="Vazgeç"
                    onConfirm={() => geriAl(k)}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<RotateCcw size={13} strokeWidth={2} />}
                    >
                      Geri al
                    </Button>
                  </Popconfirm>
                ),
            },
          ]}
        />

        <Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
        >
          Görseller vesikalık oranına (3:4) ortadan kırpılıp 480×640 piksele
          getirilir; Mikro'daki fotoğraf kutusuna kenarlarda boşluk kalmadan
          oturur.
        </Paragraph>
      </Modal>
    </>
  );
}

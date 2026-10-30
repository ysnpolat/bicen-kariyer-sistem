/**
 * ---------------------------------------------------------------------------
 * Ürün Görselleri
 * ---------------------------------------------------------------------------
 * Fiyat sorgusunda görünen ürün fotoğrafları. Personel ürünü adından
 * değil görüntüsünden tanıyor; raf etiketini doğru ürüne takmak bununla
 * kolaylaşıyor.
 *
 * Toplu yüklemede dosya adı ürünü belirliyor: 8691415451.jpg gibi bir
 * barkod ya da doğrudan stok kodu. Binlerce ürünü tek tek eşleştirmek
 * günler sürerdi; klasörü olduğu gibi seçmek yeterli.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import { Search, Trash2, Upload } from "lucide-react";

import { API_TABAN, api } from "../api";

const { Text } = Typography;

/* ========================================================================== */

export default function UrunGorselleri() {
  const [kayitlar, setKayitlar] = useState<any[]>([]);
  const [ara, setAra] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);

  const [ilerleme, setIlerleme] = useState<number | null>(null);
  const [rapor, setRapor] = useState<{ eklenen: number; atlanan: string[] } | null>(
    null
  );

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.getir<{ kayitlar: any[] }>(
        `FiyatKontrol/GorselDokum?ara=${encodeURIComponent(ara.trim())}`
      );

      setKayitlar(c.kayitlar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [ara]);

  useEffect(() => {
    getir();
  }, [getir]);

  /**
   * Toplu yükleme.
   *
   * Dosyalar yirmişerlik gruplar hâlinde gönderiliyor: beş yüz dosyayı
   * tek istekte yollamak isteği zaman aşımına düşürüyor ve hiçbiri
   * yüklenmemiş oluyordu. Grup grup gidince ilerleme de gösterilebiliyor.
   */
  const topluYukle = async (dosyalar: FileList) => {
    const liste = Array.from(dosyalar);

    if (liste.length === 0) return;

    setIlerleme(0);
    setRapor(null);

    let eklenen = 0;
    const atlanan: string[] = [];

    const GRUP = 20;

    for (let i = 0; i < liste.length; i += GRUP) {
      const form = new FormData();

      liste.slice(i, i + GRUP).forEach((d) => form.append("dosyalar", d));

      try {
        const c = await api.dosyaGonder<{ eklenen: number; atlanan: string[] }>(
          "FiyatKontrol/GorselToplu",
          form
        );

        eklenen += c.eklenen ?? 0;
        atlanan.push(...(c.atlanan ?? []));
      } catch (h) {
        atlanan.push(
          `${i + 1}-${Math.min(i + GRUP, liste.length)} arası: ${
            h instanceof Error ? h.message : "gönderilemedi"
          }`
        );
      }

      setIlerleme(Math.round(((i + GRUP) / liste.length) * 100));
    }

    setIlerleme(null);
    setRapor({ eklenen, atlanan });
    getir();
  };

  const sil = async (id: number) => {
    try {
      await api.sil(`FiyatKontrol/Gorsel/${id}`);
      message.success("Görsel silindi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Silinemedi.");
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small" title="Toplu yükleme">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Dosya adı ürünü belirler"
          description="Her dosyanın adı ürünün barkodu ya da stok kodu olmalıdır: 8691415451.jpg ya da 36.001.001.71435.jpg gibi. Eşleşmeyen dosyalar atlanır ve aşağıda listelenir."
        />

        {/* Klasör seçimi: tek tek dosya seçmek beş yüz üründe
            kullanılamaz bir işti. */}
        <Space wrap>
          <input
          type="file"
          className="dosya-secici"
            multiple
            accept=".jpg,.jpeg,.png,.webp"
            disabled={ilerleme !== null}
            style={{ width: 320 }}
            onChange={(e) => {
              const d = e.target.files;

              if (d && d.length > 0) topluYukle(d);

              e.target.value = "";
            }}
          />

          <Text type="secondary" style={{ fontSize: 12 }}>
            Birden çok dosya seçebilirsiniz (Ctrl+A ile hepsi).
          </Text>
        </Space>

        {ilerleme !== null && (
          <div style={{ marginTop: 12 }}>
            <Progress percent={ilerleme} status="active" />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Yükleniyor, pencereyi kapatmayınız.
            </Text>
          </div>
        )}

        {rapor && (
          <Alert
            style={{ marginTop: 12 }}
            type={rapor.atlanan.length === 0 ? "success" : "warning"}
            showIcon
            message={`${rapor.eklenen} görsel yüklendi${
              rapor.atlanan.length > 0
                ? `, ${rapor.atlanan.length} dosya atlandı`
                : ""
            }`}
            description={
              rapor.atlanan.length > 0 && (
                <div style={{ maxHeight: 160, overflowY: "auto", fontSize: 12.5 }}>
                  {rapor.atlanan.map((x, i) => (
                    <div key={i}>{x}</div>
                  ))}
                </div>
              )
            }
          />
        )}
      </Card>

      <Space wrap>
        <Input
          allowClear
          prefix={<Search size={14} strokeWidth={2} />}
          placeholder="Stok kodu ya da dosya adı"
          style={{ width: 280 }}
          value={ara}
          onChange={(e) => setAra(e.target.value)}
        />

        <Text type="secondary" style={{ fontSize: 12 }}>
          {kayitlar.length} görsel
        </Text>
      </Space>

      {kayitlar.length === 0 && !yukleniyor ? (
        <Empty description="Henüz ürün görseli yüklenmedi." />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={yukleniyor}
          dataSource={kayitlar}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            {
              title: "",
              width: 70,
              render: (_: unknown, k: any) => (
                <img
                  src={`${API_TABAN}/api/FiyatKontrol/Gorsel/${k.id}`}
                  alt={k.stokKodu}
                  style={{
                    width: 52,
                    height: 52,
                    objectFit: "cover",
                    borderRadius: 8,
                    background: "#f5f7f3",
                  }}
                />
              ),
            },
            {
              title: "Ürün",
              dataIndex: "urunAdi",
              render: (a: string, k: any) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{a || "Ürün bulunamadı"}</div>
                  <div style={{ fontSize: 12, color: "#8a9196" }}>{k.stokKodu}</div>
                </div>
              ),
            },
            {
              title: "Dosya",
              dataIndex: "ozgunAd",
              width: 220,
              ellipsis: true,
              render: (d: string) => (
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {d}
                </Text>
              ),
            },
            {
              title: "Kapak",
              dataIndex: "kapak",
              width: 90,
              render: (k: boolean) => (k ? <Tag color="green">Kapak</Tag> : null),
            },
            {
              title: "Yüklenme",
              dataIndex: "olusturma",
              width: 150,
              render: (t: string) => dayjs(t).format("DD.MM.YYYY HH:mm"),
            },
            {
              title: "",
              width: 50,
              render: (_: unknown, k: any) => (
                <Popconfirm
                  title="Görsel silinsin mi?"
                  okText="Sil"
                  cancelText="Vazgeç"
                  onConfirm={() => sil(k.id)}
                >
                  <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      )}
    </Space>
  );
}

/**
 * Her yerden karekodu (21.10.2026).
 *
 * Tek bir karekod: Okutma Kuralları'nda "Her yerden okutabilir" kuralı
 * verilen personel bunu konum sınırı olmadan okutabilir (şubede değilken,
 * sahada, toplantıda). Diğer personel okutursa reddedilir ve red kaydı düşer.
 * Kayıt "Her yerden · <şubesi>" olarak, konum geldiyse koordinatıyla yazılır.
 */
import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Card, Space, Tag, Typography } from "antd";
import { Globe, Printer, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { api } from "./api";

const { Text } = Typography;

export default function HerYerdenKarekod({ kuralAc }: { kuralAc?: () => void }) {
  const { message, modal } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ kod: string | null; kisi: number; son30: number } | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);
  const tuval = useRef<HTMLCanvasElement>(null);

  const getir = () =>
    api
      .al<any>("/api/OkutmaKural/SerbestKod")
      .then(setVeri)
      .catch((h) => message.error(h.message));

  useEffect(() => {
    getir();
  }, []);

  useEffect(() => {
    if (veri?.kod && tuval.current)
      QRCode.toCanvas(tuval.current, veri.kod, { width: 132, margin: 1, color: { dark: "#1d2126", light: "#ffffff" } });
  }, [veri?.kod]);

  const olustur = async () => {
    setIsleniyor(true);
    try {
      await api.gonder("/api/OkutmaKural/SerbestKod", {});
      message.success("Her yerden karekodu hazır.");
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  const yenileSor = () =>
    modal.confirm({
      title: "Kod yenilensin mi?",
      content: "Eski karekod çıktıları ve fotoğrafları hemen geçersiz olur; yeni kodu dağıtmanız gerekir.",
      okText: "Yenile",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: olustur,
    });

  const yazdir = async () => {
    if (!veri?.kod) return;
    const resim = await QRCode.toDataURL(veri.kod, { width: 900, margin: 1, color: { dark: "#1d2126", light: "#ffffff" } });
    const p = window.open("", "_blank", "width=820,height=1000");
    if (!p) return message.error("Açılır pencere engellendi. Tarayıcı ayarını kontrol ediniz.");
    p.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Her yerden karekodu</title>
<style>@page{size:A4;margin:18mm}body{font-family:"Segoe UI",system-ui,sans-serif;text-align:center;color:#1f2933;margin:0;padding:30px 20px}
h1{font-size:32px;margin:0 0 6px}.alt{font-size:18px;color:#0f766e;font-weight:700;margin-bottom:30px}
img{width:360px;height:360px;border:3px solid #0f766e;border-radius:16px;padding:14px}
.y{margin-top:30px;font-size:15px;line-height:1.8}.d{margin-top:26px;font-size:12.5px;color:#6b7280;line-height:1.7}</style></head>
<body><h1>Vardiya Giriş / Çıkış</h1><div class="alt">Her yerden karekodu</div><img src="${resim}" alt="">
<div class="y"><b>Yalnızca yetki verilen personel kullanabilir</b><br>Biçen360 › Vardiya › karekodu okutun</div>
<div class="d">Bu kod konum sınırı olmadan okutulur; kimin nereden okuttuğu kayıt altındadır.<br>Yetkisi olmayan personel okutamaz.</div>
<script>window.onload=()=>window.print();<\/script></body></html>`);
    p.document.close();
  };

  return (
    <Card size="small" style={{ marginBottom: 14, borderColor: "#99d5cb", background: "#f3fbf9" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {veri?.kod ? (
          <canvas ref={tuval} style={{ borderRadius: 8, border: "2px solid #0f766e", width: 132, height: 132 }} />
        ) : (
          <div
            style={{
              width: 132, height: 132, borderRadius: 8, border: "2px dashed #99d5cb",
              display: "grid", placeItems: "center", color: "#0f766e",
            }}
          >
            <Globe size={36} />
          </div>
        )}
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <Space size={8} style={{ marginBottom: 4 }}>
            <Globe size={16} color="#0f766e" />
            <Text strong style={{ fontSize: 15 }}>Her yerden karekodu</Text>
            {veri?.kod ? <Tag color="cyan">etkin</Tag> : <Tag>oluşturulmadı</Tag>}
          </Space>
          <div style={{ fontSize: 12.5, color: "#5b6670", lineHeight: 1.6 }}>
            Şube konumunda olmadan okutulabilen tek kod. Yalnızca <b>Okutma Kuralları</b>'nda
            “Her yerden okutabilir” kuralı verilen personel kullanabilir; diğerleri okutamaz.
            Kayıt personelin şubesiyle ve (izin verdiyse) konumuyla düşer.
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            <b>{veri?.kisi ?? 0}</b> kişi yetkili · son 30 günde <b>{veri?.son30 ?? 0}</b> okutma
          </div>
        </div>
        <Space wrap>
          {veri?.kod ? (
            <>
              <Button icon={<Printer size={14} />} onClick={yazdir}>Yazdır</Button>
              <Button danger icon={<RefreshCw size={14} />} loading={isleniyor} onClick={yenileSor}>Kodu yenile</Button>
            </>
          ) : (
            <Button type="primary" loading={isleniyor} onClick={olustur}>Kodu oluştur</Button>
          )}
          {kuralAc && <Button onClick={kuralAc}>Yetkili personel</Button>}
        </Space>
      </div>
    </Card>
  );
}

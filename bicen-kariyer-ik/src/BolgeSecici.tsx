/**
 * ---------------------------------------------------------------------------
 * Bölge Seçici
 * ---------------------------------------------------------------------------
 * Yetkisi olan kullanıcılar başlıktan bölge seçerek yalnızca o bölgelerin
 * verilerini görür. Varsayılan "Tümü"dür.
 *
 * Seçim tarayıcıda saklanır ve her istekte sunucuya iletilir; sunucu da
 * sorguları bu bölgelerin şubeleriyle sınırlar.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import { Select, Tooltip } from "antd";
import { MapPin } from "lucide-react";

import { api, bolgeleriYaz, secilenBolgeler } from "./api";

export default function BolgeSecici() {
  const [bolgeler, setBolgeler] = useState<string[]>([]);
  const [secim, setSecim] = useState<string[]>(secilenBolgeler());

  const getir = useCallback(async () => {
    try {
      const ayar = await api.al<any>("/api/Ayar/Form");

      setBolgeler(
        (ayar?.bolgeler ?? [])
          .map((b: any) => b.ad)
          .filter(Boolean)
          .sort((a: string, b: string) => a.localeCompare(b, "tr"))
      );
    } catch {
      // Bölgeler alınamazsa seçici boş kalır, panel çalışmaya devam eder
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  /**
   * Seçim değiştiğinde kaydedilir ve sayfa yenilenir.
   * Yenileme, açık olan ekranın veriyi yeni bölgeye göre çekmesini sağlar.
   */
  const degistir = (yeni: string[]) => {
    setSecim(yeni);
    bolgeleriYaz(yeni);
    window.location.reload();
  };

  if (bolgeler.length === 0) return null;

  return (
    <Tooltip title="Görüntülenecek bölgeler">
      <Select
        mode="multiple"
        allowClear
        maxTagCount={1}
        className="ik-bolge-secici"
        placeholder={
          <span className="ik-bolge-tumu">
            <MapPin size={13} strokeWidth={2} /> Tüm bölgeler
          </span>
        }
        value={secim}
        onChange={degistir}
        options={bolgeler.map((b) => ({ value: b, label: b }))}
        maxTagPlaceholder={(kalan) => `+${kalan.length}`}
      />
    </Tooltip>
  );
}

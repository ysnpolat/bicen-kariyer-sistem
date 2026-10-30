/**
 * Yenilikler penceresi (30.10.2026).
 *
 * İki kip:
 *   - "yeni": girişte kendiliğinden açılır, yalnızca okunmamışları gösterir
 *   - "hepsi": menüdeki düğmeden açılır, tüm listeyi gösterir, okunmamış
 *     olanlar "Yeni" rozetiyle işaretlidir
 *
 * Pencere nasıl kapanırsa kapansın (Tamam, Esc, perde, Ekrana git) görünen
 * en büyük numara sunucuya yazılır; aynı yenilikler bir daha kendiliğinden
 * açılmaz. Numara yalnızca ileri gider (sunucu tarafında).
 */
import { useMemo } from "react";
import { Button, Empty, Modal, Tag } from "antd";
import { Sparkles, ArrowRight } from "lucide-react";
import dayjs from "dayjs";

import type { Oturum } from "./api";
import { sayfayaGit } from "./gecis";
import { gorunenYenilikler } from "./yenilikListesi";
import type { Yenilik } from "./yenilikler/ortak";

type Props = {
  acik: boolean;
  kip: "yeni" | "hepsi";
  oturum: Oturum;
  okunan: number | null;
  /** Kapatılınca görünen en büyük numara ile çağrılır */
  kapat: (enBuyukNo: number | null) => void;
};

const tarihYaz = (t: string) => {
  const d = dayjs(t);
  if (!d.isValid()) return t;
  if (d.isSame(dayjs(), "day")) return "Bugün";
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Dün";
  return d.format("D MMMM YYYY");
};

export default function Yenilikler({ acik, kip, oturum, okunan, kapat }: Props) {
  const hepsi = useMemo(() => gorunenYenilikler(oturum), [oturum]);
  const esik = okunan ?? 0;
  const liste = kip === "yeni" ? hepsi.filter((y) => y.no > esik) : hepsi;
  const enBuyuk = hepsi.length > 0 ? hepsi[0].no : null;

  /* Güne göre grupla; liste zaten en yeni üstte */
  const gruplar = useMemo(() => {
    const m = new Map<string, Yenilik[]>();
    for (const y of liste) {
      const l = m.get(y.tarih) ?? [];
      l.push(y);
      m.set(y.tarih, l);
    }
    return [...m.entries()];
  }, [liste]);

  const bitir = () => kapat(enBuyuk);

  return (
    <Modal
      open={acik}
      onCancel={bitir}
      width={640}
      centered
      destroyOnClose
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={18} strokeWidth={2} />
          {kip === "yeni" ? "Panelde yenilikler var" : "Yenilikler"}
        </span>
      }
      footer={
        <Button type="primary" onClick={bitir}>
          Tamam
        </Button>
      }
    >
      <div style={{ maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
        {gruplar.length === 0 && <Empty description="Gösterilecek yenilik yok" image={Empty.PRESENTED_IMAGE_SIMPLE} />}

        {gruplar.map(([tarih, kayitlar]) => (
          <section key={tarih} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                color: "var(--pasif, #8a929b)",
                margin: "4px 0 8px",
              }}
            >
              {tarihYaz(tarih)}
            </div>

            {kayitlar.map((y) => (
              <article
                key={y.no}
                style={{
                  border: "1px solid var(--cizgi, #e3e6e1)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <Tag style={{ margin: 0 }}>{y.ekran}</Tag>
                  <b style={{ fontSize: 14.5 }}>{y.baslik}</b>
                  {y.no > esik && (
                    <Tag color="green" style={{ margin: 0 }}>
                      Yeni
                    </Tag>
                  )}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{y.metin}</div>
                {y.sayfa && (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      type="link"
                      style={{ padding: 0 }}
                      icon={<ArrowRight size={14} strokeWidth={2} />}
                      iconPosition="end"
                      onClick={() => {
                        bitir();
                        sayfayaGit(y.sayfa!);
                      }}
                    >
                      Ekrana git
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

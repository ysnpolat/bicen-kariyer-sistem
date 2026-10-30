/**
 * Bildirim Merkezi (07.10.2026)
 * ---------------------------------------------------------------------------
 * Üst bardaki iki çan (Bekleyen işler ve Bildirimler) tek çanda toplandı.
 * Rozet ikisinin toplamı; üzerine gelince ayrımı yazar. Çekmecede iki
 * sekme var:
 *
 *  - Bekleyen işler: önce karar sırası sizde olan personel talepleri
 *    (izin, avans, fazla mesai, rotasyon, vardiya düzeltme; dokununca ilgili
 *    sekme açılır), sonra işe alım/norm/rotasyon onayları, geciken
 *    görüşmeler, iş emirleri, Biçen Kart puan onayları ve isteklerinizin
 *    sonuçları (OnayBildirimi, gömülü).
 *  - Bildirimler: okunmamış / tümü, konuya göre süzme, güne göre gruplar;
 *    bildirime dokununca okundu olur ve ilgili sayfa açılır (BildirimCani).
 *
 * İki sekme de çekmece kapalıyken bağlı kalır: sayılar ve sağ üstte açılan
 * bildirim kutuları sürer.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Drawer, Tooltip } from "antd";
import { Bell, ArrowRight, CalendarCheck, Wallet, Clock3, Repeat2, ScanLine } from "lucide-react";

import { api, oturumOku } from "./api";
import { sayfayaGit } from "./gecis";
import OnayBildirimi from "./OnayBildirimi";
import BildirimCani from "./BildirimCani";

interface Talepler {
  izin: number | null;
  avans: number | null;
  fazlamesai: number | null;
  rotasyon: number | null;
  itiraz: number | null;
  toplam: number;
}

const TALEP_TURLERI: { k: keyof Omit<Talepler, "toplam">; ad: string; sekme: string; simge: typeof Bell }[] = [
  { k: "izin", ad: "İzin talepleri", sekme: "izin", simge: CalendarCheck },
  { k: "avans", ad: "Avans talepleri", sekme: "avans", simge: Wallet },
  { k: "fazlamesai", ad: "Fazla mesai", sekme: "fazlamesai", simge: Clock3 },
  { k: "rotasyon", ad: "Rotasyon talepleri", sekme: "rotasyon", simge: Repeat2 },
  { k: "itiraz", ad: "Vardiya düzeltme", sekme: "itiraz", simge: ScanLine },
];

export default function BildirimMerkezi() {
  const [acik, setAcik] = useState(false);
  const [sekme, setSekme] = useState<"isler" | "bildirim">("isler");
  const [isSayisi, setIsSayisi] = useState(0);
  const [bildirimSayisi, setBildirimSayisi] = useState(0);
  const [talepler, setTalepler] = useState<Talepler | null>(null);

  const talepGetir = useCallback(() => {
    if (!oturumOku()) return;
    api
      .al<Talepler>("/api/Panel/BekleyenTalepler")
      .then(setTalepler)
      .catch(() => setTalepler(null));
  }, []);

  useEffect(() => {
    talepGetir();
    const z = window.setInterval(talepGetir, 60_000);
    window.addEventListener("focus", talepGetir);
    return () => {
      window.clearInterval(z);
      window.removeEventListener("focus", talepGetir);
    };
  }, [talepGetir]);

  useEffect(() => {
    if (acik) talepGetir();
  }, [acik, talepGetir]);

  const talepToplam = talepler?.toplam ?? 0;
  const bekleyen = isSayisi + talepToplam;

  const kapat = useCallback(() => setAcik(false), []);
  const bildirimdenAc = useCallback(() => {
    setSekme("bildirim");
    setAcik(true);
  }, []);

  const ac = () => {
    /* Okunmamış bildirim varken bekleyen iş yoksa doğrudan bildirimler */
    setSekme(bekleyen === 0 && bildirimSayisi > 0 ? "bildirim" : "isler");
    setAcik(true);
  };

  const git = (s: string) => {
    setAcik(false);
    sayfayaGit("izintalep", `sekme:${s}`);
  };

  const ipucu = [
    bekleyen > 0 ? `${bekleyen} bekleyen iş` : null,
    bildirimSayisi > 0 ? `${bildirimSayisi} okunmamış bildirim` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Tooltip title={ipucu || "Bildirim merkezi"}>
        <Badge count={bekleyen + bildirimSayisi} size="small" offset={[-2, 2]} color={bekleyen > 0 ? undefined : "#5f8c10"}>
          <Button type="text" className="ik-zil" icon={<Bell size={18} strokeWidth={2} />} onClick={ac} aria-label="Bildirim merkezi" />
        </Badge>
      </Tooltip>

      <Drawer
        open={acik}
        onClose={kapat}
        forceRender
        width="min(760px, 96vw)"
        className="rp-cekmece bm-cekmece"
        title={
          <div className="bm-sekmeler" role="tablist">
            <button type="button" role="tab" className={sekme === "isler" ? "aktif" : ""} onClick={() => setSekme("isler")}>
              Bekleyen işler {bekleyen > 0 && <b className="bm-sayi kirmizi">{bekleyen}</b>}
            </button>
            <button type="button" role="tab" className={sekme === "bildirim" ? "aktif" : ""} onClick={() => setSekme("bildirim")}>
              Bildirimler {bildirimSayisi > 0 && <b className="bm-sayi">{bildirimSayisi}</b>}
            </button>
          </div>
        }
      >
        <div style={{ display: sekme === "isler" ? "block" : "none" }}>
          {/* ----------------------------- karar sırası sizde olan talepler */}
          {talepToplam > 0 && (
            <div className="bm-talepler">
              <div className="bm-baslik">
                Personel talepleri <span>karar sırası sizde</span>
              </div>
              <div className="bm-talep-izgara">
                {TALEP_TURLERI.filter((t) => (talepler?.[t.k] ?? 0) > 0).map((t) => {
                  const S = t.simge;
                  return (
                    <button key={t.k} type="button" className="bm-talep" onClick={() => git(t.sekme)}>
                      <i>
                        <S size={16} strokeWidth={2} />
                      </i>
                      <span>
                        <b>{talepler?.[t.k]}</b>
                        <small>{t.ad}</small>
                      </span>
                      <ArrowRight size={14} className="bm-ok" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <OnayBildirimi gomulu acikMi={acik && sekme === "isler"} kapat={kapat} sayiDegisti={setIsSayisi} ekBekleyen={talepToplam} />
        </div>

        <div style={{ display: sekme === "bildirim" ? "block" : "none" }}>
          <BildirimCani acikMi={acik && sekme === "bildirim"} kapat={kapat} sayiDegisti={setBildirimSayisi} ac={bildirimdenAc} />
        </div>
      </Drawer>
    </>
  );
}

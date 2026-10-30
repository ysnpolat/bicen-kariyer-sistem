/* ===========================================================================
   Biçen Kart › Kart raporları › Bekleyen işler (07.10.2026)

   Raporun üstünde dört tıklanabilir kutu: onay bekleyen puan talepleri,
   işe alımda girilip Mikro'ya işlenmeyi bekleyen kartlar, kartı tanımlı
   olmayan çalışanlar ve işten ayrılan kart bağlantıları.
   =========================================================================== */

import { useEffect, useState } from "react";
import { Drawer, Empty, Spin } from "antd";
import dayjs from "dayjs";

import { api } from "./api";
import "./IzinRapor.css";

interface Veri {
  puanBekleyen: number;
  iseAlim: { basvuruId: number; adSoyad: string; kartNo: string; tarih: string; hata: string | null; durum: string | null }[];
  kartsiz: { sicil: string; adSoyad: string; sube: string | null; pozisyon: string | null; giris: string | null }[];
}

export default function BicenKartBekleyen({ git }: { git: (g: "kartlar" | "puan" | "ayrilan") => void }) {
  const [veri, setVeri] = useState<Veri | null>(null);
  const [liste, setListe] = useState<"iseAlim" | "kartsiz" | null>(null);

  useEffect(() => {
    api.al<Veri>("/api/BicenKart/Bekleyenler").then(setVeri).catch(() => setVeri(null));
  }, []);

  if (!veri) return <Spin size="small" style={{ margin: "4px 0" }} />;

  return (
    <div className="ir" style={{ marginBottom: 14 }}>
      <div className="ir-kpiler">
        <button type="button" className={`ir-kpi ${veri.puanBekleyen ? "uyari" : ""}`} onClick={() => git("puan")}>
          <span className="et">Onay bekleyen puan talebi</span>
          <span className="d">{veri.puanBekleyen}</span>
          <span className="alt">Puan Yönetimi'nde aç</span>
        </button>
        <button type="button" className="ir-kpi" onClick={() => setListe("iseAlim")}>
          <span className="et">İşe alımda bekleyen kart</span>
          <span className="d">{veri.iseAlim.length}</span>
          <span className="alt">Mikro'ya işlenince sicile bağlanır</span>
        </button>
        <button type="button" className={`ir-kpi ${veri.kartsiz.length ? "kotu" : ""}`} onClick={() => setListe("kartsiz")}>
          <span className="et">Kartı tanımlı olmayan çalışan</span>
          <span className="d">{veri.kartsiz.length}</span>
          <span className="alt">Kartlar sekmesinden tanımlanır</span>
        </button>
        <button type="button" className="ir-kpi" onClick={() => git("ayrilan")}>
          <span className="et">İşten ayrılanların kartları</span>
          <span className="d">›</span>
          <span className="alt">Kart Bağlantıları'nda aç</span>
        </button>
      </div>

      <Drawer
        open={!!liste}
        onClose={() => setListe(null)}
        width="min(540px, 100vw)"
        title={liste === "iseAlim" ? "İşe alımda bekleyen kartlar" : "Kartı tanımlı olmayan çalışanlar"}
      >
        {liste === "iseAlim" &&
          (veri.iseAlim.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bekleyen kart yok." />
          ) : (
            <div className="ir-ck">
              <div className="ir-not bilgi">İşe alımda girilen kart, aday Mikro'ya kimlik numarasıyla çalışan olarak işlenince 15 dakika içinde sicile bağlanır.</div>
              <div className="ir-liste">
                {veri.iseAlim.map((x, i) => (
                  <button type="button" key={x.basvuruId} style={{ cursor: "default" }}>
                    <span className="sira">{i + 1}</span>
                    <span>
                      <b>{x.adSoyad}</b>
                      <small>
                        Kart {x.kartNo} · {dayjs(x.tarih).format("DD.MM.YYYY")} · {x.durum ?? "başvuru"}
                        {x.hata ? ` · ${x.hata}` : ""}
                      </small>
                    </span>
                    <span className={`ir-cip ${x.hata ? "k" : "m"}`}>{x.hata ? "bağlanamadı" : "Mikro bekleniyor"}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        {liste === "kartsiz" &&
          (veri.kartsiz.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Herkesin kartı tanımlı." />
          ) : (
            <div className="ir-ck">
              <button type="button" className="ir-kpi" style={{ alignSelf: "flex-start" }} onClick={() => { setListe(null); git("kartlar"); }}>
                <span className="et">Kartlar sekmesine git ve tanımla ›</span>
              </button>
              <div className="ir-liste">
                {veri.kartsiz.map((x, i) => (
                  <button type="button" key={x.sicil} style={{ cursor: "default" }}>
                    <span className="sira">{i + 1}</span>
                    <span>
                      <b>{x.adSoyad}</b>
                      <small>{x.pozisyon ?? "—"} · {x.sube ?? "—"} · sicil {x.sicil}</small>
                    </span>
                    <span className="deger">{x.giris ? `giriş ${dayjs(x.giris).format("DD.MM.YYYY")}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </Drawer>
    </div>
  );
}
